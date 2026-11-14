import { test, expect } from "@playwright/test";
const origin = "http://127.0.0.1:5193";
test("new incident is assigned immediately, busy teams are skipped, and released capacity retries", async ({
  page,
  context,
}) => {
  await page.goto("/signin-with-chatgpt?return_to=%2F");
  await expect(
    page.getByRole("button", { name: "Report incident", exact: true }),
  ).toBeEnabled();
  const post = async (data: any) => {
    const response = await context.request.post("/api/action", {
      headers: { Origin: origin, "Idempotency-Key": crypto.randomUUID() },
      data,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json() as Promise<any>;
  };
  const snapshot = async () =>
    (await context.request.get("/api/state")).json() as Promise<any>;
  const suffix = Date.now();
  const near = await post({
    action: "team",
    name: `Near team ${suffix}`,
    specialty: "Rescue",
    personnel: 3,
    location: "Demo base",
    lat: -70,
    lng: 20,
    available: true,
  });
  const far = await post({
    action: "team",
    name: `Far team ${suffix}`,
    specialty: "Rescue",
    personnel: 3,
    location: "Second base",
    lat: -70,
    lng: 21,
    available: true,
  });
  // Preexisting local test teams have no coordinates; both new bases are isolated demo locations.
  const created: string[] = [];
  try {
    const started = Date.now();
    const report = async (title: string) => {
      const r = await post({
        action: "incident",
        data: {
          title,
          type: "Flood",
          severity: "critical",
          location: "Demo incident",
          description: "Simulated automatic assignment test incident.",
          people: 2,
          lat: -70,
          lng: 20.001,
        },
      });
      created.push(r.id);
      return r.id;
    };
    const first = await report(`Auto report ${suffix}`);
    let state = await snapshot();
    let i = state.incidents.find((r: any) => r.id === first);
    expect(i.team_id).toBe(near.id);
    expect(i.assignment_state).toBe("assigned");
    expect(i.status).toBe("reported");
    expect(Date.now() - started).toBeLessThan(60000);
    expect(
      new Date(i.assigned_at).getTime() - new Date(i.created_at).getTime(),
    ).toBeLessThan(60000);
    await page.getByRole("button", { name: "Incidents", exact: true }).click();
    await page
      .getByRole("button", { name: `Auto report ${suffix}`, exact: true })
      .click();
    await expect(
      page.getByText(`Near team ${suffix}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").getByText(/Automatically assigned.*km away/),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const second = await report(`Second auto ${suffix}`);
    state = await snapshot();
    expect(state.incidents.find((r: any) => r.id === second).team_id).toBe(
      far.id,
    );
    const waiting = await report(`Waiting auto ${suffix}`);
    state = await snapshot();
    expect(
      state.incidents.find((r: any) => r.id === waiting).assignment_state,
    ).toBe("no_team");
    i = state.incidents.find((r: any) => r.id === first);
    await post({
      action: "status",
      id: first,
      version: i.version,
      status: "resolved",
      teamId: i.team_id,
    });
    await expect
      .poll(
        async () =>
          (await snapshot()).incidents.find((r: any) => r.id === waiting)
            .team_id,
        { timeout: 15000 },
      )
      .toBe(near.id);
    state = await snapshot();
    expect(
      state.notifications.some(
        (n: any) => n.entity_id === waiting && n.kind === "assignment",
      ),
    ).toBe(true);
    const blocked = await context.request.post("/api/action", {
      headers: { Origin: origin },
      data: {
        action: "status",
        id: waiting,
        version: state.incidents.find((r: any) => r.id === waiting).version,
        status: "reported",
        teamId: far.id,
      },
    });
    expect(blocked.status()).toBe(409);
    await page
      .getByRole("button", { name: "Response teams", exact: true })
      .click();
    const card = page
      .locator(".resource-card")
      .filter({ hasText: `Near team ${suffix}` });
    await card
      .getByRole("button", { name: "Update location / availability" })
      .click();
    await page.getByLabel("Available for new assignments").uncheck();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(card.getByText("Off duty", { exact: true })).toBeVisible();
  } finally {
    // Disable test teams first so resolving one report cannot reassign another during cleanup.
    let s = await snapshot();
    for (const id of [near.id, far.id]) {
      const t = s.teams.find((r: any) => r.id === id);
      if (t)
        await post({
          action: "team_position",
          id,
          version: t.version,
          location: t.location,
          lat: t.lat,
          lng: t.lng,
          available: false,
        });
    }
    for (const id of created) {
      s = await snapshot();
      const i = s.incidents.find((r: any) => r.id === id);
      if (i && i.status !== "resolved")
        await post({
          action: "status",
          id,
          version: i.version,
          status: "resolved",
          teamId: i.team_id,
        });
    }
  }
});
