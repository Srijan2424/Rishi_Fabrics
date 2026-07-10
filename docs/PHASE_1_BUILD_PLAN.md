# Phase 1 Build Plan

## Goal

Ship the first usable Manufacturing Control Tower spine:

```text
Factory -> Workflow Template -> Order -> Stage Movement -> Timeline -> Dashboard
```

## Milestone 1: Local Foundation

- Create monorepo
- Run API and frontend locally
- Connect Postgres
- Seed demo factory, workflow, and order

Done when:

- `http://localhost:4000/health` returns ok
- `http://localhost:3000` shows the Control Tower dashboard

## Milestone 2: Factory Onboarding

Build UI and API for:

- Factory info
- Working days
- Shifts
- Working hours
- Basic capacity fields

## Milestone 3: Workflow Management

Build UI and API for:

- Create workflow template
- Add/reorder stages
- Mark stage as manual, automatic, or hybrid
- Mark dispatch stage

## Milestone 4: Order Management

Build UI and API for:

- Create order
- Assign workflow
- Auto-create order stages
- View order journey

## Milestone 5: Material Movement

Build UI and API for:

- Move quantity from one stage to another
- Support partial completion
- Support rollback
- Update current stage
- Write immutable timeline event

## Milestone 6: Rework

Build UI and API for:

- Create rework ticket
- Track rejected/rework/scrap quantities
- Link rework to source stage
- Write immutable timeline event

## Milestone 7: ERP Imports

Build:

- Upload screen
- Schema validation for CSV/Excel
- Preview accepted/rejected rows
- Approval step
- Import execution

## Milestone 8: Control Tower Dashboard

Build:

- Running orders
- Delayed orders
- At-risk orders
- Upcoming deliveries
- Order journey table
- Recent immutable events

