# ADR-0003 — Noise-encrypted JSON frames over TCP; no libp2p

Status: accepted (2026-10, Phase 2)

## Context
Peers need mutually-authenticated, encrypted transport over LAN TCP with
manual-IP support. Candidates: rust-libp2p, raw TLS (rustls), Noise framework
(snow crate).

## Decision
**snow ("Noise_XX_25519_ChaChaPoly_BLAKE2s") + length-prefixed versioned JSON
frames over TCP.**

Rationale:
* XX pattern mutually authenticates both static keys with no PKI and no
  certificate expiry management — device identity *is* the key.
* snow is a small, audited, widely-used pure-Rust Noise implementation; TLS
  would drag in certificate lifecycle problems (self-signed trust UX on
  air-gapped school LANs) for no gain, and libp2p's swarm/relay/DHT machinery
  is far beyond the requirement (the spec itself warns against adopting it
  merely because the product is P2P).
* JSON frames are debuggable with the peer CLI and match the TypeScript SDK's
  HTTP/JSON world; the envelope carries `v` for evolution. CBOR/MessagePack
  remain possible later inside the same framing without protocol breakage.

## Consequences
* Transport security does not depend on wall-clock validity windows.
* Large payloads use the blob sidecar protocol (hash-addressed chunks) rather
  than inflating JSON frames.
* We own (and test) handshake binding: the post-handshake `DeviceCard`
  signature binds the Ed25519 device identity to the Noise handshake hash, so
  a MITM cannot substitute static keys.
