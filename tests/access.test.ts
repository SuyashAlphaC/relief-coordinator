import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from "jose";
import { verifyAccessToken, authenticateAccess } from "../lib/access.ts";
const issuer = "https://relief-test.cloudflareaccess.com",
  audience = "test-audience";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = await exportJWK(publicKey);
jwk.kid = "test";
const keys = createLocalJWKSet({ keys: [jwk] });
const token = (claims: Record<string, unknown> = {}) =>
  new SignJWT({ email: "operator@example.com", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setSubject("user-1")
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime("5m")
    .sign(privateKey);
test("Access accepts a signed user with the expected issuer and audience", async () => {
  assert.deepEqual(
    await verifyAccessToken(await token(), issuer, audience, keys),
    { id: "user-1", email: "operator@example.com" },
  );
});
test("Access rejects wrong audience, issuer, tampering, expired JWT, and missing user email", async () => {
  const valid = await token();
  await assert.rejects(verifyAccessToken(valid, issuer, "wrong", keys));
  await assert.rejects(
    verifyAccessToken(
      valid,
      "https://another.cloudflareaccess.com",
      audience,
      keys,
    ),
  );
  const [head, body, sig] = valid.split(".");
  await assert.rejects(
    verifyAccessToken(
      `${head}.${body}.${sig.slice(0, -8)}aaaaaaaa`,
      issuer,
      audience,
      keys,
    ),
  );
  const expired = await new SignJWT({ email: "operator@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setSubject("user-1")
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(1)
    .sign(privateKey);
  await assert.rejects(verifyAccessToken(expired, issuer, audience, keys));
  await assert.rejects(
    verifyAccessToken(await token({ email: null }), issuer, audience, keys),
  );
});
test("standalone deployment fails closed without configuration or JWT despite forged Sites headers", async () => {
  const req = new Request("https://relief.workers.dev", {
    headers: {
      "oai-authenticated-user-id": "attacker",
      "oai-authenticated-user-email": "attacker@example.com",
    },
  });
  const missing = await authenticateAccess(req, {});
  assert(missing instanceof Response);
  assert.equal(missing.status, 503);
  const forged = await authenticateAccess(req, {
    ACCESS_ISSUER: issuer,
    ACCESS_AUD: audience,
  });
  assert(forged instanceof Response);
  assert.equal(forged.status, 401);
});
