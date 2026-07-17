import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SALES_ORDER_FLOW_EVIDENCE_BATCH_PIPELINE_STEPS,
  SALES_ORDER_FLOW_LATENCY_TARGETS_MS,
  SALES_ORDER_FLOW_LIST_QUERIES_PER_STAGE_BUDGET,
  SALES_ORDER_FLOW_SUMMARY_QUERY_BUDGET,
} from "./salesOrderFlowPerformance.js";

describe("salesOrderFlowPerformance (OP-75)", () => {
  it("define orçamentos de query count alinhados aos loaders", () => {
    assert.equal(SALES_ORDER_FLOW_SUMMARY_QUERY_BUDGET, 8);
    assert.equal(SALES_ORDER_FLOW_LIST_QUERIES_PER_STAGE_BUDGET, 3);
    assert.equal(SALES_ORDER_FLOW_EVIDENCE_BATCH_PIPELINE_STEPS, 9);
  });

  it("documenta metas de latência de referência (não medição de produção)", () => {
    assert.equal(SALES_ORDER_FLOW_LATENCY_TARGETS_MS.summary, 1000);
    assert.equal(SALES_ORDER_FLOW_LATENCY_TARGETS_MS.initialKanbanLoad, 2000);
    assert.equal(SALES_ORDER_FLOW_LATENCY_TARGETS_MS.additionalColumnPage, 1000);
    assert.equal(SALES_ORDER_FLOW_LATENCY_TARGETS_MS.detail, 2000);
  });
});
