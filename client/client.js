// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import { generateKey, importKey, generateRoomId, generateNonce, deriveHMACKey, computeHMAC, verifyHMAC } from "./crypto.js"
import { Signaling } from "./signaling.js"
import { PeerConnection } from "./peerconnection.js"
import { listFiles, getFileHandle, readFileChunked, writeFile, formatSize, isValidPath, downloadBlob } from "./filehandling.js"
import { isValidUploadPath, RateLimiter } from "./upload.js"
import { CHUNK_SIZE, UPLOAD_LIMITS, DOWNLOAD_RATE_LIMIT, FILE_LIST_LIMITS } from "./config.js"
import { showError, renderHostFiles, renderPeerFiles, updatePeerCount, updateConnectionStatus, showUploadResponse, updateBreadcrumb, updateWindowTitle, updateStatusText, createProgressItem, updateProgressItem, setProgressVerifying, setProgressVerified, removeProgressItem } from "./ui.js"

class FolderShare {
	constructor() {
		this.dirHandle = null
		this.isHost = false
		this.roomId = null
		this.cryptoKey = null
		this.signaling = null
		this.peers = new Map()
		this.files = []
		this.allowWrite = false
		this.pendingDownloads = new Map()
		this.currentPath = "" // Current folder path for navigation
		this.folderName = "" // Root folder name

		this.uploadRateLimiter = new RateLimiter(UPLOAD_LIMITS.rateLimitPerMinute)
		this.downloadRateLimiter = new RateLimiter(DOWNLOAD_RATE_LIMIT)
		this.pendingUploads = new Map()

		this.init()
	}

	async init() {
		const hash = location.hash.slice(1)
		if (hash && hash.includes(":")) {
			await this.initPeer(hash)
		} else {
			this.initHost()
		}
	}

	initHost() {
		this.isHost = true
		document.getElementById("host-view").hidden = false
		document.getElementById("peer-view").hidden = true

		document.getElementById("select-folder").onclick = () => this.selectFolder()
		document.getElementById("copy-link").onclick = () => this.copyLink()
		document.getElementById("allow-write").onchange = (e) => {
			this.allowWrite = e.target.checked
			this.broadcastFileList()
		}
	}

	async initPeer(hash) {
		this.isHost = false
		document.getElementById("host-view").hidden = true
		document.getElementById("peer-view").hidden = false

		const [roomId, keyBase64] = hash.split(":")
		this.roomId = roomId

		try {
			this.cryptoKey = await importKey(keyBase64)
		} catch (e) {
			showError("Invalid share link")
			return
		}

		this.setupPeerUpload()
		this.setupPeerDragDrop()

		this.signaling = new Signaling(
			(msg) => this.handleSignalingMessage(msg, false),
			(error) => showError(error),
			(fromPeerId, data) => this.handleBinaryRelay(fromPeerId, data),
		)
		this.signaling.connect(this.roomId)
	}

	setupPeerUpload() {
		const fileInput = document.getElementById("upload-input")
		const folderInput = document.getElementById("upload-folder-input")
		const uploadFilesBtn = document.getElementById("upload-files-btn")
		const uploadFolderBtn = document.getElementById("upload-folder-btn")

		if (uploadFilesBtn && fileInput) {
			uploadFilesBtn.onclick = () => fileInput.click()
			fileInput.onchange = (e) => {
				const files = Array.from(e.target.files)
				this.uploadFiles(files)
				fileInput.value = ""
			}
		}

		if (uploadFolderBtn && folderInput) {
			uploadFolderBtn.onclick = () => folderInput.click()
			folderInput.onchange = (e) => {
				const files = Array.from(e.target.files)
				this.uploadFiles(files)
				folderInput.value = ""
			}
		}
	}

