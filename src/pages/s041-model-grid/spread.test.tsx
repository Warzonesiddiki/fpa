import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import Decimal from "decimal.js";
import { ModelGridPage } from "./index";
import { equalPercentCurve, percentToFraction } from "./spreadInputs";
import { useModelGridStore, WORKING_MODEL_ID } from "@/stores/model";
import { createDefaultSettings, useSettingsStore } from "@/stores/settings";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const { companyIdMock } = vi.hoisted(() => ({ companyIdMock: vi.fn() }));
vi.mock("@/stores/session", () => {
  const getState = () => ({ companyId: companyIdMock(), companyName: "Meridian" });
  const useSessionStore = ((selector: (s: unknown) => unknown) =>
    selector(getState())) as unknown as (typeof import("@/stores/session"))["useSessionStore"];
  Object.assign(useSessionStore, { getState });
  return { useSessionStore };
});

const CO = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";
const LINE = "3f9f2c9e-9f8b-4e2d-9a1c-400000000010";
const ACCOUNTS = [{ id: LINE, code: "4000", name: "Revenue" }];
const PERIOD_IDS = Array.from(
  { length: 12 },
  (_, i) => `fp-2026-p${String(i + 1).padStart(2, "0")}`,
);
const CALENDAR = {
  fiscal_years: [
    {
      fy_label: "FY2026",
      periods: PERIOD_IDS.map((_, i) => ({
        period_no: i + 1,
        code: `P${String(i + 1).padStart(2, "0")}`,
      })),
    },
  ],
};

function mockLoad() {
  callMock.mockImplementation((cmd: string) => {
    if (cmd === "coa.list") return Promise.resolve(ACCOUNTS);
    if (cmd === "calendar.preview") return Promise.resolve(CALENDAR);
    // The S-041 toolbar's ScenarioPicker reads the same model.list read side as S-050; answer a
    // valid (scenario-less) Model so the picker settles in its empty state instead of an error.
    if (cmd === "model.list")
      return Promise.resolve([
        {
          id: WORKING_MODEL_ID,
          company_id: CO,
          name: "Meridian Working Model",
          horizon: 1,
          pack_id: null,
          scenarios: [],
        },
      ]);
    if (cmd === "model.cell.set.v1")
      return Promise.resolve({
        recalc: { dirty_cells: 1, cycles: [], changed_cells: [LINE], issues: [], duration_ms: 0 },
        audit_id: 9016,
      });
    return Promise.resolve({});
  });
}

function renderPage() {
  return render(
    <main>
      <MemoryRouter initialEntries={["/app/model/grid"]}>
        <Routes>
          <Route path="/app/model/grid" element={<ModelGridPage />} />
        </Routes>
      </MemoryRouter>
    </main>,
  );
}

async function openSpreadDialog(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('[col-id="p-fp-2026-p01"]')).not.toBeNull(), {
    timeout: 8000,
  });
  await userEvent.click(container.querySelector('[col-id="p-fp-2026-p01"]') as HTMLElement);
  await userEvent.click(screen.getByRole("button", { name: "Spread total across periods" }));
  return screen.findByRole("dialog", { name: "Spread total across periods" });
}

