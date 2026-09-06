import { expect, test } from "@playwright/test";

/** E2E: Import Hub, Audit Trail, and Backup */
test("Import \u0026 Governance: navigate to import hub, audit trail and backup screen", async ({
  page,
}) => {
  await page.goto("/");

  // Unlock
  const pinInput = page.getByRole("textbox", { name: "PIN" });
  await pinInput.fill("CorrectPin9!");
  const unlockBtn = page.getByRole("button", { name: "Unlock" });
  await unlockBtn.click();
  await expect(page).toHaveURL(/\/app\/dashboard/);

  // Navigate to Import Hub
  await page.goto("/app/import");
  await expect(page.getByRole("heading", { level: 1, name: /Import Hub/i })).toBeVisible();

  // Navigate to Audit Trail
  await page.goto("/app/governance/audit");
  await expect(page.getByRole("heading", { level: 1, name: /Audit Trail/i })).toBeVisible();
  await expect(page.getByText(/HMAC SHA-256 Hash Chain/i)).toBeVisible();

  // Navigate to Backup & Restore
  await page.goto("/app/governance/backup");
  await expect(
    page.getByRole("heading", { level: 1, name: /Backup \u0026 Restore/i }),
  ).toBeVisible();
});