	setupPeerDragDrop() {
		const dropzone = document.getElementById("upload-dropzone")
		if (!dropzone) return

		const handleDragOver = (e) => {
			e.preventDefault()
			e.stopPropagation()
			dropzone.classList.add("dragover")
		}

		const handleDragLeave = (e) => {
			e.preventDefault()
			e.stopPropagation()
			dropzone.classList.remove("dragover")
		}

		const handleDrop = async (e) => {
			e.preventDefault()
			e.stopPropagation()
			dropzone.classList.remove("dragover")

			const items = e.dataTransfer.items
			const files = []

			for (const item of items) {
				if (item.kind === "file") {
					const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null
					if (entry) {
						await this.processEntry(entry, "", files)
					} else {
						const file = item.getAsFile()
						if (file) files.push({ file, path: file.name })
					}
				}
			}

			for (const { file, path } of files) {
				// Prepend current path if we're in a subfolder
				const fullPath = this.currentPath ? `${this.currentPath}/${path}` : path
				await this.uploadFile(file, fullPath)
			}
		}

		dropzone.addEventListener("dragover", handleDragOver)
		dropzone.addEventListener("dragleave", handleDragLeave)
		dropzone.addEventListener("drop", handleDrop)
	}

	async processEntry(entry, basePath, files) {
		if (entry.isFile) {
			const file = await new Promise((resolve) => entry.file(resolve))
			const path = basePath ? `${basePath}/${entry.name}` : entry.name
			files.push({ file, path })
		} else if (entry.isDirectory) {
			const dirReader = entry.createReader()
			const dirPath = basePath ? `${basePath}/${entry.name}` : entry.name

			// readEntries only returns a batch at a time, must call repeatedly until empty
			let entries = []
			let batch
			do {
				batch = await new Promise((resolve) => dirReader.readEntries(resolve))
				entries = entries.concat(batch)
			} while (batch.length > 0)

			for (const childEntry of entries) {
				await this.processEntry(childEntry, dirPath, files)
			}
		}
	}

	async uploadFiles(fileList) {
		for (const file of fileList) {
			// webkitRelativePath is set for folder uploads, preserves folder structure
			const relativePath = file.webkitRelativePath || file.name
			// Prepend current path if we're in a subfolder
			const path = this.currentPath ? `${this.currentPath}/${relativePath}` : relativePath
			await this.uploadFile(file, path)
		}
	}

	async selectFolder() {
		try {
			this.dirHandle = await window.showDirectoryPicker({
				mode: "readwrite",
				startIn: "documents",
			})
		} catch (e) {
			showError('Your browser may not allow access to top-level folders like "Documents" or "Desktop". Instead, please choose a subfolder.')
			return
		}

		this.folderName = this.dirHandle.name
		this.roomId = generateRoomId()
		const keyBase64 = await generateKey()
		this.cryptoKey = await importKey(keyBase64)

		const shareLink = `${location.origin}/#${this.roomId}:${keyBase64}`
		document.getElementById("share-link").value = shareLink
		document.getElementById("share-panel").hidden = false

		// Update window title
		updateWindowTitle("window-title", this.folderName)

		this.signaling = new Signaling(
			(msg) => this.handleSignalingMessage(msg, true),
			(error) => showError(error),
			(fromPeerId, data) => this.handleBinaryRelay(fromPeerId, data),
		)
		this.signaling.connect(this.roomId)

		await this.updateFileList()
		this.watchFolder()
	}

	navigateTo(path) {
		this.currentPath = path
		if (this.isHost) {
			renderHostFiles(this.files, this.currentPath, (p) => this.navigateTo(p))
			updateBreadcrumb("breadcrumb", this.folderName, this.currentPath, (p) => this.navigateTo(p))
		} else {
			renderPeerFiles(
				this.files,
				this.allowWrite,
				this.currentPath,
				(p) => this.navigateTo(p),
				(p) => this.requestFile(p),
				(p) => this.downloadFolder(p),
			)
			updateBreadcrumb("peer-breadcrumb", "Shared Folder", this.currentPath, (p) => this.navigateTo(p))
		}
	}

