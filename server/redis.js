// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import { REDIS_URL, REDIS_TOKEN, MACHINE_ID } from "./config.js"

export async function redisGet(key) {
	if (!REDIS_URL) return null
	try {
		const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
			headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
		})
		const data = await res.json()
		return data.result
	} catch {
		return null
	}
}

export async function redisSet(key, value, exSeconds = 86400) {
	if (!REDIS_URL) return
	try {
		await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/ex/${exSeconds}`, {
			headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
		})
	} catch {}
}

export async function redisDel(key) {
	if (!REDIS_URL) return
	try {
		await fetch(`${REDIS_URL}/del/${encodeURIComponent(key)}`, {
			headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
		})
	} catch {}
}

export async function getRoomOwner(roomId, rooms) {
	if (rooms.has(roomId)) return MACHINE_ID
	return await redisGet(`room:${roomId}`)
}

export async function claimRoom(roomId) {
	await redisSet(`room:${roomId}`, MACHINE_ID)
}

export async function releaseRoom(roomId) {
	await redisDel(`room:${roomId}`)
}
