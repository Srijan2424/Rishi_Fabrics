# Rishi Fabrics Free Pilot Deployment

This pilot setup uses:
- Web: Vercel
- API: Render
- Database: Neon or Supabase Postgres

## 1. Prepare Database
Create a free Postgres database and copy its connection string.

Required API env:
- DATABASE_URL
- SESSION_SECRET
- CORS_ORIGIN
- WEB_ORIGIN
- ADMIN_ALERT_EMAIL
- RESEND_API_KEY optional, required for live admin alert emails
- RESEND_FROM_EMAIL optional, recommended after domain verification
- SUPABASE_URL optional, required for private tech-pack file storage
- SUPABASE_SERVICE_ROLE_KEY optional, required for private tech-pack file storage
- SUPABASE_STORAGE_BUCKET optional, defaults to tech-packs
- SENTRY_DSN optional

Required web env:
- NEXT_PUBLIC_API_URL

## 2. Deploy API on Render
Use the included render.yaml.

Render build command:

```bash
npm ci && npm --workspace apps/api exec prisma generate && npm --workspace apps/api run build
```

Render start command:

```bash
npm --workspace apps/api run start
```

Render health check path:

```text
/health
```

Set env vars in Render:

```text
NODE_ENV=production
DATABASE_URL=<postgres-url>
SESSION_SECRET=<long-random-secret>
CORS_ORIGIN=<vercel-web-url>
WEB_ORIGIN=<vercel-web-url>
ADMIN_ALERT_EMAIL=<your-email>
RESEND_API_KEY=<resend-api-key>
RESEND_FROM_EMAIL=Rishi Fabrics <alerts@your-domain>
SUPABASE_URL=<supabase-project-url>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
SUPABASE_STORAGE_BUCKET=tech-packs
SENTRY_DSN=<optional>
```

After the first API deploy, open a Render shell and run:

```bash
npm --workspace apps/api run db:push
ADMIN_EMAIL=<your-email> ADMIN_NAME="Srijan Chopra" ADMIN_PASSWORD=<strong-password> npm --workspace apps/api run db:seed:prod-admin
```

Only Admin is seeded. Everyone else should request access from the login page.

## 3. Deploy Web on Vercel
Use the included vercel.json from the repo root.

Set Vercel env:

```text
NEXT_PUBLIC_API_URL=<render-api-url>
```

Deploy. After Vercel gives the production URL, put that exact URL into Render:

```text
CORS_ORIGIN=<vercel-web-url>
WEB_ORIGIN=<vercel-web-url>
```

Then redeploy the API.

## 4. First Smoke Test Online
1. Open API /health and confirm ok=true.
2. Open API /health/deep and confirm database=ONLINE.
3. Open web login page.
4. Log in as Admin.
5. Request access with one new ERP/Merchant test email.
6. Confirm that user cannot log in before approval.
7. Approve the user in Settings.
8. Confirm normal login after approval.
9. Upload Tech Pack, Daily Production, WIP, and Fabric/Dyeing files.
10. Check Reports as MD role after approving/creating an MD user.
11. Check Monitoring as Admin.
12. Create one test issue from any user's Report Issue button and confirm the Admin alert email arrives.
13. Upload a tech pack and confirm the style preview loads. The Supabase bucket should remain private; files are served through the authenticated API.

## 5. Known Pilot Limitation
If Supabase storage env vars are not configured, tech-pack preview images fall back to local API disk. On free Render, disk is ephemeral. For production, configure Supabase Storage before uploading real tech packs.
