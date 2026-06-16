#!/usr/bin/env bash
# run-spike.sh — start mock upstream + gateway, run the test client, tear down
#
# Usage:  bash spikes/sse-proof/run-spike.sh
#
# Set ANTHROPIC_API_KEY in the environment to also run a real Anthropic call.

set -euo pipefail
cd "$(dirname "$0")"

MOCK_PORT=4001
GATEWAY_PORT=4000

cleanup() {
  echo ""
  echo "[spike] Cleaning up..."
  [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null || true
  [ -n "${GATEWAY_PID:-}" ] && kill "$GATEWAY_PID" 2>/dev/null || true
  echo "[spike] Done."
}
trap cleanup EXIT

echo "[spike] Starting mock upstream on port $MOCK_PORT..."
node mock-upstream.mjs "$MOCK_PORT" &
MOCK_PID=$!

echo "[spike] Starting Hono gateway on port $GATEWAY_PORT..."
node gateway.mjs &
GATEWAY_PID=$!

echo "[spike] Waiting for servers to start..."
sleep 1

echo ""
echo "[spike] Running test client..."
echo "========================================"
node test-client.mjs "http://localhost:$GATEWAY_PORT"
