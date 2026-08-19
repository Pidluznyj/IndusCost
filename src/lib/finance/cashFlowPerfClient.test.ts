import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCashFlowReadyTracker,
} from "@/src/lib/finance/cashFlowPerfClient.js";
import {
  CASH_FLOW_PERF_ACCOUNTED_NOTE,
  CASH_FLOW_PERF_DBMS_DISCLAIMER,
  CASH_FLOW_PERF_OPENING_DISCLAIMER,
  CASH_FLOW_PERF_SHARED_PATH_NOTE,
  CASH_FLOW_PERF_SINGLE_COMMAND_NOTE,
  nearestRankPercentile,
  sortedFinite,
  summarizeNumeric,
} from "@/src/lib/finance/cashFlowPerfStats.js";

describe("PERF 3.1 cash-flow ready tracker", () => {
  it("só marca ready depois das três seções", () => {
    const tracker = createCashFlowReadyTracker();
    assert.deepEqual(tracker.pending(), ["dashboard", "annual", "radar"]);
    assert.equal(tracker.note("dashboard").ready, false);
    assert.equal(tracker.note("annual").ready, false);
    const last = tracker.note("radar");
    assert.equal(last.ready, true);
    assert.deepEqual(last.pending, []);
  });

  it("reset volta as três seções para pending", () => {
    const tracker = createCashFlowReadyTracker();
    tracker.note("dashboard");
    tracker.reset();
    assert.deepEqual(tracker.pending(), ["dashboard", "annual", "radar"]);
  });
});

describe("PERF 3.1 stats", () => {
  it("median e p95 de 5 amostras usam nearest-rank", () => {
    const sorted = sortedFinite([10, 20, 30, 40, 100]);
    const s = summarizeNumeric(sorted);
    assert.equal(s.min, 10);
    assert.equal(s.median, 30);
    assert.equal(s.p95, 100);
    assert.equal(nearestRankPercentile(sorted, 95), 100);
  });

  it("disclaimers deixam explícito que totalMs-dbMs não é CPU e opening não é tela", () => {
    assert.match(CASH_FLOW_PERF_DBMS_DISCLAIMER, /NUNCA derive CPU/);
    assert.match(CASH_FLOW_PERF_DBMS_DISCLAIMER, /totalMs - dbMs/);
    assert.match(CASH_FLOW_PERF_OPENING_DISCLAIMER, /cf:ready/);
    assert.doesNotMatch(CASH_FLOW_PERF_DBMS_DISCLAIMER, /FASE 2C/);
    assert.doesNotMatch(CASH_FLOW_PERF_OPENING_DISCLAIMER, /FASE 2C/);
    assert.match(CASH_FLOW_PERF_ACCOUNTED_NOTE, /unaccountedWallMs = totalMs - accountedWallMs/);
    assert.match(CASH_FLOW_PERF_ACCOUNTED_NOTE, /NÃO usa dbMs/);
    assert.match(CASH_FLOW_PERF_SINGLE_COMMAND_NOTE, /npm run perf:cash-flow:baseline/);
    assert.match(CASH_FLOW_PERF_SINGLE_COMMAND_NOTE, /legacy e light/);
    assert.match(CASH_FLOW_PERF_SHARED_PATH_NOTE, /timed\*/);
    assert.doesNotMatch(CASH_FLOW_PERF_ACCOUNTED_NOTE, /FASE 2C/);
    assert.doesNotMatch(CASH_FLOW_PERF_SINGLE_COMMAND_NOTE, /FASE 2C/);
  });
});
