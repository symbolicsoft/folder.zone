// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import {
	rooms,
	joinRoom,
	leaveRoom,
	forwardSignal,
	relayBinary
} from "./rooms.js"
import {
	generatePeerId,
	LIMITS
} from "./config.js"

const BINARY_RELAY = 1

// Server-side rate limiter for WebSocket connections
class ConnectionRateLimiter {
	constructor() {
		this.connections = new WeakMap()
	}

	getOrCreate(ws) {
		if (!this.connections.has(ws)) {
			this.connections.set(ws, {
				messageTimestamps: [],
				relayBytes: [],
			})
		}
		return this.connections.get(ws)
	}

	isMessageAllowed(ws) {
		const state = this.getOrCreate(ws)
		const now = Date.now()
		const minute = 60 * 1000

		state.messageTimestamps = state.messageTimestamps.filter((t) => now - t < minute)

		if (state.messageTimestamps.length >= LIMITS.messagesPerMinute) {
			return false
		}

		state.messageTimestamps.push(now)
		return true
	}

	isRelayAllowed(ws, byteCount) {
		const state = this.getOrCreate(ws)
		const now = Date.now()
		const minute = 60 * 1000

		state.relayBytes = state.relayBytes.filter((entry) => now - entry.time < minute)

		const totalBytes = state.relayBytes.reduce((sum, entry) => sum + entry.bytes, 0)
		if (totalBytes + byteCount > LIMITS.relayBytesPerMinute) {
			return false
		}

		state.relayBytes.push({
			time: now,
			bytes: byteCount
		})
		return true
	}
}

const rateLimiter = new ConnectionRateLimiter()

function isValidRoomId(roomId) {
	if (!roomId || typeof roomId !== "string") return false
	if (roomId.length > LIMITS.roomIdMaxLength) return false
	return LIMITS.roomIdPattern.test(roomId)
}

export const websocketHandler = {
	open(ws) {
		// Connection opened, wait for join message
	},

	async message(ws, data) {
		try {
			// Handle binary relay messages (separate rate limiting via bandwidth)
			if (data instanceof Buffer || data instanceof Uint8Array) {
				const bytes = new Uint8Array(data)
				if (bytes.length > LIMITS.maxRelayMessageSize) {
					console.warn("Binary message too large, dropping")
					return
				}

				// Rate limit relay bandwidth
				if (!rateLimiter.isRelayAllowed(ws, bytes.length)) {
					console.warn("Relay bandwidth limit exceeded, dropping message")
					return
				}

				if (bytes[0] === BINARY_RELAY && ws.data.peerId) {
					// Parse: [type(1)][peerIdLen(2)][peerId][data]
					const peerIdLen = (bytes[1] << 8) | bytes[2]
					const targetPeerId = new TextDecoder().decode(bytes.slice(3, 3 + peerIdLen))
					const relayPayload = bytes.slice(3 + peerIdLen)
					relayBinary(ws.data.room, ws.data.peerId, targetPeerId, relayPayload)
				}
				return
			}

			// Handle JSON messages - rate limit signaling messages
			if (!rateLimiter.isMessageAllowed(ws)) {
				console.warn("Rate limit exceeded, dropping message")
				return
			}

			if (typeof data === "string" && data.length > LIMITS.maxRelayMessageSize) {
				console.warn("Message too large, dropping")
				return
			}

			const msg = JSON.parse(data)

			switch (msg.type) {
				case "join": {
					// Validate room ID to prevent injection attacks
					if (!isValidRoomId(msg.room)) {
						ws.send(JSON.stringify({
							type: "error",
							message: "Invalid room ID"
						}))
						ws.close()
						return
					}

					// Check room limits
					if (!rooms.has(msg.room) && rooms.size >= LIMITS.maxRooms) {
						ws.send(JSON.stringify({
							type: "error",
							message: "Server at capacity"
						}))
						ws.close()
						return
					}

					const room = rooms.get(msg.room)
					if (room && room.size >= LIMITS.maxPeersPerRoom) {
						ws.send(JSON.stringify({
							type: "error",
							message: "Room is full"
						}))
						ws.close()
						return
					}

					// Generate peer ID server-side (ignore client-provided ID)
					const peerId = generatePeerId()
					ws.data.room = msg.room
					ws.data.peerId = peerId

					// Send assigned peer ID to client
					ws.send(JSON.stringify({
						type: "peer-id",
						peerId
					}))

					await joinRoom(msg.room, peerId, ws)
					break
				}

				case "signal": {
					if (!ws.data.peerId) return
					forwardSignal(ws.data.room, ws.data.peerId, msg.targetPeerId, msg.signal)
					break
				}
			}
		} catch (e) {
			console.error("Message parse error:", e)
		}
	},

	async close(ws) {
		const {
			room,
			peerId
		} = ws.data
		if (room && peerId) {
			await leaveRoom(room, peerId)
		}
	},
}