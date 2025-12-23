// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Nadim Kobeissi <nadim@symbolic.software>

export function bufferToBase64(buffer) {
	const bytes = new Uint8Array(buffer)
	const chars = new Array(bytes.length)
	for (let i = 0; i < bytes.length; i++) {
		chars[i] = String.fromCharCode(bytes[i])
	}
	return btoa(chars.join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

export function base64ToBuffer(base64) {
	const padded = base64.replace(/-/g, "+").replace(/_/g, "/")
	const binary = atob(padded)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i)
	}
	return bytes
}

export async function generateKey() {
	const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])
	const exported = await crypto.subtle.exportKey("raw", key)
	return bufferToBase64(exported)
}

export async function importKey(base64Key) {
	const keyBuffer = base64ToBuffer(base64Key)
	// extractable: true is needed to derive HMAC keys for integrity verification
	return crypto.subtle.importKey("raw", keyBuffer, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])
}

export async function encrypt(key, data) {
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data)
	const result = new Uint8Array(iv.length + encrypted.byteLength)
	result.set(iv)
	result.set(new Uint8Array(encrypted), iv.length)
	return result
}

export async function decrypt(key, data) {
	const iv = data.slice(0, 12)
	const encrypted = data.slice(12)
	const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted)
	return new Uint8Array(decrypted)
}

export function generateRoomId() {
	const bytes = crypto.getRandomValues(new Uint8Array(8))
	return bufferToBase64(bytes)
}

export function generatePeerId() {
	const bytes = crypto.getRandomValues(new Uint8Array(16)) // 128 bits for better entropy
	return bufferToBase64(bytes)
}

// Generate a random nonce for HMAC key derivation
export function generateNonce() {
	const bytes = crypto.getRandomValues(new Uint8Array(16))
	return bufferToBase64(bytes)
}

// Derive an HMAC key from the session key and a nonce
// This ensures each file transfer uses a unique key, even for the same file
export async function deriveHMACKey(sessionKey, nonce) {
	// Export the session key to raw bytes
	const sessionKeyBytes = await crypto.subtle.exportKey("raw", sessionKey)

	// Combine session key bytes with nonce to create unique key material
	const nonceBytes = base64ToBuffer(nonce)
	const combined = new Uint8Array(sessionKeyBytes.byteLength + nonceBytes.length)
	combined.set(new Uint8Array(sessionKeyBytes), 0)
	combined.set(nonceBytes, sessionKeyBytes.byteLength)

	// Derive HMAC key using HKDF
	const keyMaterial = await crypto.subtle.importKey("raw", combined, { name: "HKDF" }, false, ["deriveKey"])

	return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: nonceBytes, info: new TextEncoder().encode("file-hmac") }, keyMaterial, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"])
}

// Compute HMAC-SHA256 of data
export async function computeHMAC(hmacKey, data) {
	const signature = await crypto.subtle.sign("HMAC", hmacKey, data)
	return bufferToBase64(new Uint8Array(signature))
}

// Verify HMAC-SHA256 of data
export async function verifyHMAC(hmacKey, data, expectedHMAC) {
	const expectedBytes = base64ToBuffer(expectedHMAC)
	return crypto.subtle.verify("HMAC", hmacKey, expectedBytes, data)
}
