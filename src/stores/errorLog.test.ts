import { beforeEach, describe, expect, it } from "vitest";
import {
  ERROR_AGGREGATION_THRESHOLD,
  ERROR_AGGREGATION_WINDOW_MS,
  selectAggregated,
  useErrorLogStore,
} from "./errorLog";

const ERR = { code: "VALUE_INVALID", userMessage: "Value is not valid for this cell ({type})." };

describe("errorLog store — ERROR-HANDLING §3 rule 7", () => {
  beforeEach(() => useErrorLogStore.getState().clear());

  it("identical errors aggregate on one group; different copy splits groups", () => {
    const s = useErrorLogStore.getState();
    s.record(ERR, 1_000);
    s.record(ERR, 2_000);
    s.record({ code: "VALUE_INVALID", userMessage: "Different catalog copy." }, 3_000);
    const groups = Object.values(useErrorLogStore.getState().groups);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.userMessage === ERR.userMessage)?.count).toBe(2);
  });

  it("threshold boundary: 4 → not aggregated, 5 → aggregated (§3 rule 7)", () => {
    const s = useErrorLogStore.getState();
    for (let i = 0; i < ERROR_AGGREGATION_THRESHOLD - 1; i++) s.record(ERR, 1_000 + i);
    expect(selectAggregated(useErrorLogStore.getState().groups)).toHaveLength(0);
    s.record(ERR, 2_000);
    const agg = selectAggregated(useErrorLogStore.getState().groups);
    expect(agg).toHaveLength(1);
    expect(agg[0]).toMatchObject({ code: ERR.code, count: 5 });
  });

  it("groups outside the 1-minute window are pruned on the next record", () => {
    const s = useErrorLogStore.getState();
    for (let i = 0; i < 5; i++) s.record(ERR, 0);
    expect(selectAggregated(useErrorLogStore.getState().groups)).toHaveLength(1);
    // A different, recent error prunes the stale VALUE_INVALID group entirely.
    s.record({ code: "INTERNAL", userMessage: "x" }, ERROR_AGGREGATION_WINDOW_MS + 5_000);
    const groups = useErrorLogStore.getState().groups;
    expect(groups[Object.keys(groups)[0]]?.code).toBe("INTERNAL");
    expect(Object.keys(groups)).toHaveLength(1);
  });

  it("dismiss drops exactly one group", () => {
    const s = useErrorLogStore.getState();
    for (let i = 0; i < 5; i++) s.record(ERR, i);
    const [group] = selectAggregated(useErrorLogStore.getState().groups);
    s.dismiss(group.key);
    expect(useErrorLogStore.getState().groups).toEqual({});
    // dismissing an unknown key is a no-op
    expect(() => s.dismiss("nope")).not.toThrow();
  });

  it("most frequent group sorts first in the banner feed", () => {
    const s = useErrorLogStore.getState();
    for (let i = 0; i < 9; i++) s.record(ERR, i);
    for (let i = 0; i < 5; i++) s.record({ code: "INTERNAL", userMessage: "x" }, i);
    const agg = selectAggregated(useErrorLogStore.getState().groups);
    expect(agg.map((g) => g.code)).toEqual(["VALUE_INVALID", "INTERNAL"]);
  });
});
