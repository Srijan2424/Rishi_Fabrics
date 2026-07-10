# Rishi Fabrics Control Tower

Phase 1 starter codebase for an order-centric manufacturing intelligence platform.

## Stack

- Frontend: Next.js + TypeScript
- Backend: Express + TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Architecture: modular monolith, workflow-driven, event-first

## Phase 1 Scope

- Rishi Fabrics company onboarding foundations
- Order management
- Workflow templates and stages
- Order stage transitions
- Material movements
- Rework tickets
- Immutable timeline events
- ERP file import records
- Control Tower dashboard API

## Local Setup

1. Install Node.js 20+ and Docker Desktop.
2. Open this folder in VS Code.
3. Copy environment files:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

4. Start Postgres:

```bash
docker compose up -d
```

5. Install dependencies:

```bash
npm install
```

6. Create the database tables:

```bash
npm run db:push
```

7. Seed starter workflow data:

```bash
npm run db:seed
```

8. Run both apps:

```bash
npm run dev
```

Frontend: http://localhost:3000

API: http://localhost:4000/health

## Important Commands

```bash
npm run dev          # web + api
npm run dev:api      # api only
npm run dev:web      # web only
npm run db:push      # sync Prisma schema to Postgres
npm run db:seed      # seed starter factory/workflow/order
npm run prisma       # run Prisma CLI commands
```

## Product Spine

The product revolves around this chain:

```text
Order -> WorkflowTemplate -> OrderStage -> MaterialMovement -> Event Timeline
```

All business actions should generate an immutable `Event`.

# Rishi_Fabrics
