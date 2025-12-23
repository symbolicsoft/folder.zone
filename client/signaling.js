// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

const BINARY_RELAY = 1

export class Signaling {
	constructor(onMessage, onError, onBinaryRelay) {
		this.onMessage = onMessage
		this.onError = onError || (() => {})
		this.onBinaryRelay = onBinaryRelay || (() => {})
		this.ws = null
		this.peerId = null // Assigned by server
		this.room = null
	}

	connect(room) {
		this.room = room
		const protocol = location.protocol === "https:" ? "wss:" : "ws:"
		this.ws = new WebSocket(`${protocol}//${location.host}?room=${room}`)
		this.ws.binaryType = "arraybuffer"

		this.ws.onopen = () => {
			// Request to join - server will assign peer ID
			this.ws.send(JSON.stringify({ type: "join", room }))
		}

		this.ws.onmessage = (event) => {
			// Handle binary relay messages
			if (event.data instanceof ArrayBuffer) {
				const bytes = new Uint8Array(event.data)
				console.log(`Received binary message: ${bytes.length} bytes, type=${bytes[0]}`)
				if (bytes[0] === BINARY_RELAY) {
					const peerIdLen = (bytes[1] << 8) | bytes[2]
					const fromPeerId = new TextDecoder().decode(bytes.slice(3, 3 + peerIdLen))
					const data = bytes.slice(3 + peerIdLen)
					console.log(`Relay message from ${fromPeerId}: ${data.length} bytes`)
					this.onBinaryRelay(fromPeerId, data)
				}
				return
			}

			const msg = JSON.parse(event.data)

			// Handle server-assigned peer ID
			if (msg.type === "peer-id") {
				this.peerId = msg.peerId
				return
			}

			// Handle server errors
			if (msg.type === "error") {
				this.onError(msg.message)
				return
			}

			this.onMessage(msg)
		}

		this.ws.onclose = () => {
			console.log("Signaling connection closed")
		}
	}

	send(msg) {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg))
		}
	}

	// Send binary relay message: [type(1)][peerIdLen(2)][peerId][data]
	sendBinaryRelay(targetPeerId, data) {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			const peerIdBytes = new TextEncoder().encode(targetPeerId)
			const msg = new Uint8Array(3 + peerIdBytes.length + data.length)
			msg[0] = BINARY_RELAY
			msg[1] = (peerIdBytes.length >> 8) & 0xff
			msg[2] = peerIdBytes.length & 0xff
			msg.set(peerIdBytes, 3)
			msg.set(data, 3 + peerIdBytes.length)
			this.ws.send(msg)
		}
	}
}
