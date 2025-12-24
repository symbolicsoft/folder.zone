// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import {
	encrypt,
	decrypt
} from "./crypto.js"
import {
	ICE_SERVERS,
	WEBRTC_TIMEOUT,
	WEBRTC_BUFFER_THRESHOLD,
	WEBRTC_BUFFER_LOW,
	MSG_TYPE,
	MAX_JSON_SIZE
} from "./config.js"

export class PeerConnection {
	constructor(peerId, signaling, cryptoKey, isInitiator, onMessage, onStateChange) {
		this.peerId = peerId
		this.signaling = signaling
		this.cryptoKey = cryptoKey
		this.onMessage = onMessage
		this.onStateChange = onStateChange
		this.channel = null
		this.useRelay = false
		this.connected = false
		this.sendQueue = []
		this.pendingSend = null
		this.webrtcVerified = false
		this.jsonChunkBuffers = new Map()
		this.nextJsonMessageId = 0
		this.messageQueue = []
		this.processingMessage = false
		this.pc = new RTCPeerConnection({
			iceServers: ICE_SERVERS,
			iceCandidatePoolSize: ICE_SERVERS.length
		})
		this.pc.onicecandidate = (e) => {
			if (e.candidate) {
				signaling.send({
					type: "signal",
					targetPeerId: peerId,
					signal: {
						candidate: e.candidate
					},
				})
			}
		}
		this.pc.onconnectionstatechange = () => {
			const state = this.pc.connectionState
			if (state === "connected") {
				this.connected = true
				clearTimeout(this.fallbackTimer)
			} else if (state === "failed" || state === "disconnected") {
				this.switchToRelay()
			}
			onStateChange(state)
		}
		if (isInitiator) {
			this.channel = this.pc.createDataChannel("data")
			this.setupChannel()
			this.createOffer()
		} else {
			this.pc.ondatachannel = (e) => {
				this.channel = e.channel
				this.setupChannel()
			}
		}

		this.fallbackTimer = setTimeout(() => {
			if (!this.connected && !this.useRelay) {
				this.switchToRelay()
			}
		}, WEBRTC_TIMEOUT)
	}

	switchToRelay() {
		if (this.useRelay) return
		this.useRelay = true
		this.connected = true

		while (this.sendQueue.length > 0) {
			const {
				data,
				resolve
			} = this.sendQueue.shift()
			this.signaling.sendBinaryRelay(this.peerId, data)
			resolve()
		}

		this.onStateChange("connected (relay)")
	}

	setupChannel() {
		this.channel.binaryType = "arraybuffer"
		this.channel.bufferedAmountLowThreshold = WEBRTC_BUFFER_LOW

		this.channel.onopen = () => {
			this.connected = true
			clearTimeout(this.fallbackTimer)
		}
		this.channel.onclose = () => {
			this.switchToRelay()
		}
		this.channel.onerror = () => {
			if (this.pendingSend) {
				this.signaling.sendBinaryRelay(this.peerId, this.pendingSend)
				this.pendingSend = null
			}
			this.switchToRelay()
		}
		this.channel.onbufferedamountlow = () => {
			this.drainQueue()
		}
		this.channel.onmessage = (e) => {
			const rawData = new Uint8Array(e.data).slice()
			this._queueMessage(rawData)
		}
	}

	async createOffer() {
		const offer = await this.pc.createOffer()
		await this.pc.setLocalDescription(offer)
		this.signaling.send({
			type: "signal",
			targetPeerId: this.peerId,
			signal: {
				sdp: this.pc.localDescription
			},
		})
	}

	async handleSignal(signal) {
		try {
			if (signal.sdp) {
				await this.pc.setRemoteDescription(signal.sdp)
				if (signal.sdp.type === "offer") {
					const answer = await this.pc.createAnswer()
					await this.pc.setLocalDescription(answer)
					this.signaling.send({
						type: "signal",
						targetPeerId: this.peerId,
						signal: {
							sdp: this.pc.localDescription
						},
					})
				}
			} else if (signal.candidate) {
				await this.pc.addIceCandidate(signal.candidate)
			}
		} catch (e) {
			console.error("WebRTC signaling error:", e)
			this.switchToRelay()
		}
	}

	async handleBinaryRelay(encryptedData) {
		this._queueMessage(encryptedData)
	}

	_queueMessage(encryptedData) {
		this.messageQueue.push(encryptedData)
		this._processQueue()
	}

	async _processQueue() {
		if (this.processingMessage || this.messageQueue.length === 0) {
			return
		}

		this.processingMessage = true

		while (this.messageQueue.length > 0) {
			const encryptedData = this.messageQueue.shift()
			try {
				const decrypted = await decrypt(this.cryptoKey, encryptedData)
				await this._handleDecryptedMessage(decrypted)
			} catch (err) {
				console.error("Decrypt/parse error:", err)
			}
		}

		this.processingMessage = false
	}

