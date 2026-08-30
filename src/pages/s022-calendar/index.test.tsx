import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarPage } from "./index";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const { companyIdMock } = vi.hoisted(() => ({ companyIdMock: vi.fn() }));
vi.mock("@/stores/session", () => ({
  useSessionStore: (selector: (s: unknown) => unknown) =>
    selector({ companyId: companyIdMock(), companyName: "Meridian Holdings" }),
}));

const CO = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

const PREVIEW = {
  fiscal_years: [
    {
      fy_label: "FY2026",
      start_date: "2026-04-01",
      end_date: "2027-03-31",
      week_count: 52,
      periods: [
        {
          period_no: 1,
          code: "P01",
          start_date: "2026-04-01",
          end_date: "2026-04-30",
          is_53rd_week: false,
        },
        {
          period_no: 12,
          code: "P12",
          start_date: "2027-03-01",
          end_date: "2027-03-31",
          is_53rd_week: false,
        },
      ],
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/model/calendar"]}>
      <Routes>
        <Route path="/app/model/calendar" element={<CalendarPage />} />
        <Route path="/app/model/coa" element={<div>coa</div>} />
        <Route path="/app/model/packs" element={<div>packs</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("S-022 Fiscal Calendar (F-003)", () => {
  beforeEach(() => {
    callMock.mockReset();
    companyIdMock.mockReturnValue(CO);
  });

  it("renders a live preview and applies the calendar", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "calendar.preview") return Promise.resolve(PREVIEW);
      if (cmd === "calendar.apply") return Promise.resolve({ applied: true });
      return Promise.reject({ code: "INTERNAL", userMessage: "unexpected" });
    });
    renderPage();
    // 300ms debounce before the preview crosses the bridge
    expect(await screen.findByText("P01")).toBeInTheDocument();
    expect(screen.getByText("FY2026")).toBeInTheDocument();
    expect(screen.getByText(/52 weeks/)).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith(
      "calendar.preview",
      expect.objectContaining({ preset: "12month", year_count: 3 }),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Apply to Company" }));
    expect(await screen.findByText("Calendar applied to Meridian Holdings")).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith(
      "calendar.apply",
      expect.objectContaining({
        company_id: CO,
        config: [expect.objectContaining({ preset: "12month", year_end_rule: null })],
        bu_map: [],
      }),
    );
  });

  it("scopes the NRF rule to 4-5-4 and hides a stale applied banner on change", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "calendar.preview") return Promise.resolve(PREVIEW);
      if (cmd === "calendar.apply") return Promise.resolve({ applied: true });
      return Promise.reject({ code: "INTERNAL", userMessage: "unexpected" });
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("P01");
    await user.click(screen.getByRole("button", { name: "Apply to Company" }));
    expect(await screen.findByText("Calendar applied to Meridian Holdings")).toBeInTheDocument();

    // Switching preset away from 12month resets the year-end rule default (454 → nrf_4_day)
    await user.click(screen.getByLabelText("4-5-4 (NRF)"));
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith(
        "calendar.preview",
        expect.objectContaining({ preset: "454", year_end_rule: "nrf_4_day" }),
      ),
    );
    // The applied banner refers to the old config → hidden
    expect(screen.queryByText("Calendar applied to Meridian Holdings")).not.toBeInTheDocument();
  });

  it("shows a typed preview error with retry (CAL_53WEEK_CONFLICT)", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "calendar.preview")
        return Promise.reject({
          code: "CAL_53WEEK_CONFLICT",
          userMessage:
            "The 53rd week rule conflicts with your FY start. Choose NRF (4+ days) or full-week rule.",
          httpStatus: 422,
          retryable: false,
          retryAfterMs: null,
          details: {},
        });
      return Promise.reject({ code: "INTERNAL", userMessage: "unexpected" });
    });
    renderPage();
    const user = userEvent.setup();
    expect(
      await screen.findByText(
        "The 53rd week rule conflicts with your FY start. Choose NRF (4+ days) or full-week rule.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("CAL_53WEEK_CONFLICT")).toBeInTheDocument();
    // Apply stays disabled while the preview is in error
    expect(screen.getByRole("button", { name: "Apply to Company" })).toBeDisabled();

    callMock.mockImplementation((cmd: string) =>
      cmd === "calendar.preview" ? Promise.resolve(PREVIEW) : Promise.resolve({ applied: true }),
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("P01")).toBeInTheDocument();
  });

  it("shows the apply error inline when the backend rejects", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "calendar.preview") return Promise.resolve(PREVIEW);
      if (cmd === "calendar.apply")
        return Promise.reject({
          code: "CAL_TRANSIT_AMBIGUOUS",
          userMessage: "BU period spans two Group periods. Map both date ranges to proceed.",
          httpStatus: 422,
          retryable: false,
          retryAfterMs: null,
          details: {},
        });
      return Promise.reject({ code: "INTERNAL", userMessage: "unexpected" });
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("P01");
    await user.click(screen.getByRole("button", { name: "Apply to Company" }));
    expect(
      await screen.findByText(
        "BU period spans two Group periods. Map both date ranges to proceed.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the no-company empty state outside a session", () => {
    companyIdMock.mockReturnValue(null);
    renderPage();
    expect(screen.getByText(/Open a Company to configure its fiscal calendar/)).toBeInTheDocument();
    expect(callMock).not.toHaveBeenCalled();
  });
});
