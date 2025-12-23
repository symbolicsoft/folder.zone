// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import {
	formatSize,
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

export class UploadManager {
	constructor(allowWrite, dirHandle, updateFileList, sendUploadResponse) {
		this.allowWrite = allowWrite
		this.dirHandle = dirHandle
		this.updateFileList = updateFileList
		this.sendUploadResponse = sendUploadResponse
		this.rateLimiter = new RateLimiter(UPLOAD_LIMITS.rateLimitPerMinute)
		this.pendingUploads = new Map()
	}

	setAllowWrite(allowWrite) {
		this.allowWrite = allowWrite
	}

	handleUploadStart(peerId, msg) {
		if (!this.allowWrite) {
			this.sendUploadResponse(peerId, msg.path, false, "Write access disabled")
			return
		}

		if (!this.rateLimiter.isAllowed(peerId)) {
			this.sendUploadResponse(peerId, msg.path, false, "Rate limit exceeded")
			return
		}

		if (!isValidUploadPath(msg.path)) {
			this.sendUploadResponse(peerId, msg.path, false, "Invalid file path")
			return
		}

		if (msg.size > UPLOAD_LIMITS.maxFileSize) {
			this.sendUploadResponse(peerId, msg.path, false, `File too large (max ${formatSize(UPLOAD_LIMITS.maxFileSize)})`)
			return
		}

		const key = `${peerId}:${msg.path}`
		this.pendingUploads.set(key, {
			chunks: [],
			received: 0,
			total: msg.totalChunks,
			size: msg.size,
			path: msg.path,
		})

		this.sendUploadResponse(peerId, msg.path, true, "Upload started")
	}

	handleUploadChunk(peerId, msg) {
		const key = `${peerId}:${msg.path}`
		const upload = this.pendingUploads.get(key)

		if (!upload) return

		// msg.data is already a Uint8Array (raw binary)
		upload.chunks[msg.index] = msg.data
		upload.received++
	}

	async handleUploadComplete(peerId, msg, writeFile) {
		const key = `${peerId}:${msg.path}`
		const upload = this.pendingUploads.get(key)

		if (!upload || upload.received !== upload.total) {
			this.sendUploadResponse(peerId, msg.path, false, "Incomplete upload")
			this.pendingUploads.delete(key)
			return
		}

		try {
			const totalSize = upload.chunks.reduce((sum, c) => sum + c.length, 0)
			const combined = new Uint8Array(totalSize)
			let offset = 0
			for (const chunk of upload.chunks) {
				combined.set(chunk, offset)
				offset += chunk.length
			}

			await writeFile(this.dirHandle, upload.path, combined)

			this.sendUploadResponse(peerId, msg.path, true, "Upload complete")
			await this.updateFileList()
		} catch (e) {
			console.error("Upload write error:", e)
			this.sendUploadResponse(peerId, msg.path, false, "Write failed")
		} finally {
			this.pendingUploads.delete(key)
		}
	}
}