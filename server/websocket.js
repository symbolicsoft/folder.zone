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
	LIMITS,
	BINARY_RELAY
} from "./config.js"

import {
	randomBytes
} from "crypto"

const textDecoder = new TextDecoder()
const rateLimitState = new WeakMap()
const WINDOW_MS = 60_000

function getRateLimitState(ws) {
	let state = rateLimitState.get(ws)
	if (!state) {
		state = {
			windowStart: 0,
			messageCount: 0,
			relayBytes: 0
		}
		rateLimitState.set(ws, state)
	}
	const now = Date.now()
	if (now - state.windowStart >= WINDOW_MS) {
		state.windowStart = now
		state.messageCount = 0
		state.relayBytes = 0
	}
	return state
}

function isMessageAllowed(ws) {
	const state = getRateLimitState(ws)
	if (state.messageCount >= LIMITS.messagesPerMinute) return false
	state.messageCount++
	return true
}

function isRelayAllowed(ws, byteCount) {
	const state = getRateLimitState(ws)
	if (state.relayBytes + byteCount > LIMITS.relayBytesPerMinute) return false
	state.relayBytes += byteCount
	return true
}

function isValidRoomId(roomId) {
	if (!roomId || typeof roomId !== "string") return false
	if (roomId.length > LIMITS.roomIdMaxLength) return false
	return LIMITS.roomIdPattern.test(roomId)
}

function generatePeerId() {
	return randomBytes(16).toString("base64url")
}

export const websocketHandler = {
	async message(ws, data) {
		try {
			if (data instanceof Buffer || data instanceof Uint8Array) {
				const bytes = new Uint8Array(data)
				if (bytes.length > LIMITS.maxRelayMessageSize) {
					console.warn("Binary message too large, dropping")
					return
				}
				if (!isRelayAllowed(ws, bytes.length)) {
					console.warn("Relay bandwidth limit exceeded, dropping message")
					return
				}
				if (bytes[0] === BINARY_RELAY && ws.data.peerId) {
					const peerIdLen = (bytes[1] << 8) | bytes[2]
					const targetPeerId = textDecoder.decode(bytes.slice(3, 3 + peerIdLen))
					const relayPayload = bytes.slice(3 + peerIdLen)
					relayBinary(ws.data.room, ws.data.peerId, targetPeerId, relayPayload)
				}
				return
			}
			if (!isMessageAllowed(ws)) {
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
					if (!isValidRoomId(msg.room)) {
						ws.send(JSON.stringify({
							type: "error",
							message: "Invalid room ID"
						}))
						ws.close()
						return
					}
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
					const peerId = generatePeerId()
					const result = await joinRoom(msg.room, peerId, ws)
					if (!result.success) {
						ws.close()
						return
					}
					ws.data.room = msg.room
					ws.data.peerId = peerId
					ws.send(JSON.stringify({
						type: "peer-id",
						peerId
					}))
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