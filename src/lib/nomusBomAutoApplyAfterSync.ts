import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeAutoApplyReportForDisk } from "@/src/lib/nomusAutoApplyBomReportParser";
import { buildEngineeringValidationChecklistMarkdown } from "@/src/lib/nomusEngineeringValidationChecklist";
import {
  countDistinctParentCodesInStage,
  listDistinctParentCodesFromStage,
} from "@/src/lib/nomusBomComparisonLoad";
import {
  applyEffectiveBomToProductBom,
  buildControlledApplyPreview,
} from "@/src/lib/nomusBomControlledApply";
import { buildNomusUniverseCodeSet } from "@/src/lib/nomusBomUniverse";
import { prisma } from "@/src/lib/prisma";
import type {
  NomusBomAutoApplyMode,
  NomusBomAutoApplyProductResult,
  NomusBomAutoApplyProductStatus,
  NomusBomAutoApplyReport,
  NomusBomAutoApplyTotals,
} from "@/src/lib/nomusBomAutoApplyAfterSyncTypes";

export const NOMUS_AUTO_SYNC_APPROVED_BY = "nomus-auto-sync";
export const NOMUS_AUTO_SYNC_AUDIT_ORIGIN = "NOMUS_AUTO_SYNC_BOM_APPLY";
export const NOMUS_AUTO_SYNC_CHANGE_REASON =
  "Atualização automática após sincronização Nomus. Nomus é fonte de verdade para BOM controlada.";

const DEFAULT_PAGE_SIZE = 200;

export type RunNomusBomAutoApplyOptions = {
  mode: NomusBomAutoApplyMode;
  parentCode?: string;
  pageSize?: number;
  reportDir?: string;
  approvedBy?: string;
};

function stableBatchPlanHash(parentCodes: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify([...parentCodes].sort()))
    .digest("hex");
}

export function aggregateAutoApplyTotals(
  products: NomusBomAutoApplyProductResult[],
  parentsInNomusStage: number
): NomusBomAutoApplyTotals {
  const totals: NomusBomAutoApplyTotals = {
    parentsInNomusStage,
    parentsEvaluated: products.length,
    parentsApplied: 0,
    parentsNoChanges: 0,
    parentsBlocked: 0,
    parentsSkipped: 0,
    parentsErrored: 0,
    linesCreated: 0,
    linesUpdated: 0,
    linesRemoved: 0,
    linesKept: 0,
  };

  for (const p of products) {
    if (p.status === "APPLIED") totals.parentsApplied += 1;
    else if (p.status === "NO_CHANGES") totals.parentsNoChanges += 1;
    else if (p.status === "BLOCKED") totals.parentsBlocked += 1;
    else if (p.status === "SKIPPED") totals.parentsSkipped += 1;
    else if (p.status === "ERROR") totals.parentsErrored += 1;

    if (p.summary) {
      totals.linesCreated += p.summary.created;
      totals.linesUpdated += p.summary.updated;
      totals.linesRemoved += p.summary.removed;
      totals.linesKept += p.summary.kept;
    }
  }

  return totals;
}

