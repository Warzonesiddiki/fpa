import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./Card";

describe("Card — surface + header contract", () => {
  it("renders children without header when no title/actions", () => {
    render(
      <Card>
        <p>body</p>
      </Card>,
    );
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  it("renders title + actions header", () => {
    render(
      <Card title="Revenue" actions={<button>more</button>}>
        <p>x</p>
      </Card>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Revenue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "more" })).toBeInTheDocument();
  });

  it("spreads section attributes", () => {
    render(
      <Card data-testid="card" aria-label="KPI card">
        <p>x</p>
      </Card>,
    );
    expect(screen.getByTestId("card")).toHaveAttribute("aria-label", "KPI card");
  });
});
