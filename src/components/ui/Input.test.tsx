import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./Input";

describe("Input — labelled field contract (a11y §5, Q4)", () => {
  it("associates label via generated id", () => {
    render(<Input label="Company name" />);
    const input = screen.getByLabelText("Company name");
    expect(input).toHaveAttribute("id", "input-company-name");
    expect(input).toBeInTheDocument();
  });

  it("uses a caller-provided id", () => {
    render(<Input id="pin" label="PIN" />);
    expect(screen.getByLabelText("PIN")).toHaveAttribute("id", "pin");
  });

  it("renders hint in aria-describedby", () => {
    render(<Input label="PIN" hint="4–64 characters" />);
    const input = screen.getByLabelText("PIN");
    expect(input).toHaveAttribute("aria-describedby", "input-pin-desc");
    expect(screen.getByText("4–64 characters")).toBeInTheDocument();
  });

  it("marks invalid + replaces hint with error text (never color alone)", () => {
    render(<Input label="PIN" hint="hint" errorText="Too short" />);
    const input = screen.getByLabelText("PIN");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Too short")).toBeInTheDocument();
    expect(screen.queryByText("hint")).not.toBeInTheDocument();
  });

  it("renders leading adornment with aria-hidden wrapper", () => {
    render(<Input label="Amount" leading={<span>$</span>} />);
    expect(screen.getByText("$").parentElement).toHaveAttribute("aria-hidden", "true");
  });
});
