import { test, expect } from "@playwright/test";
test("expired Access redirect shows reauthentication instead of Failed to fetch", async ({
  page,
}) => {
  await page.goto("/signin-with-chatgpt?return_to=%2F");
  await expect(
    page.getByRole("button", { name: "Report incident", exact: true }),
  ).toBeEnabled();
  // Reproduce the edge's response after a previously authenticated session expires.
  await page.route("**/api/state", (route) =>
    route.fulfill({
      status: 302,
      headers: { Location: "https://example.org/access-login" },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("alert")).toContainText(
    "sign-in session has expired",
  );
  await expect(page.getByRole("link", { name: "Sign in again" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Every response starts here." }),
  ).toBeVisible();
  await page.unroute("**/api/state");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("link", { name: "Sign in again" })).toHaveCount(
    0,
  );
  await expect(page.locator(".connection")).toContainText("Live updates");
});
test("network failure retains data and recovery clears the error", async ({
  page,
}) => {
  await page.goto("/signin-with-chatgpt?return_to=%2F");
  await expect(
    page.getByRole("button", { name: "Report incident", exact: true }),
  ).toBeEnabled();
  await page.route("**/api/state", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("alert")).toContainText("Check your connection");
  await expect(page.getByRole("link", { name: "Sign in again" })).toHaveCount(
    0,
  );
  await page.unroute("**/api/state");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
