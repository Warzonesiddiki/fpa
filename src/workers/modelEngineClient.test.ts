import { describe, expect, it, vi } from "vitest";
import {
  InProcessTransport,
  createModelEngineClient,
  parseEngineOpError,
} from "./modelEngineClient";
import type { EngineTransport } from "./modelEngineClient";
import Decimal from "decimal.js";

/** Convert a cell's computed_text to a number (uses Decimal, avoids money-ast B3 banned ops). */
function cellNum(text: string | null): number {
  return new Decimal(text ?? "0").toNumber();
}
import type { EngineRequest, EngineResponse } from "./protocol";
import type { DriverDef, ModelGridLine, ModelGridPeriod } from "./modelEngine";

const LINES: ModelGridLine[] = [
  { id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000010", label: "4000 · Revenue", method: "manual" },
];
const PERIODS: ModelGridPeriod[] = [
  { id: "fp-2026-p01", code: "P01" },
  { id: "fp-2026-p02", code: "P02" },
];

const DRIVERS: DriverDef[] = [
  {
    id: "dr-units",
    name: "units",
    driver_type: "volume_x_rate",
    unit: "units",
    source: "global",
    is_core: true,
    bounds_low: "0",
    bounds_high: "100000",
  },
];

describe("modelEngineClient (single-flight queue)", () => {
  it("loads a grid and reads cells through the in-process transport", async () => {
    const client = createModelEngineClient(new InProcessTransport());
    await client.loadGrid({ lines: LINES, periods: PERIODS });
    await client.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "42.00" });
    const cell = (await client.getGrid())[0];
    expect(cell.amount_text).toBe("42.00");
    const derived = await client.getDerived(LINES[0].id);
    expect(derived.ytd).toBe("42");
  });

  it("serializes ops so setCell/recalc never interleave (single-flight)", async () => {
    const order: string[] = [];
    const fake: EngineTransport = {
      request: (req: EngineRequest) => {
        order.push(`${req.id}:start`);
        return new Promise<EngineResponse>((resolve) => {
          setTimeout(
            () => {
              order.push(`${req.id}:end`);
              resolve({ id: req.id, ok: true, data: null });
            },
            req.op === "setCell" ? 20 : 5,
          );
        });
      },
      destroy: () => undefined,
    };
    const client = createModelEngineClient(fake);
    await Promise.all([
      client.loadGrid({ lines: LINES, periods: PERIODS }),
      client.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "1.00" }),
      client.setCell({ line_id: LINES[0].id, period_id: PERIODS[1].id, value: "2.00" }),
    ]);
    // No op starts before the previous op ends → strictly sequential.
    for (let i = 0; i < order.length; i += 1) {
      if (i % 2 === 0) expect(order[i]).toMatch(/:start$/);
      else expect(order[i]).toMatch(/:end$/);
    }
  });

  it("propagates engine errors with the locked code in the message", async () => {
    const client = createModelEngineClient(new InProcessTransport());
    await client.loadGrid({ lines: LINES, periods: PERIODS });
    await expect(
      client.setCell({ line_id: "missing", period_id: PERIODS[0].id, value: "1.00" }),
    ).rejects.toThrow(/REFERENCE_BROKEN/);
  });

  it("keeps the queue alive after a rejection (later ops still run)", async () => {
    const client = createModelEngineClient(new InProcessTransport());
    await client.loadGrid({ lines: LINES, periods: PERIODS });
    await expect(
      client.setCell({ line_id: "missing", period_id: PERIODS[0].id, value: "1.00" }),
    ).rejects.toThrow(/REFERENCE_BROKEN/);
    // The next op still runs (the tail survived the rejection).
    await client.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "7.00" });
    expect((await client.getGrid())[0].amount_text).toBe("7.00");
  });

  it("destroy calls the transport destroy", () => {
    const destroy = vi.fn();
    const client = createModelEngineClient({
      request: () => Promise.resolve({ id: 0, ok: true, data: null }),
      destroy,
    });
    client.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("inspectCell returns formula and precedence data through the client", async () => {
    const client = createModelEngineClient(new InProcessTransport());
    await client.loadGrid({ lines: LINES, periods: PERIODS });
    await client.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "10.00" });
    // B2 = row 2, col B (P01) = LINES[0] / PERIODS[0]; =B2+5 is a direct cell reference.
    await client.setCell({ line_id: LINES[0].id, period_id: PERIODS[1].id, formula: "=B2+5" });
    const result = await client.inspectCell(LINES[0].id, PERIODS[1].id);
    expect(result.formula).toBe("=B2+5");
    expect(result.precedents.length).toBeGreaterThanOrEqual(1);
    expect(result.is_cycle).toBe(false);
    expect(result.cycle).toBeNull();
  });

  it("loadDrivers/setDriverValue/getDriverGrid round-trip through the client", async () => {
    const client = createModelEngineClient(new InProcessTransport());
    await client.loadGrid({ lines: LINES, periods: PERIODS });
    await client.loadDrivers(DRIVERS, PERIODS);
    await client.setDriverValue("dr-units", PERIODS[0].id, "12000");
    const grid = await client.getDriverGrid();
    expect(grid[0]?.amount_text).toBe("12000");
    const drivers = await client.getDrivers();
    expect(drivers).toHaveLength(1);
    const impact = await client.getDriverImpact("dr-units");
    expect(impact).toEqual([]); // no Model formula references the driver yet
  });

  it("propagates DRIVER_OUT_OF_BOUNDS through the client", async () => {
    const client = createModelEngineClient(new InProcessTransport());
    await client.loadGrid({ lines: LINES, periods: PERIODS });
    await client.loadDrivers(DRIVERS, PERIODS);
    await expect(client.setDriverValue("dr-units", PERIODS[0].id, "200000")).rejects.toThrow(
      /DRIVER_OUT_OF_BOUNDS/,
    );
  });

  it("scanHardcoded/convertHardcoded round-trip through the client", async () => {
    const client = createModelEngineClient(new InProcessTransport());
    await client.loadGrid({ lines: LINES, periods: PERIODS });
    await client.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, formula: "=base*1.04" });

    const findings = await client.scanHardcoded();
    expect(findings).toHaveLength(1);
    expect(findings[0]?.literals[0]?.literal).toBe("1.04");

    const result = await client.convertHardcoded(
      LINES[0].id,
      PERIODS[0].id,
      { literal: "1.04", start: 6, end: 10 },
      "wage_inflation",
    );
    expect(result.cell.formula).toBe("=base*wage_inflation");
    expect(await client.scanHardcoded()).toEqual([]);
  });
});

