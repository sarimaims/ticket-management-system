# Ticket Management System

Monorepo with two apps.

| Folder | Stack | Dev URL |
| --- | --- | --- |
| `backend` | Node.js + Express 5 (ESM) | http://localhost:5000 |
| `frontend` | Next.js 16 (App Router, TypeScript) + Tailwind CSS 4 | http://localhost:3000 |

## Setup

```bash
# backend
cd backend
cp .env.example .env
npm install
npm run dev

# frontend
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

## Backend layout

```
backend/src
├── app.js              # express app: middleware + route mounting
├── server.js           # http listener + graceful shutdown
├── config/env.js       # env vars, loaded via dotenv
├── routes/             # route modules, mounted under /api
├── controllers/        # request handlers
├── middleware/         # errorHandler, notFound
└── utils/
```

API base path: `/api`. Health check: `GET /api/health`.
