# DevSecOps

A full-stack app for managing **encrypted credentials**, **security scanners**, and **scan runs** (SAST and container-oriented flows). It includes a React dashboard and an Express API backed by MongoDB.

## What’s in the repo

| Area | Stack |
|------|--------|
| **Client** (`client/`) | React 19, Vite 8, React Router |
| **Server** (`server/`) | Node.js 18+, Express, MongoDB, JWT auth, bcrypt |

## Features

- **Accounts** — Sign up, log in; API routes primage.pngotected with JWT.
- **Secrets** — Store and edit secrets; sensitive values are encrypted at rest (`CREDENTIALS_ENCRYPTION_KEY`).
- **Scanners** — Create and manage scanner configurations, list branches for Git-based SAST setups, trigger scans, and view reports / scan state.
- **API** — REST-style routes under `/api` (auth, secrets, scanners, git helpers, health).

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer  
- A [MongoDB](https://www.mongodb.com/) deployment (connection string)

## Setup

### 1. Server

```bash
cd server
cp .env.example .env   # then edit .env — see variables below
npm install
npm run dev            # or npm start
```

The API listens on **port 3000** by default (`PORT` in `.env`).

### 2. Client

```bash
cd client
npm install
```

Create `client/.env` if the API is not on the Vite dev default proxy target, or to point at a remote API:

```env
VITE_API_URL=http://localhost:3000
```

Then:

```bash
npm run dev
```

The Vite dev server typically runs at `http://localhost:5173`. CORS allows `localhost` / `127.0.0.1` on that port unless you override with `CLIENT_ORIGIN` or `CLIENT_ORIGINS` on the server.

## Server environment variables

Set these in `server/.env` (never commit this file):

| Variable | Purpose |
|----------|---------|
| `MONGODB_URI` | MongoDB connection string (**required**) |
| `JWT_SECRET` | Secret for signing JWTs (**required**) |
| `CREDENTIALS_ENCRYPTION_KEY` | Key used to encrypt stored credentials (**required**) |
| `PORT` | HTTP port (default `3000`) |
| `CLIENT_ORIGIN` | Single allowed browser origin for CORS |
| `CLIENT_ORIGINS` | Comma-separated list of allowed origins (if not using `CLIENT_ORIGIN`) |

## Scripts

**Server**

- `npm run dev` — run with file watch  
- `npm start` — run once  

**Client**

- `npm run dev` — Vite dev server  
- `npm run build` — production build  
- `npm run preview` — preview production build  

## Project layout

```
client/          # React SPA (dashboard, auth, secrets, scanners)
server/          # Express API, MongoDB, scan services
```

## Security notes

- Keep `server/.env` and any local secret files out of version control (see root `.gitignore`).
- Use strong, unique values for `JWT_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` in production.
- Rotate keys if they are ever exposed.

## License

Private / not specified.
