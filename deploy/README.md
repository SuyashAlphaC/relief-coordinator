# Deploy on Cloudflare Free

This target uses your own free Cloudflare account. Sites hosting remains an independent private preview. Do not enable a paid Workers subscription for this course demo.

1. Create your account at https://dash.cloudflare.com/sign-up and log in locally:

   ```sh
   npx wrangler login
   npx wrangler whoami
   npx wrangler d1 create relief-desk
   ```

2. Build and copy `deploy/cloudflare.example.json` to the ignored `deploy/cloudflare.local.json`. Fill in the real database ID returned above. Choose a unique Worker name if needed.

3. In Cloudflare Zero Trust, select the Free plan and configure your team domain. Create a self-hosted Access application for your intended `<worker-name>.<account-subdomain>.workers.dev` hostname, with an Allow policy containing only your course team emails. Use email one-time PIN or your existing identity provider. Copy the application AUD tag and team issuer into `deploy/cloudflare.local.json`.

4. Enable R2 in the dashboard, then provision the private bucket and queues once:

   ```sh
   npx wrangler r2 bucket create relief-desk-attachments
   npx wrangler queues create relief-desk-events
   npx wrangler queues create relief-desk-events-dlq
   ```

   Prepare, migrate, and deploy the private services Worker before the app:

   ```sh
   npm run build
   npm run cloudflare:prepare
   npx wrangler d1 migrations apply DB --remote --config dist/server/wrangler.free.json
   npx wrangler deploy --config cloud/wrangler.production.json
   npx wrangler deploy --config dist/server/wrangler.free.json
   ```

5. Enable Access protection for the workers.dev hostname in the Worker's Settings → Domains & Routes, and verify the application policy and audience match the configuration. The Worker independently verifies Access JWT signature, issuer, audience, expiry, and user identity on every request. Before Access is configured, the app fails closed. Forged Sites identity headers cannot grant access in this deployment mode.

6. Sign in as the intended first coordinator before inviting other course members. First authenticated access initializes the coordinator; subsequent users join as reporters. Use Access in Relief Desk to promote responders. Verify a second browser can see a new incident immediately.

Never deploy the generated `dist/server/wrangler.json` directly to a public account: that configuration is for the Sites identity proxy. The standalone `wrangler.free.json` sets the required `AUTH_MODE=cloudflare-access`.

After every rebuild rerun `npm run cloudflare:prepare`, because `dist/` is generated. D1 migration tracking applies only new migrations. Back up data before schema changes with `wrangler d1 export`.

## Free quotas and limits

Official pricing checked during development:

- Workers Free: 100,000 requests/day, 10 ms CPU/request: https://developers.cloudflare.com/workers/platform/pricing/
- D1 Free: 5 million rows read/day, 100,000 rows written/day, 5 GB total storage: https://developers.cloudflare.com/d1/platform/pricing/

Live updates use hibernating Durable Objects and WebSockets, with a 30-second snapshot fallback. R2 stores private incident files; Queues processes in-app notifications; Cron checks every five minutes. The services Worker has no public workers.dev or preview URL. Keep the R2 bucket private.

Check usage in the dashboard. Included quotas are finite, and R2 activation may require billing details. Application storage caps (5 MB/file, 20/incident, 500 MB/workspace) limit stored file data, but do not cap all possible operation charges. No paid Workers upgrade is required by this configuration. Additional references:

- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/queues/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/pricing/

Migrations 0004 and 0005 are additive. To roll back app code, deploy the previous Worker versions while retaining these tables and stored objects. Do not drop tables or buckets as a code rollback. For failed events, inspect the outbox and dead-letter queue; scheduled scans retry unprocessed events. Old interrupted file transfers are reconciled after one hour.

## Demo walkthrough

1. Add a response team and a supply (e.g. 100 water kits).
2. Report a simulated flood with affected population and location.
3. Assign the response team and mark Responding.
4. Request 20 water kits. In another browser, observe the request and dispatch it.
5. Confirm stock fell to 80; a repeated dispatch cannot reduce it again.
6. Mark Contained, then Resolved. Show the activity log and export.
7. Demonstrate a reporter cannot restock or change roles, and two requests cannot overdraw the same inventory.

8. Open an incident and upload a PNG/JPG/PDF, download it, then remove it.
9. Report a critical incident and open Alerts; acknowledge its notification. Use Check now as coordinator to demonstrate stock checks.
10. Open the app in two browsers and show live workspace presence and incident viewers.

## Assignment rollout (25 October 2026)

Apply additive migrations 0006 and 0007 before deploying either updated Worker. Export D1 before migration. These add coordinates/availability/version to teams, assignment metadata to incidents, transactional assignment audit, and guards against new overlapping team allocations. Legacy data and existing allocations are preserved, including any historical overlapping assignments; no records are deleted or bulk assigned.

Deploy the cloud Worker before the main Worker. Its single cron is now `* * * * *`; assignment recovery runs every minute while escalation checks run on minutes divisible by five. Existing team coordinates must be configured by a coordinator before automatic dispatch is eligible.

For code rollback, retain the additive columns and tables, roll back both Workers, and restore the previous five-minute schedule if needed. The team guards remain active and reject new overlapping assignments from either application version. Do not drop assignment data or disable integrity guards to roll back a UI change.
