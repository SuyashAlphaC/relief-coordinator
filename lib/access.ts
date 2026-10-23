import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
const keySets = new Map<string, JWTVerifyGetKey>();
export async function verifyAccessToken(
  token: string,
  issuer: string,
  audience: string,
  keys?: JWTVerifyGetKey,
) {
  if (
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) ||
    !audience
  )
    throw new Error("Access is not configured");
  let key = keys || keySets.get(issuer);
  if (!key) {
    key = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    keySets.set(issuer, key);
  }
  const { payload } = await jwtVerify(token, key, {
    issuer,
    audience,
    algorithms: ["RS256"],
  });
  if (
    !payload.sub ||
    typeof payload.email !== "string" ||
    !payload.email.includes("@")
  )
    throw new Error("User identity required");
  return { id: payload.sub, email: payload.email };
}
export async function authenticateAccess(
  request: Request,
  env: { ACCESS_ISSUER?: string; ACCESS_AUD?: string },
) {
  if (!env.ACCESS_ISSUER || !env.ACCESS_AUD)
    return Response.json(
      { error: "Configure Cloudflare Access before using this deployment." },
      { status: 503 },
    );
  try {
    const token = request.headers.get("cf-access-jwt-assertion");
    if (!token) throw new Error("Missing token");
    const user = await verifyAccessToken(
      token,
      env.ACCESS_ISSUER,
      env.ACCESS_AUD,
    );
    const headers = new Headers(request.headers);
    for (const name of [...headers.keys()])
      if (name.startsWith("oai-authenticated-user-")) headers.delete(name);
    headers.set("oai-authenticated-user-id", `cf:${user.id}`);
    headers.set("oai-authenticated-user-email", user.email);
    return new Request(request, { headers });
  } catch {
    return Response.json(
      { error: "Cloudflare Access sign-in is required." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
}
