// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

// Size of each file chunk when transferring files over WebRTC (64KB).
// Files are split into chunks of this size for streaming transfers.
export const CHUNK_SIZE = 64 * 1024

// Timeout in milliseconds for WebRTC connection establishment (5 seconds).
// If a peer connection isn't established within this time, it fails.
export const WEBRTC_TIMEOUT = 5000

// High-water mark for the WebRTC data channel buffer (4MB).
// When bufferedAmount exceeds this, sending pauses to prevent memory overflow.
export const WEBRTC_BUFFER_THRESHOLD = 4 * 1024 * 1024

// Low-water mark for the WebRTC data channel buffer (1MB).
// Used as bufferedAmountLowThreshold to resume sending after backpressure.
export const WEBRTC_BUFFER_LOW = 1024 * 1024

// STUN servers for WebRTC NAT traversal.
// These help peers discover their public IP addresses and establish direct connections.
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

// Message type identifiers for the binary protocol over WebRTC data channels.
// The first byte of each message indicates its type.
export const MSG_TYPE = {
	JSON: 0, // Single JSON message that fits in one chunk
	FILE_CHUNK: 1, // Chunk of file data being downloaded
	UPLOAD_CHUNK: 2, // Chunk of file data being uploaded
	JSON_CHUNK: 3, // Part of a large JSON message split across multiple chunks
}

// Maximum size for a single JSON message before chunking (48KB).
// JSON messages larger than this are split into MSG_TYPE.JSON_CHUNK fragments.
export const MAX_JSON_SIZE = 48 * 1024

// Maximum file download requests allowed per minute per peer.
export const DOWNLOAD_RATE_LIMIT = 60

// Maximum allowed file size for transfers (2GB).
// Files exceeding this limit are rejected.
export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024

// Constraints for file uploads to prevent abuse.
export const UPLOAD_LIMITS = {
	maxFilenameLength: 255, // Maximum characters in a filename
	maxPathDepth: 10, // Maximum directory nesting depth
	rateLimitPerMinute: 30, // Maximum upload requests per minute per peer
}

// Limits for the file list sent to peers.
export const FILE_LIST_LIMITS = {
	maxFiles: 50000, // Maximum number of files in a shared folder
	maxFileListSize: 5 * 1024 * 1024, // Maximum serialized file list size (5MB)
}

// Protocol identifier for binary relay messages through the signaling server.
// Used as the first byte to distinguish relay data from JSON signaling messages.
export const BINARY_RELAY = 1