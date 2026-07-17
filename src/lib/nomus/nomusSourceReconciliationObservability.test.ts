import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OBSERVABILITY_FRONTEND_MUST_NOT_CONTAIN,
  assertNoSensitiveObservabilityLeak,
  buildNomusSourceReconciliationAlerts,
  buildNomusSourceReconciliationMetrics,
  buildNomusSourceReconciliationObservabilityPayload,
  buildPresenceDrilldownRow,
  isNomusSourceObservabilityAuthorized,
  paginateDrilldownRows,
  parseNomusSourceDrilldownQuery,
  sanitizeObservabilitySummaryJson,
  type NomusSourceSyncRunObservabilityRow,
} from "./nomusSourceReconciliationObservability.js";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function run(
  overrides: Partial<NomusSourceSyncRunObservabilityRow> &
    Pick<NomusSourceSyncRunObservabilityRow, "id" | "entityType">
): NomusSourceSyncRunObservabilityRow {
  return {
    strategy: "full-reconciliation",
    scope: { kind: "test", from: "2026-07-01", to: "2026-07-31" },
    startedAt: "2026-07-17T10:00:00.000Z",
    finishedAt: "2026-07-17T10:05:00.000Z",
    status: "SUCCESS",
    payloadComplete: true,
    pagesRead: 3,
    rowsRead: 100,
    createdCount: 2,
    updatedCount: 5,
    unchangedCount: 90,
    missingCandidateCount: 1,
    missingConfirmedCount: 0,
    reactivatedCount: 0,
    http429Count: 0,
    errors: 0,
    ...overrides,
  };
}

