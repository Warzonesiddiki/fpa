import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { MemoryRouter } from "react-router-dom";
import { SheetsManagerPage } from "./index";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/model/sheets"]}>
      <SheetsManagerPage />
    </MemoryRouter>,
  );
}

describe("S-040 Sheets / Multi-Tab Grid Manager (F-012)", () => {
  it("renders populated state with sheets list, tab bar, freeze config and is axe-clean", async () => {
    const { container } = renderPage();

    expect(screen.getByRole("heading", { level: 1, name: /Sheets/i })).toBeInTheDocument();
    expect(screen.getByText("Workbook Sheets (5)")).toBeInTheDocument();

    const sheetsTable = screen.getByRole("table", { name: "Workbook sheets list" });
    expect(within(sheetsTable).getByText("Revenue")).toBeInTheDocument();
    expect(within(sheetsTable).getByText("COGS")).toBeInTheDocument();
    expect(within(sheetsTable).getByText("Opex")).toBeInTheDocument();
    expect(within(sheetsTable).getByText("Capex")).toBeInTheDocument();
    expect(within(sheetsTable).getByText("Cash Flow")).toBeInTheDocument();

    // Verify Freeze Panes section
    expect(
      screen.getByRole("heading", { name: /Freeze Panes Configuration/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Freeze Header \/ Top Row/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Freeze First \/ Line Name Column/i)).toBeInTheDocument();

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  describe("Sheet reordering", () => {
    it("moves sheet left and right updating order", async () => {
      const user = userEvent.setup();
      renderPage();

      // COGS is currently 2nd. Move it left (becomes 1st).
      const moveCogsLeft = screen.getByRole("button", { name: "Move sheet COGS left" });
      await user.click(moveCogsLeft);

      expect(screen.getByRole("status")).toHaveTextContent('Moved sheet "COGS" left.');

      // Check order: COGS now has order 1, Revenue has order 2
      const moveCogsRight = screen.getByRole("button", { name: "Move sheet COGS right" });
      await user.click(moveCogsRight);

      expect(screen.getByRole("status")).toHaveTextContent('Moved sheet "COGS" right.');
    });
  });
  describe("Sheet rename with validation", () => {
    it("validates sheet names with duplicate detection and invalid characters via UI", async () => {
      const user = userEvent.setup();
      renderPage();

      const renameBtn = screen.getByRole("button", { name: "Rename sheet Revenue" });
      await user.click(renameBtn);

      const input = screen.getByLabelText("Edit name for sheet Revenue");
      const saveBtn = screen.getByRole("button", { name: "Save sheet name" });

      // Empty name
      await user.clear(input);
      await user.click(saveBtn);
      expect(screen.getByRole("alert")).toHaveTextContent("Sheet name cannot be empty.");

      // Invalid characters
      await user.type(input, "Rev/Sheet");
      await user.click(saveBtn);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Sheet name cannot contain any of the following characters",
      );

      // Apostrophe at edge
      await user.clear(input);
      await user.type(input, "'Revenue");
      await user.click(saveBtn);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Sheet name cannot begin or end with an apostrophe",
      );
    });

    it("renames a sheet successfully and displays updated name", async () => {
      const user = userEvent.setup();
      renderPage();

      // Click rename on Revenue
      const renameBtn = screen.getByRole("button", { name: "Rename sheet Revenue" });
      await user.click(renameBtn);

      const input = screen.getByLabelText("Edit name for sheet Revenue");
      await user.clear(input);
      await user.type(input, "Total Revenue");

      const saveBtn = screen.getByRole("button", { name: "Save sheet name" });
      await user.click(saveBtn);

      expect(screen.getByRole("status")).toHaveTextContent('Sheet renamed to "Total Revenue".');
      const sheetsTable = screen.getByRole("table", { name: "Workbook sheets list" });
      expect(within(sheetsTable).getByText("Total Revenue")).toBeInTheDocument();
    });

    it("blocks rename with duplicate name error", async () => {
      const user = userEvent.setup();
      renderPage();

      const renameBtn = screen.getByRole("button", { name: "Rename sheet Revenue" });
      await user.click(renameBtn);

      const input = screen.getByLabelText("Edit name for sheet Revenue");
      await user.clear(input);
      await user.type(input, "COGS");

      const saveBtn = screen.getByRole("button", { name: "Save sheet name" });
      await user.click(saveBtn);

      expect(screen.getByRole("alert")).toHaveTextContent('A sheet named "COGS" already exists.');
    });
  });

  describe("Freeze panes configuration", () => {
    it("updates row and column freeze settings and toggles", async () => {
      const user = userEvent.setup();
      renderPage();

      const sheetsTable = screen.getByRole("table", { name: "Workbook sheets list" });
      await user.click(within(sheetsTable).getByRole("button", { name: "Revenue" }));

      // Check freeze row count input
      const rowsInput = screen.getByLabelText("Frozen Rows Count");
      await user.clear(rowsInput);
      await user.type(rowsInput, "3");

      expect(screen.getByRole("status")).toHaveTextContent('Freeze panes updated for "Revenue".');

      // Check freeze cols count input
      const colsInput = screen.getByLabelText("Frozen Cols Count");
      await user.clear(colsInput);
      await user.type(colsInput, "2");

      expect(within(sheetsTable).getByText("R3:C2")).toBeInTheDocument();

      // Unfreeze all
      await user.click(screen.getByRole("button", { name: "Unfreeze All Panes" }));
      expect(screen.getByLabelText("Frozen Rows Count")).toHaveValue(0);
      expect(screen.getByLabelText("Frozen Cols Count")).toHaveValue(0);
    });
  });

  describe("Sheet duplication", () => {
    it("duplicates sheet with (Copy) appended to name", async () => {
      const user = userEvent.setup();
      renderPage();

      const dupBtn = screen.getByRole("button", { name: "Duplicate sheet Revenue" });
      await user.click(dupBtn);

      expect(screen.getByRole("status")).toHaveTextContent(
        'Duplicated "Revenue" as "Revenue (Copy)".',
      );
      const sheetsTable = screen.getByRole("table", { name: "Workbook sheets list" });
      expect(within(sheetsTable).getByText("Revenue (Copy)")).toBeInTheDocument();
      expect(screen.getByText("Workbook Sheets (6)")).toBeInTheDocument();
    });
  });

  describe("Add new sheet and delete sheet", () => {
    it("adds a new sheet successfully", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole("button", { name: "Add Sheet" }));
      const form = screen.getByRole("form", { name: "Add new sheet form" });

      const nameInput = within(form).getByLabelText("Sheet Name");
      await user.type(nameInput, "Headcount Model");

      await user.click(within(form).getByRole("button", { name: "Save Sheet" }));

      expect(screen.getByRole("status")).toHaveTextContent('Sheet "Headcount Model" created.');
      const sheetsTable = screen.getByRole("table", { name: "Workbook sheets list" });
      expect(within(sheetsTable).getByText("Headcount Model")).toBeInTheDocument();
      expect(screen.getByText("Workbook Sheets (6)")).toBeInTheDocument();
    });

    it("prompts confirmation before deleting a sheet and removes it", async () => {
      const user = userEvent.setup();
      renderPage();

      const deleteBtn = screen.getByRole("button", { name: "Delete sheet Cash Flow" });
      await user.click(deleteBtn);

      // Confirm dialog appears
      const dialog = screen.getByRole("dialog", { name: "Delete Sheet?" });
      expect(dialog).toBeInTheDocument();
      expect(
        within(dialog).getByText(/Are you sure you want to delete sheet/i),
      ).toBeInTheDocument();

      const confirmBtn = within(dialog).getByRole("button", { name: "Delete Sheet" });
      await user.click(confirmBtn);

      expect(screen.getByRole("status")).toHaveTextContent('Sheet "Cash Flow" deleted.');
      const sheetsTable = screen.getByRole("table", { name: "Workbook sheets list" });
      expect(within(sheetsTable).queryByText("Cash Flow")).not.toBeInTheDocument();
      expect(screen.getByText("Workbook Sheets (4)")).toBeInTheDocument();
    });
  });

  describe("Canonical 5 states", () => {
    it("switches between loading, empty, error, success, and populated states cleanly", async () => {
      const user = userEvent.setup();
      const { container } = renderPage();

      // 1. Loading state
      await user.click(screen.getByRole("button", { name: "Loading" }));
      expect(screen.getByRole("status")).toBeInTheDocument();
      let res = await axe(container);
      expect(res.violations).toEqual([]);

      // 2. Empty state
      await user.click(screen.getByRole("button", { name: "Empty" }));
      expect(screen.getByText("Workbook contains only 1 default empty sheet.")).toBeInTheDocument();
      const sheetsTable = screen.getByRole("table", { name: "Workbook sheets list" });
      expect(within(sheetsTable).getByText("Sheet1")).toBeInTheDocument();
      res = await axe(container);
      expect(res.violations).toEqual([]);

      // 3. Error state
      await user.click(screen.getByRole("button", { name: "Error" }));
      expect(
        screen.getByText("Failed to synchronize workbook sheets from model database."),
      ).toBeInTheDocument();
      expect(screen.getByText(/MODEL_SHEET_LOAD_FAILED/)).toBeInTheDocument();
      res = await axe(container);
      expect(res.violations).toEqual([]);

      // 4. Success state
      await user.click(screen.getByRole("button", { name: "Success" }));
      expect(
        screen.getByText("All sheet tabs, reordering, and freeze panes committed."),
      ).toBeInTheDocument();
      res = await axe(container);
      expect(res.violations).toEqual([]);

      // 5. Populated state
      await user.click(screen.getByRole("button", { name: "Populated" }));
      expect(screen.getByText("Workbook Sheets (5)")).toBeInTheDocument();
      res = await axe(container);
      expect(res.violations).toEqual([]);
    });
  });
});
