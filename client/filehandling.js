// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import {
	CHUNK_SIZE
} from "./config.js"

export async function listFiles(dirHandle, path = "") {
	const files = []
	for await (const [name, handle] of dirHandle) {
		const fullPath = path ? `${path}/${name}` : name
		if (handle.kind === "file") {
			const file = await handle.getFile()
			files.push({
				path: fullPath,
				size: file.size,
				modified: file.lastModified,
			})
		} else {
			files.push(...(await listFiles(handle, fullPath)))
		}
	}
	return files
}

export async function getFileHandle(dirHandle, path) {
	const parts = path.split("/")
	let current = dirHandle
	for (let i = 0; i < parts.length - 1; i++) {
		current = await current.getDirectoryHandle(parts[i])
	}
	return current.getFileHandle(parts[parts.length - 1])
}

export async function readFileChunked(fileHandle, chunkSize = CHUNK_SIZE) {
	const file = await fileHandle.getFile()
	const chunks = []
	let offset = 0
	while (offset < file.size) {
		const slice = file.slice(offset, offset + chunkSize)
		chunks.push(await slice.arrayBuffer())
		offset += chunkSize
	}
	return {
		chunks,
		size: file.size,
		name: file.name
	}
}

export async function writeFile(dirHandle, path, data) {
	const parts = path.split("/")
	let current = dirHandle

	for (let i = 0; i < parts.length - 1; i++) {
		current = await current.getDirectoryHandle(parts[i], {
			create: true
		})
	}

	const filename = parts[parts.length - 1]
	const fileHandle = await current.getFileHandle(filename, {
		create: true
	})
	const writable = await fileHandle.createWritable()
	await writable.write(data)
	await writable.close()
}

export function formatSize(bytes) {
	if (bytes < 1024) return bytes + " B"
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
	return (bytes / (1024 * 1024)).toFixed(1) + " MB"
}

export function isValidPath(path) {
	if (!path || typeof path !== "string") return false
	if (path.includes("..")) return false
	if (path.startsWith("/") || path.startsWith("\\")) return false
	if (/^[a-zA-Z]:/.test(path)) return false
	return true
}

export function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = filename
	a.click()
	URL.revokeObjectURL(url)
}