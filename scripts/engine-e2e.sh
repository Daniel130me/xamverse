#!/usr/bin/env bash
# engine-e2e — the scripted two-peer demo from docs/phase2/TESTING.md §4.
#
# Brings up two real engine nodes over real TCP (loopback, mDNS disabled) and
# exercises: ping (Noise XX handshake + card exchange) → enroll → pair →
# approve on both sides → queued pull completing. Also asserts that pairing
# into an un-enrolled school fails with a CLEAN structured error (never a
# Rust panic) — the regression guard for the CLI error contract.
#
# Exits 0 only if every step succeeds. Used by CI (engine-e2e job) and as
# the local smoke test after touching sync/network/CLI code.
#
# Usage:
#   scripts/engine-e2e.sh
#   XAMVERSE_PEER_BIN=target/debug/xamverse-peer scripts/engine-e2e.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${XAMVERSE_PEER_BIN:-$REPO_ROOT/target/release/xamverse-peer}"
PORT_A="${XAMVERSE_E2E_PORT_A:-47810}"
PORT_B="${XAMVERSE_E2E_PORT_B:-47820}"

if [ ! -x "$BIN" ]; then
    echo "error: $BIN not found — build it first: cargo build --release -p xamverse-peer" >&2
    exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
    echo "error: python3 is required for JSON parsing in this script" >&2
    exit 1
fi

WORK="$(mktemp -d)"
PIDS=()
cleanup() {
    for pid in "${PIDS[@]:-}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    rm -rf "$WORK"
}
trap cleanup EXIT

# Serving commands run in the background; all output (stdout println!s and
# stderr tracing logs) goes to one log per node so assertions can grep both.
serve() { # serve <dir-name> <args...>
    "$BIN" --data-dir "$WORK/$1" "${@:2}" >"$WORK/$1.log" 2>&1 &
    PIDS+=($!)
}

# One-shot commands: stdout (println! JSON / results) and stderr (tracing
# logs, `error:` lines) are kept in separate files so assertions never parse
# a mixed stream.
one_shot() { # one_shot <dir-name> <args...>
    "$BIN" --data-dir "$WORK/$1" "${@:2}" >"$WORK/$1.last.out" 2>"$WORK/$1.last.err"
}

device_id() { # device_id <dir-name> — parse `info` JSON output
    one_shot "$1" info
    python3 -c 'import json,sys; print(json.load(sys.stdin)["device_id"])' <"$WORK/$1.last.out"
}

wait_for() { # wait_for <file> <pattern> <what>
    for _ in $(seq 1 60); do
        if grep -q "$2" "$1" 2>/dev/null; then return 0; fi
        sleep 0.5
    done
    echo "error: timed out waiting for $3" >&2
    echo "----- last log lines: $1 -----" >&2
    tail -5 "$1" >&2 || true
    return 1
}

echo "==> 1. both nodes enroll school-1 (one-shot commands: nodes not serving)"
one_shot nodeA enroll-school --school-id school-1 --name "E2E School" --user owner-a
one_shot nodeB enroll-school --school-id school-1 --name "E2E School" --user owner-b

echo "==> 2. node A serves on :$PORT_A (first run creates identity/keys if missing)"
serve nodeA serve --port "$PORT_A" --name "e2e-Lab-A" --no-mdns
wait_for "$WORK/nodeA.log" "listening on" "node A to start"

echo "==> 3. node B identity + ping (full Noise handshake + card exchange)"
one_shot nodeB peer-ping "127.0.0.1:$PORT_A"
RTT_LINE=$(grep "pong from" "$WORK/nodeB.last.out" || true)
[ -n "$RTT_LINE" ] || { echo "error: peer-ping did not answer" >&2; tail -3 "$WORK/nodeB.last.err" >&2; exit 1; }
echo "    $RTT_LINE"

echo "==> 4. negative check: pair into a school the responder has NOT enrolled"
if one_shot nodeB peer-pair "127.0.0.1:$PORT_A" --school-id school-orphan --school-name "Orphan"; then
    echo "error: pairing into an un-enrolled school unexpectedly succeeded" >&2
    exit 1
fi
grep -q "^error: " "$WORK/nodeB.last.err" \
    || { echo "error: failure was not a clean error line (panic?)" >&2; cat "$WORK/nodeB.last.err" >&2; exit 1; }
echo "    clean refusal: $(grep -m1 '^error: ' "$WORK/nodeB.last.err" | cut -c1-100)"

echo "==> 5. B requests pairing into school-1"
B_ID=$(device_id nodeB)
one_shot nodeB peer-pair "127.0.0.1:$PORT_A" --school-id school-1 --school-name "E2E School"
grep -q "pairing pending" "$WORK/nodeB.last.out" \
    || { echo "error: pair request did not go pending" >&2; tail -3 "$WORK/nodeB.last.err" >&2; exit 1; }

echo "==> 6. A approves B (one-shot needs the engine lock: stop A first)"
kill "${PIDS[0]}" && wait "${PIDS[0]}" 2>/dev/null || true
PIDS=()
one_shot nodeA peer-approve --school-id school-1 --device-id "$B_ID" --user owner-a
A_ID=$(device_id nodeA) # one-shot info works while A is stopped
serve nodeA serve --port "$PORT_A" --name "e2e-Lab-A" --no-mdns
wait_for "$WORK/nodeA.log" "listening on" "node A to restart"

echo "==> 7. B approves A back and queues a pull"
one_shot nodeB peer-approve --school-id school-1 --device-id "$A_ID" --user owner-b
one_shot nodeB sync-pull --device-id "$A_ID" --address "127.0.0.1:$PORT_A" --school-id school-1
grep -q "pull job" "$WORK/nodeB.last.out" \
    || { echo "error: pull job was not queued" >&2; tail -3 "$WORK/nodeB.last.err" >&2; exit 1; }

echo "==> 8. node B serves; the durable job runner completes the pull"
serve nodeB serve --port "$PORT_B" --name "e2e-Lab-B" --no-mdns
wait_for "$WORK/nodeB.log" "pull complete received=" "pull to complete on B"
echo "    $(grep -o 'pull complete received=[0-9]* duplicates=[0-9]* conflicts=[0-9]*' "$WORK/nodeB.log" | tail -1)"

echo "==> 9. stop both nodes, then verify mutual trust (one-shot needs the lock)"
for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
wait 2>/dev/null || true
PIDS=()
sleep 1
one_shot nodeA peers --school-id school-1
awk -F'\t' -v id="$B_ID" '$1==id && $2=="trusted" {found=1} END {exit found?0:1}' "$WORK/nodeA.last.out" || { echo "error: B not trusted on A" >&2; cat "$WORK/nodeA.last.out" >&2; exit 1; }
one_shot nodeB peers --school-id school-1
awk -F'\t' -v id="$A_ID" '$1==id && $2=="trusted" {found=1} END {exit found?0:1}' "$WORK/nodeB.last.out" || { echo "error: A not trusted on B" >&2; cat "$WORK/nodeB.last.out" >&2; exit 1; }

echo "engine-e2e: ALL STEPS PASSED"
