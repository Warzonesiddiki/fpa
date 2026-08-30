import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button — variants/sizes/a11y contract (DESIGN-SYSTEM §4)", () => {
  it("renders primary md by default and fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Create</Button>);
    const btn = screen.getByRole("button", { name: "Create" });
    expect(btn).toHaveClass("h-10");
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies secondary/ghost/danger + sm/lg sizes and disabled", () => {
    const { rerender } = render(
      <Button variant="danger" size="lg">
        Delete
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("h-12");
    rerender(
      <Button variant="secondary" size="sm">
        Back
      </Button>,
    );
    const back = screen.getByRole("button", { name: "Back" });
    expect(back).toHaveClass("h-8");
    rerender(<Button disabled>Locked</Button>);
    expect(screen.getByRole("button", { name: "Locked" })).toBeDisabled();
    rerender(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByRole("button", { name: "Ghost" })).toBeEnabled();
  });

  it("renders children content (no aria-hidden text loss)", () => {
    render(
      <Button>
        <span>Save</span> now
      </Button>,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Save now");
  });
});
