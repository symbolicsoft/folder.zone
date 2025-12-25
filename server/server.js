// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import {
	PORT,
	MACHINE_ID,
	REDIS_URL
} from "./config.js"
import {
	getRoomOwner,
	startRoomRefreshInterval
} from "./redis.js"
import {
	rooms
} from "./rooms.js"
import {
	websocketHandler
} from "./websocket.js"
import {
	serveStatic
} from "./staticServer.js"

Bun.serve({
	port: PORT,
	hostname: "0.0.0.0",

	async fetch(req, server) {
		const url = new URL(req.url)

		if (req.headers.get("upgrade") === "websocket") {
			const roomId = url.searchParams.get("room")

			if (roomId && REDIS_URL) {
				const owner = await getRoomOwner(roomId, rooms)

				if (owner && owner !== MACHINE_ID) {
					return new Response("Redirecting to room owner", {
						status: 307,
						headers: {
							"fly-replay": `instance=${owner}`
						},
					})
				}
			}

			const success = server.upgrade(req, {
				data: {
					room: null,
					peerId: null
				},
			})
			return success ? undefined : new Response("WebSocket upgrade failed", {
				status: 400
			})
		}

		return serveStatic(url.pathname)
	},

	websocket: websocketHandler,
})

startRoomRefreshInterval(rooms)

console.log(`Server running on port ${PORT} (machine: ${MACHINE_ID})`)