describe("M3-5: spreadTotal client op + structured error parsing", () => {
  it("spreads through the single-flight client and parses the HARD weights error", async () => {
    const client = createModelEngineClient(new InProcessTransport());
    const ok = await client.spreadTotal({
      total: "12000000.00",
      periodIds: PERIODS.map((p) => p.id),
      method: "equal",
      scale: 2,
    });
    expect(ok.sum_text).toBe("12000000.00");
    expect(ok.values).toHaveLength(PERIODS.length);

    let caught: unknown;
    try {
      await client.spreadTotal({
        total: "100.00",
        periodIds: PERIODS.map((p) => p.id),
        method: "seasonal",
        weights: PERIODS.map(() => "0.6"), // 2 × 60% = 120%
        scale: 2,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const parsed = parseEngineOpError(caught);
    expect(parsed.code).toBe("SPREAD_WEIGHTS_INVALID");
    expect(parsed.userMessage).toBe("Seasonality weights total 120% — normalize to 100% or fix.");
    expect(parsed.details.canNormalize).toBe(true);
  });

  it("parseEngineOpError handles plain-text and code-only engine errors", () => {
    expect(parseEngineOpError(new Error("REFERENCE_BROKEN: unknown line"))).toEqual({
      code: "REFERENCE_BROKEN",
      userMessage: null,
      details: { reason: "unknown line" },
    });
    expect(parseEngineOpError(new Error("FORMULA_CYCLE"))).toEqual({
      code: "FORMULA_CYCLE",
      userMessage: null,
      details: {},
    });
    expect(parseEngineOpError("boom")).toEqual({ code: "boom", userMessage: null, details: {} });
    expect(parseEngineOpError(new Error("X: {not json"))).toEqual({
      code: "X",
      userMessage: null,
      details: { reason: "{not json" },
    });
  });
});

describe("M3-10: named range client ops", () => {
  it("add/list/get/remove named ranges through the client", async () => {
    const client = createModelEngineClient(new InProcessTransport());
    await client.loadGrid({ lines: LINES, periods: PERIODS });

    expect(await client.listNamedRanges()).toEqual([]);
    await client.addNamedRange("wage_inflation", "0.05");
    expect(await client.listNamedRanges()).toEqual(["wage_inflation"]);
    expect(await client.getNamedRangeValue("wage_inflation")).toBe("0.05");

    // Update in-place.
    await client.addNamedRange("wage_inflation", "0.08");
    expect(await client.getNamedRangeValue("wage_inflation")).toBe("0.08");

    await client.removeNamedRange("wage_inflation");
    expect(await client.listNamedRanges()).toEqual([]);
    expect(await client.getNamedRangeValue("wage_inflation")).toBeNull();
  });

  it("named range resolves in a formula through the client", async () => {
    const client = createModelEngineClient(new InProcessTransport());
    await client.loadGrid({ lines: LINES, periods: PERIODS });
    await client.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "1000" });
    await client.addNamedRange("growth", "0.1");
    const { cell } = await client.setCell({
      line_id: LINES[0].id,
      period_id: PERIODS[1].id,
      formula: "=B2*growth",
    });
    expect(cellNum(cell.computed_text)).toBeCloseTo(100, 0);
  });
});