	async updateFileList() {
		this.files = await listFiles(this.dirHandle)

		// Warn if folder has too many files (only once)
		if (this.files.length > FILE_LIST_LIMITS.maxFiles && !this.fileLimitWarningShown) {
			this.fileLimitWarningShown = true
			showError(`This folder contains ${this.files.length} files, which exceeds the limit of ${FILE_LIST_LIMITS.maxFiles}. Peers may not be able to view the full file list.`)
		}

		renderHostFiles(this.files, this.currentPath, (p) => this.navigateTo(p))
		updateBreadcrumb("breadcrumb", this.folderName, this.currentPath, (p) => this.navigateTo(p))
		updateStatusText("status-text", `Sharing: ${this.folderName}`)
		this.broadcastFileList()
	}

	watchFolder() {
		setInterval(() => this.updateFileList(), 2000)
	}

	copyLink() {
		const input = document.getElementById("share-link")
		const btn = document.getElementById("copy-link")
		input.select()
		navigator.clipboard.writeText(input.value)

		// Visual feedback on button
		if (btn) {
			btn.classList.add("copied")
			const span = btn.querySelector("span")
			if (span) span.textContent = "Copied!"
			setTimeout(() => {
				btn.classList.remove("copied")
				if (span) span.textContent = "Copy"
			}, 2000)
		}

		updateStatusText("status-text", "Link copied!")
		setTimeout(() => updateStatusText("status-text", `Sharing: ${this.folderName}`), 2000)
	}

	handleSignalingMessage(msg, isHost) {
		switch (msg.type) {
			case "peer-joined": {
				const pc = new PeerConnection(
					msg.peerId,
					this.signaling,
					this.cryptoKey,
					isHost,
					(m) => this.handlePeerMessage(msg.peerId, m),
					(state) => this.handleConnectionState(msg.peerId, state),
				)
				this.peers.set(msg.peerId, pc)
				updatePeerCount(this.peers.size)
				break
			}
			case "peer-left": {
				const pc = this.peers.get(msg.peerId)
				if (pc) {
					pc.close()
					this.peers.delete(msg.peerId)
				}
				updatePeerCount(this.peers.size)
				break
			}
			case "signal": {
				const pc = this.peers.get(msg.fromPeerId)
				if (pc) {
					pc.handleSignal(msg.signal)
				}
				break
			}
		}
	}

	handleBinaryRelay(fromPeerId, data) {
		const pc = this.peers.get(fromPeerId)
		if (pc) {
			pc.handleBinaryRelay(data)
		}
	}

	handleConnectionState(peerId, state) {
		console.log(`Peer ${peerId}: ${state}`)
		const isConnected = state === "connected" || state === "connected (relay)"

		if (!this.isHost && isConnected) {
			updateConnectionStatus(state, state === "connected (relay)")
		}
		if (isConnected && this.isHost) {
			setTimeout(() => this.sendFileList(peerId), 500)
		}
	}

	async handlePeerMessage(peerId, msg) {
		switch (msg.type) {
			case "file-list":
				// Validate file list size to prevent DoS
				if (!Array.isArray(msg.files)) {
					console.warn("Invalid file list received")
					return
				}
				if (msg.files.length > FILE_LIST_LIMITS.maxFiles) {
					showError(`File list too large (${msg.files.length} files, max ${FILE_LIST_LIMITS.maxFiles})`)
					return
				}
				this.files = msg.files
				this.allowWrite = msg.allowWrite
				renderPeerFiles(
					msg.files,
					msg.allowWrite,
					this.currentPath,
					(p) => this.navigateTo(p),
					(p) => this.requestFile(p),
					(p) => this.downloadFolder(p),
				)
				updateBreadcrumb("peer-breadcrumb", "Shared Folder", this.currentPath, (p) => this.navigateTo(p))
				updateStatusText("peer-status-text", "Ready")
				break
			case "file-request":
				await this.handleFileRequest(peerId, msg.path)
				break
			case "file-chunk":
				this.handleFileChunk(msg)
				break
			case "file-complete":
				await this.handleFileComplete(msg)
				break
			case "upload-start":
				this.handleUploadStart(peerId, msg)
				break
			case "upload-chunk":
				this.handleUploadChunk(peerId, msg)
				break
			case "upload-complete":
				await this.handleUploadComplete(peerId, msg)
				break
			case "upload-response":
				this.handleUploadResponse(msg)
				break
		}
	}

