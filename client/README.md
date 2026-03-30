# DevSecOps Client (React)

React dashboard for managing secrets, scanners, and scan reports.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+

## Setup

```bash
cd client
npm install
```

If your API is not at `http://localhost:3000`, create `client/.env`:

```env
VITE_API_URL=http://localhost:3000
```

Then run the dev server:

```bash
npm run dev
```

The UI typically runs at `http://localhost:5173`.
