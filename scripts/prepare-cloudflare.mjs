import { readFileSync, writeFileSync } from "node:fs";
const input = JSON.parse(readFileSync("deploy/cloudflare.local.json", "utf8"));
if (!/^[a-z][a-z0-9-]{2,50}$/.test(input.name))
  throw new Error("Invalid Worker name");
if (
  !/^[a-f0-9-]{36}$/.test(input.database_id) ||
  input.database_id === "00000000-0000-4000-8000-000000000000"
)
  throw new Error("Set the actual D1 database ID");
if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(input.access_issuer))
  throw new Error("Set the Access team issuer");
if (!/^[a-f0-9]{64}$/.test(input.access_audience))
  throw new Error("Set the Access application audience");
const config = JSON.parse(readFileSync("dist/server/wrangler.json", "utf8"));
config.name = input.name;
config.workers_dev = true;
config.preview_urls = false;
config.d1_databases = [
  {
    binding: "DB",
    database_name: input.name,
    database_id: input.database_id,
    migrations_dir: "../../drizzle",
  },
];
config.services = [
  ...(config.services || []).filter((s) => s.binding !== "CLOUD"),
  { binding: "CLOUD", service: "relief-desk-cloud" },
];
config.vars = {
  ...config.vars,
  AUTH_MODE: "cloudflare-access",
  ACCESS_ISSUER: input.access_issuer,
  ACCESS_AUD: input.access_audience,
};
// Keep the standalone config beside the generated config to preserve relative asset paths.
writeFileSync(
  "dist/server/wrangler.free.json",
  JSON.stringify(config, null, 2) + "\n",
);
console.log(
  "Prepared dist/server/wrangler.free.json. Access JWT validation is required on every request.",
);

const cloud = JSON.parse(readFileSync("cloud/wrangler.json", "utf8"));
cloud.d1_databases = [
  { binding: "DB", database_name: input.name, database_id: input.database_id },
];
writeFileSync(
  "cloud/wrangler.production.json",
  JSON.stringify(cloud, null, 2) + "\n",
);
