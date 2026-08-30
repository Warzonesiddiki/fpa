import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StatePanel } from "./StatePanel";

describe("StatePanel — the five screen states (Q1)", () => {
  it.each([
    ["loading", "Loading…"],
    ["empty", "Nothing here yet"],
    ["error", "Something went wrong"],
    ["success", "Done"],
    ["populated", "Populated"],
  ] as const)("renders %s state with role=status + aria-live", (state, label) => {
    render(<StatePanel state={state} />);
    const panel = screen.getByRole("status");
    expect(panel).toHaveAttribute("aria-live", "polite");
    expect(panel).toHaveTextContent(label);
  });

  it("shows the message instead of the generic label", () => {
    render(<StatePanel state="empty" message="No companies yet" />);
    expect(screen.getByRole("status")).toHaveTextContent("No companies yet");
  });

  it("shows error code (B12) and a retry button", async () => {
    const onRetry = vi.fn();
    render(
      <StatePanel state="error" message="boom" errorCode="AUTH_PIN_INVALID" onRetry={onRetry} />,
    );
    expect(screen.getByText(/AUTH_PIN_INVALID/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("omits a retry button when no handler is provided", () => {
    render(<StatePanel state="error" message="no retry" />);
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("shows an empty-state action when label+handler are present", async () => {
    const onAction = vi.fn();
    render(
      <StatePanel state="empty" message="empty" actionLabel="Create company" onAction={onAction} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Create company" }));
    expect(onAction).toHaveBeenCalled();
  });

  it("omits the empty-state action when no handler is provided", () => {
    render(<StatePanel state="empty" message="no action" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders children for success/populated", () => {
    render(
      <StatePanel state="success" message="ok">
        <p>extra content</p>
      </StatePanel>,
    );
    expect(screen.getByText("extra content")).toBeInTheDocument();
    render(
      <StatePanel state="populated" message="list">
        <ul>
          <li>row</li>
        </ul>
      </StatePanel>,
    );
    expect(screen.getByText("row")).toBeInTheDocument();
  });
});
