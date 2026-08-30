import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompaniesPage } from "./index";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const { openMock } = vi.hoisted(() => ({ openMock: vi.fn() }));
vi.mock("@/stores/session", () => ({
  useSessionStore: (selector: (s: unknown) => unknown) =>
    selector({
      open: openMock,
      companyId: null,
      companyName: null,
      unlocked: true,
      status: "populated",
    }),
}));

const COMPANIES = [
  {
    id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    name: "Meridian Holdings (Demo)",
    type: "group",
    default_currency_code: "USD",
    base_locale: "en-IN",
    last_opened_at: "2026-08-30T00:00:00Z",
    company_file_path: "/Users/demo/Meridian.fpa",
    license_status: "active",
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/companies"]}>
      <Routes>
        <Route path="/app/companies" element={<CompaniesPage />} />
        <Route path="/app/dashboard" element={<div>dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("S-020 Company Manager — typed error surface (B12)", () => {
  beforeEach(() => {
    callMock.mockReset();
    openMock.mockReset();
  });

  it("shows a list-level error with retry when company.list fails", async () => {
    callMock.mockRejectedValue({
      code: "INTERNAL",
      userMessage: "A database error occurred.",
      httpStatus: 500,
      retryable: true,
      retryAfterMs: null,
      details: {},
    });
    renderPage();
    expect(await screen.findByText("A database error occurred.")).toBeInTheDocument();
    expect(screen.getByText("INTERNAL")).toBeInTheDocument();

    callMock.mockResolvedValue(COMPANIES);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Meridian Holdings (Demo)")).toBeInTheDocument();
  });

  it("shows the retention error inside the delete dialog (COMPANY_IN_USE_RECENT)", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "company.delete")
        return Promise.reject({
          code: "COMPANY_IN_USE_RECENT",
          userMessage:
            "This Company was used less than 30 days ago. Delete it or wait — recent Companies can't be deleted.",
          httpStatus: 409,
          retryable: false,
          retryAfterMs: null,
          details: {},
        });
      return Promise.resolve(COMPANIES);
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Meridian Holdings (Demo)");
    await user.click(screen.getByRole("button", { name: /Delete/ }));
    await user.type(screen.getByPlaceholderText(/Superseded by/), "cleanup");
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect(
      await screen.findByText(/This Company was used less than 30 days ago/),
    ).toBeInTheDocument();
    expect(screen.getByText("COMPANY_IN_USE_RECENT")).toBeInTheDocument();
    // The card stays in the list — deletion failed
    expect(screen.getByText("Meridian Holdings (Demo)")).toBeInTheDocument();
  });

  it("shows a card-level open error when company.open fails", async () => {
    callMock.mockResolvedValue(COMPANIES);
    openMock.mockResolvedValue(false);
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Meridian Holdings (Demo)");
    await user.click(screen.getAllByRole("button", { name: /Open/ })[0]);
    expect(await screen.findByText(/could not be verified/)).toBeInTheDocument();
  });
});
