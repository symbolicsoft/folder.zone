// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import {
	BINARY_RELAY
} from "./config.js"

const WS_BUFFER_THRESHOLD = 4 * 1024 * 1024
const WS_BUFFER_CHECK_INTERVAL = 50
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]

export class Signaling {
	constructor(onMessage, onError, onBinaryRelay, onReconnect) {
		this.onMessage = onMessage
		this.onError = onError || (() => {})
		this.onBinaryRelay = onBinaryRelay || (() => {})
		this.onReconnect = onReconnect || (() => {})
		this.ws = null
		this.peerId = null
		this.room = null
		this.reconnectAttempt = 0
		this.reconnectTimer = null
		this.intentionallyClosed = false
	}

	connect(room) {
		this.room = room
		this.intentionallyClosed = false
		this._connect()
	}

	_connect() {
		const protocol = location.protocol === "https:" ? "wss:" : "ws:"
		this.ws = new WebSocket(`${protocol}//${location.host}?room=${encodeURIComponent(this.room)}`)
		this.ws.binaryType = "arraybuffer"

		this.ws.onopen = () => {
			this.reconnectAttempt = 0
			this.ws.send(JSON.stringify({
				type: "join",
				room: this.room
			}))
		}

		this.ws.onmessage = (event) => {
			if (event.data instanceof ArrayBuffer) {
				const bytes = new Uint8Array(event.data)
				if (bytes[0] === BINARY_RELAY) {
					const peerIdLen = (bytes[1] << 8) | bytes[2]
					const fromPeerId = new TextDecoder().decode(bytes.slice(3, 3 + peerIdLen))
					const data = bytes.slice(3 + peerIdLen)
					this.onBinaryRelay(fromPeerId, data)
				}
				return
			}

			const msg = JSON.parse(event.data)

			if (msg.type === "peer-id") {
				const isReconnect = this.peerId !== null && this.peerId !== msg.peerId
				this.peerId = msg.peerId
				if (isReconnect) {
					this.onReconnect()
				}
				return
			}

			if (msg.type === "error") {
				this.onError(msg.message)
				return
			}

			this.onMessage(msg)
		}

		this.ws.onclose = () => {
			if (this.intentionallyClosed) return
			this._scheduleReconnect()
		}

		this.ws.onerror = () => {}
	}

	_scheduleReconnect() {
		if (this.reconnectTimer) return

		const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)]
		this.reconnectAttempt++

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			if (!this.intentionallyClosed) {
				this._connect()
			}
		}, delay)
	}

	send(msg) {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg))
		}
	}

	async sendBinaryRelay(targetPeerId, data) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			return
		}

		while (this.ws.bufferedAmount > WS_BUFFER_THRESHOLD) {
			await new Promise((r) => setTimeout(r, WS_BUFFER_CHECK_INTERVAL))
			if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
				return
			}
		}

		const peerIdBytes = new TextEncoder().encode(targetPeerId)
		const msg = new Uint8Array(3 + peerIdBytes.length + data.length)
		msg[0] = BINARY_RELAY
		msg[1] = (peerIdBytes.length >> 8) & 0xff
		msg[2] = peerIdBytes.length & 0xff
		msg.set(peerIdBytes, 3)
		msg.set(data, 3 + peerIdBytes.length)
		this.ws.send(msg)
	}

	close() {
		this.intentionallyClosed = true
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
		if (this.ws) {
			this.ws.close()
			this.ws = null
		}
	}
}