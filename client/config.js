// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

// Transfer configuration
export const CHUNK_SIZE = 64 * 1024 // 64KB - WebRTC data channels have ~256KB message limit

// WebRTC configuration
export const WEBRTC_TIMEOUT = 10000 // 10 seconds to establish connection before relay fallback
export const WEBRTC_BUFFER_THRESHOLD = 4 * 1024 * 1024 // 4MB - pause sending when buffer exceeds this
export const WEBRTC_BUFFER_LOW = 1024 * 1024 // 1MB - resume sending when buffer drops below this

// ICE servers for WebRTC
export const ICE_SERVERS = [{
	urls: "stun:stun.l.google.com:19302"
}, {
	urls: "stun:stun1.l.google.com:19302"
}]

// Binary message types for peer communication
export const MSG_TYPE = {
	JSON: 0,
	FILE_CHUNK: 1,
	UPLOAD_CHUNK: 2,
	JSON_CHUNK: 3, // For large JSON messages that need chunking
}

// Maximum JSON message size before chunking (must be less than WebRTC limit after encryption overhead)
export const MAX_JSON_SIZE = 48 * 1024 // 48KB - leaves room for encryption overhead

// Rate limiting
export const DOWNLOAD_RATE_LIMIT = 60 // requests per minute per peer

// Upload limits
export const UPLOAD_LIMITS = {
	maxFileSize: 2 * 1024 * 1024 * 1024, // 2GB
	maxFilenameLength: 255,
	maxPathDepth: 10,
	rateLimitPerMinute: 30,
}

// File list limits (DoS protection)
export const FILE_LIST_LIMITS = {
	maxFiles: 50000, // Maximum files in a shared folder
	maxFileListSize: 5 * 1024 * 1024, // 5MB max serialized file list
}