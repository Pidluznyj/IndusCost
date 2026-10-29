/**
 * Reconciliação do vínculo Pedido de Venda → Proposta (política: src/lib/sales/proposalSalesOrderLinkPolicy.ts).
 *
 *   DRY-RUN (padrão, só leitura):
 *     npx tsx scripts/reconcileProposalSalesOrderLinks.ts [--manual=revisao.json] [--out=tmp/proposal-link-reconcile]
 *
 *   APPLY (somente referência explícita do Nomus e revisão manual; exige o hash do dry-run revisado):
 *     npx tsx scripts/reconcileProposalSalesOrderLinks.ts --apply --confirm=<planHash> --authorized-by=<nome> [--manual=revisao.json]
 *
 *   REVERSÃO de um APPLY:
 *     npx tsx scripts/reconcileProposalSalesOrderLinks.ts --revert=<runId> --authorized-by=<nome>
 *
 * Arquivo --manual: JSON [{ "salesOrderId", "proposalId", "reviewer", "note"?, "replaceExisting"? }].
 * O relatório não contém nome de cliente nem CPF/CNPJ: só ids e códigos de pedido/proposta.
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  applyProposalLinkReconcilePlan,
  buildProposalLinkReconcilePlan,
  revertProposalLinkReconcileRun,
  type ManualReviewEntry,
  type ReconcilePlanRow,
} from "../src/lib/sales/proposalSalesOrderLinkReconcile.server.ts";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function readManual(path: string | undefined): ManualReviewEntry[] | undefined {
  if (!path) return undefined;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error("--manual deve ser um array JSON.");
  return parsed.map((row, i) => {
    const r = row as Record<string, unknown>;
    if (typeof r.salesOrderId !== "string" || typeof r.proposalId !== "string" || typeof r.reviewer !== "string" || !r.reviewer.trim()) {
      throw new Error(`--manual linha ${i + 1}: salesOrderId, proposalId e reviewer são obrigatórios.`);
    }
    return {
      salesOrderId: r.salesOrderId,
      proposalId: r.proposalId,
      reviewer: r.reviewer,
      note: typeof r.note === "string" ? r.note : null,
      replaceExisting: r.replaceExisting === true,
    };
  });
}

const CSV_COLUMNS: Array<keyof ReconcilePlanRow> = [
  "orderCode",
  "salesOrderId",
  "sourceSystem",
  "currentProposalCode",
  "currentSource",
  "currentStatus",
  "candidateProposalCode",
  "decidedStatus",
  "reason",
  "action",
  "matchedLines",
  "unmatchedLines",
  "candidateProposalCount",
];

function toCsv(rows: ReconcilePlanRow[]): string {
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [CSV_COLUMNS.join(";"), ...rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(";"))].join("\n") + "\n";
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const authorizedBy = arg("authorized-by") ?? "";
    const revertRunId = arg("revert");
    if (revertRunId) {
      const result = await revertProposalLinkReconcileRun(prisma, { runId: revertRunId, authorizedBy });
      console.log(JSON.stringify({ mode: "revert", runId: revertRunId, ...result }, null, 2));
      return;
    }

    const manual = readManual(arg("manual"));
    if (process.argv.includes("--apply")) {
      const confirm = arg("confirm");
      if (!confirm) throw new Error("APPLY exige --confirm=<planHash> do dry-run revisado.");
      const result = await applyProposalLinkReconcilePlan(prisma, { confirmPlanHash: confirm, authorizedBy, manual });
      console.log(JSON.stringify({ mode: "apply", ...result, revertCommand: `--revert=${result.runId} --authorized-by=<nome>` }, null, 2));
      return;
    }

    const plan = await buildProposalLinkReconcilePlan(prisma, { manual });
    const outDir = arg("out") ?? join("tmp", "proposal-link-reconcile");
    mkdirSync(outDir, { recursive: true });
    const stamp = plan.generatedAt.replace(/[-:.TZ]/g, "");
    const jsonPath = join(outDir, `dry-run-${stamp}.json`);
    const csvPath = join(outDir, `dry-run-${stamp}.csv`);
    writeFileSync(jsonPath, JSON.stringify(plan, null, 2));
    writeFileSync(csvPath, toCsv(plan.rows));
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          writes: false,
          totals: plan.totals,
          candidateReferenceKeys: plan.candidateReferenceKeys,
          confirmedReferenceFields: plan.confirmedReferenceFields,
          applicable: plan.applicable.length,
          planHash: plan.planHash,
          report: { json: jsonPath, csv: csvPath },
          nextStep:
            plan.applicable.length > 0
              ? `revisar o relatório e, com autorização, --apply --confirm=${plan.planHash} --authorized-by=<nome>`
              : "nada aplicável pela reconciliação (inferências ficam a cargo do sync; conflitos/ambíguos exigem revisão manual)",
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
