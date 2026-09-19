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
├── config/             # env vars, database connection, prisma client
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
| `npm run prisma:push` | Apply `prisma/schema.prisma` to MongoDB (collections and indexes) |
| `npm run prisma:seed` | Create the super admin if it is missing (idempotent) |
| `npm run prisma:generate` | Regenerate the Prisma client after a schema change |
| `npm run prisma:studio` | Browse the data in Prisma Studio |

### Prisma

`backend/prisma/schema.prisma` describes the same data Mongoose writes — same
collections, same `_id` keys, same field names — so both can read one database.
It reads `MONGODB_URI`, the connection string the app already uses.

There are no migration files, and there is no way to add them: `prisma migrate`
is a SQL-only feature, and MongoDB is not a SQL database. Schema changes are
applied with `npm run prisma:push`, which creates collections and indexes and
never rewrites documents. Prisma ORM 7 dropped MongoDB support entirely, so the
backend pins Prisma 6 until it returns.

A fresh machine goes: `npm install`, `npm run prisma:push`, `npm run prisma:seed`,
`npm run dev`. The seeder creates one account - the super admin,
`admin@flowdesk.com` / `admin1234` unless `SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD` say otherwise. Running it again changes nothing, except
that it puts the account back to `superadmin` / `active` with no department if
something moved it. It never touches an existing password unless you ask:

```bash
SEED_ADMIN_PASSWORD=somethingNew SEED_FORCE_PASSWORD=yes npm run prisma:seed
```

The seeder writes with `$runCommandRaw`, not `prisma.user.create`, because
every Prisma write on MongoDB opens a transaction and MongoDB only offers
transactions on a replica set. Reads are unaffected. Run the database as a
single-node replica set if you want ordinary Prisma writes.

Indexes are owned by the Prisma schema, which is why the Mongoose connection
sets `autoIndex: false` — both index sets cover the same keys under different
names, and MongoDB rejects the second one with `IndexOptionsConflict`. After
changing a model in `src/models`, mirror it in `schema.prisma` and run
`npm run prisma:push`.
