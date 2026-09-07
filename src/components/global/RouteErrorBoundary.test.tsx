import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

/** Mirrors the production wiring exactly: data router + errorElement boundary. */
function renderCrashing(throwable: () => unknown, initialEntries = ["/app/broken"]) {
  function Broken(): React.ReactElement {
    throw throwable();
  }
  // createBrowserRouter reads the real window URL — set it before creating (jsdom).
  window.history.pushState({}, "", initialEntries[0]);
  const router = createBrowserRouter([
    {
      path: "/app",
      errorElement: <RouteErrorBoundary />,
      children: [
        { path: "broken", element: <Broken /> },
        { path: "dashboard", element: <div data-testid="dashboard" /> },
      ],
    },
  ]);
  return render(<RouterProvider router={router} />);
}

describe("RouteErrorBoundary — S-004 error state (recover/reload)", () => {
  it("renders INTERNAL for an unexpected render crash, with recover/reload/error-reference actions", () => {
    renderCrashing(() => new Error("boom"));
    const boundary = screen.getByTestId("route-error-boundary");
    expect(boundary).toHaveAttribute("data-screen-state", "error");
    expect(screen.getByText(/this screen failed to render/i)).toBeInTheDocument();
    expect(screen.getByText(/INTERNAL/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /error reference/i })).toHaveAttribute(
      "href",
      "/app/help/errors",
    );
  });

  it("keeps a typed BridgeError's code and catalog userMessage", () => {
    renderCrashing(() => ({
      code: "MODEL_CELL_LOCKED",
      userMessage: "Cell locked — create a version to edit.",
    }));
    expect(screen.getByText(/cell locked/i)).toBeInTheDocument();
    expect(screen.getByText(/MODEL_CELL_LOCKED/)).toBeInTheDocument();
  });

  it("Recovers to the Dashboard route", async () => {
    const user = userEvent.setup();
    renderCrashing(() => new Error("boom"));
    await user.click(screen.getByRole("button", { name: /recover to dashboard/i }));
    expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("route-error-boundary")).not.toBeInTheDocument();
  });

  it("Reload triggers a full page reload (window.location.reload)", async () => {
    const user = userEvent.setup();
    renderCrashing(() => new Error("boom"));
    // Stub after render: react-router's history captured the real location at
    // creation; the click handler reads window.location.reload at click time.
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
