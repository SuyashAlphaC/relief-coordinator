import { database, identity, failure } from "@/lib/server";
export async function GET() {
  try {
    const user = await identity();
    const db = database();
    const tables = [
      "incidents",
      "teams",
      "resources",
      "requests",
      "activity",
      "members",
    ];
    const results = await db.batch(
      tables.map((t) =>
        db.prepare(
          `SELECT * FROM ${t} ${t === "activity" ? "ORDER BY created_at DESC LIMIT 60" : ""}`,
        ),
      ),
    );
    return Response.json(
      {
        user,
        ...Object.fromEntries(tables.map((t, i) => [t, results[i].results])),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
