// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import {
	REDIS_URL,
	REDIS_TOKEN,
	MACHINE_ID
} from "./config.js"

const ROOM_TTL_SECONDS = 300

export async function redisGet(key) {
	if (!REDIS_URL) return null
	try {
		const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
			headers: {
				Authorization: `Bearer ${REDIS_TOKEN}`
			},
		})
		const data = await res.json()
		return data.result
	} catch {
		return null
	}
}

async function redisSet(key, value, exSeconds) {
	if (!REDIS_URL) return true
	try {
		const res = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/nx/ex/${exSeconds}`, {
			headers: {
				Authorization: `Bearer ${REDIS_TOKEN}`
			},
		})
		const data = await res.json()
		return data.result === "OK"
	} catch {
		return false
	}
}

async function redisExpire(key, exSeconds) {
	if (!REDIS_URL) return true
	try {
		const res = await fetch(`${REDIS_URL}/expire/${encodeURIComponent(key)}/${exSeconds}`, {
			headers: {
				Authorization: `Bearer ${REDIS_TOKEN}`
			},
		})
		const data = await res.json()
		return data.result === 1
	} catch {
		return false
	}
}

export async function redisDel(key) {
	if (!REDIS_URL) return true
	try {
		const res = await fetch(`${REDIS_URL}/del/${encodeURIComponent(key)}`, {
			headers: {
				Authorization: `Bearer ${REDIS_TOKEN}`
			},
		})
		const data = await res.json()
		return data.result === 1
	} catch {
		return false
	}
}

export async function getRoomOwner(roomId, rooms) {
	if (rooms.has(roomId)) return MACHINE_ID
	return await redisGet(`room:${roomId}`)
}

export async function claimRoom(roomId) {
	const claimed = await redisSet(`room:${roomId}`, MACHINE_ID, ROOM_TTL_SECONDS)
	if (claimed) {
		return {
			success: true
		}
	}
	const owner = await redisGet(`room:${roomId}`)
	if (owner === MACHINE_ID) {
		return {
			success: true
		}
	}
	return {
		success: false,
		owner
	}
}

export async function refreshRoomClaim(roomId) {
	return await redisExpire(`room:${roomId}`, ROOM_TTL_SECONDS)
}

export async function releaseRoom(roomId) {
	await redisDel(`room:${roomId}`)
}

export function startRoomRefreshInterval(rooms) {
	if (!REDIS_URL) return null
	return setInterval(async () => {
		for (const roomId of rooms.keys()) {
			await refreshRoomClaim(roomId)
		}
	}, (ROOM_TTL_SECONDS / 2) * 1000)
}