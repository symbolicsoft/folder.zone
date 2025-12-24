// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import {
	isValidPath
} from "./filehandling.js"
import {
	UPLOAD_LIMITS
} from "./config.js"

export function sanitizeFilename(name) {
	if (!name || typeof name !== "string") return null
	let sanitized = name
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
		.replace(/^\.+/, "_")
		.replace(/\.+$/, "")
		.trim()

	if (!sanitized || sanitized.length > UPLOAD_LIMITS.maxFilenameLength) {
		return null
	}
	const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
	if (reserved.test(sanitized.split(".")[0])) {
		return null
	}
	return sanitized
}

export function isValidUploadPath(path) {
	if (!isValidPath(path)) return false
	const parts = path.split("/")
	if (parts.length > UPLOAD_LIMITS.maxPathDepth) return false
	for (const part of parts) {
		if (!sanitizeFilename(part)) return false
	}
	return true
}

export class RateLimiter {
	constructor(maxPerMinute) {
		this.maxPerMinute = maxPerMinute
		this.requests = new Map()
	}
	isAllowed(peerId) {
		const now = Date.now()
		const minute = 60 * 1000
		if (!this.requests.has(peerId)) {
			this.requests.set(peerId, [])
		}
		const timestamps = this.requests.get(peerId)
		const recent = timestamps.filter((t) => now - t < minute)
		this.requests.set(peerId, recent)
		if (recent.length >= this.maxPerMinute) {
			return false
		}
		recent.push(now)
		return true
	}
}