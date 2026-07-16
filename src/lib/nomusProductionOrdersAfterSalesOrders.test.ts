/**
 * OP-13 — pós Pedidos de Venda → incremental de OP (mocks, sem API real).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatProductionOrdersAfterSalesOrdersLogLine,
  runNomusProductionOrdersAfterSalesOrdersSync,
} from "@/src/lib/nomusProductionOrdersAfterSalesOrders.server.js";
import type { ProductionOrdersIncrementalSummary } from "@/src/lib/nomusProductionOrdersIncremental.js";
import {
  NOMUS_PRODUCTION_ORDERS_INCREMENTAL_DEFAULT_OVERLAP_HOURS,
} from "@/src/lib/nomusProductionOrdersIncremental.js";

function emptyIncrementalSummary(
  partial?: Partial<ProductionOrdersIncrementalSummary>
): ProductionOrdersIncrementalSummary {
  return {
    mode: "apply",
    strategy: "incremental",
    plan: {
      strategy: "date_filter",
      selectorDecision: {
        ok: true,
        selector: "dataHoraEdicao",
        source: "default",
        homologation: "unverified",
      },
      overlapHours: NOMUS_PRODUCTION_ORDERS_INCREMENTAL_DEFAULT_OVERLAP_HOURS,
      cutoffIso: "2026-07-13T12:00:00.000Z",
      filterRsql: "dataHoraEdicao>=10/07/2026",
      maxPages: 20,
      pageSize: 50,
      fallbackMaxPages: 20,
      hadPriorState: false,
      priorLastSuccessAt: null,
      bootstrap: true,
    },
    pagesRead: 1,
    recordsReceived: 2,
    created: 1,
    updated: 0,
    unchanged: 1,
    invalid: 0,
    linkedRows: 1,
    linksCreated: 1,
    linksUpdated: 0,
    linksReactivated: 0,
    linksMarkedAbsent: 0,
    errors: 0,
    errorReport: [],
    stateAdvanced: true,
    stateFile: null,
    filterUsed: "dataHoraEdicao>=10/07/2026",
    cutoffUsed: "2026-07-13T12:00:00.000Z",
    duration: 10,
    lockBlocked: false,
    exitCode: 0,
    ...partial,
  };
}

describe("runNomusProductionOrdersAfterSalesOrdersSync", () => {
  it("execução bem-sucedida chama incremental apply uma vez (nunca backfill)", async () => {
    let incrementalCalls = 0;
    let reconcileCalls = 0;
    const modes: string[] = [];

    const result = await runNomusProductionOrdersAfterSalesOrdersSync({
      prisma: {} as never,
      salesOrderExternalIds: [2530],
      env: { NOMUS_PRODUCTION_ORDERS_AFTER_SYNC: "true" },
      logger: () => {},
      runIncremental: async (args) => {
        incrementalCalls += 1;
        modes.push(args.options?.mode ?? "missing");
        assert.equal(args.respectGlobalLock, false);
        assert.equal(args.options?.mode, "apply");
        assert.ok(
          (args.options?.overlapHours ?? 0) >= 72,
          "overlap padrão incremental"
        );
        return emptyIncrementalSummary();
      },
      reconcilePending: async (_db, opts) => {
        reconcileCalls += 1;
        assert.deepEqual(opts?.externalSalesOrderIds, [2530]);
        return {
          scanned: 1,
          salesOrderResolved: 1,
          salesOrderItemResolved: 1,
          updated: 1,
        };
      },
    });

    assert.equal(result.skipped, false);
    assert.equal(incrementalCalls, 1);
    assert.equal(reconcileCalls, 1);
    assert.deepEqual(modes, ["apply"]);
    assert.match(formatProductionOrdersAfterSalesOrdersLogLine(result), /incremental/);
    assert.match(formatProductionOrdersAfterSalesOrdersLogLine(result), /created=1/);
  });

  it("env desabilitado não inicia OP", async () => {
    let incrementalCalls = 0;
    const result = await runNomusProductionOrdersAfterSalesOrdersSync({
      prisma: {} as never,
      env: { NOMUS_PRODUCTION_ORDERS_AFTER_SYNC: "false" },
      logger: () => {},
      runIncremental: async () => {
        incrementalCalls += 1;
        return emptyIncrementalSummary();
      },
    });
    assert.equal(result.skipped, true);
    assert.equal(incrementalCalls, 0);
    assert.match(formatProductionOrdersAfterSalesOrdersLogLine(result), /skipped/);
  });

  it("falha em OP é registrada e não engole o fluxo (summary com errors)", async () => {
    const result = await runNomusProductionOrdersAfterSalesOrdersSync({
      prisma: {} as never,
      env: {},
      logger: () => {},
      runIncremental: async () =>
        emptyIncrementalSummary({
          errors: 2,
          exitCode: 2,
          stateAdvanced: false,
          errorReport: [{ externalId: 1, message: "boom" }],
        }),
      reconcilePending: async () => ({
        scanned: 0,
        salesOrderResolved: 0,
        salesOrderItemResolved: 0,
        updated: 0,
      }),
    });
    assert.equal(result.skipped, false);
    assert.equal(result.summary?.errors, 2);
    assert.match(
      formatProductionOrdersAfterSalesOrdersLogLine(result),
      /errors=2/
    );
  });

  it("lock ativo → BLOCKED sem throw; pedidos permaneceriam válidos", async () => {
    const result = await runNomusProductionOrdersAfterSalesOrdersSync({
      prisma: {} as never,
      env: {},
      logger: () => {},
      runIncremental: async () =>
        emptyIncrementalSummary({
          lockBlocked: true,
          pagesRead: 0,
          recordsReceived: 0,
          created: 0,
          stateAdvanced: false,
          exitCode: 0,
          audit: {
            type: "incremental",
            mode: "apply",
            startedAt: "2026-07-16T12:00:00.000Z",
            finishedAt: "2026-07-16T12:00:01.000Z",
            status: "BLOCKED",
            cutoff: null,
            pages: 0,
            received: 0,
            created: 0,
            updated: 0,
            unchanged: 0,
            invalid: 0,
            links: 0,
            resolved: 0,
            pending: 0,
            deactivated: 0,
            errors: 0,
            rateLimit429: 0,
            durationMs: 1,
            finalMessage: "SKIPPED: lock",
            exitCode: 0,
            lockFile: "/tmp/x.lock",
            blockedCode: "LOCK_HELD",
          },
        }),
      reconcilePending: async () => ({
        scanned: 0,
        salesOrderResolved: 0,
        salesOrderItemResolved: 0,
        updated: 0,
      }),
    });
    assert.equal(result.summary?.lockBlocked, true);
    assert.match(formatProductionOrdersAfterSalesOrdersLogLine(result), /BLOCKED/);
  });

  it("throw do incremental propaga para soft-fail do chamador", async () => {
    await assert.rejects(
      () =>
        runNomusProductionOrdersAfterSalesOrdersSync({
          prisma: {} as never,
          env: {},
          logger: () => {},
          runIncremental: async () => {
            throw new Error("API down");
          },
        }),
      /API down/
    );
  });
});

describe("OP-13 wiring — fluxos de Pedidos de Venda", () => {
  it("sales-orders apply chama pós-sync incremental; dry não", () => {
    const sales = readFileSync(
      join(process.cwd(), "scripts/nomusSalesOrdersSyncV1.ts"),
      "utf8"
    );
    assert.match(sales, /nomusProductionOrdersAfterSalesOrders\.server/);
    assert.match(sales, /runNomusProductionOrdersAfterSalesOrdersSync/);
    assert.match(sales, /formatProductionOrdersAfterSalesOrdersLogLine/);
    assert.match(sales, /if \(isApply\)/);
    assert.match(sales, /production-orders sync falhou \(sync de pedidos segue\)/);
    assert.match(sales, /production-orders incremental falhou/);
    assert.doesNotMatch(sales, /Backfill|backfill:apply/);
  });

  it("hook SyncV1 delega ao incremental (sem SyncV1 apply no pós-pedidos)", () => {
    const script = readFileSync(
      join(process.cwd(), "scripts/nomusProductionOrdersSyncV1.ts"),
      "utf8"
    );
    assert.match(script, /nomusProductionOrdersAfterSalesOrders\.server/);
    assert.match(script, /runNomusProductionOrdersAfterSalesOrdersSync/);
    // A implementação antiga com --strategy=incremental SyncV1 não deve restar no hook.
    assert.doesNotMatch(
      script,
      /salesOrderExternalId=\$\{salesOrderExternalIds/
    );
  });

  it("rotina horária / wide / orquestrador passam por sales-orders apply (herdam OP)", () => {
    const hourly = readFileSync(
      join(process.cwd(), "scripts/runNomusSalesOrdersSync.sh"),
      "utf8"
    );
    const wide = readFileSync(
      join(process.cwd(), "scripts/runNomusSalesOrdersWideReconciliation.sh"),
      "utf8"
    );
    const orch = readFileSync(
      join(process.cwd(), "scripts/nomusSyncOrchestrator.ts"),
      "utf8"
    );
    const daily = readFileSync(
      join(process.cwd(), "scripts/runNomusDailySync.sh"),
      "utf8"
    );

    assert.match(hourly, /sync:nomus:sales-orders/);
    assert.match(wide, /sync:nomus:sales-orders/);
    assert.match(orch, /sales-orders/);
    // Daily não roda sales-orders — OP pós-pedidos não se aplica.
    assert.doesNotMatch(daily, /sales-orders/);
    // Orquestrador não chama backfill OP.
    assert.doesNotMatch(orch, /production-orders:backfill/);
    assert.doesNotMatch(orch, /nomusProductionOrdersBackfill/);
  });

  it("admin settings não dispara sales-orders nem OP (sem nova tela)", () => {
    const routes = readFileSync(
      join(process.cwd(), "src/lib/settingsNomusSyncRoutes.ts"),
      "utf8"
    );
    assert.doesNotMatch(routes, /sales-orders-run|production-orders-run/);
  });
});
