// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

export const CHUNK_SIZE = 64 * 1024
export const WEBRTC_TIMEOUT = 5000
export const WEBRTC_BUFFER_THRESHOLD = 4 * 1024 * 1024
export const WEBRTC_BUFFER_LOW = 1024 * 1024

export const ICE_SERVERS = [{
		urls: "stun:stun.l.google.com:19302"
	},
	{
		urls: "stun:stun.l.google.com:5349"
	},
	{
		urls: "stun:stun1.l.google.com:3478"
	},
	{
		urls: "stun:stun1.l.google.com:5349"
	},
	{
		urls: "stun:stun2.l.google.com:19302"
	},
	{
		urls: "stun:stun2.l.google.com:5349"
	},
	{
		urls: "stun:stun3.l.google.com:3478"
	},
	{
		urls: "stun:stun3.l.google.com:5349"
	},
	{
		urls: "stun:stun4.l.google.com:19302"
	},
	{
		urls: "stun:stun4.l.google.com:5349"
	},
	{
		urls: [
			"stun:stun.cloudflare.com:3478",
			"stun:stun.cloudflare.com:53"
		]
	},
]

export const MSG_TYPE = {
	JSON: 0,
	FILE_CHUNK: 1,
	UPLOAD_CHUNK: 2,
	JSON_CHUNK: 3,
}

export const MAX_JSON_SIZE = 48 * 1024

export const DOWNLOAD_RATE_LIMIT = 60

export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024

export const UPLOAD_LIMITS = {
	maxFilenameLength: 255,
	maxPathDepth: 10,
	rateLimitPerMinute: 30,
}

export const FILE_LIST_LIMITS = {
	maxFiles: 50000,
	maxFileListSize: 5 * 1024 * 1024,
}

export const BINARY_RELAY = 1