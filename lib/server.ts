import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function database() {
  if (!env.DB) throw new ApiError(503, "Database is not configured.");
  return env.DB;
}
export async function identity() {
  const user = await getChatGPTUser();
  if (!user)
    throw new ApiError(401, "Sign in to access the coordination desk.");
  const db = database();
  await db
    .prepare(
      "INSERT OR IGNORE INTO members (id,name,role) SELECT ?,?,CASE WHEN EXISTS(SELECT 1 FROM members) THEN 'reporter' ELSE 'coordinator' END",
    )
    .bind(user.userId, user.displayName)
    .run();
  return (await db
    .prepare("SELECT * FROM members WHERE id=?")
    .bind(user.userId)
    .first()) as { id: string; name: string; role: string };
}
export function failure(e: unknown) {
  if (e instanceof ApiError)
    return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json(
    { error: "The operation could not be completed. Refresh and try again." },
    { status: 500 },
  );
}
export function audit(actor: string, message: string) {
  return database()
    .prepare(
      "INSERT INTO activity (id,actor,message,created_at) VALUES (?,?,?,?)",
    )
    .bind(crypto.randomUUID(), actor, message, new Date().toISOString());
}
