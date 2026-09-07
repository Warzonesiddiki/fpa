import { expect, test, type Page } from "@playwright/test";

/**
 * E2E navigation smoke: Import Hub → Audit Trail → Backup & Restore.
 * The dev-preview core keeps the session in memory: full page loads reset it to
 * locked, so navigation goes through SPA links only (no page.goto after unlock).
 */

/** Unlock S-001 once; every later step must navigate SPA-style. */
async function unlock(page: Page): Promise<void> {
  await page.goto("/");
  const pinInput = page.getByRole("textbox", { name: "PIN" });
  await pinInput.fill("CorrectPin9!");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
}

test("Import & Governance: navigate to import hub, audit trail and backup screen", async ({
  page,
}) => {
  await unlock(page);

  const mainNav = page.getByRole("navigation", { name: "Main" });

  // Import Hub (S-030) — the "Data" nav link redirects to /app/import.
  await mainNav.getByRole("link", { name: "Data" }).click();
  await expect(page).toHaveURL(/\/app\/import/);
  await expect(page.getByRole("heading", { level: 1, name: /Import Hub/i })).toBeVisible();

  // Audit Trail (S-070) — "Governance" nav link redirects to /app/governance/audit.
  await mainNav.getByRole("link", { name: "Governance" }).click();
  await expect(page).toHaveURL(/\/app\/governance\/audit/);
  await expect(page.getByRole("heading", { level: 1, name: /Audit Trail/i })).toBeVisible();
  await expect(page.getByTestId("audit-chain-chip")).toContainText(/Chain verified/i);

  // Backup & Restore (S-074) — reachable through the ⌘K Search Palette, which
  // navigates SPA-style (navigate(entry.payload)); no page reload, session intact.
  await page.getByRole("button", { name: /Search/ }).click();
  await page.getByRole("combobox", { name: /Search/i }).fill("Backup");
  await page
    .getByRole("option", { name: /Backup & Restore/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/app\/governance\/backup/);
  await expect(page.getByRole("heading", { level: 1, name: /Backup & Restore/i })).toBeVisible();
});
