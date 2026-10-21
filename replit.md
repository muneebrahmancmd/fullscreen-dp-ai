# Fullscreen DP AI

A full-stack web app that sets your WhatsApp profile picture in fullscreen 3:4 mode using AI image processing, with Google OAuth login and access code gating.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/fullscreen-dp run dev` — run the frontend Vite server (port 25386)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + Socket.io 4 + Passport.js (Google OAuth)
- WhatsApp: whatsapp-web.js + puppeteer (system Chromium)
- Image: Sharp (1080×1440 fit-contain with black background)
- DB: lowdb v1 (JSON file, db.json)
- Sessions: express-session
- Frontend: Plain HTML/CSS/JS served via Vite static server

## Where things live

- `artifacts/api-server/src/app.ts` — Express app with Socket.io, Passport, session
- `artifacts/api-server/src/lib/whatsapp.ts` — WhatsApp client flow
- `artifacts/api-server/src/lib/passport.ts` — Google OAuth strategy
- `artifacts/api-server/src/lib/db.ts` — lowdb v1 (CommonJS via createRequire)
- `artifacts/api-server/src/routes/auth.ts` — /api/auth/* routes
- `artifacts/api-server/src/routes/api.ts` — /api/me, /api/verify-code, /api/start
- `artifacts/api-server/public/` — login.html, verify.html, index.html (main app)
- `artifacts/fullscreen-dp/public/` — same HTML files served via Vite at /

## Architecture decisions

- Frontend HTML is pure HTML/CSS/JS (no React) — served statically by Vite at `/`
- Socket.io path is `/api/socket.io` (non-default) to route through the proxy correctly
- lowdb v1 (CommonJS) is loaded via `createRequire(import.meta.url)` inside ESM
- puppeteer browser download is skipped (`PUPPETEER_SKIP_DOWNLOAD=true`); whatsapp-web.js uses system Chromium
- The api-server owns all auth/business logic at `/api/*`; the Vite server owns `/` static files

## Product

- Google OAuth login → access code gate (code: muneebrahman56) → main app
- User uploads photo + enters WhatsApp number → pairing code shown → profile picture set
- Real-time step-by-step progress via Socket.io
- Sharp processes image to 1080×1440 fit:contain with black background

## User preferences

- App name: Fullscreen DP AI by Muneeb Rehman
- Access code: muneebrahman56
- Fonts: Syne (headings) + DM Mono (labels/code)

## Gotchas

- lowdb v1 must be required via `createRequire` (not imported) — it's CommonJS only
- Always set `PUPPETEER_SKIP_DOWNLOAD=true` in env before `pnpm install`
- Socket.io path must be `/api/socket.io` (not default `/socket.io`) to route through proxy
- Google OAuth callback URL must match APP_URL exactly: `APP_URL/api/auth/google/callback`
- After editing HTML in `artifacts/api-server/public/`, sync changes to `artifacts/fullscreen-dp/public/`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
