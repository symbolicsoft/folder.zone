// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import {
	generateKey,
	importKey,
	generateRoomId,
	generateNonce,
	deriveHMACKey,
	computeHMAC,
	verifyHMAC
} from "./crypto.js"
import {
	Signaling
} from "./signaling.js"
import {
	PeerConnection
} from "./peerconnection.js"
import {
	listFiles,
	getFileHandle,
	writeFile,
	formatSize,
	isValidPath,
	downloadBlob
} from "./filehandling.js"
import {
	isValidUploadPath,
	RateLimiter
} from "./upload.js"
import {
	CHUNK_SIZE,
	MAX_FILE_SIZE,
	UPLOAD_LIMITS,
	DOWNLOAD_RATE_LIMIT,
	FILE_LIST_LIMITS
} from "./config.js"
import {
	showError,
	renderHostFiles,
	renderPeerFiles,
	updatePeerCount,
	updateConnectionStatus,
	showUploadResponse,
	updateBreadcrumb,
	updateStatusText,
	createProgressItem,
	updateProgressItem,
	setProgressVerifying,
	setProgressVerified,
	removeProgressItem
} from "./ui.js"

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
		this.currentPath = ""
		this.folderName = ""
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
		document.getElementById("qr-link").onclick = () => this.showQRCode()
		document.getElementById("qr-close").onclick = () => this.hideQRCode()
		document.getElementById("qr-modal").onclick = (e) => {
			if (e.target.id === "qr-modal") this.hideQRCode()
		}
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
			showError("Invalid link")
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
		const uploadFilesBtn = document.getElementById("upload-files-btn")
		if (uploadFilesBtn && fileInput) {
			uploadFilesBtn.onclick = () => fileInput.click()
			fileInput.onchange = (e) => {
				const files = Array.from(e.target.files)
				this.uploadFiles(files)
				fileInput.value = ""
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
			const droppedFiles = Array.from(e.dataTransfer.files).filter((f) => f.size > 0 || f.type !== "")
			if (droppedFiles.length === 0) return
			const targetPath = this.currentPath
			for (let i = 0; i < droppedFiles.length; i++) {
				const file = droppedFiles[i]
				const fullPath = targetPath ? `${targetPath}/${file.name}` : file.name
				await this.uploadFile(file, fullPath)
				if (i < droppedFiles.length - 1) {
					await new Promise((r) => setTimeout(r, 1000))
				}
			}
		}
		dropzone.addEventListener("dragover", handleDragOver)
		dropzone.addEventListener("dragleave", handleDragLeave)
		dropzone.addEventListener("drop", handleDrop)
	}

	async uploadFiles(fileList) {
		const targetPath = this.currentPath
		for (let i = 0; i < fileList.length; i++) {
			const file = fileList[i]
			const path = targetPath ? `${targetPath}/${file.name}` : file.name
			await this.uploadFile(file, path)
			if (i < fileList.length - 1) {
				await new Promise((r) => setTimeout(r, 1000))
			}
		}
	}

	async selectFolder() {
		const isSupported =
			typeof window.showDirectoryPicker === "function" &&
			typeof window.crypto !== "undefined" &&
			typeof window.crypto.subtle !== "undefined" &&
			typeof window.RTCPeerConnection !== "undefined" &&
			typeof window.WebSocket !== "undefined"

		if (!isSupported) {
			document.getElementById("unsupported-browser").hidden = false
			return
		}

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
		const partakeLink = `${location.origin}/#${this.roomId}:${keyBase64}`
		document.getElementById("partake-link").value = partakeLink
		document.getElementById("partake-panel").hidden = false
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
		setInterval(() => this.updateFileList(), 5000)
	}

	copyLink() {
		const input = document.getElementById("partake-link")
		const btn = document.getElementById("copy-link")
		input.select()
		navigator.clipboard.writeText(input.value)

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

	showQRCode() {
		const link = document.getElementById("partake-link").value
		if (!link) return

		const qrContainer = document.getElementById("qr-code")
		qrContainer.innerHTML = ""

		const qr = qrcode(0, "M")
		qr.addData(link)
		qr.make()

		const img = document.createElement("img")
		img.src = qr.createDataURL(6, 0)
		img.alt = "QR Code"
		qrContainer.appendChild(img)

		document.getElementById("qr-modal").hidden = false
	}

	hideQRCode() {
		document.getElementById("qr-modal").hidden = true
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
				if (!this.isHost && this.peers.size === 0) {
					updateConnectionStatus("disconnected")
				}
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
		if (file && file.size > MAX_FILE_SIZE) {
			showError(`File too large (max ${formatSize(MAX_FILE_SIZE)})`)
			return
		}
		const fileName = path.split("/").pop()
		const progressId = `${path.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
		createProgressItem(progressId, fileName, file ? file.size : 0, "download")
		for (const [, pc] of this.peers) {
			pc.send({
				type: "file-request",
				path,
			})
		}
		this.pendingDownloads.set(path, {
			chunks: [],
			received: 0,
			total: 0,
			progressId,
		})
	}

	async downloadFolder(folderPath) {
		const filesInFolder = this.files.filter((f) => f.path.startsWith(folderPath + "/") || f.path === folderPath)
		if (filesInFolder.length === 0) {
			showError("No files found in this folder")
			return
		}
		updateStatusText("peer-status-text", `Downloading ${filesInFolder.length} files...`)
		const concurrency = 3
		let activeDownloads = 0
		let index = 0

		const downloadNext = () => {
			while (activeDownloads < concurrency && index < filesInFolder.length) {
				const file = filesInFolder[index++]
				activeDownloads++
				this.requestFileWithCallback(file.path, () => {
					activeDownloads--
					downloadNext()
				})
			}
		}

		downloadNext()
	}

	requestFileWithCallback(path, onComplete) {
		const file = this.files.find((f) => f.path === path)
		if (file && file.size > MAX_FILE_SIZE) {
			showError(`File too large (max ${formatSize(MAX_FILE_SIZE)})`)
			if (onComplete) onComplete()
			return
		}
		const fileName = path.split("/").pop()
		const progressId = `${path.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
		createProgressItem(progressId, fileName, file ? file.size : 0, "download")
		for (const [, pc] of this.peers) {
			pc.send({
				type: "file-request",
				path,
			})
		}
		this.pendingDownloads.set(path, {
			chunks: [],
			received: 0,
			total: 0,
			progressId,
			onComplete,
		})
	}

	async handleFileRequest(peerId, path) {
		if (!isValidPath(path)) {
			console.warn(`Rejected invalid path request: ${path}`)
			return
		}
		if (!this.downloadRateLimiter.isAllowed(peerId)) {
			console.warn(`Download rate limit exceeded for peer ${peerId}`)
			return
		}
		try {
			const fileHandle = await getFileHandle(this.dirHandle, path)
			const file = await fileHandle.getFile()
			if (file.size > MAX_FILE_SIZE) {
				console.warn(`Rejected file request: file too large (${file.size} bytes)`)
				return
			}
			const pc = this.peers.get(peerId)
			if (!pc) return
			const nonce = generateNonce()
			const hmacKey = await deriveHMACKey(this.cryptoKey, nonce)
			const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))
			for (let i = 0; i < totalChunks; i++) {
				const start = i * CHUNK_SIZE
				const end = Math.min(start + CHUNK_SIZE, file.size)
				const chunk = await file.slice(start, end).arrayBuffer()
				await pc.sendChunk(path, i, totalChunks, chunk)
				await new Promise((r) => setTimeout(r, 0))
			}
			const fileData = await file.arrayBuffer()
			const hmac = await computeHMAC(hmacKey, new Uint8Array(fileData))

			pc.send({
				type: "file-complete",
				path,
				name: file.name,
				size: file.size,
				nonce,
				hmac,
			})
		} catch (e) {
			console.error("Error sending file:", e)
		}
	}

	handleFileChunk(msg) {
		const download = this.pendingDownloads.get(msg.path)
		if (download) {
			download.chunks[msg.index] = msg.data
			download.total = msg.total
			download.received++
			const progress = (download.received / download.total) * 100
			updateProgressItem(download.progressId, progress, "download")
		} else {
			console.warn(`Received chunk for unknown download: ${msg.path}`)
		}
	}

	async handleFileComplete(msg) {
		const download = this.pendingDownloads.get(msg.path)
		if (download && download.received === download.total) {
			try {
				const blob = new Blob(download.chunks)
				if (msg.nonce && msg.hmac) {
					setProgressVerifying(download.progressId, "download")
					const hmacKey = await deriveHMACKey(this.cryptoKey, msg.nonce)
					const fileData = await blob.arrayBuffer()
					const isValid = await verifyHMAC(hmacKey, fileData, msg.hmac)
					if (!isValid) {
						setProgressVerified(download.progressId, false, "download")
						showError("File integrity check failed - the file may have been corrupted during transfer")
						setTimeout(() => removeProgressItem(download.progressId, "download"), 3000)
						this.pendingDownloads.delete(msg.path)
						if (download.onComplete) download.onComplete()
						return
					}
					setProgressVerified(download.progressId, true, "download")
					await new Promise((r) => setTimeout(r, 500))
				}
				downloadBlob(blob, msg.name)
				setTimeout(() => removeProgressItem(download.progressId, "download"), 1000)
				this.pendingDownloads.delete(msg.path)
				if (download.onComplete) download.onComplete()
			} catch (e) {
				console.error("Error assembling/downloading file:", e)
				showError(`Download failed: ${e.message}`)
				removeProgressItem(download.progressId, "download")
				this.pendingDownloads.delete(msg.path)
				if (download.onComplete) download.onComplete()
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
		if (msg.size > MAX_FILE_SIZE) {
			this.sendUploadResponse(peerId, msg.path, false, `File too large (max ${formatSize(MAX_FILE_SIZE)})`)
			return
		}
		const maxChunks = Math.ceil(msg.size / CHUNK_SIZE) + 1
		if (msg.totalChunks > maxChunks || msg.totalChunks < 1) {
			this.sendUploadResponse(peerId, msg.path, false, "Invalid chunk count")
			return
		}
		const key = `${peerId}:${msg.path}`
		const existing = this.pendingUploads.get(key)
		if (existing && existing.timeout) {
			clearTimeout(existing.timeout)
		}

		const timeout = setTimeout(
			() => {
				this.pendingUploads.delete(key)
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
			progressId: msg.progressId,
			timeout,
		})
	}

	handleUploadChunk(peerId, msg) {
		const key = `${peerId}:${msg.path}`
		const upload = this.pendingUploads.get(key)
		if (!upload) return
		if (typeof msg.index !== "number" || msg.index < 0 || msg.index >= upload.total) {
			console.warn(`Invalid chunk index ${msg.index} for upload ${key}`)
			return
		}
		if (upload.chunks[msg.index] !== undefined) {
			console.warn(`Duplicate chunk ${msg.index} for upload ${key}`)
			return
		}
		const chunkData = msg.data
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
		const progressId = upload?.progressId || msg.progressId
		if (!upload || upload.received !== upload.total) {
			this.sendUploadResponse(peerId, msg.path, false, "Incomplete upload", progressId)
			if (upload && upload.timeout) clearTimeout(upload.timeout)
			this.pendingUploads.delete(key)
			return
		}
		if (upload.timeout) clearTimeout(upload.timeout)
		try {
			const totalSize = upload.chunks.reduce((sum, c) => sum + c.length, 0)
			const combined = new Uint8Array(totalSize)
			let offset = 0
			for (const chunk of upload.chunks) {
				combined.set(chunk, offset)
				offset += chunk.length
			}
			if (msg.nonce && msg.hmac) {
				const hmacKey = await deriveHMACKey(this.cryptoKey, msg.nonce)
				const isValid = await verifyHMAC(hmacKey, combined, msg.hmac)
				if (!isValid) {
					this.sendUploadResponse(peerId, msg.path, false, "Integrity check failed", progressId)
					this.pendingUploads.delete(key)
					return
				}
			}
			await writeFile(this.dirHandle, upload.path, combined)
			this.sendUploadResponse(peerId, msg.path, true, "Upload complete", progressId)
			await this.updateFileList()
		} catch (e) {
			console.error("Upload write error:", e)
			this.sendUploadResponse(peerId, msg.path, false, "Write failed", progressId)
		} finally {
			this.pendingUploads.delete(key)
		}
	}

	sendUploadResponse(peerId, path, success, message, progressId) {
		const pc = this.peers.get(peerId)
		if (pc) {
			pc.send({
				type: "upload-response",
				path,
				success,
				message,
				progressId,
			})
		}
	}

	handleUploadResponse(msg) {
		const progressId = msg.progressId || msg.path.replace(/[^a-zA-Z0-9]/g, "_")
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
		const path = targetPath || file.name
		if (!isValidUploadPath(path)) {
			showUploadResponse(false, "Invalid filename")
			return
		}
		if (file.size > MAX_FILE_SIZE) {
			showUploadResponse(false, `File too large (max ${formatSize(MAX_FILE_SIZE)})`)
			return
		}
		const progressId = `${path.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`
		createProgressItem(progressId, path.split("/").pop(), file.size, "upload")
		const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))
		for (const [, pc] of this.peers) {
			await pc.send({
				type: "upload-start",
				path,
				size: file.size,
				totalChunks,
				progressId,
			})
		}
		const nonce = generateNonce()
		const hmacKey = await deriveHMACKey(this.cryptoKey, nonce)
		for (let i = 0; i < totalChunks; i++) {
			const start = i * CHUNK_SIZE
			const end = Math.min(start + CHUNK_SIZE, file.size)
			const chunk = new Uint8Array(await file.slice(start, end).arrayBuffer())
			for (const [, pc] of this.peers) {
				await pc.sendUploadChunk(path, i, totalChunks, chunk)
			}
			const progress = ((i + 1) / totalChunks) * 100
			updateProgressItem(progressId, progress, "upload")
		}

		setProgressVerifying(progressId, "upload")
		const fileData = await file.arrayBuffer()
		const hmac = await computeHMAC(hmacKey, new Uint8Array(fileData))

		for (const [, pc] of this.peers) {
			await pc.send({
				type: "upload-complete",
				path,
				nonce,
				hmac,
				progressId,
			})
		}
	}
}

new FolderShare()