	async _handleDecryptedMessage(decrypted) {
		const msgType = decrypted[0]
		if (msgType === MSG_TYPE.FILE_CHUNK || msgType === MSG_TYPE.UPLOAD_CHUNK) {
			const view = new DataView(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength)
			const index = view.getUint32(1, true)
			const total = view.getUint32(5, true)
			const pathLen = view.getUint16(9, true)
			const path = new TextDecoder().decode(decrypted.slice(11, 11 + pathLen))
			const data = decrypted.slice(11 + pathLen)
			const type = msgType === MSG_TYPE.FILE_CHUNK ? "file-chunk" : "upload-chunk"
			await this.onMessage({
				type,
				path,
				index,
				total,
				data
			})
		} else if (msgType === MSG_TYPE.JSON_CHUNK) {
			const view = new DataView(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength)
			const messageId = view.getUint32(1, true)
			const index = view.getUint32(5, true)
			const total = view.getUint32(9, true)
			const chunkData = decrypted.slice(13)
			if (!this.jsonChunkBuffers.has(messageId)) {
				// Clean up incomplete buffers after 60 seconds
				const timeout = setTimeout(() => {
					this.jsonChunkBuffers.delete(messageId)
				}, 60000)
				this.jsonChunkBuffers.set(messageId, {
					chunks: new Array(total),
					received: 0,
					total: total,
					timeout,
				})
			}
			const buffer = this.jsonChunkBuffers.get(messageId)
			if (!buffer.chunks[index]) {
				buffer.chunks[index] = chunkData
				buffer.received++
				if (buffer.received === buffer.total) {
					if (buffer.timeout) clearTimeout(buffer.timeout)
					const totalLength = buffer.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
					const fullData = new Uint8Array(totalLength)
					let offset = 0
					for (const chunk of buffer.chunks) {
						fullData.set(chunk, offset)
						offset += chunk.length
					}
					this.jsonChunkBuffers.delete(messageId)
					const text = new TextDecoder().decode(fullData)
					await this.onMessage(JSON.parse(text))
				}
			}
		} else {
			const text = new TextDecoder().decode(decrypted.slice(1))
			await this.onMessage(JSON.parse(text))
		}
	}

	async send(msg) {
		const text = JSON.stringify(msg)
		const textBytes = new TextEncoder().encode(text)
		if (textBytes.length > MAX_JSON_SIZE) {
			await this._sendChunkedJson(textBytes)
		} else {
			const data = new Uint8Array(1 + textBytes.length)
			data[0] = MSG_TYPE.JSON
			data.set(textBytes, 1)
			await this._sendEncrypted(data)
		}
	}

	async _sendChunkedJson(textBytes) {
		const messageId = this.nextJsonMessageId++
		const totalChunks = Math.ceil(textBytes.length / MAX_JSON_SIZE)
		for (let i = 0; i < totalChunks; i++) {
			const start = i * MAX_JSON_SIZE
			const end = Math.min(start + MAX_JSON_SIZE, textBytes.length)
			const chunkData = textBytes.slice(start, end)
			const header = new ArrayBuffer(13)
			const headerView = new DataView(header)
			const headerBytes = new Uint8Array(header)
			headerBytes[0] = MSG_TYPE.JSON_CHUNK
			headerView.setUint32(1, messageId, true)
			headerView.setUint32(5, i, true)
			headerView.setUint32(9, totalChunks, true)
			const data = new Uint8Array(13 + chunkData.length)
			data.set(headerBytes, 0)
			data.set(chunkData, 13)
			await this._sendEncrypted(data)
		}
	}

	async sendChunk(path, index, total, chunkData) {
		await this._sendBinaryChunk(MSG_TYPE.FILE_CHUNK, path, index, total, chunkData)
	}

	async sendUploadChunk(path, index, total, chunkData) {
		await this._sendBinaryChunk(MSG_TYPE.UPLOAD_CHUNK, path, index, total, chunkData)
	}

	async _sendBinaryChunk(msgType, path, index, total, chunkData) {
		const pathBytes = new TextEncoder().encode(path)
		const header = new ArrayBuffer(11 + pathBytes.length)
		const headerView = new DataView(header)
		const headerBytes = new Uint8Array(header)
		headerBytes[0] = msgType
		headerView.setUint32(1, index, true)
		headerView.setUint32(5, total, true)
		headerView.setUint16(9, pathBytes.length, true)
		headerBytes.set(pathBytes, 11)
		const data = new Uint8Array(header.byteLength + chunkData.byteLength)
		data.set(headerBytes, 0)
		data.set(new Uint8Array(chunkData), header.byteLength)
		await this._sendEncrypted(data)
	}

	drainQueue() {
		while (this.sendQueue.length > 0 && this.channel && this.channel.readyState === "open") {
			if (this.channel.bufferedAmount > WEBRTC_BUFFER_THRESHOLD) {
				return
			}
			const {
				data,
				resolve
			} = this.sendQueue.shift()
			this.channel.send(data)
			resolve()
		}
	}

	async _sendEncrypted(data) {
		const encrypted = await encrypt(this.cryptoKey, data)
		if (!this.useRelay && this.channel && this.channel.readyState === "open") {
			if (this.channel.bufferedAmount <= WEBRTC_BUFFER_THRESHOLD) {
				this.pendingSend = encrypted
				this.channel.send(encrypted)
				const waitTime = this.webrtcVerified ? 0 : 10
				await new Promise((r) => setTimeout(r, waitTime))
				if (this.pendingSend === null) {
					return
				}
				if (!this.useRelay && this.channel && this.channel.readyState === "open") {
					if (!this.webrtcVerified) {
						this.webrtcVerified = true
					}
					return
				}
				this.pendingSend = null
				await this.signaling.sendBinaryRelay(this.peerId, encrypted)
				return
			} else {
				await new Promise((resolve) => {
					this.sendQueue.push({
						data: encrypted,
						resolve
					})
				})
				return
			}
		}
		await this.signaling.sendBinaryRelay(this.peerId, encrypted)
	}

	close() {
		clearTimeout(this.fallbackTimer)
		for (const [, buffer] of this.jsonChunkBuffers) {
			if (buffer.timeout) clearTimeout(buffer.timeout)
		}
		this.jsonChunkBuffers.clear()
		if (this.channel) this.channel.close()
		this.pc.close()
	}
}