export function buildAutoApplyReportMarkdown(report: NomusBomAutoApplyReport): string {
  const lines: string[] = [
    "# Relatório — Auto Apply BOM Nomus após Sync",
    "",
    `- **Gerado em:** ${report.generatedAt}`,
    `- **Modo:** ${report.mode}`,
    `- **Início:** ${report.startedAt}`,
    `- **Fim:** ${report.finishedAt}`,
    `- **Executado por:** ${report.approvedBy}`,
    `- **Batch run ID:** ${report.batchRunId ?? "—"}`,
    "",
    "## Totais",
    "",
    "| Métrica | Valor |",
    "|---|---:|",
    `| Produtos no stage Nomus | ${report.totals.parentsInNomusStage} |`,
    `| Produtos avaliados | ${report.totals.parentsEvaluated} |`,
    `| Produtos aplicados (com alteração) | ${report.totals.parentsApplied} |`,
    `| Produtos sem alteração | ${report.totals.parentsNoChanges} |`,
    `| Produtos bloqueados | ${report.totals.parentsBlocked} |`,
    `| Produtos ignorados | ${report.totals.parentsSkipped} |`,
    `| Produtos com erro | ${report.totals.parentsErrored} |`,
    `| Linhas criadas | ${report.totals.linesCreated} |`,
    `| Linhas atualizadas | ${report.totals.linesUpdated} |`,
    `| Linhas removidas | ${report.totals.linesRemoved} |`,
    `| Linhas preservadas | ${report.totals.linesKept} |`,
    "",
  ];

  const applied = report.products.filter((p) => p.status === "APPLIED" || p.status === "NO_CHANGES");
  const blocked = report.products.filter((p) => p.status === "BLOCKED");
  const errored = report.products.filter((p) => p.status === "ERROR");

  if (applied.length > 0) {
    lines.push("## Produtos aplicados / sem alteração", "");
    for (const p of applied) {
      lines.push(`### ${p.parentCode} — ${p.status}`);
      if (p.summary) {
        lines.push(
          `- created=${p.summary.created} updated=${p.summary.updated} removed=${p.summary.removed} kept=${p.summary.kept}`
        );
      }
      if (p.actionsPreview?.length) {
        for (const a of p.actionsPreview.filter((x) =>
          [
            "UPDATE_PRODUCT_BOM_QUANTITY",
            "UPDATE_PRODUCT_BOM_NOMUS_METADATA",
            "CREATE_PRODUCT_BOM_LINE",
            "REMOVE_PRODUCT_BOM_LINE",
          ].includes(x.actionType)
        )) {
          lines.push(
            `- \`${a.actionType}\` ${a.componentCode}: ${a.currentQuantity ?? "—"} → ${a.effectiveQuantity ?? "—"}`
          );
        }
      }
      lines.push("");
    }
  }

  if (blocked.length > 0) {
    lines.push("## Produtos bloqueados", "");
    for (const p of blocked) {
      lines.push(`### ${p.parentCode}`);
      for (const r of p.blockingReasons) lines.push(`- ${r}`);
      lines.push("");
    }
  }

  if (errored.length > 0) {
    lines.push("## Erros", "");
    for (const p of errored) {
      lines.push(`- **${p.parentCode}:** ${p.errorMessage ?? "erro desconhecido"}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function previewActionsSummary(
  preview: Awaited<ReturnType<typeof buildControlledApplyPreview>>
): NomusBomAutoApplyProductResult["actionsPreview"] {
  return preview.actions.map((a) => ({
    actionType: a.actionType,
    componentCode: a.componentCode,
    currentQuantity: a.currentQuantity ?? null,
    effectiveQuantity: a.effectiveQuantity ?? null,
  }));
}

function statusFromApplyResult(
  resultStatus: "APPLIED" | "NO_CHANGES"
): NomusBomAutoApplyProductStatus {
  return resultStatus === "NO_CHANGES" ? "NO_CHANGES" : "APPLIED";
}

async function listParentCodesToProcess(options: RunNomusBomAutoApplyOptions): Promise<string[]> {
  if (options.parentCode?.trim()) {
    return [options.parentCode.trim()];
  }

  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const total = await countDistinctParentCodesInStage();
  const codes: string[] = [];
  for (let offset = 0; offset < total; offset += pageSize) {
    const page = await listDistinctParentCodesFromStage({ limit: pageSize, offset });
    codes.push(...page);
  }
  return codes;
}

async function processOneProduct(
  parentCode: string,
  mode: NomusBomAutoApplyMode,
  approvedBy: string,
  nomusUniverse: ReadonlySet<string>
): Promise<NomusBomAutoApplyProductResult> {
  try {
    const preview = await buildControlledApplyPreview(parentCode, { nomusUniverse });

    const base: NomusBomAutoApplyProductResult = {
      parentCode: preview.parentCode,
      productId: preview.productId,
      status: "SKIPPED",
      canApply: preview.canApply,
      blockingReasons: preview.blockingReasons,
      actionsPreview: previewActionsSummary(preview),
    };

    if (!preview.productId) {
      return {
        ...base,
        status: "SKIPPED",
        blockingReasons: ["Produto não cadastrado no IndusCost."],
      };
    }

    if (!preview.canApply) {
      return {
        ...base,
        status: "BLOCKED",
      };
    }

    const hasMutations = preview.actions.some((a) =>
      [
        "CREATE_PRODUCT_BOM_LINE",
        "UPDATE_PRODUCT_BOM_QUANTITY",
        "UPDATE_PRODUCT_BOM_NOMUS_METADATA",
        "REMOVE_PRODUCT_BOM_LINE",
        "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES",
      ].includes(a.actionType)
    );

    if (mode === "DRY") {
      return {
        ...base,
        status: hasMutations ? "APPLIED" : "NO_CHANGES",
        resultStatus: hasMutations ? "APPLIED" : "NO_CHANGES",
        summary: {
          created: preview.actions.filter((a) => a.actionType === "CREATE_PRODUCT_BOM_LINE").length,
          updated: preview.actions.filter((a) =>
            [
              "UPDATE_PRODUCT_BOM_QUANTITY",
              "UPDATE_PRODUCT_BOM_NOMUS_METADATA",
              "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES",
            ].includes(a.actionType)
          ).length,
          removed: preview.actions.filter((a) => a.actionType === "REMOVE_PRODUCT_BOM_LINE").length,
          kept: preview.actions.filter((a) => a.actionType === "KEEP_PRODUCT_BOM_LINE").length,
          skipped: preview.actions.filter((a) => a.actionType === "SKIP_UNRESOLVED").length,
          blocked: preview.actions.filter((a) => a.actionType === "BLOCKED").length,
        },
      };
    }

    const result = await applyEffectiveBomToProductBom({
      parentCode: preview.parentCode,
      planHash: preview.planHash,
      confirmationText: preview.confirmationRequiredText,
      approvedBy,
      auditOrigin: NOMUS_AUTO_SYNC_AUDIT_ORIGIN,
    });

    const resultStatus =
      result.resultStatus === "NO_CHANGES" ? ("NO_CHANGES" as const) : ("APPLIED" as const);

    return {
      ...base,
      status: statusFromApplyResult(resultStatus),
      resultStatus,
      summary: result.summary,
      applyRunId: result.applyRunId,
    };
  } catch (err) {
    return {
      parentCode,
      productId: null,
      status: "ERROR",
      canApply: false,
      blockingReasons: [],
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function writeReportFiles(
  report: NomusBomAutoApplyReport,
  reportDir: string
): { mdPath: string; jsonPath: string } {
  mkdirSync(reportDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const mdPath = join(reportDir, `nomus-auto-sync-bom-apply-report-${stamp}.md`);
  const jsonPath = join(reportDir, `nomus-auto-sync-bom-apply-report-${stamp}.json`);
  writeFileSync(mdPath, buildAutoApplyReportMarkdown(report), "utf8");
  const serialized = `${JSON.stringify(serializeAutoApplyReportForDisk(report), null, 2)}\n`;
  writeFileSync(jsonPath, serialized, "utf8");

  const latestMd = join(reportDir, "nomus-auto-sync-bom-apply-report.md");
  const latestJson = join(reportDir, "nomus-auto-sync-bom-apply-report.json");
  writeFileSync(latestMd, buildAutoApplyReportMarkdown(report), "utf8");
  writeFileSync(latestJson, serialized, "utf8");

  const checklistMd = buildEngineeringValidationChecklistMarkdown({
    generatedAt: report.generatedAt,
    totals: report.totals,
    products: report.products,
  });
  writeFileSync(join(reportDir, "nomus-engineering-validation-checklist.md"), checklistMd, "utf8");

  return { mdPath, jsonPath };
}

export async function runNomusBomAutoApplyAfterSync(
  options: RunNomusBomAutoApplyOptions
): Promise<NomusBomAutoApplyReport> {
  const startedAt = new Date().toISOString();
  const approvedBy = options.approvedBy?.trim() || NOMUS_AUTO_SYNC_APPROVED_BY;
  const reportDir = options.reportDir ?? join(process.cwd(), "docs", "generated");

  const parentCodes = await listParentCodesToProcess(options);
  const parentsInNomusStage = options.parentCode?.trim()
    ? parentCodes.length
    : await countDistinctParentCodesInStage();

  const batchPlanHash = stableBatchPlanHash(parentCodes);
  let batchRunId: string | null = null;

  if (options.mode === "APPLY") {
    const batchRun = await prisma.engineeringSyncRun.create({
      data: {
        mode: "ALL_NOMUS_PRODUCTS",
        status: "PREVIEWED",
        planHash: batchPlanHash,
        confirmationText: NOMUS_AUTO_SYNC_CHANGE_REASON,
        approvedBy,
        startedAt: new Date(startedAt),
        summaryJson: {
          origin: "NOMUS_SYNC",
          mode: "AUTO_BOM_APPLY_BATCH",
          parentsScheduled: parentCodes.length,
          reason: NOMUS_AUTO_SYNC_CHANGE_REASON,
        } as never,
      },
      select: { id: true },
    });
    batchRunId = batchRun.id;
  }

  const products: NomusBomAutoApplyProductResult[] = [];
  const nomusUniverse = await buildNomusUniverseCodeSet();
  for (const parentCode of parentCodes) {
    const result = await processOneProduct(parentCode, options.mode, approvedBy, nomusUniverse);
    products.push(result);
  }

  const finishedAt = new Date().toISOString();
  const totals = aggregateAutoApplyTotals(products, parentsInNomusStage);

  let reportMdPath: string | null = null;
  let reportJsonPath: string | null = null;

  const report: NomusBomAutoApplyReport = {
    generatedAt: finishedAt,
    mode: options.mode,
    startedAt,
    finishedAt,
    approvedBy,
    batchRunId,
    reportMdPath: null,
    reportJsonPath: null,
    totals,
    products,
  };

  const paths = writeReportFiles(report, reportDir);
  reportMdPath = paths.mdPath;
  reportJsonPath = paths.jsonPath;
  report.reportMdPath = reportMdPath;
  report.reportJsonPath = reportJsonPath;

  if (batchRunId) {
    const batchStatus =
      totals.parentsErrored > 0 && totals.parentsApplied + totals.parentsNoChanges > 0
        ? "PARTIAL"
        : totals.parentsErrored > 0
          ? "FAILED"
          : "APPLIED";

    await prisma.engineeringSyncRun.update({
      where: { id: batchRunId },
      data: {
        status: batchStatus,
        finishedAt: new Date(finishedAt),
        summaryJson: {
          origin: "NOMUS_SYNC",
          mode: "AUTO_BOM_APPLY_BATCH",
          reason: NOMUS_AUTO_SYNC_CHANGE_REASON,
          totals,
          reportMdPath,
          reportJsonPath,
        } as never,
      },
    });
  }

  return report;
}
