// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import { readFile, realpath } from "fs/promises"
import { join, extname, resolve } from "path"
import { CLIENT_DIR, MIME_TYPES } from "./config.js"

export async function serveStatic(pathname) {
	let path = pathname === "/" ? "/index.html" : pathname

	if (!path.includes(".")) {
		path = "/index.html"
	}

	const filePath = join(CLIENT_DIR, path)

	// Prevent path traversal: ensure resolved path is within CLIENT_DIR
	const resolvedClient = resolve(CLIENT_DIR)
	const resolvedFile = resolve(filePath)
	if (!resolvedFile.startsWith(resolvedClient + "/") && resolvedFile !== resolvedClient) {
		return new Response("Forbidden", { status: 403 })
	}

	const ext = extname(filePath)

	try {
		// Also check realpath to prevent symlink attacks
		const realFilePath = await realpath(filePath)
		if (!realFilePath.startsWith(resolvedClient + "/") && realFilePath !== resolvedClient) {
			return new Response("Forbidden", { status: 403 })
		}

		const content = await readFile(filePath)
		return new Response(content, {
			headers: { "Content-Type": MIME_TYPES[ext] || "text/plain" },
		})
	} catch {
		return new Response("Not found", { status: 404 })
	}
}
