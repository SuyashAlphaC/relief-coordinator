import { test, expect } from "@playwright/test";
const origin = "http://127.0.0.1:5193";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMfsAAAAASUVORK5CYII=",
  "base64",
);
test("queued alerts, manual scheduled check, private attachments, and incident presence", async ({
  page,
  context,
}) => {
  await page.goto("/signin-with-chatgpt?return_to=%2F");
  await expect(page.getByText(/Live updates/)).toBeVisible();
  const title = `Cloud workflow ${Date.now()}`;
  const created = await context.request.post("/api/action", {
    headers: { Origin: origin },
    data: {
      action: "incident",
      data: {
        title,
        type: "Flood",
        severity: "critical",
        location: "Local test",
        description: "Simulated incident for cloud integration tests.",
        people: 12,
        lat: null,
        lng: null,
      },
    },
  });
  expect(created.status()).toBe(200);
  const { id } = (await created.json()) as any;
  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await expect(
    page.getByText(`${title} · Local test`, { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  const card = page.locator(".alert-card").filter({ hasText: title });
  await card.getByRole("button", { name: "Acknowledge" }).click();
  await expect(card).toHaveCount(0);
  await page.getByLabel("Show acknowledged").check();
  await expect(
    page.locator(".alert-card").filter({ hasText: title }),
  ).toContainText("Acknowledged");
  await page.getByRole("button", { name: "Check now" }).click();
  await expect(page.getByText(/Last check:/)).toBeVisible();
  await page.getByRole("button", { name: "Incidents", exact: true }).click();
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByText("1 viewing", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await page
    .getByLabel("Choose incident attachment")
    .setInputFiles({
      name: "assessment.png",
      mimeType: "image/png",
      buffer: png,
    });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "assessment.png" }),
  ).toBeVisible();
  const href = await page
    .getByRole("link", { name: "assessment.png" })
    .getAttribute("href");
  const file = await context.request.get(href!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-disposition"]).toContain("attachment;");
  expect(await file.body()).toEqual(png);
  const unauth = await fetch(origin + href);
  expect(unauth.status).toBe(401);
  const headers = {
    Origin: origin,
    "Content-Type": "image/png",
    "X-Filename": "invalid.png",
    "X-Incident-ID": id,
    "Idempotency-Key": crypto.randomUUID(),
  };
  expect(
    (
      await context.request.post("/api/cloud/attachments", {
        headers,
        data: Buffer.from("<script>bad</script>"),
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await context.request.post("/api/cloud/attachments", {
        headers: { ...headers, "Content-Type": "text/html" },
        data: Buffer.from("<html>bad</html>"),
      })
    ).status(),
  ).toBe(415);
  expect(
    (
      await context.request.post("/api/cloud/attachments", {
        headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        data: Buffer.alloc(5 * 1024 * 1024 + 1),
      })
    ).status(),
  ).toBe(413);
  await page
    .getByRole("button", { name: "Remove assessment.png", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm removal" }).click();
  await expect(page.getByRole("link", { name: "assessment.png" })).toHaveCount(
    0,
  );
  expect((await context.request.get(href!)).status()).toBe(404);
});
test("attachment retries are idempotent and live endpoint rejects cross-origin connections", async ({
  context,
}) => {
  await context.request.get("/signin-with-chatgpt");
  const state = (await (await context.request.get("/api/state")).json()) as any;
  const incident = state.incidents[0];
  const key = crypto.randomUUID();
  const upload = () =>
    context.request.post("/api/cloud/attachments", {
      headers: {
        Origin: origin,
        "Content-Type": "image/png",
        "X-Filename": "retry.png",
        "X-Incident-ID": incident.id,
        "Idempotency-Key": key,
      },
      data: png,
    });
  expect((await upload()).status()).toBe(200);
  expect((await upload()).status()).toBe(200);
  const files = (await (
    await context.request.get(`/api/cloud/attachments?incident=${incident.id}`)
  ).json()) as any[];
  expect(files.filter((f) => f.id === key)).toHaveLength(1);
  expect(
    (
      await context.request.get("/api/live", {
        headers: { Origin: "https://attacker.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.delete(`/api/cloud/files/${key}`, {
        headers: { Origin: origin },
      })
    ).status(),
  ).toBe(200);
});
