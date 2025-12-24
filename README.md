<p align="center">
  <img src="client/images/favicon.png" alt="folder.zone" width="128" height="128" />
</p>

<h1 align="center">folder.zone</h1>

<p align="center">
  <strong>End-to-end encrypted, peer-to-peer folder sharing in the browser.</strong>
</p>

<p align="center">
  <a href="https://folder.zone">folder.zone</a> &nbsp;·&nbsp;
  <a href="#security-model">Security Model</a> &nbsp;·&nbsp;
  <a href="#cryptographic-design">Cryptographic Design</a> &nbsp;·&nbsp;
  <a href="#self-hosting">Self-Hosting</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0" />
  <img src="https://img.shields.io/badge/status-beta-orange" alt="Beta" />
</p>

## Overview

folder.zone enables real-time folder sharing directly from your browser. Select a folder, receive a link, share it. Recipients browse and download files immediately: no upload step, no cloud storage, no accounts.

All data is encrypted client-side before transmission. The server facilitates peer discovery and connection signaling but never receives encryption keys. In relay fallback mode, the server forwards only ciphertext it cannot decrypt.

## Security Model

### Threat Model

The server is assumed **fully compromised**. An attacker with complete server access can:

- Read all server-side state (room IDs, connection metadata)
- Store and analyze all relay traffic
- Observe WebRTC signaling messages (SDP offers, ICE candidates)
- Perform traffic analysis on message timing and sizes

### Protected Assets

| Asset | Mechanism |
|-------|-----------|
| File contents | AES-256-GCM authenticated encryption |
| File integrity | HMAC-SHA256 with per-transfer key derivation |
| File paths | Encrypted within authenticated payload |

### Exposed Metadata

| Observable | Notes |
|------------|-------|
| Room identifiers | Required for peer discovery |
| Connection timing | When peers join/leave |
| Transfer volumes | Approximate, via ciphertext sizes |
| Peer count | Number of participants per room |

### Key Confidentiality

Encryption keys are transmitted exclusively via URL fragment. Per [RFC 3986 §3.5](https://www.rfc-editor.org/rfc/rfc3986#section-3.5), the fragment component is never sent to the server:

```
https://folder.zone/#<room_id>:<key_base64url>
                     └────────────────────────┘
                       Client-side only
```

**Link security is equivalent to key security.** Treat shared links as secrets.

## Cryptographic Design

### Primitives

| Operation | Algorithm | Source |
|-----------|-----------|--------|
| Authenticated encryption | AES-256-GCM | Web Crypto API |
| Key derivation | HKDF-SHA-256 | Web Crypto API |
| Message authentication | HMAC-SHA-256 | Web Crypto API |
| Random generation | CSPRNG | `crypto.getRandomValues` |

### Message Encryption

Each message is encrypted with a fresh 96-bit initialization vector:

```javascript
async function encrypt(key, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        plaintext
    )
    return iv || ciphertext  // 12-byte IV ‖ ciphertext ‖ 16-byte tag
}
```

GCM mode provides authenticated encryption—tampering is detected via the 128-bit authentication tag.

### File Integrity

File transfers include end-to-end integrity verification. A unique HMAC key is derived per transfer via HKDF to prevent replay:

```javascript
async function deriveHMACKey(sessionKey, transferNonce) {
    const ikm = concat(exportKey(sessionKey), transferNonce)
    const keyMaterial = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"])

    return crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: transferNonce, info: encode("file-hmac") },
        keyMaterial,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        false,
        ["sign", "verify"]
    )
}
```

Verification flow:
1. Sender computes `tag = HMAC(derivedKey, fileContents)`
2. Sender transmits `(nonce, tag)` with completion message
3. Receiver re-derives HMAC key from `(sessionKey, nonce)`
4. Receiver verifies `tag` before accepting file

### Wire Format

Binary messages use a compact header for efficient WebRTC transport:

```
┌──────────┬───────────┬───────────┬───────────┬──────────┬──────────────┐
│ Type (1) │ Index (4) │ Total (4) │ PathLen(2)│ Path (n) │ Chunk (≤64K) │
└──────────┴───────────┴───────────┴───────────┴──────────┴──────────────┘
     └─────────────────────────────────────────────────────────────────┘
                          Encrypted before transmission
```

64KB chunks stay within WebRTC DataChannel limits (~256KB) while enabling streaming without full file buffering.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              HOST BROWSER                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐  │
│  │ File System │──│   Encrypt   │──│    Chunk    │──│   Transport   │  │
│  │ Access API  │  │ AES-256-GCM │  │    64KB     │  │ WebRTC / WS   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └───────┬───────┘  │
└─────────────────────────────────────────────────────────────│──────────┘
                                                              │
                    ┌─────────────────────────────────────────┴─────┐
                    │              SIGNALING SERVER                 │
                    │                                               │
                    │  • Room management and peer discovery         │
                    │  • WebRTC signaling relay (SDP, ICE)          │
                    │  • Encrypted blob relay (fallback mode)       │
                    │  • Zero knowledge of plaintext or keys        │
                    │                                               │
                    └─────────────────────────────────────────┬─────┘
                                                              │
┌─────────────────────────────────────────────────────────────│──────────┐
│                              PEER BROWSER                              │
│  ┌───────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Transport   │──│  Reassemble │──│   Decrypt   │──│ Verify HMAC │  │
│  │ WebRTC / WS   │  │   Chunks    │  │ AES-256-GCM │  │  Download   │  │
│  └───────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Transport Modes

**WebRTC DataChannel** (primary)
- Direct peer-to-peer via STUN hole-punching
- No server bandwidth consumption
- Lowest latency

**WebSocket Relay** (fallback)
- Activated after 10s WebRTC timeout
- Handles symmetric NAT, restrictive firewalls
- Identical encryption—server sees only ciphertext

## Self-Hosting

### Requirements

- [Bun](https://bun.sh/) v1.0+

### Development

```bash
git clone https://github.com/symbolicsoft/folder.zone
cd folder.zone
bun run server/server.js
```

### Production

Includes `Dockerfile` and `fly.toml` for [Fly.io](https://fly.io):

```bash
fly launch
fly deploy
```

#### Multi-Instance Scaling

For horizontal scaling, configure [Upstash Redis](https://upstash.com/) for room affinity:

```bash
fly secrets set UPSTASH_REDIS_REST_URL=<url>
fly secrets set UPSTASH_REDIS_REST_TOKEN=<token>
```

### Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP/WebSocket listen port | `3000` |
| `UPSTASH_REDIS_REST_URL` | Redis endpoint for room tracking | — |
| `UPSTASH_REDIS_REST_TOKEN` | Redis authentication | — |

## Rate Limits

| Resource | Limit | Scope |
|----------|-------|-------|
| File downloads | 60/min | Per peer |
| File uploads | 30/min | Per peer |
| Max file size | 2 GB | Per file |
| Max path depth | 10 | Directories |
| WebSocket messages | 300/min | Per connection |
| Relay bandwidth | 100 MB/min | Per connection |

## Limitations

**Beta software.** The implementation uses standard cryptographic primitives via Web Crypto API, but the protocol has not undergone independent security audit.

**Not recommended for:**
- High-risk threat models requiring audited security
- Adversaries capable of compromising your browser
- Scenarios where link interception is likely

For sensitive applications, consider [OnionShare](https://onionshare.org/) or similar audited tools.

## License

**AGPL-3.0-or-later**

Public deployment of modified versions requires source disclosure. See [LICENSE](LICENSE).

<p align="center">
  <a href="https://nadim.computer"><strong>Nadim Kobeissi</strong></a>
</p>
