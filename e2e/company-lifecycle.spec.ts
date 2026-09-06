import { expect, test } from "@playwright/test";

/**
 * M7-5 / UF-001: Company Lifecycle Journey
 * Flow:
 * 1. Unlock with PIN (S-001)
 * 2. Open First-Run Wizard (S-002)
 * 3. Create company with Industry Pack
 * 4. Open Company
 * 5. Land on S-010 Dashboard
 */
test.describe("Company Lifecycle Journey (UF-001)", () => {
  test("Unlock with PIN -> Open First-Run Wizard -> Create company with Industry Pack -> Open Company -> Land on S-010 Dashboard", async ({
    page,
  }) => {
    // Step 1: Unlock with PIN on S-001
    await page.goto("/");
    await expect(page.getByText("Enter your PIN to open your Company")).toBeVisible();

    const pinInput = page.getByRole("textbox", { name: "PIN" });
    await pinInput.fill("CorrectPin9!");
    const unlockBtn = page.getByRole("button", { name: "Unlock" });
    await expect(unlockBtn).toBeEnabled();
    await unlockBtn.click();
    await expect(page).toHaveURL(/\/app\/dashboard/);

    // Step 2: Open First-Run Wizard via Companies page or direct navigation
    await page.goto("/app/companies");
    await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
    await page.getByRole("button", { name: "New Company" }).click();

    await expect(page).toHaveURL(/\/wizard/);
    await expect(page.getByRole("heading", { name: "Company" })).toBeVisible();

    // Step 3: Walk Wizard with Industry Pack
    // Step 3.1: Company Name
    const uniqueName = `Solaris Dynamics ${Date.now()}`;
    await page.getByLabel("Company name").fill(uniqueName);
    await page.getByRole("button", { name: "Next" }).click();

    // Step 3.2: Industry Pack (select Manufacturing)
    await expect(page.getByRole("heading", { name: "Industry Pack" })).toBeVisible();
    await expect(page.getByText("Manufacturing")).toBeVisible();
    await page.getByLabel("Manufacturing").check();
    await page.getByRole("button", { name: "Next" }).click();

    // Step 3.3: Fiscal Calendar
    await expect(page.getByRole("heading", { name: "Fiscal Calendar" })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    // Step 3.4: Chart of Accounts
    await expect(page.getByRole("heading", { name: "Chart of Accounts" })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    // Step 3.5: Model structure & Create Company
    await expect(page.getByRole("heading", { name: "Model" })).toBeVisible();
    const createBtn = page.getByRole("button", { name: "Create Company" });
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Step 4 & 5: Open Company & land on S-010 Dashboard
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Plan-Only Model")).toBeVisible();
  });
});
