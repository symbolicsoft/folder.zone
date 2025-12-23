// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

import {
	formatSize,
	isValidPath
} from "./filehandling.js"

// SVG Icons
const ICONS = {
	folder: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
		<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
	</svg>`,
	folderOpen: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
		<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
	</svg>`,
	file: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
		<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
	</svg>`,
	image: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
		<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
	</svg>`,
	video: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
		<path stroke-linecap="round" stroke-linejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 016 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621.504-1.125 1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621-.504 1.125-1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5" />
	</svg>`,
	audio: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
		<path stroke-linecap="round" stroke-linejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
	</svg>`,
	archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
		<path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
	</svg>`,
	code: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
		<path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
	</svg>`,
	document: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
		<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
	</svg>`,
	home: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
		<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
	</svg>`,
	download: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
		<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
	</svg>`,
}

// File extension to icon type mapping
const FILE_ICONS = {
	image: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "ico", "tiff", "tif", "raw", "cr2", "nef", "heic", "heif", "avif", "jfif", "psd", "ai", "eps", "xcf"],
	audio: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "wma", "aiff", "ape", "opus", "mid", "midi"],
	video: ["mp4", "avi", "mov", "mkv", "webm", "wmv", "flv", "m4v", "mpg", "mpeg", "3gp", "3g2", "ogv"],
	archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "lz", "lzma", "cab", "iso", "dmg", "tgz", "jar"],
	code: ["js", "ts", "jsx", "tsx", "py", "rb", "java", "c", "cpp", "h", "hpp", "cs", "go", "rs", "swift", "kt", "scala", "php", "sh", "bash", "zsh", "json", "yaml", "yml", "xml", "toml", "ini", "css", "scss", "sass", "less", "html", "htm", "vue", "svelte"],
	document: ["doc", "docx", "rtf", "odt", "pdf", "txt", "md", "markdown", "tex", "xls", "xlsx", "csv", "ppt", "pptx"],
}

const EXTENSION_TO_TYPE = new Map()
for (const [type, extensions] of Object.entries(FILE_ICONS)) {
	for (const ext of extensions) {
		EXTENSION_TO_TYPE.set(ext, type)
	}
}

function getFileIconType(filename) {
	const ext = filename.split(".").pop()?.toLowerCase() || ""
	return EXTENSION_TO_TYPE.get(ext) || "file"
}

function getFileIconSvg(filename) {
	const type = getFileIconType(filename)
	return ICONS[type] || ICONS.file
}

export function escapeHtml(str) {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

export function showError(msg) {
	const dialog = document.getElementById("error-dialog")
	const text = document.getElementById("error-text")
	if (dialog && text) {
		text.textContent = msg
		dialog.hidden = false
	}
}

// Get items at a specific path
export function getItemsAtPath(files, currentPath) {
	const items = {
		folders: new Set(),
		files: []
	}
	const prefix = currentPath ? currentPath + "/" : ""

	for (const file of files) {
		if (currentPath && !file.path.startsWith(prefix)) continue
		if (!currentPath && file.path.includes("/")) {
			const topFolder = file.path.split("/")[0]
			items.folders.add(topFolder)
		} else if (currentPath && file.path.startsWith(prefix)) {
			const remaining = file.path.slice(prefix.length)
			if (remaining.includes("/")) {
				const nextFolder = remaining.split("/")[0]
				items.folders.add(nextFolder)
			} else {
				items.files.push(file)
			}
		} else if (!currentPath && !file.path.includes("/")) {
			items.files.push(file)
		}
	}

	return {
		folders: Array.from(items.folders).sort((a, b) => a.localeCompare(b)),
		files: items.files.sort((a, b) => a.path.localeCompare(b.path)),
	}
}

// Render host files
export function renderHostFiles(files, currentPath, onNavigate) {
	const grid = document.getElementById("file-grid")
	const welcomeScreen = document.getElementById("welcome-screen")
	const statusItems = document.getElementById("status-items")

	if (welcomeScreen) welcomeScreen.hidden = true
	if (grid) grid.hidden = false

	if (!grid) return

	grid.innerHTML = ""

	const items = getItemsAtPath(files, currentPath)
	let itemCount = 0

	// Render folders
	for (const folderName of items.folders) {
		const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName
		const item = document.createElement("div")
		item.className = "file-item"
		item.innerHTML = `
			<div class="file-icon folder">${ICONS.folder}</div>
			<span class="file-name">${escapeHtml(folderName)}</span>
		`
		item.ondblclick = () => onNavigate(folderPath)
		grid.appendChild(item)
		itemCount++
	}

	// Render files
	for (const file of items.files) {
		const fileName = file.path.split("/").pop()
		const iconType = getFileIconType(fileName)
		const item = document.createElement("div")
		item.className = "file-item"
		item.innerHTML = `
			<div class="file-icon ${iconType}">${getFileIconSvg(fileName)}</div>
			<span class="file-name">${escapeHtml(fileName)}</span>
			<span class="file-size">${formatSize(file.size)}</span>
		`
		item.title = fileName
		grid.appendChild(item)
		itemCount++
	}

	if (statusItems) {
		statusItems.textContent = `${itemCount} item${itemCount !== 1 ? "s" : ""}`
	}
}

// Render peer files
export function renderPeerFiles(files, allowWrite, currentPath, onNavigate, onDownload, onDownloadFolder) {
	const grid = document.getElementById("peer-file-grid")
	const statusItems = document.getElementById("peer-status-items")
	const uploadSection = document.getElementById("upload-section")

	if (!grid) return

	grid.innerHTML = ""

	const items = getItemsAtPath(files, currentPath)
	let itemCount = 0

	// Render folders
	for (const folderName of items.folders) {
		const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName
		const item = document.createElement("div")
		item.className = "file-item"
		item.innerHTML = `
			<div class="file-icon folder">${ICONS.folder}</div>
			<span class="file-name">${escapeHtml(folderName)}</span>
		`
		item.ondblclick = () => onNavigate(folderPath)
		item.title = "Double-click to open\nRight-click to download"
		item.oncontextmenu = (e) => {
			e.preventDefault()
			onDownloadFolder(folderPath)
		}
		grid.appendChild(item)
		itemCount++
	}

	// Render files
	for (const file of items.files) {
		if (!isValidPath(file.path)) continue
		const fileName = file.path.split("/").pop()
		const iconType = getFileIconType(fileName)
		const item = document.createElement("div")
		item.className = "file-item"
		item.innerHTML = `
			<div class="file-icon ${iconType}">${getFileIconSvg(fileName)}</div>
			<span class="file-name">${escapeHtml(fileName)}</span>
			<span class="file-size">${formatSize(file.size)}</span>
		`
		item.title = "Double-click to download"
		item.ondblclick = () => onDownload(file.path)
		grid.appendChild(item)
		itemCount++
	}

	if (statusItems) {
		statusItems.textContent = `${itemCount} item${itemCount !== 1 ? "s" : ""}`
	}

	if (uploadSection) {
		uploadSection.hidden = !allowWrite
	}
}

// Update breadcrumb
export function updateBreadcrumb(elementId, folderName, currentPath, onNavigate) {
	const breadcrumb = document.getElementById(elementId)
	if (!breadcrumb) return

	breadcrumb.innerHTML = ""

	// Root item
	const rootItem = document.createElement("span")
	rootItem.className = "breadcrumb-item"
	rootItem.innerHTML = `${ICONS.home} ${escapeHtml(folderName || "Home")}`
	rootItem.onclick = () => onNavigate("")
	breadcrumb.appendChild(rootItem)

	// Path segments
	if (currentPath) {
		const parts = currentPath.split("/")
		let pathSoFar = ""
		for (const part of parts) {
			pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part

			const separator = document.createElement("span")
			separator.className = "breadcrumb-separator"
			separator.textContent = "/"
			breadcrumb.appendChild(separator)

			const pathItem = document.createElement("span")
			pathItem.className = "breadcrumb-item"
			pathItem.innerHTML = `${ICONS.folderOpen} ${escapeHtml(part)}`
			const capturedPath = pathSoFar
			pathItem.onclick = () => onNavigate(capturedPath)
			breadcrumb.appendChild(pathItem)
		}
	}
}

export function updatePeerCount(count) {
	const el = document.getElementById("peer-count")
	const el2 = document.getElementById("peer-count-label")
	const status = document.getElementById("host-peer-status")

	if (el) el.textContent = `${count} connected`
	if (el2) el2.textContent = `${count} connected`
	if (status) status.hidden = count === 0
}

export function updateConnectionStatus(status, isRelay) {
	const statusEl = document.getElementById("connection-status")
	const statusDot = document.getElementById("status-dot")
	const statusText = document.getElementById("peer-status-text")
	const connectionMode = document.getElementById("connection-mode")

	if (statusEl) {
		statusEl.textContent = "Connected"
	}

	if (statusDot) {
		statusDot.className = "status-dot connected"
	}

	if (statusText) {
		statusText.textContent = isRelay ? "Connected via relay" : "Connected directly"
	}

	if (connectionMode) {
		connectionMode.hidden = false
		connectionMode.className = isRelay ? "connection-mode relay" : "connection-mode p2p"
		connectionMode.textContent = isRelay ? "Relay" : "P2P"
		connectionMode.title = isRelay ? "Using encrypted relay (slower)" : "Direct peer-to-peer connection (fastest)"
	}
}

export function showUploadResponse(success, message) {
	const statusText = document.getElementById("peer-status-text")
	if (statusText) {
		statusText.textContent = message
		setTimeout(() => {
			statusText.textContent = "Ready"
		}, 3000)
	}
}

// Progress management
export function createProgressItem(id, name, size, type = "download") {
	const container = document.getElementById(type === "download" ? "download-progress-list" : "upload-progress-list")
	const section = document.getElementById(type === "download" ? "download-section" : null)

	if (!container) return

	if (section) section.hidden = false

	const item = document.createElement("div")
	item.className = "progress-item"
	item.id = `progress-${type}-${id}`
	item.innerHTML = `
		<div class="progress-header">
			<span class="progress-name">${escapeHtml(name)}</span>
			<span class="progress-size">${formatSize(size)}</span>
		</div>
		<div class="progress-bar">
			<div class="progress-fill" style="width: 0%"></div>
			<span class="progress-percent">0%</span>
		</div>
	`
	container.appendChild(item)
	return item
}

export function updateProgressItem(id, progress, type = "download") {
	const item = document.getElementById(`progress-${type}-${id}`)
	if (!item) return

	const bar = item.querySelector(".progress-fill")
	if (bar) {
		bar.style.width = `${Math.min(100, progress)}%`
	}

	const percent = item.querySelector(".progress-percent")
	if (percent) {
		percent.textContent = `${Math.round(progress)}%`
	}
}

export function setProgressVerifying(id, type = "download") {
	const item = document.getElementById(`progress-${type}-${id}`)
	if (!item) return

	item.classList.add("verifying")

	const bar = item.querySelector(".progress-fill")
	if (bar) {
		bar.style.width = "100%"
	}

	const percent = item.querySelector(".progress-percent")
	if (percent) {
		percent.textContent = "VERIFYING INTEGRITY..."
	}
}

export function setProgressVerified(id, success, type = "download") {
	const item = document.getElementById(`progress-${type}-${id}`)
	if (!item) return

	item.classList.remove("verifying")
	item.classList.add(success ? "verified" : "failed")

	const percent = item.querySelector(".progress-percent")
	if (percent) {
		percent.textContent = success ? "VERIFIED" : "INTEGRITY CHECK FAILED"
	}
}

export function removeProgressItem(id, type = "download") {
	const item = document.getElementById(`progress-${type}-${id}`)
	if (item) {
		item.remove()
	}

	const container = document.getElementById(type === "download" ? "download-progress-list" : "upload-progress-list")
	const section = document.getElementById(type === "download" ? "download-section" : null)
	if (container && container.children.length === 0 && section) {
		section.hidden = true
	}
}

export function updateWindowTitle(elementId, title) {
	// Not used in modern design
}

export function updateStatusText(elementId, text) {
	const el = document.getElementById(elementId)
	if (el) {
		el.textContent = text
	}
}