/** Separate file (Vitest async-rejection quirk, playbook §4.6) — S-041 Spread dialog (M3-5 · US-016). */
describe("S-041 Spread dialog (M3-5 · F-015 · US-016)", () => {
  beforeEach(() => {
    callMock.mockReset();
    companyIdMock.mockReturnValue(CO);
    useModelGridStore.getState().reset();
    useSettingsStore.setState({
      preferences: {
        ...createDefaultSettings("en-US"),
        displayThousands: false,
        displayDecimals: "2",
      },
    });
  });

  it("US-016: ₹12M seasonal spread with a Q4-heavy curve writes 12 audited period values summing exactly", async () => {
    mockLoad();
    const { container } = renderPage();
    await openSpreadDialog(container);

    await userEvent.type(screen.getByLabelText(/^Total/), "12000000.00");
    await userEvent.click(screen.getByRole("radio", { name: "Seasonal" }));
    // Q4-heavy: 6,6,7,7,7,8,8,8,9,10,11,13 = 100
    const curve = ["6", "6", "7", "7", "7", "8", "8", "8", "9", "10", "11", "13"];
    for (const [i, pct] of curve.entries()) {
      const input = screen.getByLabelText(`Weight for P${String(i + 1).padStart(2, "0")} (%)`);
      await userEvent.clear(input);
      await userEvent.type(input, pct);
    }
    expect(screen.getByText("Σ 100%")).toBeInTheDocument();
    callMock.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Spread" }));

    expect(await screen.findByTestId("spread-done", {}, { timeout: 8000 })).toHaveTextContent(
      "Spread 12 periods (Seasonal) — Σ 12000000.00 USD exactly.",
    );
    const writes = callMock.mock.calls.filter((c) => c[0] === "model.cell.set.v1");
    expect(writes).toHaveLength(12);
    expect(writes[11][1]).toMatchObject({
      period_id: "fp-2026-p12",
      value: "1560000.00",
      formula: null,
    });
    const s = useModelGridStore.getState();
    expect(s.cells[`${LINE}:fp-2026-p01`].amount_text).toBe("720000.00");
    expect(s.canUndo).toBe(true);
    expect(s.spreadError).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  }, 30000);

  it("HARD SPREAD_WEIGHTS_INVALID shows the documented text inline with Normalize / Fix; Normalize is an explicit choice", async () => {
    mockLoad();
    const { container } = renderPage();
    await openSpreadDialog(container);
    await userEvent.type(screen.getByLabelText(/^Total/), "1000.00");
    await userEvent.click(screen.getByRole("radio", { name: "Seasonal" }));
    // Bump P12 from 8.3337 to 10.3337 → Σ 102%
    const p12 = screen.getByLabelText("Weight for P12 (%)");
    await userEvent.clear(p12);
    await userEvent.type(p12, "10.3337");
    callMock.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Spread" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Seasonality weights total 102% — normalize to 100% or fix.");
    expect(alert).toHaveTextContent("SPREAD_WEIGHTS_INVALID");
    // Nothing was written — never silently normalised.
    expect(callMock.mock.calls.filter((c) => c[0] === "model.cell.set.v1")).toHaveLength(0);
    // The page itself is not in the error state; the grid stays usable.
    expect(useModelGridStore.getState().status).toBe("success");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

    // "Fix" clears the alert and keeps the form.
    await userEvent.click(screen.getByRole("button", { name: "Fix weights" }));
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Spread" }));
    await screen.findByRole("alert");

    // "Normalize" is the explicit, recorded choice.
    await userEvent.click(screen.getByRole("button", { name: "Normalize to 100%" }));
    expect(await screen.findByTestId("spread-done", {}, { timeout: 8000 })).toHaveTextContent(
      "Weights were normalized at your request (recorded).",
    );
    expect(callMock.mock.calls.filter((c) => c[0] === "model.cell.set.v1")).toHaveLength(12);
    const s = useModelGridStore.getState();
    const sum = PERIOD_IDS.reduce(
      (acc, id) => acc.plus(s.cells[`${LINE}:${id}`].amount_text ?? "0"),
      new Decimal(0),
    );
    expect(sum.toString()).toBe("1000"); // exact
  }, 30000);

  it("lump method: amounts in chosen periods, rest 0; mismatch has no Normalize offer", async () => {
    mockLoad();
    const { container } = renderPage();
    await openSpreadDialog(container);
    await userEvent.type(screen.getByLabelText(/^Total/), "5000.00");
    await userEvent.click(screen.getByRole("radio", { name: "Lumps" }));
    await userEvent.type(screen.getByLabelText("Lump for P03"), "2000.00");
    await userEvent.click(screen.getByRole("button", { name: "Spread" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Seasonality weights total 40% — normalize to 100% or fix.");
    expect(screen.queryByRole("button", { name: "Normalize to 100%" })).toBeNull();
    expect(screen.getByRole("button", { name: "Fix weights" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Lump for P09"), "3000.00");
    await userEvent.click(screen.getByRole("button", { name: "Spread" }));
    expect(await screen.findByTestId("spread-done", {}, { timeout: 8000 })).toHaveTextContent(
      "Spread 12 periods (Lumps) — Σ 5000.00 USD exactly.",
    );
    const s = useModelGridStore.getState();
    expect(s.cells[`${LINE}:fp-2026-p03`].amount_text).toBe("2000.00");
    expect(s.cells[`${LINE}:fp-2026-p09`].amount_text).toBe("3000.00");
    expect(s.cells[`${LINE}:fp-2026-p01`].amount_text).toBe("0.00");
  }, 30000);

  it("custom method: the per-period sum is shown live; the Spread button stays disabled without a valid total", async () => {
    mockLoad();
    const { container } = renderPage();
    await openSpreadDialog(container);
    expect(screen.getByRole("button", { name: "Spread" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Custom" }));
    await userEvent.type(screen.getByLabelText("Value for P01"), "10.5");
    await userEvent.type(screen.getByLabelText("Value for P02"), "abc"); // ignored in the live sum
    expect(screen.getByText("Σ 10.5 USD")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Total/), "1e3");
    expect(screen.getByRole("button", { name: "Spread" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  }, 30000);

  it("is axe-clean with the dialog open", async () => {
    mockLoad();
    const { container } = renderPage();
    await openSpreadDialog(container);
    await userEvent.click(screen.getByRole("radio", { name: "Seasonal" }));
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  }, 30000);
});

describe("spread input helpers", () => {
  it("percentToFraction is exact and passes garbage through for the engine to reject", () => {
    expect(percentToFraction("8.5")).toBe("0.085");
    expect(percentToFraction(" 100 ")).toBe("1");
    expect(percentToFraction("")).toBe("0");
    expect(percentToFraction("0.1")).toBe("0.001");
    expect(percentToFraction("x")).toBe("x");
  });

  it("equalPercentCurve sums to exactly 100 with the residual on the last period", () => {
    expect(equalPercentCurve(0)).toEqual([]);
    expect(equalPercentCurve(4)).toEqual(["25", "25", "25", "25"]);
    const twelve = equalPercentCurve(12);
    expect(twelve.slice(0, 11).every((p) => p === "8.3333")).toBe(true);
    expect(twelve[11]).toBe("8.3337");
    const thirteen = equalPercentCurve(13);
    expect(thirteen[12]).toBe("7.6924"); // 100 − 12 × 7.6923
    expect(thirteen.reduce((acc, p) => acc.plus(p), new Decimal(0)).toString()).toBe("100");
  });
});
