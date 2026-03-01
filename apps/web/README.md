# animus web (Next.js static export)

This app provides the frontend for `animus` and is exported as static assets.

## Stack

- Next.js App Router
- JSON-RPC WebSocket bridge to backend Codex server

## Local Run

From repo root:

```bash
./start.sh
```

Or in split terminals:

```bash
pnpm run build:web
cargo run --manifest-path apps/server/Cargo.toml --release
```

## Env

- `NEXT_PUBLIC_WS_URL` (optional)
- Default: `ws://127.0.0.1:10112/ws`

## Frontend Features

- Chat/thread session persistence via browser local storage
- History rehydrate on reload
- Multi-part message rendering (`text`, `data-*`, `tool-*`)
- Stable plain TOML editor for Agent configuration (no cursor jump from syntax overlay)
- Quick presets:
  - `approval_policy = \"never\"` + `sandbox_mode = \"danger-full-access\"`
  - `approval_policy = \"on-request\"` + `sandbox_mode = \"workspace-write\"`
