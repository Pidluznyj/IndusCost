import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateSalesOrderFlowRecomputeObservabilityMetrics,
  assertSalesOrderFlowObservabilitySanitized,
  buildSalesOrderFlowRecomputeFailureObservability,
  buildSalesOrderFlowRecomputeIntegrationRunSummary,
  buildSalesOrderFlowRecomputeObservability,
  formatSalesOrderFlowRecomputeObservabilityLog,
  summarizeSalesOrderFlowSourceFingerprint,
} from "./salesOrderFlowObservability.js";
import { persistSalesOrderFlowRecomputeObservabilityBestEffort } from "./salesOrderFlowObservability.server.js";
import { SALES_ORDER_FLOW_COMPUTATION_VERSION } from "./salesOrderFlowFingerprint.js";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const FULL_FP = "a".repeat(64);

describe("salesOrderFlowObservability (OP-74)", () => {
  it("resume fingerprint sem publicar hash completo", () => {
    assert.equal(
      summarizeSalesOrderFlowSourceFingerprint(FULL_FP),
      "a".repeat(12)
    );
    assert.equal(summarizeSalesOrderFlowSourceFingerprint(""), "");
  });

  it("monta métricas de sucesso com origem e versão", () => {
    const log = buildSalesOrderFlowRecomputeObservability({
      salesOrderId: ORDER_ID,
      orderCode: "PV-74",
      previousStage: "IN_PRODUCTION",
      currentStage: "WAITING_NFE",
      reason: "fingerprint_changed",
      computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
      orderFingerprint: FULL_FP,
      action: "updated",
      source: "http",
      durationMs: 42.6,
      itemsEvaluated: 3,
      itemsCreated: 0,
      itemsUpdated: 2,
      eventsCreated: 1,
      inconsistencies: 2,
    });

    assert.equal(log.sourceFingerprint.length, 12);
    assert.equal(log.orderCode, "PV-74");
    assert.equal(log.previousStage, "IN_PRODUCTION");
    assert.equal(log.currentStage, "WAITING_NFE");
    assert.equal(log.metrics.ordersEvaluated, 1);
    assert.equal(log.metrics.itemsEvaluated, 3);
    assert.equal(log.metrics.snapshotsCreated, 0);
    assert.equal(log.metrics.snapshotsUpdated, 3); // order + 2 items
    assert.equal(log.metrics.unchanged, 0);
    assert.equal(log.metrics.eventsCreated, 1);
    assert.equal(log.metrics.inconsistencies, 2);
    assert.equal(log.metrics.failures, 0);
    assert.equal(log.metrics.durationMs, 43);
    assert.equal(log.metrics.source, "http");
    assert.equal(log.metrics.computationVersion, SALES_ORDER_FLOW_COMPUTATION_VERSION);

    const line = formatSalesOrderFlowRecomputeObservabilityLog(log);
    assert.match(line, /\[sales-order-flow-recompute\]/);
    assert.match(line, /salesOrderId=/);
    assert.match(line, /orderCode=PV-74/);
    assert.match(line, /prevStage=IN_PRODUCTION/);
    assert.match(line, /nextStage=WAITING_NFE/);
    assert.match(line, /sourceFingerprint=aaaaaaaaaaaa/);
    assert.doesNotMatch(line, /rawJson|password|token|nomusRaw/i);
    assert.doesNotMatch(line, new RegExp(FULL_FP));
  });

  it("monta log de falha sem dados sensíveis", () => {
    const log = buildSalesOrderFlowRecomputeFailureObservability({
      salesOrderId: ORDER_ID,
      orderCode: "PV-ERR",
      source: "rebuild",
      durationMs: 10,
      computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
      error: new Error("db timeout"),
    });
    assert.equal(log.action, "failed");
    assert.equal(log.metrics.failures, 1);
    assert.equal(log.reason, "recompute_failed");
    assert.equal(log.errorMessage, "db timeout");
    assertSalesOrderFlowObservabilitySanitized(log);
    const line = formatSalesOrderFlowRecomputeObservabilityLog(log);
    assert.match(line, /action=failed/);
    assert.match(line, /error=db timeout/);
  });

  it("rejeita payload com rawJson/token/senha", () => {
    assert.throws(
      () =>
        assertSalesOrderFlowObservabilitySanitized({
          salesOrderId: ORDER_ID,
          rawJson: { secret: true },
        }),
      /sensível/
    );
    assert.throws(
      () =>
        assertSalesOrderFlowObservabilitySanitized({
          token: "abc",
        }),
      /sensível/
    );
    assert.throws(
      () =>
        assertSalesOrderFlowObservabilitySanitized({
          sourceFingerprint: "a".repeat(64),
        }),
      /resumido/
    );
  });

  it("agrega métricas e monta summaryJson sanitizado para IntegrationRun", () => {
    const a = buildSalesOrderFlowRecomputeObservability({
      salesOrderId: ORDER_ID,
      orderCode: "A",
      reason: "first_run",
      computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
      orderFingerprint: FULL_FP,
      action: "created",
      source: "rebuild",
      durationMs: 5,
      itemsEvaluated: 2,
      itemsCreated: 2,
      itemsUpdated: 0,
      eventsCreated: 3,
      inconsistencies: 1,
    });
    const b = buildSalesOrderFlowRecomputeObservability({
      salesOrderId: "22222222-2222-4222-8222-222222222222",
      orderCode: "B",
      reason: "fingerprint_match",
      computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
      orderFingerprint: FULL_FP,
      action: "unchanged",
      source: "rebuild",
      durationMs: 2,
      itemsEvaluated: 1,
      itemsCreated: 0,
      itemsUpdated: 0,
      eventsCreated: 0,
      inconsistencies: 0,
    });
    const metrics = aggregateSalesOrderFlowRecomputeObservabilityMetrics([a, b], {
      source: "rebuild",
      computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
      durationMs: 20,
    });
    assert.equal(metrics.ordersEvaluated, 2);
    assert.equal(metrics.itemsEvaluated, 3);
    assert.equal(metrics.snapshotsCreated, 3);
    assert.equal(metrics.unchanged, 1);
    assert.equal(metrics.eventsCreated, 3);
    assert.equal(metrics.inconsistencies, 1);
    assert.equal(metrics.durationMs, 20);

    const summary = buildSalesOrderFlowRecomputeIntegrationRunSummary({
      metrics,
      logs: [a, b],
    });
    assertSalesOrderFlowObservabilitySanitized(summary);
    assert.doesNotMatch(JSON.stringify(summary), /rawJson|password|nomusRaw/i);
  });

  it("persiste IntegrationRun best-effort e não propaga falha", async () => {
    const created: unknown[] = [];
    await persistSalesOrderFlowRecomputeObservabilityBestEffort(
      {
        integrationRun: {
          create: async ({ data }: { data: unknown }) => {
            created.push(data);
            return data;
          },
        },
      } as never,
      {
        source: "http",
        metrics: {
          ordersEvaluated: 1,
          itemsEvaluated: 2,
          snapshotsCreated: 3,
          snapshotsUpdated: 0,
          unchanged: 0,
          eventsCreated: 1,
          inconsistencies: 0,
          failures: 0,
          durationMs: 12,
          computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
          source: "http",
        },
        startedAt: new Date("2026-07-17T12:00:00.000Z"),
        finishedAt: new Date("2026-07-17T12:00:00.012Z"),
        mode: "http",
      }
    );
    assert.equal(created.length, 1);
    const row = created[0] as {
      target: string;
      kind: string;
      status: string;
      summaryJson: { metrics: { ordersEvaluated: number } };
    };
    assert.equal(row.target, "sales-order-flow-recompute:http");
    assert.equal(row.kind, "recompute");
    assert.equal(row.status, "SUCCESS");
    assert.equal(row.summaryJson.metrics.ordersEvaluated, 1);

    await persistSalesOrderFlowRecomputeObservabilityBestEffort(
      {
        integrationRun: {
          create: async () => {
            throw new Error("db down");
          },
        },
      } as never,
      {
        source: "http",
        metrics: {
          ordersEvaluated: 1,
          itemsEvaluated: 0,
          snapshotsCreated: 0,
          snapshotsUpdated: 0,
          unchanged: 0,
          eventsCreated: 0,
          inconsistencies: 0,
          failures: 1,
          durationMs: 1,
          computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
          source: "http",
        },
        startedAt: new Date(),
        finishedAt: new Date(),
        errorMessage: "boom",
      }
    );
  });
});