	broadcastFileList() {
		for (const [peerId] of this.peers) {
			this.sendFileList(peerId)
		}
	}

	sendFileList(peerId) {
		const pc = this.peers.get(peerId)
		if (pc) {
			pc.send({
				type: "file-list",
				files: this.files,
				allowWrite: this.allowWrite,
			})
		}
	}

	requestFile(path) {
		const file = this.files.find((f) => f.path === path)
		const fileName = path.split("/").pop()

		// Create progress item
		const progressId = path.replace(/[^a-zA-Z0-9]/g, "_")
		createProgressItem(progressId, fileName, file ? file.size : 0, "download")

		for (const [, pc] of this.peers) {
			pc.send({ type: "file-request", path })
		}
		this.pendingDownloads.set(path, { chunks: [], received: 0, total: 0, progressId })
	}

	async downloadFolder(folderPath) {
		// Find all files in this folder
		const filesInFolder = this.files.filter((f) => f.path.startsWith(folderPath + "/") || f.path === folderPath)

		if (filesInFolder.length === 0) {
			showError("No files found in this folder")
			return
		}

		updateStatusText("peer-status-text", `Downloading ${filesInFolder.length} files...`)

		for (const file of filesInFolder) {
			this.requestFile(file.path)
		}
	}

	async handleFileRequest(peerId, path) {
		if (!isValidPath(path)) {
			console.warn(`Rejected invalid path request: ${path}`)
			return
		}

		// Rate limit download requests per peer
		if (!this.downloadRateLimiter.isAllowed(peerId)) {
			console.warn(`Download rate limit exceeded for peer ${peerId}`)
			return
		}

		try {
			const fileHandle = await getFileHandle(this.dirHandle, path)
			const file = await fileHandle.getFile()
			const pc = this.peers.get(peerId)
			if (!pc) return

			// Generate unique nonce for this transfer's HMAC
			const nonce = generateNonce()
			const hmacKey = await deriveHMACKey(this.cryptoKey, nonce)

			const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

			// Stream chunks one at a time instead of loading entire file
			console.log(`Starting transfer: ${totalChunks} chunks`)
			for (let i = 0; i < totalChunks; i++) {
				const start = i * CHUNK_SIZE
				const end = Math.min(start + CHUNK_SIZE, file.size)
				const chunk = await file.slice(start, end).arrayBuffer()
				if ((i + 1) % 100 === 0 || i === totalChunks - 1) {
					console.log(`Sending chunk ${i + 1}/${totalChunks}`)
				}
				await pc.sendChunk(path, i, totalChunks, chunk)
				// Yield to event loop every chunk to prevent overwhelming receiver
				await new Promise((r) => setTimeout(r, 0))
			}
			console.log("Transfer complete, computing HMAC...")

			// Compute HMAC over entire file content
			const fileData = await file.arrayBuffer()
			const hmac = await computeHMAC(hmacKey, fileData)
			console.log("HMAC computed")

			pc.send({ type: "file-complete", path, name: file.name, size: file.size, nonce, hmac })
		} catch (e) {
			console.error("Error sending file:", e)
		}
	}

	handleFileChunk(msg) {
		const download = this.pendingDownloads.get(msg.path)
		if (download) {
			// msg.data is already a Uint8Array (raw binary, no base64)
			download.chunks[msg.index] = msg.data
			download.total = msg.total
			download.received++

			// Update progress
			const progress = (download.received / download.total) * 100
			updateProgressItem(download.progressId, progress, "download")
		} else {
			console.warn(`Received chunk for unknown download: ${msg.path}`)
		}
	}