describe("nomusSourceReconciliationObservability", () => {
  it("1. métricas dos runs oficiais", () => {
    const metrics = buildNomusSourceReconciliationMetrics([
      run({ id: "r1", entityType: "SALES_ORDER", rowsRead: 120 }),
      run({
        id: "r0",
        entityType: "SALES_ORDER",
        startedAt: "2026-07-16T10:00:00.000Z",
        finishedAt: "2026-07-16T10:04:00.000Z",
        rowsRead: 110,
      }),
    ]);
    assert.equal(metrics.source, "NomusSourceSyncRun");
    const so = metrics.byEntity.find((e) => e.entityType === "SALES_ORDER");
    assert.equal(so?.rowsRead, 120);
    assert.equal(so?.previousRowsRead, 110);
    assert.equal(so?.createdCount, 2);
    assert.equal(so?.durationMs, 5 * 60 * 1000);
  });

  it("2. execução completa", () => {
    const payload = buildNomusSourceReconciliationObservabilityPayload({
      runs: [run({ id: "ok", entityType: "ACCOUNTS_RECEIVABLE", payloadComplete: true })],
    });
    const ar = payload.metrics.byEntity.find((e) => e.entityType === "ACCOUNTS_RECEIVABLE");
    assert.equal(ar?.payloadComplete, true);
    assert.equal(ar?.status, "SUCCESS");
    assert.equal(payload.alertsConfirmAbsence, false);
  });

  it("3. inconclusiva", () => {
    const alerts = buildNomusSourceReconciliationAlerts(
      buildNomusSourceReconciliationMetrics([
        run({
          id: "inc",
          entityType: "ACCOUNTS_PAYABLE",
          status: "INCONCLUSIVE",
          payloadComplete: false,
          pagesRead: 200,
        }),
      ]).byEntity
    );
    assert.ok(alerts.some((a) => a.code === "PAYLOAD_INCONCLUSIVE"));
    assert.ok(alerts.some((a) => a.code === "MAX_PAGES_REACHED"));
    assert.ok(alerts.every((a) => a.confirmsAbsence === false));
  });

  it("4. candidato", () => {
    const alerts = buildNomusSourceReconciliationAlerts(
      buildNomusSourceReconciliationMetrics([
        run({
          id: "c1",
          entityType: "SALES_ORDER",
          missingCandidateCount: 30,
        }),
        run({
          id: "c0",
          entityType: "SALES_ORDER",
          startedAt: "2026-07-16T10:00:00.000Z",
          finishedAt: "2026-07-16T10:01:00.000Z",
          missingCandidateCount: 2,
        }),
      ]).byEntity
    );
    assert.ok(alerts.some((a) => a.code === "CANDIDATES_SPIKE"));
  });

  it("5. confirmado", () => {
    const alerts = buildNomusSourceReconciliationAlerts(
      buildNomusSourceReconciliationMetrics([
        run({
          id: "conf",
          entityType: "SALES_ORDER",
          missingConfirmedCount: 2,
        }),
      ]).byEntity
    );
    const confirmed = alerts.find((a) => a.code === "ABSENCE_CONFIRMED");
    assert.ok(confirmed);
    assert.equal(confirmed?.confirmsAbsence, false);
  });

  it("6. reativado", () => {
    const alerts = buildNomusSourceReconciliationAlerts(
      buildNomusSourceReconciliationMetrics([
        run({
          id: "re",
          entityType: "ACCOUNTS_RECEIVABLE",
          reactivatedCount: 1,
        }),
      ]).byEntity
    );
    assert.ok(alerts.some((a) => a.code === "RECORD_REACTIVATED"));
  });

  it("7. autorização", () => {
    assert.equal(isNomusSourceObservabilityAuthorized({ hasView: true }), true);
    assert.equal(isNomusSourceObservabilityAuthorized({ hasView: false }), false);
    assert.equal(
      isNomusSourceObservabilityAuthorized({ hasView: false, isBootstrap: true }),
      true
    );
    const routes = read("src/lib/settingsNomusSyncRoutes.ts");
    assert.match(routes, /source-reconciliation-status/);
    assert.match(routes, /source-reconciliation-records/);
    assert.match(routes, /ADMIN_SETTINGS_ACTIONS\.view/);
    const pilot = read("src/lib/adminSettingsAccess.ts");
    assert.match(pilot, /source-reconciliation-records/);
  });

  it("8. ausência de informação sensível", () => {
    const sanitized = sanitizeObservabilitySummaryJson({
      applied: 3,
      rawPayload: { secret: true },
      nomusRawResponse: { token: "x" },
      authorization: "Bearer abc",
      nested: { token: "y", ok: 1 },
    }) as Record<string, unknown>;
    assert.equal(sanitized.applied, 3);
    assert.equal(sanitized.rawPayload, undefined);
    assert.equal(sanitized.nomusRawResponse, undefined);
    assert.throws(
      () => assertNoSensitiveObservabilityLeak({ rawPayload: {} }),
      /rawPayload/
    );
    const card = read(
      "src/components/NomusSourceReconciliationObservabilityCard.tsx"
    );
    assert.doesNotMatch(card, /rawPayload/);
    assert.doesNotMatch(card, /nomusRawResponse/);
  });

  it("9. filtros", () => {
    const q = parseNomusSourceDrilldownQuery({
      entityType: "accounts_receivable",
      presenceStatus: "missing_candidate",
      code: "PD 02739",
      page: "2",
      pageSize: "5",
    });
    assert.equal(q.entityType, "ACCOUNTS_RECEIVABLE");
    assert.equal(q.presenceStatus, "MISSING_CANDIDATE");
    assert.equal(q.code, "PD 02739");
    assert.equal(q.page, 2);
    assert.equal(q.pageSize, 5);
  });

  it("10. paginação", () => {
    const page = paginateDrilldownRows([1, 2, 3, 4, 5], 2, 2);
    assert.deepEqual(page.items, [3, 4]);
    assert.equal(page.total, 5);
    assert.equal(page.totalPages, 3);
    assert.equal(page.page, 2);
  });

  it("11. nenhuma lógica de negócio no frontend", () => {
    const card = read(
      "src/components/NomusSourceReconciliationObservabilityCard.tsx"
    );
    for (const banned of OBSERVABILITY_FRONTEND_MUST_NOT_CONTAIN) {
      assert.doesNotMatch(card, new RegExp(banned));
    }
    assert.match(card, /source-reconciliation-status/);
    assert.match(card, /somente apresentação|Observabilidade/i);
    const row = buildPresenceDrilldownRow({
      entityType: "SALES_ORDER",
      localId: "x",
      externalId: 2737,
      code: "PD 02739",
      sourcePresenceStatus: "MISSING_CANDIDATE",
      openBalance: 10,
    });
    assert.equal(row.operationalImpact.adminAlert, true);
    assert.equal(row.operationalImpact.isOperationallyPresent, true);
  });

  it("checklist: estende painel existente sem módulo paralelo", () => {
    const settings = read("src/components/SettingsModule.tsx");
    assert.match(settings, /NomusSourceReconciliationObservabilityCard/);
    assert.match(
      read("src/lib/nomus/nomusSourceReconciliationObservability.ts"),
      /NomusSourceSyncRun/
    );
    assert.ok(
      read("docs/nomus/nomus-source-reconciliation-observability.md").length > 0
    );
  });
});
