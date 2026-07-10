# Rishi Fabrics Production Checklist

## Required environment variables
- DATABASE_URL
- SESSION_SECRET
- NEXT_PUBLIC_API_URL
- CORS_ORIGIN or WEB_ORIGIN

## Optional environment variables
- SENTRY_DSN
- ADMIN_ALERT_EMAIL
- RESEND_API_KEY
- RESEND_FROM_EMAIL
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_STORAGE_BUCKET

## Health check
- API health endpoint: /health
- Expected healthy response includes ok=true, database=ONLINE, and environment checks.

## Before pilot deployment
1. Run API build.
2. Run web build.
3. Push Prisma schema to production database.
4. Seed only the Admin account.
5. Log in as Admin.
6. Request access with one test user.
7. Approve the user once from Settings.
8. Confirm the user can log in normally after approval.
9. Upload real Tech Pack, Daily Production, WIP, and Fabric/Dyeing files.
10. Verify the Rishi Fabrics Weekly Production Report.
11. Create a test issue from an upload rejection and confirm Admin receives an email.
12. Upload a tech pack and confirm the preview image is served through the app while the storage bucket remains private.

## Deployment Runbook
See docs/DEPLOYMENT_FREE_PILOT.md for the free pilot deployment steps.
