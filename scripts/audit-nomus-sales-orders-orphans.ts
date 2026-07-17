#!/usr/bin/env npx tsx
/**
 * OP-81 — Auditoria Local × Nomus (órfãos) + SYNC-04 lifecycle preview/apply.
 *
 * Uso:
 *   npm run audit:nomus:sales-orders:orphans -- --from=2026-07-01 --to=2026-07-31
 *   npm run audit:nomus:sales-orders:orphans -- --orderCode="PD 02739" --from=2026-07-01 --to=2026-07-31 --confirm-candidates
 *   npm run audit:nomus:sales-orders:orphans -- --from=... --to=... --lifecycle-preview
 *   npm run audit:nomus:sales-orders:orphans -- --from=... --to=... --confirm-candidates --lifecycle-apply
 *
 * --apply/--write/--mutate continuam proibidos (não mutam dados comerciais).
 * --lifecycle-apply grava somente campos oficiais de presença (SYNC-02/04).
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  applyDirectedConfirmation,
  assessAutoActionRisk,
  compareLocalAndNomusSalesOrders,
  summarizeOrphanAudit,
  type OrphanCompareRow,
} from "../src/lib/audit/nomusSalesOrderOrphanAudit.ts";
import { loadLocalNomusSalesOrdersForOrphanAudit } from "../src/lib/audit/nomusSalesOrderOrphanAudit.server.ts";
import {
  fetchNomusPedidosForAudit,
  lookupNomusPedidoByOrderCode,
} from "../src/lib/nomusSalesOrdersClient.ts";
import {
  assessSalesOrderSyncPayloadCompleteness,
  buildSalesOrderSourceReconciliationPlan,
  buildSalesOrderSyncReconciliationScope,
  SALES_ORDER_PILOT_ABSENCE,
  summarizeSalesOrderReconciliationPreview,
  type SalesOrderLifecycleLocalSnapshot,
} from "../src/lib/nomus/nomusSalesOrderSourceReconciliation.ts";
import {
  acquireSalesOrderReconcileLock,
  applySalesOrderLifecyclePatches,
  createSalesOrderSourceSyncRun,
  finishSalesOrderSourceSyncRun,
  isSalesOrderAbsenceReconcileEnabled,
  loadSalesOrderLifecycleLocals,
} from "../src/lib/nomus/nomusSalesOrderSourceReconciliation.server.ts";

const prisma = new PrismaClient();

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
}

function parseIsoDate(value: string, label: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`${label} deve ser YYYY-MM-DD (recebido: ${value})`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new Error(`${label} inválida: ${value}`);
  }
  return date;
}

function escapeCsv(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows: OrphanCompareRow[]): string {
  const header = [
    "classification",
    "matchKey",
    "salesOrderId",
    "externalSalesOrderId",
    "orderCode",
    "issueDate",
    "status",
    "totalNetValue",
    "customerName",
    "sellerName",
    "itemCount",
    "nomusExternalId",
    "nomusOrderCode",
    "absenceObserved",
    "autoActionRisk",
    "notes",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.classification,
        row.matchKey,
        row.local?.id ?? "",
        row.local?.externalSalesOrderId ?? "",
        row.local?.orderCode ?? "",
        row.local?.issueDateIso ?? "",
        row.local?.status ?? "",
        row.local?.totalNetValue ?? "",
        row.local?.customerName ?? "",
        row.local?.sellerName ?? "",
        row.local?.itemCount ?? "",
        row.nomus?.externalSalesOrderId ?? "",
        row.nomus?.orderCode ?? "",
        row.absenceObserved,
        row.autoActionRisk,
        row.notes.join(" | "),
      ]
        .map(escapeCsv)
        .join(",")
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  if (hasFlag("apply") || hasFlag("write") || hasFlag("mutate")) {
    throw new Error(
      "Flags --apply/--write/--mutate são proibidas. Use --lifecycle-apply para gravar só presença."
    );
  }

  const fromRaw = parseArg("from");
  const toRaw = parseArg("to");
  if (!fromRaw || !toRaw) {
    throw new Error("Informe --from=YYYY-MM-DD e --to=YYYY-MM-DD");
  }
  const from = parseIsoDate(fromRaw, "--from");
  const to = parseIsoDate(toRaw, "--to");
  if (from.getTime() > to.getTime()) {
    throw new Error("--from não pode ser posterior a --to");
  }

  const orderCode = parseArg("orderCode")?.trim() || null;
  const confirmCandidates = hasFlag("confirm-candidates");
  const lifecyclePreview = hasFlag("lifecycle-preview");
  const lifecycleApply = hasFlag("lifecycle-apply");
  const maxConfirmations = Math.max(
    0,
    Number.parseInt(parseArg("max-confirmations") ?? "50", 10) || 50
  );
  const wantJson = hasFlag("json");
  const wantCsv = hasFlag("csv");

  const baseUrl = (process.env.NOMUS_BASE_URL ?? "").trim();
  if (!baseUrl) {
    throw new Error("NOMUS_BASE_URL é obrigatório para a auditoria de órfãos.");
  }

  const started = Date.now();

  const localRows = await loadLocalNomusSalesOrdersForOrphanAudit({
    from,
    to,
    orderCode,
  });

  const { pedidos: nomusPedidos, completeness } = await fetchNomusPedidosForAudit({
    baseUrl,
    from,
    to,
    strategyLabel: "period-full-reconciliation",
  });

  let rows = compareLocalAndNomusSalesOrders({
    local: localRows,
    nomus: nomusPedidos,
    completeness,
  });

  const impactById = new Map(localRows.map((r) => [r.id, r] as const));
  rows = rows.map((row) => {
    if (!row.local) return row;
    const impactRow = impactById.get(row.local.id);
    if (!impactRow) return row;
    const risk = assessAutoActionRisk(impactRow.impact);
    return {
      ...row,
      autoActionRisk:
        row.classification === "MATCHED"
          ? "none"
          : risk === "high" || row.autoActionRisk === "high"
            ? "high"
            : risk,
    };
  });

  if (confirmCandidates && completeness.complete) {
    let confirmed = 0;
    const next: OrphanCompareRow[] = [];
    for (const row of rows) {
      if (
        row.classification === "LOCAL_ONLY_CANDIDATE" &&
        row.local &&
        confirmed < maxConfirmations
      ) {
        confirmed += 1;
        const lookup = await lookupNomusPedidoByOrderCode({
          baseUrl,
          orderCode: row.local.orderCode,
          from,
          to,
        });
        next.push(
          applyDirectedConfirmation(row, {
            status: lookup.status,
            reason: lookup.status === "inconclusive" ? lookup.reason : undefined,
          })
        );
      } else {
        next.push(row);
      }
    }
    rows = next;
  } else if (confirmCandidates && !completeness.complete) {
    console.warn(
      "[orphan-audit] --confirm-candidates ignorado: coleta Nomus INCONCLUSIVE_FETCH."
    );
  }

  const durationMs = Date.now() - started;
  const summary = summarizeOrphanAudit({ rows, completeness, durationMs });

  const candidates = rows.filter(
    (r) =>
      r.classification === "LOCAL_ONLY_CANDIDATE" ||
      r.classification === "CONFIRMED_MISSING_IN_NOMUS" ||
      r.classification === "CANDIDATE_MISSING_IN_NOMUS"
  );

  const impactDetails = candidates.map((row) => {
    const local = row.local ? impactById.get(row.local.id) : null;
    return {
      classification: row.classification,
      salesOrderId: row.local?.id ?? null,
      externalSalesOrderId: row.local?.externalSalesOrderId ?? null,
      orderCode: row.local?.orderCode ?? null,
      issueDate: row.local?.issueDateIso ?? null,
      status: row.local?.status ?? null,
      totalNetValue: row.local?.totalNetValue ?? null,
      customerName: row.local?.customerName ?? null,
      sellerName: row.local?.sellerName ?? null,
      itemCount: row.local?.itemCount ?? null,
      autoActionRisk: row.autoActionRisk,
      notes: row.notes,
      impact: local?.impactDetail ?? null,
      wording: "ausente na origem (não afirmar exclusão)",
    };
  });

  let sourceLifecycle: Record<string, unknown> | null = null;

  if (lifecyclePreview || lifecycleApply) {
    const reconcileEnabled = isSalesOrderAbsenceReconcileEnabled();
    const lock = acquireSalesOrderReconcileLock({
      mode: lifecycleApply ? "apply" : "preview",
    });
    if (!lock.ok) {
      throw new Error(
        lock.code === "LOCK_HELD"
          ? lock.message
          : "Lock de reconciliação de Pedidos indisponível."
      );
    }

    try {
      const scope = buildSalesOrderSyncReconciliationScope({
        strategy: "full-reconciliation",
        fromIso: fromRaw,
        toIso: toRaw,
      });
      const completenessAssessment = assessSalesOrderSyncPayloadCompleteness({
        strategy: "full-reconciliation",
        startPage: completeness.startPage,
        completedWindow: completeness.stoppedBecauseMaxPages,
        stoppedBecauseEmpty: completeness.stoppedBecauseEmpty,
        stoppedBecauseNoNext: completeness.stoppedBecauseNoNext,
        http429Count: completeness.http429Count,
        errors: completeness.errors,
        fetchFailed: completeness.stopReason === "http_error",
      });

      const lifecycleLocals: SalesOrderLifecycleLocalSnapshot[] =
        await loadSalesOrderLifecycleLocals({
          prisma,
          issueDateFrom: from,
          issueDateTo: to,
          orderCode,
        });

      const localHashByExternalId = new Map(
        lifecycleLocals.map((l) => [l.externalSalesOrderId, l.payloadHash ?? ""] as const)
      );
      const foundPedidos = nomusPedidos
        .filter((p) => p.externalSalesOrderId != null)
        .map((p) => {
          const id = p.externalSalesOrderId as number;
          const existingHash = localHashByExternalId.get(id);
          return {
            externalSalesOrderId: id,
            // Presença-only: reutiliza hash local para não inventar UPDATE comercial.
            payloadHash:
              existingHash && existingHash.length > 0
                ? existingHash
                : `audit-presence:${id}`,
          };
        });

      const directedLookups = rows
        .filter(
          (r) =>
            r.classification === "CONFIRMED_MISSING_IN_NOMUS" &&
            r.local?.externalSalesOrderId != null
        )
        .map((r) => ({
          externalSalesOrderId: r.local!.externalSalesOrderId as number,
          found: false,
        }));

      let runId: string | null = null;
      if (lifecycleApply) {
        if (!reconcileEnabled) {
          throw new Error(
            "NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED deve estar habilitado para --lifecycle-apply."
          );
        }
        if (!completenessAssessment.payloadComplete) {
          throw new Error(
            "Coleta Nomus incompleta — --lifecycle-apply recusado (mesma prova OP-81)."
          );
        }
        const run = await createSalesOrderSourceSyncRun({
          prisma,
          strategy: "full-reconciliation",
          scope: scope as unknown as Record<string, unknown>,
          startedAt: new Date(),
          coveredFrom: from,
          coveredTo: to,
        });
        runId = run.id;
      }

      const plan = buildSalesOrderSourceReconciliationPlan({
        strategy: "full-reconciliation",
        scope,
        completeness: completenessAssessment,
        reconciliationEnabled: reconcileEnabled,
        foundPedidos,
        localRecords: lifecycleLocals,
        directedLookups,
        executedAt: new Date(),
        runId,
        runStatus: completenessAssessment.payloadComplete ? "SUCCESS" : "INCONCLUSIVE",
        mode: lifecycleApply ? "apply" : "preview",
      });

      const orderCodeByExternalId = new Map(
        lifecycleLocals.map((l) => [String(l.externalSalesOrderId), l.orderCode] as const)
      );
      const preview = summarizeSalesOrderReconciliationPreview(
        plan,
        completenessAssessment,
        orderCodeByExternalId
      );

      let lifecycleApplied = 0;
      if (lifecycleApply && runId) {
        const patches = [
          ...plan.missingCandidates,
          ...plan.missingConfirmed,
        ]
          .filter((i) => i.localId && i.lifecyclePatch)
          .map((i) => ({ localId: i.localId as string, patch: i.lifecyclePatch! }));
        const { applied } = await applySalesOrderLifecyclePatches({ prisma, patches });
        lifecycleApplied = applied;
        await finishSalesOrderSourceSyncRun({
          prisma,
          runId,
          status: "SUCCESS",
          payloadComplete: true,
          finishedAt: new Date(),
          counters: {
            rowsRead: nomusPedidos.length,
            missingCandidateCount: plan.counters.missingCandidates,
            missingConfirmedCount: plan.counters.missingConfirmed,
            http429Count: completeness.http429Count,
          },
          summaryJson: { preview, lifecycleApplied, source: "op-81-orphan-audit" },
        });
      }

      sourceLifecycle = {
        mode: lifecycleApply ? "apply" : "preview",
        reconciliationEnabled: reconcileEnabled,
        runId,
        lifecycleApplied,
        creates: preview.creates,
        updates: preview.updates,
        unchanged: preview.unchanged,
        missingCandidates: preview.missingCandidates,
        missingConfirmed: preview.missingConfirmed,
        reactivated: preview.reactivated,
        ignoredOutsideScope: preview.ignoredOutsideScope,
        fetchCompleteness: preview.fetchCompleteness,
        counters: preview.counters,
        reasons: preview.reasons,
        pilot: {
          orderCode: SALES_ORDER_PILOT_ABSENCE.orderCode,
          externalSalesOrderId: SALES_ORDER_PILOT_ABSENCE.externalSalesOrderId,
          inPreview:
            preview.missingCandidates.some(
              (r) => r.externalId === String(SALES_ORDER_PILOT_ABSENCE.externalSalesOrderId)
            ) ||
            preview.missingConfirmed.some(
              (r) => r.externalId === String(SALES_ORDER_PILOT_ABSENCE.externalSalesOrderId)
            ),
        },
      };
    } finally {
      lock.release();
    }
  }

  const report = {
    ok: completeness.complete,
    summary,
    fetchCompleteness: completeness,
    candidates: impactDetails,
    rows,
    sourceLifecycle,
    exampleDocumented: {
      orderCode: SALES_ORDER_PILOT_ABSENCE.orderCode,
      externalSalesOrderId: SALES_ORDER_PILOT_ABSENCE.externalSalesOrderId,
      expectedWhenAbsent: "CONFIRMED_MISSING_IN_NOMUS (com --confirm-candidates)",
    },
  };

  const outDir = join(process.cwd(), "tmp", "audits");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(outDir, `nomus-sales-orders-orphans-${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  if (wantCsv) {
    const csvPath = join(outDir, `nomus-sales-orders-orphans-${stamp}.csv`);
    writeFileSync(csvPath, rowsToCsv(rows), "utf8");
    console.error(`CSV: ${csvPath}`);
  }

  console.error(`JSON: ${jsonPath}`);

  if (wantJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      JSON.stringify(
        {
          localCount: summary.localCount,
          nomusCount: summary.nomusCount,
          matchedCount: summary.matchedCount,
          localOnlyCandidateCount: summary.localOnlyCandidateCount,
          confirmedMissingCount: summary.confirmedMissingCount,
          candidateMissingCount: summary.candidateMissingCount,
          nomusOnlyCount: summary.nomusOnlyCount,
          identityMismatchCount: summary.identityMismatchCount,
          inconclusiveCount: summary.inconclusiveCount,
          totalValueConfirmedMissing: summary.totalValueConfirmedMissing,
          fetchCompleteness: summary.fetchCompleteness.status,
          durationMs: summary.durationMs,
          http429Count: summary.http429Count,
          errors: summary.errors,
          reportPath: jsonPath,
          sourceLifecycle: sourceLifecycle
            ? {
                mode: sourceLifecycle.mode,
                missingCandidates: (sourceLifecycle.counters as { missingCandidates: number })
                  .missingCandidates,
                missingConfirmed: (sourceLifecycle.counters as { missingConfirmed: number })
                  .missingConfirmed,
                lifecycleApplied: sourceLifecycle.lifecycleApplied,
                pilotInPreview: (sourceLifecycle.pilot as { inPreview: boolean }).inPreview,
              }
            : null,
        },
        null,
        2
      )
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
