// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import {
	dirname,
	join
} from "path"
import {
	fileURLToPath
} from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))

export const PORT = process.env.PORT || 3000
export const CLIENT_DIR = join(__dirname, "..", "client")
export const MACHINE_ID = process.env.FLY_MACHINE_ID || "local"
export const REDIS_URL = process.env.REDIS_URL
export const REDIS_TOKEN = process.env.REDIS_TOKEN

export const MIME_TYPES = {
	".html": "text/html",
	".css": "text/css",
	".js": "application/javascript",
	".json": "application/json",
	".png": "image/png",
	".ico": "image/x-icon",
}

export const BINARY_RELAY = 1

export const LIMITS = {
	maxRooms: 10000,
	maxPeersPerRoom: 50,
	maxRelayMessageSize: 2 * 1024 * 1024,
	roomIdMaxLength: 32,
	roomIdPattern: /^[a-zA-Z0-9_-]+$/,
	messagesPerMinute: 300,
	relayBytesPerMinute: 100 * 1024 * 1024,
}