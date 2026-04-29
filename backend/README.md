# Backend (Express)

This is the Express backend for the FoH_v2 project.

## Run

From the project root:

```bash
npm run dev:backend
```

Or from this folder:

```bash
npm run dev
```

The server runs on port 3000 by default.

## Environment Variables

Copy values from `.env.example` into `.env` as needed.

Current variables:

- `PORT` (default: `3000`)
- `NODE_ENV` (default: `development`)

## API Endpoints

### Health

```bash
curl -s http://localhost:3000/api/health
```

Example response:

```json
{"status":"ok"}
```

### Hello

```bash
curl -s http://localhost:3000/api/hello
```

Example response:

```json
{"message":"Hello from the Express backend."}
```

### Runtime Info

```bash
curl -s http://localhost:3000/api/info
```

Example response:

```json
{"name":"backend","version":"1.0.0","nodeEnv":"development","port":3000,"uptimeSeconds":12}
```

This endpoint intentionally returns only non-sensitive runtime details.
