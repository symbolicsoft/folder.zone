// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import {
	MACHINE_ID
} from "./config.js"
import {
	claimRoom,
	releaseRoom
} from "./redis.js"

export const rooms = new Map()

export async function joinRoom(roomId, peerId, ws) {
	if (!rooms.has(roomId)) {
		rooms.set(roomId, new Map())
		await claimRoom(roomId)
	}

	const room = rooms.get(roomId)

	for (const [existingPeerId, peer] of room) {
		peer.send(
			JSON.stringify({
				type: "peer-joined",
				peerId: peerId,
			}),
		)
		ws.send(
			JSON.stringify({
				type: "peer-joined",
				peerId: existingPeerId,
			}),
		)
	}

	room.set(peerId, ws)
	console.log(`[${MACHINE_ID}] Peer ${peerId} joined room ${roomId} (${room.size} peers)`)
}

export async function leaveRoom(roomId, peerId) {
	if (!rooms.has(roomId)) return

	const room = rooms.get(roomId)
	room.delete(peerId)

	for (const [, peer] of room) {
		peer.send(JSON.stringify({
			type: "peer-left",
			peerId
		}))
	}

	if (room.size === 0) {
		rooms.delete(roomId)
		await releaseRoom(roomId)
	}

	console.log(`[${MACHINE_ID}] Peer ${peerId} left room ${roomId}`)
}

export function forwardSignal(roomId, fromPeerId, targetPeerId, signal) {
	const room = rooms.get(roomId)
	if (room && room.has(targetPeerId)) {
		room.get(targetPeerId).send(
			JSON.stringify({
				type: "signal",
				fromPeerId: fromPeerId,
				signal: signal,
			}),
		)
	}
}

const BINARY_RELAY = 1

export function relayBinary(roomId, fromPeerId, targetPeerId, data) {
	const room = rooms.get(roomId)
	if (room && room.has(targetPeerId)) {
		// Build binary message: [type(1)][peerIdLen(2)][peerId][data]
		const peerIdBytes = new TextEncoder().encode(fromPeerId)
		const msg = new Uint8Array(3 + peerIdBytes.length + data.length)
		msg[0] = BINARY_RELAY
		msg[1] = (peerIdBytes.length >> 8) & 0xff
		msg[2] = peerIdBytes.length & 0xff
		msg.set(peerIdBytes, 3)
		msg.set(data, 3 + peerIdBytes.length)
		room.get(targetPeerId).send(msg)
	}
}