	async handleFileComplete(msg) {
		const download = this.pendingDownloads.get(msg.path)
		console.log(`File complete received: ${msg.path}, got ${download?.received}/${download?.total} chunks`)
		if (download && download.received === download.total) {
			try {
				console.log("Assembling file from chunks...")
				// Create blob directly from chunks instead of copying to intermediate array
				const blob = new Blob(download.chunks)
				console.log(`Blob created: ${blob.size} bytes`)

				// Verify HMAC integrity
				if (msg.nonce && msg.hmac) {
					setProgressVerifying(download.progressId, "download")
					console.log("Verifying HMAC integrity...")

					const hmacKey = await deriveHMACKey(this.cryptoKey, msg.nonce)
					const fileData = await blob.arrayBuffer()
					const isValid = await verifyHMAC(hmacKey, fileData, msg.hmac)

					if (!isValid) {
						console.error("HMAC verification failed!")
						setProgressVerified(download.progressId, false, "download")
						showError("File integrity check failed - the file may have been corrupted during transfer")
						setTimeout(() => removeProgressItem(download.progressId, "download"), 3000)
						this.pendingDownloads.delete(msg.path)
						return
					}

					console.log("HMAC verified successfully")
					setProgressVerified(download.progressId, true, "download")
					await new Promise((r) => setTimeout(r, 500)) // Show verified state briefly
				}

				downloadBlob(blob, msg.name)
				console.log("Download triggered")

				// Complete progress
				setTimeout(() => removeProgressItem(download.progressId, "download"), 1000)

				this.pendingDownloads.delete(msg.path)
			} catch (e) {
				console.error("Error assembling/downloading file:", e)
				showError(`Download failed: ${e.message}`)
				removeProgressItem(download.progressId, "download")
				this.pendingDownloads.delete(msg.path)
			}
		} else {
			console.warn(`File complete but chunks missing: got ${download?.received}/${download?.total}`)
		}
	}

