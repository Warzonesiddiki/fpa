import { describe, expect, it } from "vitest";
import { tokens, tokenColor, type TokenColorName } from "./tokens";

describe("Design tokens — single source of truth (DESIGN-SYSTEM §6)", () => {
  it("defines the full color set for light+dark (F-038)", () => {
    const names = Object.keys(tokens.color) as TokenColorName[];
    for (const name of names) {
      expect(tokenColor(name, "light")).toMatch(/^#|^rgba/);
      expect(tokenColor(name, "dark")).toMatch(/^#|^rgba/);
    }
  });

  it("never has light === dark for semantic colors (readability in both themes)", () => {
    for (const name of Object.keys(tokens.color) as TokenColorName[]) {
      expect(tokens.color[name].light).not.toBe(tokens.color[name].dark);
    }
  });

  it("exposes the spacing/type/radius/density scales pinned in the spec", () => {
    expect(tokens.space[0]).toBe(0);
    expect(tokens.space[4]).toBe(16);
    expect(tokens.fontSize.md).toBe(14);
    expect(tokens.radius.lg).toBe(8);
    expect(tokens.density.compact).toBe(28);
  });
});
