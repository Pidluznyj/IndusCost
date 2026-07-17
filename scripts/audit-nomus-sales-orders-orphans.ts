#!/usr/bin/env npx tsx
/**
 * OP-81 — Auditoria read-only: pedidos locais NOMUS ausentes na origem.
 *
 * Uso:
 *   npm run audit:nomus:sales-orders:orphans -- --from=2026-07-01 --to=2026-07-31
 *   npm run audit:nomus:sales-orders:orphans -- --orderCode="PD 02739" --from=2026-07-01 --to=2026-07-31 --confirm-candidates
 *
 * Não arquiva, desativa, exclui nem altera status. Não grava no banco.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
      "Auditoria estritamente read-only: flags --apply/--write/--mutate são proibidas."
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

  const report = {
    ok: completeness.complete,
    summary,
    fetchCompleteness: completeness,
    candidates: impactDetails,
    rows,
    exampleDocumented: {
      orderCode: "PD 02739",
      externalSalesOrderId: 2737,
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
        },
        null,
        2
      )
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
