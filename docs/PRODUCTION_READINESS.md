# Production Readiness Checklist

## Role-Owned Tools
- Reports are for MD / CEO production review and require VIEW_REPORTS.
- Monitoring and Work Logs are Admin-only by permission and route guard.
- ERP, Merchant, and Head of Operations should not receive VIEW_MONITORING, VIEW_WORK_LOGS, MANAGE_ISSUES, or VIEW_REPORTS unless the role is intentionally expanded.
- Work logs are created automatically when a user completes a tracked action; team-wide visibility is Admin-only.

## Monitoring
- Internal errors are captured into SystemError when an authenticated request fails.
- Client-side errors can be sent to POST /monitoring/client-errors.
- Set SENTRY_DSN before installing/enabling the Sentry SDK in the web and API apps.
- Keep failed imports visible in Admin Monitoring until row rejection causes are fixed.

## Deployment
- Use a managed PostgreSQL database with automated daily backups.
- Set NODE_ENV=production, secure WEB_ORIGIN, and NEXT_PUBLIC_API_URL.
- Keep ALLOW_DEV_AUTH=false in production.
- Run npm --workspace apps/api run build and npm --workspace apps/web run build before publishing.
- Run npm --workspace apps/api run db:push only after reviewing schema changes for the production database.

## Smoke Checks After Publish
- Admin can open /monitoring and /work-logs.
- MD / CEO can open /reports for production review.
- ERP and Merchant cannot see or directly access /monitoring, /work-logs, or /reports.
- Upload failure appears in Monitoring.
- Completing a tracked action creates a work log.
- Demo opens in English and Hindi for every role.
