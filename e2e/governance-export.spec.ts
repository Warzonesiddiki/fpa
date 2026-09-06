import { expect, test } from "@playwright/test";

/**
 * M7-5 / UF-005, UF-010, UF-014: Governance & Export Journey
 * Flow:
 * 1. Unlock session & navigate to S-070 Audit Trail
 * 2. Verify HMAC audit log entries & verified chain indicator
 * 3. Export Auditor Data Room package
 * 4. Navigate to S-074 Backup & Restore
 * 5. Open backup creation flow & create encrypted backup
 */
test.describe("Governance & Export Journey (UF-005, UF-010, UF-014)", () => {
  test("Navigate to Audit Trail -> Verify HMAC log entries -> Export Auditor Data Room -> Open Backup & Restore -> Create Backup", async ({
    page,
  }) => {
    // Step 1: Unlock session to open company
    await page.goto("/");
    const pinInput = page.getByRole("textbox", { name: "PIN" });
    await pinInput.fill("CorrectPin9!");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);

    // Navigate to S-070 Audit Trail
    await page.goto("/app/governance/audit");
    await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();

    // Step 2: Verify HMAC audit log entries and verified chain indicator
    await expect(page.getByText("Chain verified").or(page.getByText("Chain intact"))).toBeVisible();
    const eventRows = page.locator("li").filter({ hasText: /expand payload/i });
    await expect(eventRows.first()).toBeVisible();

    // Expand the first event row to inspect HMAC hash linkage
    await eventRows
      .first()
      .getByRole("button", { name: /expand payload/i })
      .click();
    await expect(page.getByText("Previous event hash")).toBeVisible();
    await expect(page.getByText("Event hash")).toBeVisible();

    // Step 3: Export Auditor Data Room package
    const exportDataRoomBtn = page.getByRole("button", { name: "Auditor Data-Room Export" });
    await expect(exportDataRoomBtn).toBeVisible();
    await exportDataRoomBtn.click();

    // Verify success banner feedback
    await expect(page.getByTestId("audit-export-success-banner")).toBeVisible();

    // Step 4: Navigate to S-074 Backup & Restore
    await page.goto("/app/governance/backup");
    await expect(page.getByRole("heading", { name: "Backup & Restore" })).toBeVisible();

    // Step 5: Create Backup
    const backupNowBtn = page.getByTestId("backup-now-btn");
    await expect(backupNowBtn).toBeVisible();
    await backupNowBtn.click();

    // Dialog opens: specify destination path & passphrase
    await expect(page.getByText("Create Encrypted Backup")).toBeVisible();
    const pathInput = page.locator("#backup-path");
    const passphraseInput = page.locator("#backup-passphrase");

    await pathInput.fill("C:\\backups\\e2e-demo-backup.fpa-bak");
    await passphraseInput.fill("StrongBackupPass9!");

    const confirmCreateBtn = page.getByRole("button", { name: "Create Backup" });
    await expect(confirmCreateBtn).toBeEnabled();
    await confirmCreateBtn.click();

    // Verify success message / state
    await expect(page.getByText(/Backup created and encrypted successfully/i)).toBeVisible();
  });
});
