// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import { encrypt, decrypt } from "./crypto.js"
import { ICE_SERVERS, WEBRTC_TIMEOUT, WEBRTC_BUFFER_THRESHOLD, WEBRTC_BUFFER_LOW, MSG_TYPE, MAX_JSON_SIZE } from "./config.js"

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

		this.pendingSend = null // Track in-flight send for error recovery
		this.webrtcVerified = false // True after first successful WebRTC send
		this.jsonChunkBuffers = new Map() // For reassembling chunked JSON messages
		this.nextJsonMessageId = 0 // Counter for chunked JSON message IDs

		this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

		this.pc.onicecandidate = (e) => {
			if (e.candidate) {
				signaling.send({
					type: "signal",
					targetPeerId: peerId,
					signal: { candidate: e.candidate },
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
		console.log(`Peer ${this.peerId}: falling back to relay mode`)

		// Drain any queued sends via relay
		while (this.sendQueue.length > 0) {
			const { data, resolve } = this.sendQueue.shift()
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
			console.log("Data channel opened")
		}
		this.channel.onclose = () => {
			console.log("Data channel closed")
			this.switchToRelay()
		}
		this.channel.onerror = (e) => {
			console.error("Data channel error:", e)
			// If there's an in-flight send, relay it now
			if (this.pendingSend) {
				console.log("Retrying failed send via relay")
				this.signaling.sendBinaryRelay(this.peerId, this.pendingSend)
				this.pendingSend = null
			}
			this.switchToRelay()
		}
		this.channel.onbufferedamountlow = () => {
			this.drainQueue()
		}
		this.channel.onmessage = async (e) => {
			// Copy data immediately before any async operations
			const rawData = new Uint8Array(e.data).slice()
			try {
				const decrypted = await decrypt(this.cryptoKey, rawData)
				this._handleDecryptedMessage(decrypted)
			} catch (err) {
				console.error("Decrypt/parse error:", err)
			}
		}
	}

	async createOffer() {
		const offer = await this.pc.createOffer()
		await this.pc.setLocalDescription(offer)
		this.signaling.send({
			type: "signal",
			targetPeerId: this.peerId,
			signal: { sdp: this.pc.localDescription },
		})
	}

	async handleSignal(signal) {
		if (signal.sdp) {
			await this.pc.setRemoteDescription(signal.sdp)
			if (signal.sdp.type === "offer") {
				const answer = await this.pc.createAnswer()
				await this.pc.setLocalDescription(answer)
				this.signaling.send({
					type: "signal",
					targetPeerId: this.peerId,
					signal: { sdp: this.pc.localDescription },
				})
			}
		} else if (signal.candidate) {
			await this.pc.addIceCandidate(signal.candidate)
		}
	}

	async handleBinaryRelay(encryptedData) {
		try {
			const decrypted = await decrypt(this.cryptoKey, encryptedData)
			this._handleDecryptedMessage(decrypted)
		} catch (err) {
			console.error("Relay decrypt/parse error:", err)
		}
	}

	_handleDecryptedMessage(decrypted) {
		const msgType = decrypted[0]

		if (msgType === MSG_TYPE.FILE_CHUNK || msgType === MSG_TYPE.UPLOAD_CHUNK) {
			// Binary chunk: [type(1)][index(4)][total(4)][pathLen(2)][path][data]
			const view = new DataView(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength)
			const index = view.getUint32(1, true)
			const total = view.getUint32(5, true)
			if (index % 100 === 0) {
				console.log(`Received chunk ${index}/${total}`)
			}
			const pathLen = view.getUint16(9, true)
			const path = new TextDecoder().decode(decrypted.slice(11, 11 + pathLen))
			const data = decrypted.slice(11 + pathLen)
			const type = msgType === MSG_TYPE.FILE_CHUNK ? "file-chunk" : "upload-chunk"
			this.onMessage({ type, path, index, total, data })
		} else if (msgType === MSG_TYPE.JSON_CHUNK) {
			// Chunked JSON: [type(1)][messageId(4)][index(4)][total(4)][data]
			const view = new DataView(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength)
			const messageId = view.getUint32(1, true)
			const index = view.getUint32(5, true)
			const total = view.getUint32(9, true)
			const chunkData = decrypted.slice(13)

			// Get or create buffer for this message
			if (!this.jsonChunkBuffers.has(messageId)) {
				this.jsonChunkBuffers.set(messageId, {
					chunks: new Array(total),
					received: 0,
					total: total,
				})
			}

			const buffer = this.jsonChunkBuffers.get(messageId)
			if (!buffer.chunks[index]) {
				buffer.chunks[index] = chunkData
				buffer.received++

				// Check if complete
				if (buffer.received === buffer.total) {
					// Reassemble the JSON
					const totalLength = buffer.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
					const fullData = new Uint8Array(totalLength)
					let offset = 0
					for (const chunk of buffer.chunks) {
						fullData.set(chunk, offset)
						offset += chunk.length
					}
					this.jsonChunkBuffers.delete(messageId)

					const text = new TextDecoder().decode(fullData)
					this.onMessage(JSON.parse(text))
				}
			}
		} else {
			// Regular JSON message
			const text = new TextDecoder().decode(decrypted.slice(1))
			this.onMessage(JSON.parse(text))
		}
	}

	async send(msg) {
		const text = JSON.stringify(msg)
		const textBytes = new TextEncoder().encode(text)

		// Check if message needs chunking
		if (textBytes.length > MAX_JSON_SIZE) {
			await this._sendChunkedJson(textBytes)
		} else {
			// Small message - send directly with JSON type byte
			const data = new Uint8Array(1 + textBytes.length)
			data[0] = MSG_TYPE.JSON
			data.set(textBytes, 1)
			await this._sendEncrypted(data)
		}
	}

	async _sendChunkedJson(textBytes) {
		const messageId = this.nextJsonMessageId++
		const totalChunks = Math.ceil(textBytes.length / MAX_JSON_SIZE)

		console.log(`Sending chunked JSON: ${textBytes.length} bytes in ${totalChunks} chunks`)

		for (let i = 0; i < totalChunks; i++) {
			const start = i * MAX_JSON_SIZE
			const end = Math.min(start + MAX_JSON_SIZE, textBytes.length)
			const chunkData = textBytes.slice(start, end)

			// Format: [type(1)][messageId(4)][index(4)][total(4)][data]
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

	// Send binary file chunk (download direction: host -> peer)
	async sendChunk(path, index, total, chunkData) {
		await this._sendBinaryChunk(MSG_TYPE.FILE_CHUNK, path, index, total, chunkData)
	}

	// Send binary upload chunk (upload direction: peer -> host)
	async sendUploadChunk(path, index, total, chunkData) {
		await this._sendBinaryChunk(MSG_TYPE.UPLOAD_CHUNK, path, index, total, chunkData)
	}

	async _sendBinaryChunk(msgType, path, index, total, chunkData) {
		const pathBytes = new TextEncoder().encode(path)
		// Format: [type(1)][index(4)][total(4)][pathLen(2)][path][data]
		const header = new ArrayBuffer(11 + pathBytes.length)
		const headerView = new DataView(header)
		const headerBytes = new Uint8Array(header)

		headerBytes[0] = msgType
		headerView.setUint32(1, index, true)
		headerView.setUint32(5, total, true)
		headerView.setUint16(9, pathBytes.length, true)
		headerBytes.set(pathBytes, 11)

		// Combine header + chunk data
		const data = new Uint8Array(header.byteLength + chunkData.byteLength)
		data.set(headerBytes, 0)
		data.set(new Uint8Array(chunkData), header.byteLength)

		await this._sendEncrypted(data)
	}

	drainQueue() {
		while (this.sendQueue.length > 0 && this.channel && this.channel.readyState === "open") {
			if (this.channel.bufferedAmount > WEBRTC_BUFFER_THRESHOLD) {
				return // Wait for next bufferedamountlow event
			}
			const { data, resolve } = this.sendQueue.shift()
			this.channel.send(data)
			resolve()
		}
	}

	async _sendEncrypted(data) {
		const encrypted = await encrypt(this.cryptoKey, data)

		// Use direct WebRTC channel if available
		if (!this.useRelay && this.channel && this.channel.readyState === "open") {
			// If buffer is low enough, send immediately
			if (this.channel.bufferedAmount <= WEBRTC_BUFFER_THRESHOLD) {
				// Track this send so onerror can retry it if it fails
				this.pendingSend = encrypted
				this.channel.send(encrypted)

				// For verified channel, just yield briefly to catch immediate errors
				// For unverified channel, wait longer to confirm it works
				const waitTime = this.webrtcVerified ? 0 : 10
				await new Promise((r) => setTimeout(r, waitTime))

				// Check if onerror handled it (set pendingSend to null)
				if (this.pendingSend === null) {
					// onerror already retried via relay, we're done
					return
				}

				// Check if send succeeded (channel still valid and not switched to relay)
				if (!this.useRelay && this.channel && this.channel.readyState === "open") {
					if (!this.webrtcVerified) {
						this.webrtcVerified = true
						console.log("WebRTC channel verified working")
					}
					// Don't clear pendingSend - leave it for onerror to catch late failures
					return
				}

				// Channel died after send but onerror didn't catch it, retry via relay
				console.log("WebRTC send failed asynchronously, retrying via relay")
				this.pendingSend = null
				await this.signaling.sendBinaryRelay(this.peerId, encrypted)
				return
			} else {
				// Buffer too full, queue and wait
				console.log(`Queueing: buffer=${(this.channel.bufferedAmount / 1024 / 1024).toFixed(1)}MB`)
				await new Promise((resolve) => {
					this.sendQueue.push({ data: encrypted, resolve })
				})
				return
			}
		}
		// Use relay as fallback - send binary directly (with flow control)
		await this.signaling.sendBinaryRelay(this.peerId, encrypted)
	}

	close() {
		clearTimeout(this.fallbackTimer)
		if (this.channel) this.channel.close()
		this.pc.close()
	}
}