	handleUploadStart(peerId, msg) {
		if (!this.allowWrite) {
			this.sendUploadResponse(peerId, msg.path, false, "Write access disabled")
			return
		}

		if (!this.uploadRateLimiter.isAllowed(peerId)) {
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

		// Validate totalChunks is reasonable for declared size
		const maxChunks = Math.ceil(msg.size / CHUNK_SIZE) + 1
		if (msg.totalChunks > maxChunks || msg.totalChunks < 1) {
			this.sendUploadResponse(peerId, msg.path, false, "Invalid chunk count")
			return
		}

		const key = `${peerId}:${msg.path}`

		// Clear any existing upload timeout for this key
		const existing = this.pendingUploads.get(key)
		if (existing && existing.timeout) {
			clearTimeout(existing.timeout)
		}

		// Set timeout to cleanup abandoned uploads (5 minutes)
		const timeout = setTimeout(
			() => {
				this.pendingUploads.delete(key)
				console.log(`Upload timeout: ${key}`)
			},
			5 * 60 * 1000,
		)

		this.pendingUploads.set(key, {
			chunks: new Array(msg.totalChunks),
			received: 0,
			total: msg.totalChunks,
			size: msg.size,
			bytesReceived: 0,
			path: msg.path,
			timeout,
		})

		this.sendUploadResponse(peerId, msg.path, true, "Upload started")
	}

	handleUploadChunk(peerId, msg) {
		const key = `${peerId}:${msg.path}`
		const upload = this.pendingUploads.get(key)

		if (!upload) return

		// Validate chunk index is within bounds
		if (typeof msg.index !== "number" || msg.index < 0 || msg.index >= upload.total) {
			console.warn(`Invalid chunk index ${msg.index} for upload ${key}`)
			return
		}

		// Prevent duplicate chunks
		if (upload.chunks[msg.index] !== undefined) {
			console.warn(`Duplicate chunk ${msg.index} for upload ${key}`)
			return
		}

		// msg.data is already a Uint8Array (raw binary)
		const chunkData = msg.data

		// Validate cumulative size doesn't exceed declared size
		if (upload.bytesReceived + chunkData.length > upload.size) {
			console.warn(`Upload size exceeded for ${key}`)
			this.pendingUploads.delete(key)
			if (upload.timeout) clearTimeout(upload.timeout)
			this.sendUploadResponse(peerId, msg.path, false, "Upload size exceeded")
			return
		}

		upload.chunks[msg.index] = chunkData
		upload.received++
		upload.bytesReceived += chunkData.length
	}

	async handleUploadComplete(peerId, msg) {
		const key = `${peerId}:${msg.path}`
		const upload = this.pendingUploads.get(key)

		if (!upload || upload.received !== upload.total) {
			this.sendUploadResponse(peerId, msg.path, false, "Incomplete upload")
			if (upload && upload.timeout) clearTimeout(upload.timeout)
			this.pendingUploads.delete(key)
			return
		}

		// Clear the timeout since upload is completing
		if (upload.timeout) clearTimeout(upload.timeout)

		try {
			const totalSize = upload.chunks.reduce((sum, c) => sum + c.length, 0)
			const combined = new Uint8Array(totalSize)
			let offset = 0
			for (const chunk of upload.chunks) {
				combined.set(chunk, offset)
				offset += chunk.length
			}

			// Verify HMAC integrity before writing
			if (msg.nonce && msg.hmac) {
				console.log("Verifying upload HMAC integrity...")
				const hmacKey = await deriveHMACKey(this.cryptoKey, msg.nonce)
				const isValid = await verifyHMAC(hmacKey, combined, msg.hmac)

				if (!isValid) {
					console.error("Upload HMAC verification failed!")
					this.sendUploadResponse(peerId, msg.path, false, "Integrity check failed")
					this.pendingUploads.delete(key)
					return
				}
				console.log("Upload HMAC verified successfully")
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

	sendUploadResponse(peerId, path, success, message) {
		const pc = this.peers.get(peerId)
		if (pc) {
			pc.send({ type: "upload-response", path, success, message })
		}
	}

	handleUploadResponse(msg) {
		const progressId = msg.path.replace(/[^a-zA-Z0-9]/g, "_")

		if (msg.success) {
			setProgressVerified(progressId, true, "upload")
			showUploadResponse(true, msg.message)
			setTimeout(() => removeProgressItem(progressId, "upload"), 1500)
		} else {
			setProgressVerified(progressId, false, "upload")
			showUploadResponse(false, msg.message)
			setTimeout(() => removeProgressItem(progressId, "upload"), 3000)
		}
	}

	async uploadFile(file, targetPath = "") {
		if (!file) return

		// Handle both full path and target directory
		let path
		if (targetPath && targetPath !== file.name) {
			// If targetPath includes the filename or is a directory path
			if (targetPath.includes("/")) {
				path = targetPath
			} else {
				path = targetPath
			}
		} else {
			path = file.name
		}

		if (!isValidUploadPath(path)) {
			showUploadResponse(false, "Invalid filename")
			return
		}

		if (file.size > UPLOAD_LIMITS.maxFileSize) {
			showUploadResponse(false, `File too large (max ${formatSize(UPLOAD_LIMITS.maxFileSize)})`)
			return
		}

		// Create progress item
		const progressId = path.replace(/[^a-zA-Z0-9]/g, "_")
		createProgressItem(progressId, path.split("/").pop(), file.size, "upload")

		const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

		for (const [, pc] of this.peers) {
			await pc.send({
				type: "upload-start",
				path,
				size: file.size,
				totalChunks,
			})
		}

		// Generate unique nonce for this transfer's HMAC
		const nonce = generateNonce()
		const hmacKey = await deriveHMACKey(this.cryptoKey, nonce)

		// Stream chunks on-demand instead of loading entire file into memory
		for (let i = 0; i < totalChunks; i++) {
			const start = i * CHUNK_SIZE
			const end = Math.min(start + CHUNK_SIZE, file.size)
			const chunk = new Uint8Array(await file.slice(start, end).arrayBuffer())

			for (const [, pc] of this.peers) {
				await pc.sendUploadChunk(path, i, totalChunks, chunk)
			}

			// Update progress
			const progress = ((i + 1) / totalChunks) * 100
			updateProgressItem(progressId, progress, "upload")
		}

		// Compute HMAC over entire file content
		setProgressVerifying(progressId, "upload")
		const fileData = await file.arrayBuffer()
		const hmac = await computeHMAC(hmacKey, fileData)

		for (const [, pc] of this.peers) {
			await pc.send({ type: "upload-complete", path, nonce, hmac })
		}

		// Show verifying state - will be updated when we get response
		// The actual verification happens on the host side
	}
}

new FolderShare()
