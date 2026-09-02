import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MoneyCell } from "./MoneyCell";
import { createDefaultSettings, useSettingsStore } from "@/stores/settings";

describe("MoneyCell — exact display only (B3; UI never computes money)", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      preferences: {
        ...createDefaultSettings("en-US"),
        displayThousands: false,
        displayDecimals: "2",
      },
    });
  });
  it("renders grouped minor units with the ISO currency (exact scale=2)", () => {
    render(<MoneyCell minor={123456789} currency="USD" />);
    expect(screen.getByLabelText("USD 1,234,567.89")).toHaveTextContent("USD 1,234,567.89");
  });

  it("renders thousands mode with no decimals (display-only)", () => {
    render(<MoneyCell minor={123456789} currency="USD" showInThousands />);
    expect(screen.getByText("USD 1,235")).toBeInTheDocument();
  });

  it("renders zero-scale currencies exactly", () => {
    render(<MoneyCell minor={12345} currency="JPY" displayDecimals={0} />);
    expect(screen.getByText("JPY 12,345")).toBeInTheDocument();
  });

  it("renders the 5 cell states (Q1)", () => {
    const { rerender } = render(<MoneyCell currency="USD" state="loading" />);
    expect(screen.getByText("…")).toHaveAttribute("aria-label", "Loading");
    rerender(<MoneyCell currency="USD" state="empty" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    rerender(<MoneyCell currency="USD" state="error" />);
    expect(screen.getByText("!")).toBeInTheDocument();
    rerender(<MoneyCell currency="USD" state="success" />);
    expect(screen.getByText("✓")).toBeInTheDocument();
    rerender(<MoneyCell currency="USD" state="populated" />);
    expect(screen.getByText("—")).toBeInTheDocument(); // no amount → empty placeholder
    rerender(<MoneyCell currency="USD" state="populated" minor={0} />);
    expect(screen.getByText("USD 0.00")).toBeInTheDocument();
  });

  it("prefers decimal strings and falls back to an em dash when null", () => {
    render(<MoneyCell decimal="1234.5" currency="USD" />);
    expect(screen.getByText("USD 1,234.50")).toBeInTheDocument();
    const { rerender } = render(<></>);
    rerender(<MoneyCell currency="USD" minor={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("consumes S-075 locale, sign, 000s, and decimal defaults", () => {
    useSettingsStore.setState({
      preferences: {
        ...createDefaultSettings("de-DE"),
        locale: "de-DE",
        negativeStyle: "minus",
        displayThousands: true,
        displayDecimals: "1",
      },
    });
    render(<MoneyCell decimal="-1234567.89" currency="EUR" />);
    expect(screen.getByText("-EUR 1.234,6")).toBeInTheDocument();
  });

  it("lets a financial surface override persisted display defaults", () => {
    useSettingsStore.setState({
      preferences: {
        ...createDefaultSettings("de-DE"),
        locale: "de-DE",
        negativeStyle: "minus",
        displayThousands: true,
        displayDecimals: "0",
      },
    });
    render(
      <MoneyCell
        decimal="-1234567.89"
        currency="USD"
        locale="en-US"
        negativeStyle="paren"
        showInThousands={false}
        displayDecimals={2}
      />,
    );
    expect(screen.getByText("(USD 1,234,567.89)")).toBeInTheDocument();
  });
});
