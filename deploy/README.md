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

4. Prepare, migrate, and deploy:

   ```sh
   npm run build
   npm run cloudflare:prepare
   npx wrangler d1 migrations apply DB --remote --config dist/server/wrangler.free.json
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

Live updates use a short server-sent event connection with one indexed revision read per second. Connections renew every 25 seconds; background tabs close them. The browser also refreshes the full workspace every 30 seconds as a fallback. This is sized for a small course demo, not sustained public emergency traffic. Monitor quotas and CPU in the Cloudflare dashboard during your demonstration; free quota exhaustion must be treated as service unavailability. Do not enable paid upgrades automatically.

## Demo walkthrough

1. Add a response team and a supply (e.g. 100 water kits).
2. Report a simulated flood with affected population and location.
3. Assign the response team and mark Responding.
4. Request 20 water kits. In another browser, observe the request and dispatch it.
5. Confirm stock fell to 80; a repeated dispatch cannot reduce it again.
6. Mark Contained, then Resolved. Show the activity log and export.
7. Demonstrate a reporter cannot restock or change roles, and two requests cannot overdraw the same inventory.
