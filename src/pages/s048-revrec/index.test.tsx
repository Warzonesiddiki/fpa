import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { RevRecPage } from "./index";

describe("S-048 Revenue Recognition Page (F-019)", () => {
  it("renders populated state with metrics, schedules and is axe-clean", async () => {
    const { container } = render(<RevRecPage />);

    expect(screen.getByText("Revenue Recognition")).toBeInTheDocument();
    expect(screen.getByText("SAAS-2026-001")).toBeInTheDocument();
    expect(screen.getByText("Apex Financial Systems")).toBeInTheDocument();

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it("toggles empty state when clear data is clicked", () => {
    render(<RevRecPage />);

    const clearBtn = screen.getByRole("button", { name: /Clear Data/i });
    fireEvent.click(clearBtn);

    expect(screen.getByText("No bookings")).toBeInTheDocument();

    const addBtn = screen.getByRole("button", { name: /Add Contract Booking/i });
    fireEvent.click(addBtn);

    expect(screen.getByText("SAAS-2026-001")).toBeInTheDocument();
  });
});
