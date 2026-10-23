import { ApiError, database } from "./server";
export async function receiptIdentity(
  request: Request,
  actor: string,
  body: string,
) {
  const key = request.headers.get("idempotency-key");
  if (!key) return null;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      key,
    )
  )
    throw new ApiError(400, "Invalid idempotency key.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return {
    id: `${actor}:${key}`,
    actor,
    hash: Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
  };
}
export async function priorReceipt(
  receipt: { id: string; hash: string } | null,
) {
  if (!receipt) return null;
  const prior = await database()
    .prepare("SELECT body_hash,result_id FROM receipts WHERE id=?")
    .bind(receipt.id)
    .first<{ body_hash: string; result_id: string }>();
  if (!prior) return null;
  if (prior.body_hash !== receipt.hash)
    throw new ApiError(
      409,
      "This retry key was already used for different data.",
    );
  return Response.json({ ok: true, id: prior.result_id, replayed: true });
}
