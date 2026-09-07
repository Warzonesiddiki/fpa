import { expect, test, type Page } from "@playwright/test";

/**
 * M7-5 / UF-004 & UF-007: Planning Journey (E2E-TESTING §UF-004/§UF-007).
 * The dev-preview core keeps the session in memory: any full page load (page.goto)
 * resets it to locked. All in-app navigation therefore goes through SPA links,
 * buttons, or the ⌘K Search Palette (react-router navigate() — no reload).
 */

/** Unlock S-001 once; every later step must navigate SPA-style. */
async function unlock(page: Page): Promise<void> {
  await page.goto("/");
  const pinInput = page.getByRole("textbox", { name: "PIN" });
  await pinInput.fill("CorrectPin9!");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
}

test("Open Model Grid -> Edit line item cell -> Verify formula recalc -> Compare scenarios", async ({
  page,
}) => {
  await unlock(page);

  // Step 1: Model nav link → /app/model redirects to the Model Grid (router.tsx).
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Model" }).click();
  await expect(page).toHaveURL(/\/app\/model\/grid/);
  await expect(page.getByRole("heading", { name: "Model Grid" })).toBeVisible();

  // The grid region carries data-testid="model-grid" (S-041).
  const grid = page.getByTestId("model-grid");
  await expect(grid).toBeVisible();

  // Step 2: Edit the first period cell of the first line through the formula bar.
  const firstCell = page.locator('[role="gridcell"][col-id^="p-"]').first();
  await expect(firstCell).toBeVisible();
  await firstCell.click();

  const formulaBar = page.getByLabel("Formula bar");
  await expect(formulaBar).toBeVisible();
  await formulaBar.fill("250000.00");
  await page.getByRole("button", { name: /Apply/ }).click();

  // Step 3: The audited write surfaces its audit event id (S-041 contract).
  await expect(page.getByText(/audit #\d+/)).toBeVisible();

  // Step 4: Compare Scenarios (S-050 → S-051) — the S-050 button is SPA navigation
  // (fixed from window.location.href, which reloaded the webview and dropped the session).
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Plan" }).click();
  await expect(page).toHaveURL(/\/app\/plan\/scenarios/);
  await expect(page.getByRole("heading", { name: "Scenario Manager" })).toBeVisible();

  await page.getByRole("button", { name: "Compare Scenarios" }).click();
  await expect(page).toHaveURL(/\/app\/plan\/compare/);
  await expect(page.getByRole("heading", { name: "Model Compare" })).toBeVisible();

  // S-051 empty state: two scenario selectors + the "select two" guidance.
  const scenarioA = page.getByRole("combobox", { name: "Scenario A" });
  const scenarioB = page.getByRole("combobox", { name: "Scenario B" });
  await expect(scenarioA).toBeVisible();
  await expect(scenarioB).toBeVisible();
  await expect(page.getByText("Select two Scenarios to compare their cell values.")).toBeVisible();
});
