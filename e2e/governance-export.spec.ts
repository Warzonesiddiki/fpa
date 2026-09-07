import { expect, test, type Page } from "@playwright/test";

/**
 * M7-5 / UF-005, UF-010, UF-014: Governance & Export Journey (E2E-TESTING).
 * Audit Trail (verify chain + expand payload) → Auditor Data-Room export →
 * Backup & Restore (create an encrypted backup).
 * The dev-preview core keeps the session in memory: full page loads reset it to
 * locked, so every in-app step navigates SPA-style (no page.goto after unlock).
 */

/** Unlock S-001 once; every later step must navigate SPA-style. */
async function unlock(page: Page): Promise<void> {
  await page.goto("/");
  const pinInput = page.getByRole("textbox", { name: "PIN" });
  await pinInput.fill("CorrectPin9!");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
}

test("Audit Trail -> verify HMAC chain -> Data-Room export -> Backup & Restore -> Create Backup", async ({
  page,
}) => {
  await unlock(page);

  // Step 1: Governance nav link → /app/governance redirects to the Audit Trail.
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Governance" })
    .click();
  await expect(page).toHaveURL(/\/app\/governance\/audit/);
  await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();

  // Step 2: verified chain chip + expandable event rows with hash linkage.
  const chainChip = page.getByTestId("audit-chain-chip");
  await expect(chainChip).toContainText(/Chain verified/i);
  const firstToggle = page.getByRole("button", { name: /^#\d+$/ }).first();
  await expect(firstToggle).toBeVisible();
  await firstToggle.click();
  await expect(page.getByText("Previous hash")).toBeVisible();
  await expect(page.getByText(/^Hash$/)).toBeVisible();

  // Step 3: Auditor Data-Room export (audited mutation; success banner asserts).
  const dataRoomBtn = page.getByRole("button", { name: /Auditor Data-Room Export/i });
  await expect(dataRoomBtn).toBeEnabled();
  await dataRoomBtn.click();
  await expect(page.getByTestId("audit-export-success-banner")).toBeVisible();

  // Step 4: Backup & Restore (S-074) via the ⌘K palette — the only SPA path.
  await page.getByRole("button", { name: /Search/ }).click();
  await page.getByRole("combobox", { name: /Search/i }).fill("Backup");
  await page
    .getByRole("option", { name: /Backup & Restore/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/app\/governance\/backup/);
  await expect(page.getByText("Backup & Restore")).toBeVisible();

  // Step 5: Create an encrypted backup.
  await page.getByTestId("backup-now-btn").first().click();
  await expect(page.getByText("Create Encrypted Backup")).toBeVisible();
  await page.locator("#backup-path").fill("C:\\backups\\e2e-demo-backup.fpa-bak");
  await page.locator("#backup-passphrase").fill("StrongBackupPass9!");
  const confirmCreate = page.getByRole("button", { name: "Create Backup" });
  await expect(confirmCreate).toBeEnabled();
  await confirmCreate.click();
  await expect(page.getByText(/Backup created and encrypted successfully/i)).toBeVisible();
});
