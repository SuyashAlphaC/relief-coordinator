import { test, expect } from "@playwright/test";
const origin = "http://127.0.0.1:5193";
test("complete coordination workflow, concurrent dispatch, stale updates, and browser refresh", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/signin-with-chatgpt?return_to=%2F");
  await expect(
    page.getByRole("heading", { name: "Every response starts here." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Report incident", exact: true }),
  ).toBeEnabled();
  const suffix = Date.now();
  await page
    .getByRole("button", { name: "Report incident", exact: true })
    .click();
  await page.getByLabel("Title", { exact: true }).fill(`Test flood ${suffix}`);
  await page.getByLabel("Location", { exact: true }).fill("Patna, Bihar");
  await page
    .getByLabel("Situation report")
    .fill("Simulated flooding; families need clean water and rescue support.");
  await page.getByLabel("Estimated people affected").fill("75");
  await page.getByRole("button", { name: "Save changes" }).click();
  // The overview shows only six priority reports; inspect the complete list.
  await page.getByRole("button", { name: "Incidents", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Test flood ${suffix}`, exact: true }),
  ).toBeVisible();
  const api = async (data: any) => {
    const r = await context.request.post("/api/action", {
      headers: { Origin: origin },
      data,
    });
    return { status: r.status(), data: (await r.json()) as any };
  };
  const get = async () =>
    (await (await context.request.get("/api/state")).json()) as any;
  const team = await api({
    action: "team",
    name: `Rescue ${suffix}`,
    specialty: "Water rescue",
    personnel: 10,
    location: "Patna",
  });
  expect(team.status).toBe(200);
  const supply = await api({
    action: "resource",
    name: `Water ${suffix}`,
    unit: "litres",
    quantity: 10,
    location: "Depot",
  });
  expect(supply.status).toBe(200);
  let state = await get();
  const incident = state.incidents.find(
    (i: any) => i.title === `Test flood ${suffix}`,
  );
  expect(
    (
      await api({
        action: "status",
        id: incident.id,
        version: incident.version,
        status: "responding",
        teamId: null,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await api({
        action: "status",
        id: incident.id,
        version: incident.version,
        status: "responding",
        teamId: team.data.id,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await api({
        action: "status",
        id: incident.id,
        version: incident.version,
        status: "contained",
        teamId: team.data.id,
      })
    ).status,
  ).toBe(409);
  const q1 = await api({
    action: "request",
    incidentId: incident.id,
    resourceId: supply.data.id,
    quantity: 6,
  });
  const q2 = await api({
    action: "request",
    incidentId: incident.id,
    resourceId: supply.data.id,
    quantity: 6,
  });
  expect(q1.status).toBe(200);
  expect(q2.status).toBe(200);
  const outcomes = await Promise.all(
    [q1, q2].map((q) => api({ action: "fulfill", id: q.data.id, version: 1 })),
  );
  expect(outcomes.map((o) => o.status).sort()).toEqual([200, 409]);
  state = await get();
  expect(
    state.resources.find((r: any) => r.id === supply.data.id).quantity,
  ).toBe(4);
  const fulfilled = state.requests.find(
    (r: any) =>
      [q1.data.id, q2.data.id].includes(r.id) && r.status === "fulfilled",
  );
  expect(
    (await api({ action: "fulfill", id: fulfilled.id, version: 1 })).status,
  ).toBe(409);
  const pending = state.requests.find(
    (r: any) =>
      [q1.data.id, q2.data.id].includes(r.id) && r.status === "pending",
  );
  expect(
    (
      await api({
        action: "status",
        id: incident.id,
        version: 2,
        status: "resolved",
        teamId: team.data.id,
      })
    ).status,
  ).toBe(409);
  expect(
    (await api({ action: "cancel", id: pending.id, version: 1 })).status,
  ).toBe(200);
  expect(
    (
      await api({
        action: "status",
        id: incident.id,
        version: 2,
        status: "resolved",
        teamId: team.data.id,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await api({
        action: "request",
        incidentId: incident.id,
        resourceId: supply.data.id,
        quantity: 1,
      })
    ).status,
  ).toBe(400);
  await page.getByRole("button", { name: "Incidents", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search Incidents" })
    .fill(`Test flood ${suffix}`);
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: `Test flood ${suffix}` })
      .getByText("Resolved", { exact: true }),
  ).toBeVisible({ timeout: 12000 });
  await page.reload();
  await page.getByRole("button", { name: "Incidents", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Test flood ${suffix}`, exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("API rejects unauthenticated, forged identity, cross-origin, malformed, and invalid inputs", async ({
  request,
}) => {
  expect((await request.get("/api/state")).status()).toBe(401);
  expect(
    (
      await request.get("/api/state", {
        headers: {
          "oai-authenticated-user-id": "forged",
          "oai-authenticated-user-email": "forged@example.com",
        },
      })
    ).status(),
  ).toBe(401);
  await request.get("/signin-with-chatgpt");
  expect(
    (
      await request.post("/api/action", {
        headers: { Origin: "https://attacker.example" },
        data: { action: "team" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/action", {
        headers: { Origin: origin, "Content-Type": "application/json" },
        data: "{bad",
      })
    ).status(),
  ).toBe(400);
  for (const data of [
    { action: "unknown" },
    {
      action: "resource",
      name: "Water",
      unit: "litres",
      quantity: -1,
      location: "Depot",
    },
    {
      action: "resource",
      name: "Water",
      unit: "litres",
      quantity: 1.5,
      location: "Depot",
    },
    {
      action: "incident",
      data: {
        title: " ",
        type: "Flood",
        severity: "critical",
        location: "Here",
        description: "a".repeat(20),
        people: 0,
        lat: 100,
        lng: 0,
      },
    },
  ])
    expect(
      (
        await request.post("/api/action", { headers: { Origin: origin }, data })
      ).status(),
    ).toBe(400);
  expect(
    (
      await request.post("/api/action", {
        headers: { Origin: origin, "Content-Type": "application/json" },
        data: " ".repeat(13000),
      })
    ).status(),
  ).toBe(413);
});
test("mobile layout fits viewport and dialogs support keyboard close", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/signin-with-chatgpt?return_to=%2F");
  await expect(
    page.getByRole("button", { name: "Report incident", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Report incident", exact: true })
    .click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).not.toBeVisible();
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
});
test("a second browser receives live updates and recovers after losing connectivity", async ({
  browser,
}) => {
  const first = await browser.newContext(),
    second = await browser.newContext();
  const a = await first.newPage(),
    b = await second.newPage();
  await a.goto("/signin-with-chatgpt?return_to=%2F");
  await b.goto("/signin-with-chatgpt?return_to=%2F");
  await expect(b.getByText(/Live updates/)).toBeVisible();
  const title = `Live report ${Date.now()}`;
  const response = await first.request.post("/api/action", {
    headers: { Origin: origin },
    data: {
      action: "incident",
      data: {
        title,
        type: "Fire",
        severity: "critical",
        location: "Test district",
        description: "A simulated report for live synchronization testing.",
        people: 3,
        lat: null,
        lng: null,
      },
    },
  });
  expect(response.ok()).toBe(true);
  await expect(b.getByRole("button", { name: title, exact: true })).toBeVisible(
    { timeout: 10000 },
  );
  await second.setOffline(true);
  await b.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(b.getByText("Connection unavailable")).toBeVisible({
    timeout: 15000,
  });
  await second.setOffline(false);
  await b.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(b.getByText(/Live updates|Reconnecting/)).toBeVisible({
    timeout: 15000,
  });
  await first.close();
  await second.close();
});
test("concurrent retries create one report, mismatched payloads conflict, and HTML stays text", async ({
  page,
  context,
}) => {
  await page.goto("/signin-with-chatgpt?return_to=%2F");
  const key = crypto.randomUUID(),
    title = `<img src=x onerror=alert(1)> ${Date.now()}`;
  const data = {
    action: "incident",
    data: {
      title,
      type: "Other",
      severity: "low",
      location: "Test district",
      description: "An injection test report, not an actual emergency.",
      people: 0,
      lat: null,
      lng: null,
    },
  };
  const send = (payload: any) =>
    context.request.post("/api/action", {
      headers: { Origin: origin, "Idempotency-Key": key },
      data: payload,
    });
  const responses = await Promise.all([send(data), send(data)]);
  expect(responses.map((r) => r.status())).toEqual([200, 200]);
  const results = await Promise.all(
    responses.map((r) => r.json() as Promise<any>),
  );
  expect(results[0].id).toBe(results[1].id);
  expect(
    (
      await send({ ...data, data: { ...data.data, title: "Changed title" } })
    ).status(),
  ).toBe(409);
  const state = (await (await context.request.get("/api/state")).json()) as any;
  expect(state.incidents.filter((i: any) => i.title === title)).toHaveLength(1);
  await page.getByRole("button", { name: "Incidents", exact: true }).click();
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible({ timeout: 10000 });
  expect(await page.locator('img[src="x"]').count()).toBe(0);
});
