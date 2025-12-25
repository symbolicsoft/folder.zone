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

// HTTP server port. Defaults to 3000 if PORT env var is not set.
export const PORT = process.env.PORT || 3000

// Path to the client static files directory.
export const CLIENT_DIR = join(__dirname, "..", "client")

// Unique identifier for this server instance.
// Uses Fly.io's machine ID in production, "local" for development.
// Used for coordinating rooms across multiple server instances via Redis.
export const MACHINE_ID = process.env.FLY_MACHINE_ID || "local"

// Upstash Redis REST API URL for cross-instance room coordination.
// Required for horizontal scaling; rooms are local-only if not set.
export const REDIS_URL = process.env.REDIS_URL

// Upstash Redis REST API authentication token.
export const REDIS_TOKEN = process.env.REDIS_TOKEN

// Content-Type mappings for static file serving.
export const MIME_TYPES = {
	".html": "text/html",
	".css": "text/css",
	".js": "application/javascript",
	".json": "application/json",
	".png": "image/png",
	".ico": "image/x-icon",
}

// Protocol identifier for binary relay messages through the WebSocket.
// Used as the first byte to distinguish relay data from JSON signaling messages.
export const BINARY_RELAY = 1

// Server-side limits for rate limiting and resource protection.
export const LIMITS = {
	// Maximum number of rooms the server can host simultaneously.
	maxRooms: 100000000,
	// Maximum peers allowed in a single room.
	maxPeersPerRoom: 256,
	// Maximum size of a single relay message in bytes (2MB).
	// Messages exceeding this are rejected to prevent memory exhaustion.
	maxRelayMessageSize: 2 * 1024 * 1024,
	// Maximum length of a room ID string.
	roomIdMaxLength: 32,
	// Allowed characters in room IDs (alphanumeric, underscore, hyphen).
	roomIdPattern: /^[a-zA-Z0-9_-]+$/,
	// Maximum WebSocket messages per peer per minute.
	messagesPerMinute: 100000000,
	// Maximum relay bytes per peer per minute (5GB).
	relayBytesPerMinute: 5000 * 1024 * 1024,
}