# FlowDesk

Internal ticket management: raise a request to any department, and let that
department's head and team work it.

Monorepo with two apps.

| Folder | Stack | Dev URL |
| --- | --- | --- |
| `backend` | Node.js + Express 5 (ESM) + MongoDB | http://localhost:5000 |
| `frontend` | Next.js 16 (App Router, TypeScript) + Tailwind CSS 4 | http://localhost:3000 |

## Setup

```bash
# backend
cd backend
cp .env.example .env
npm install
npm run seed     # creates the super admin and demo departments
npm run dev

# frontend
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

MongoDB must be running locally; the database is `flowdesk_tickets`.

## Roles

| Role | Scope |
| --- | --- |
| `superadmin` | One fixed account. Cannot be created, demoted or deleted. |
| `admin` | Full management rights, except deleting the super admin. |
| `head` | Runs one department: adds and removes its team members. |
| `team` | Works the tickets raised to their department. |

Super admins and admins belong to no department — their rights are workspace
wide. Heads and team members see only the departments they belong to.

## Backend layout

```
backend/src
├── app.js              # express app: middleware + route mounting
├── server.js           # http listener + graceful shutdown
├── config/             # env vars, database connection
├── models/             # User, Department, Ticket
├── routes/             # mounted under /api
├── controllers/        # request handlers
├── middleware/         # auth, errorHandler, notFound
└── scripts/            # seed, reset, rename-database
```

API base path: `/api`. Health check: `GET /api/health`.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the API with reload |
| `npm run seed` | Create the super admin, demo departments and members (idempotent) |
| `npm run reset` | Delete every department, ticket and account except the super admin |
