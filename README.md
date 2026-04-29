# FoH_v2

Full-stack starter project with:

- Vite frontend
- Express backend

## Project Structure

- `frontend/` - Vite app (UI)
- `backend/` - Express API

## Prerequisites

- Node.js 18+
- npm

## Install

From the project root:

```bash
npm install
npm --prefix frontend install
npm --prefix backend install
```

## Run

From the project root:

```bash
npm run dev
```

This starts:

- Frontend: http://localhost:5173
- Backend: http://localhost:3000

## Useful Commands

```bash
npm run dev            # run frontend + backend together
npm run dev:frontend   # run frontend only
npm run dev:backend    # run backend only
npm run build          # build frontend
npm run start          # run backend in production mode
```

## API Quick Check

```bash
curl -s http://localhost:3000/api/health
curl -s http://localhost:3000/api/hello
curl -s http://localhost:3000/api/info
```

For backend endpoint details, see [backend/README.md](backend/README.md).
