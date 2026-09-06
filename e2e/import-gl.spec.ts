import { expect, test } from "@playwright/test";

/**
 * M7-5 / UF-002: GL Import Journey
 * Flow:
 * 1. Unlock with PIN (S-001)
 * 2. Navigate to S-030 Import Hub
 * 3. Open GL dump import flow & select file / parse
 * 4. Map columns in S-031 Mapping Wizard
 * 5. Review Tie-Out in S-032
 * 6. Commit batch
 */
test.describe("GL Dump Import Journey (UF-002)", () => {
  test("Navigate to Import Hub -> Open GL dump import -> Map columns -> Review Tie-Out -> Commit batch", async ({
    page,
  }) => {
    // Step 1: Unlock session to open company
    await page.goto("/");
    const pinInput = page.getByRole("textbox", { name: "PIN" });
    await pinInput.fill("CorrectPin9!");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);

    // Step 2: Navigate to Import Hub (S-030)
    await page.goto("/app/import");
    await expect(page.getByRole("heading", { name: "Import Hub" })).toBeVisible();

    // Step 3: Ensure GL Dump tab is selected and choose/parse a GL file
    const glTab = page.getByRole("tab", { name: "GL Dump" });
    await expect(glTab).toBeVisible();
    await glTab.click();

    // In web preview mode, an hidden file input is rendered for browser testing
    const fileChooserInput = page.locator('input[type="file"]');
    await fileChooserInput.setInputFiles({
      name: "sample_gl_dump.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "period,account_code,debit,credit,posting_ref\n2026-08,4000,1000.00,1000.00,REF123",
      ),
    });

    // File selected -> click Parse button
    const parseBtn = page.getByRole("button", { name: "Parse" });
    await expect(parseBtn).toBeEnabled();
    await parseBtn.click();

    // Verify summary is parsed successfully
    await expect(page.getByText("File parsed successfully")).toBeVisible();
    const continueBtn = page.getByRole("button", { name: "Continue to Mapping" });
    await expect(continueBtn).toBeVisible();
    await continueBtn.click();

    // Step 4: Map columns in S-031 Mapping Wizard
    await expect(page).toHaveURL(/\/app\/import\/map/);
    await expect(page.getByRole("heading", { name: "Mapping Wizard" })).toBeVisible();

    // Use canonical mapping template or save a template
    const useCanonicalBtn = page.getByRole("button", { name: "Use OneFP&A Canonical GL" });
    if (await useCanonicalBtn.isVisible()) {
      await useCanonicalBtn.click();
    } else {
      const templateNameInput = page.locator("#mapping-template-name");
      await templateNameInput.fill("E2E GL Mapping");
      await page.getByRole("button", { name: "Save versioned mapping" }).click();
    }

    // Validation panel displays outcomes
    const continueValidationBtn = page.getByRole("button", { name: "Continue to Validation" });
    if (await continueValidationBtn.isVisible()) {
      await continueValidationBtn.click();
    }

    // Continue to Tie-Out (S-032)
    const tieOutBtn = page.getByRole("button", { name: "Continue to Tie-Out" });
    await expect(tieOutBtn).toBeEnabled();
    await tieOutBtn.click();

    // Step 5: Review Tie-Out in S-032 Import Commit
    await expect(page).toHaveURL(/\/app\/import\/commit/);
    await expect(page.getByRole("heading", { name: "Tie-Out & Commit Batch" })).toBeVisible();
    await expect(page.getByText("Balanced")).toBeVisible();

    // Step 6: Commit batch
    const batchNameInput = page.locator("#import-batch-name");
    await expect(batchNameInput).toBeVisible();

    const commitBtn = page.getByRole("button", { name: "Commit Batch" });
    await expect(commitBtn).toBeEnabled();
    await commitBtn.click();

    // Verify commit success
    await expect(page.getByText("Batch committed successfully")).toBeVisible();
    await expect(page.getByRole("link", { name: "View in Import History" })).toBeVisible();
  });
});
