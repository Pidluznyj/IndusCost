/**
 * Geração CLI/API do Relatório Analisável — reutiliza os mesmos services do botão.
 * Read-only; não altera dados produtivos.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import type {
  DiagnosticFinding,
  DiagnosticRedactionReport,
  DiagnosticScope,
} from "./chatgptDiagnosticTypes.js";
import {
  type BuildDiagnosticBundleInput,
  type BuildDiagnosticBundleResult,
  assertRequiredBundleStructure,
  buildAndWriteDiagnosticBundle,
} from "./diagnosticBundleBuilder.server.js";
import { buildCommissionReceiptClosingDiagnosticBundleInput } from "./commissionDiagnostic.server.js";
import { buildCostToCashDiagnosticBundleInput } from "./costToCashDiagnostic.server.js";
import { buildPublishedPriceDiagnosticBundleInput } from "./pricingDiagnostic.server.js";
import { buildProductEngineeringDiagnosticBundleInput } from "./productEngineeringDiagnostic.server.js";
import { buildSystemDiagnosticBundleInput } from "./systemDiagnostic.server.js";
import { assertBundleContainsNoForbiddenSecrets } from "./sanitizeDiagnosticPayload.server.js";

export const CHATGPT_DIAGNOSTIC_REPORT_SCOPES: DiagnosticScope[] = [
  "SYSTEM",
  "PRODUCT_ENGINEERING",
  "PUBLISHED_PRICE",
  "SALES_ORDER",
  "COMMISSION_RECEIPT_CLOSING",
  "COST_TO_CASH",
];

export type ChatGptDiagnosticReportStatus = "PASS" | "WARNING" | "ERROR";

export type ChatGptDiagnosticReportCliArgs = {
  scope: DiagnosticScope;
  sku?: string | null;
  productId?: string | null;
  tableCode?: string | null;
  priceItemId?: string | null;
  priceTableVersionId?: string | null;
  salesOrderId?: string | null;
  orderNumber?: string | null;
  nfeNumber?: string | null;
  receivableCode?: string | null;
  year?: number | null;
  month?: number | null;
  seller?: string | null;
  customer?: string | null;
  includeLogs: boolean;
  includeApiTrace: boolean;
  outputDir?: string | null;
  jsonSummary: boolean;
};

export type ChatGptDiagnosticReportSummary = {
  ok: true;
  scope: DiagnosticScope;
  status: ChatGptDiagnosticReportStatus;
  bundleId: string;
  generatedAt: string;
  zipPath: string;
  outputDir: string;
  fileCount: number;
  findingCount: number;
  findingsBySeverity: Record<string, number>;
  redactedFieldsCount: number;
  redactedPatterns: string[];
  filesSanitizedCount: number;
  gitWorkingTreeClean: boolean;
  readOnly: true;
  scopeHints?: Record<string, unknown>;
};

export type ChatGptDiagnosticReportResult = {
  result: BuildDiagnosticBundleResult;
  summary: ChatGptDiagnosticReportSummary;
};

const SCOPES_REQUIRING_DATABASE: DiagnosticScope[] = [
  "PRODUCT_ENGINEERING",
  "PUBLISHED_PRICE",
  "COMMISSION_RECEIPT_CLOSING",
  "COST_TO_CASH",
];

function parseArgValue(argv: string[], name: string): string | null {
  const prefix = `--${name}=`;
  for (const arg of argv) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim() || null;
  }
  return null;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function parseOptionalInt(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

export function parseChatGptDiagnosticReportCliArgs(
  argv: string[] = process.argv.slice(2)
): ChatGptDiagnosticReportCliArgs {
  const scopeRaw = parseArgValue(argv, "scope")?.toUpperCase() ?? "SYSTEM";
  if (!CHATGPT_DIAGNOSTIC_REPORT_SCOPES.includes(scopeRaw as DiagnosticScope)) {
    throw new Error(
      `Escopo inválido: ${scopeRaw}. Use: ${CHATGPT_DIAGNOSTIC_REPORT_SCOPES.join(", ")}`
    );
  }

  const year = parseOptionalInt(parseArgValue(argv, "year"));
  const month = parseOptionalInt(parseArgValue(argv, "month"));
  if (parseArgValue(argv, "year") && year == null) {
    throw new Error("--year inválido.");
  }
  if (parseArgValue(argv, "month") && month == null) {
    throw new Error("--month inválido (1-12).");
  }
  if (month != null && (month < 1 || month > 12)) {
    throw new Error("--month inválido (1-12).");
  }

  return {
    scope: scopeRaw as DiagnosticScope,
    sku: parseArgValue(argv, "sku"),
    productId: parseArgValue(argv, "product-id"),
    tableCode: parseArgValue(argv, "table-code"),
    priceItemId: parseArgValue(argv, "price-item-id"),
    priceTableVersionId: parseArgValue(argv, "price-table-version-id"),
    salesOrderId: parseArgValue(argv, "sales-order-id"),
    orderNumber: parseArgValue(argv, "order-number"),
    nfeNumber: parseArgValue(argv, "nfe-number"),
    receivableCode: parseArgValue(argv, "receivable-code"),
    year,
    month,
    seller: parseArgValue(argv, "seller"),
    customer: parseArgValue(argv, "customer"),
    includeLogs: !hasFlag(argv, "no-include-logs") && parseArgValue(argv, "include-logs") !== "false",
    includeApiTrace:
      !hasFlag(argv, "no-include-api-trace") &&
      parseArgValue(argv, "include-api-trace") !== "false",
    outputDir: parseArgValue(argv, "output-dir"),
    jsonSummary: hasFlag(argv, "json-summary") || parseArgValue(argv, "json-summary") === "true",
  };
}

export function resolveDiagnosticReportStatus(
  findings: DiagnosticFinding[]
): ChatGptDiagnosticReportStatus {
  if (findings.some((f) => f.severity === "error" || f.severity === "critical")) {
    return "ERROR";
  }
  if (findings.some((f) => f.severity === "warning")) {
    return "WARNING";
  }
  return "PASS";
}

export function isGitWorkingTreeClean(): boolean {
  try {
    const out = execSync("git status --porcelain", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return out.trim().length === 0;
  } catch {
    return false;
  }
}

function applyCliPresentationOptions(
  input: BuildDiagnosticBundleInput,
  args: ChatGptDiagnosticReportCliArgs
): BuildDiagnosticBundleInput {
  const context = input.context ?? { scope: input.scope };
  return {
    ...input,
    logs: args.includeLogs ? input.logs : [],
    context: {
      ...context,
      apiCalls: args.includeApiTrace ? (context.apiCalls ?? []) : [],
      notes: [context.notes, "Gerado via CLI read-only (generate-chatgpt-diagnostic-report)."]
        .filter(Boolean)
        .join(" "),
    },
  };
}

export function scopeRequiresDatabase(scope: DiagnosticScope): boolean {
  return SCOPES_REQUIRING_DATABASE.includes(scope);
}

export async function buildChatGptDiagnosticReportBundleInput(
  db: PrismaClient | null,
  args: ChatGptDiagnosticReportCliArgs
): Promise<BuildDiagnosticBundleInput> {
  const { scope } = args;

  if (scopeRequiresDatabase(scope) && !db) {
    throw new Error(`DATABASE_URL ausente — configure .env para ${scope}.`);
  }

  switch (scope) {
    case "SYSTEM": {
      return buildSystemDiagnosticBundleInput(db, {
        screenTitle: "Gerar Relatório Analisável",
        screenRoute: "/settings/diagnostic-bundle",
        notes: "Gerado via CLI read-only.",
      });
    }
    case "PRODUCT_ENGINEERING": {
      if (!args.sku && !args.productId) {
        throw new Error("Informe --sku ou --product-id para PRODUCT_ENGINEERING.");
      }
      return buildProductEngineeringDiagnosticBundleInput(db!, {
        sku: args.sku,
        productId: args.productId,
        screenTitle: "Engenharia de Produto",
        screenRoute: "/products/engineering",
      });
    }
    case "PUBLISHED_PRICE": {
      if (!args.priceItemId && !args.sku && !args.productId) {
        throw new Error(
          "Informe --price-item-id ou --sku (com --table-code) para PUBLISHED_PRICE."
        );
      }
      return buildPublishedPriceDiagnosticBundleInput(db!, {
        sku: args.sku,
        productId: args.productId,
        tableCode: args.tableCode,
        priceItemId: args.priceItemId,
        priceTableVersionId: args.priceTableVersionId,
        screenTitle: "Formação de Preço",
        screenRoute: "/pricing",
      });
    }
    case "COMMISSION_RECEIPT_CLOSING": {
      if (args.year == null || args.month == null) {
        throw new Error("Informe --year e --month para COMMISSION_RECEIPT_CLOSING.");
      }
      return buildCommissionReceiptClosingDiagnosticBundleInput(db!, {
        year: args.year,
        month: args.month,
        seller: args.seller,
        customer: args.customer,
        screenTitle: "Fechamento por Recebimento",
        screenRoute: "/commissions/receipt-closing",
      });
    }
    case "COST_TO_CASH": {
      if (
        !args.sku &&
        !args.productId &&
        !args.priceItemId &&
        !args.salesOrderId &&
        !args.orderNumber &&
        !args.nfeNumber &&
        !args.receivableCode &&
        !(args.customer && args.year != null)
      ) {
        throw new Error(
          "Informe --sku, --order-number, --nfe-number, --receivable-code ou --customer com --year para COST_TO_CASH."
        );
      }
      return buildCostToCashDiagnosticBundleInput(db!, {
        sku: args.sku,
        productId: args.productId,
        tableCode: args.tableCode,
        priceItemId: args.priceItemId,
        salesOrderId: args.salesOrderId,
        orderNumber: args.orderNumber,
        nfeNumber: args.nfeNumber,
        receivableCode: args.receivableCode,
        year: args.year,
        month: args.month,
        seller: args.seller,
        customer: args.customer,
        screenTitle: "Rastreabilidade Custo → Caixa",
        screenRoute: "/reports/cost-to-cash-trace",
      });
    }
    case "SALES_ORDER":
      return {
        scope: "SALES_ORDER",
        context: {
          scope: "SALES_ORDER",
          screenTitle: "Pedido / Venda",
          screenRoute: "/sales/orders",
          filters: {
            salesOrderId: args.salesOrderId,
            orderNumber: args.orderNumber,
            nfeNumber: args.nfeNumber,
          },
          notes: "Escopo SALES_ORDER — bundle mínimo via CLI.",
        },
      };
    default:
      throw new Error(`Escopo não suportado: ${scope}`);
  }
}

function countFindingsBySeverity(
  findings: DiagnosticFinding[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  return counts;
}

function readRedactionReport(bundle: BuildDiagnosticBundleResult["bundle"]): DiagnosticRedactionReport {
  const raw = bundle.entries["15_REDACTION_REPORT.json"];
  if (!raw) {
    return {
      redactedFieldsCount: 0,
      redactedPatterns: [],
      filesSanitized: [],
      warnings: [],
    };
  }
  return JSON.parse(raw) as DiagnosticRedactionReport;
}

function buildScopeHints(
  scope: DiagnosticScope,
  args: ChatGptDiagnosticReportCliArgs,
  bundle: BuildDiagnosticBundleResult["bundle"]
): Record<string, unknown> | undefined {
  switch (scope) {
    case "PRODUCT_ENGINEERING": {
      const evidence = JSON.parse(bundle.entries["evidence/product-cost-trace.json"] ?? "{}");
      return {
        sku: evidence.product?.sku ?? args.sku,
        warningStatus: evidence.cost?.warningStatus,
      };
    }
    case "PUBLISHED_PRICE": {
      const evidence = JSON.parse(bundle.entries["evidence/published-price-trace.json"] ?? "{}");
      return {
        sku: evidence.product?.sku ?? args.sku,
        tableCode: evidence.commercialTable?.tableCode ?? args.tableCode,
        salePrice: evidence.price?.salePrice ?? evidence.trace?.commercialPrice?.salePrice,
        costUsed: evidence.price?.costUsed ?? evidence.trace?.costSource?.industrialCost,
      };
    }
    case "COMMISSION_RECEIPT_CLOSING": {
      const evidence = JSON.parse(bundle.entries["evidence/commission-trace.json"] ?? "{}");
      return {
        previewOk: evidence.capture?.ok,
        errorClassification: evidence.capture?.error?.classification,
        uniqueReceivedTotal: evidence.uniqueReceivedTotal,
      };
    }
    case "COST_TO_CASH": {
      const timeline = JSON.parse(bundle.entries["evidence/cost-to-cash-timeline.json"] ?? "{}");
      const raw = JSON.parse(
        bundle.entries["evidence/raw-limited/cost-to-cash-summary.json"] ?? "{}"
      );
      return {
        sku: raw.sku ?? args.sku,
        completedSteps: raw.completedSteps ?? timeline.timeline?.completedSteps,
        totalSteps: raw.totalSteps ?? timeline.timeline?.totalSteps,
        chainBreakDescription: raw.chainBreakDescription ?? timeline.chainBreakDescription,
        diagnosticCodes: raw.diagnosticCodes ?? [],
      };
    }
    case "SYSTEM": {
      const snapshot = JSON.parse(bundle.entries["06_SYSTEM_SNAPSHOT.json"] ?? "{}");
      return {
        commit: snapshot.git?.commit ?? snapshot.app?.commit,
        branch: snapshot.git?.branch,
        pendingMigrations: snapshot.database?.pendingCount,
      };
    }
    default:
      return undefined;
  }
}

export function buildChatGptDiagnosticReportSummary(
  args: ChatGptDiagnosticReportCliArgs,
  writeResult: BuildDiagnosticBundleResult
): ChatGptDiagnosticReportSummary {
  const findings = (
    JSON.parse(writeResult.bundle.entries["04_DIAGNOSTICS.json"] ?? '{"findings":[]}') as {
      findings: DiagnosticFinding[];
    }
  ).findings;

  const redaction = readRedactionReport(writeResult.bundle);

  return {
    ok: true,
    scope: args.scope,
    status: resolveDiagnosticReportStatus(findings),
    bundleId: writeResult.bundle.manifest.bundleId,
    generatedAt: writeResult.bundle.manifest.generatedAt,
    zipPath: writeResult.zipPath.replace(/\\/g, "/"),
    outputDir: writeResult.outputDir.replace(/\\/g, "/"),
    fileCount: writeResult.bundle.manifest.files.length,
    findingCount: findings.length,
    findingsBySeverity: countFindingsBySeverity(findings),
    redactedFieldsCount: redaction.redactedFieldsCount,
    redactedPatterns: redaction.redactedPatterns,
    filesSanitizedCount: redaction.filesSanitized.length,
    gitWorkingTreeClean: isGitWorkingTreeClean(),
    readOnly: true,
    scopeHints: buildScopeHints(args.scope, args, writeResult.bundle),
  };
}

export function assertChatGptDiagnosticReportBundleValid(
  writeResult: BuildDiagnosticBundleResult
): void {
  assertRequiredBundleStructure(writeResult.bundle);

  for (const [path, content] of Object.entries(writeResult.bundle.entries)) {
    if (path.endsWith(".json")) {
      JSON.parse(content);
    }
    if (path.endsWith(".gitkeep")) continue;
    assertBundleContainsNoForbiddenSecrets(content);
  }

  if (!existsSync(writeResult.zipPath)) {
    throw new Error(`ZIP não encontrado: ${writeResult.zipPath}`);
  }
}

export async function generateChatGptDiagnosticReport(
  db: PrismaClient | null,
  args: ChatGptDiagnosticReportCliArgs
): Promise<ChatGptDiagnosticReportResult> {
  const rawInput = await buildChatGptDiagnosticReportBundleInput(db, args);
  const input = applyCliPresentationOptions(rawInput, args);

  const result = await buildAndWriteDiagnosticBundle(input, {
    outputDir: args.outputDir,
  });

  assertChatGptDiagnosticReportBundleValid(result);

  const summary = buildChatGptDiagnosticReportSummary(args, result);
  return { result, summary };
}

export function formatChatGptDiagnosticReportHumanSummary(
  summary: ChatGptDiagnosticReportSummary
): string {
  const lines = [
    "=== ChatGPT Analyzable Diagnostic Report ===",
    `Escopo: ${summary.scope}`,
    `Status: ${summary.status}`,
    `Bundle ID: ${summary.bundleId}`,
    `ZIP: ${summary.zipPath}`,
    `Pasta: ${summary.outputDir}`,
    `Arquivos: ${summary.fileCount}`,
    `Findings: ${summary.findingCount}`,
    `Redactions: ${summary.redactedFieldsCount} campo(s) em ${summary.filesSanitizedCount} arquivo(s)`,
    `Git limpo: ${summary.gitWorkingTreeClean ? "sim" : "não"}`,
  ];

  if (summary.scopeHints && Object.keys(summary.scopeHints).length > 0) {
    lines.push("", "Resumo do escopo:");
    for (const [key, value] of Object.entries(summary.scopeHints)) {
      lines.push(`  ${key}: ${value ?? "—"}`);
    }
  }

  return lines.join("\n");
}

export function printChatGptDiagnosticReportResult(
  report: ChatGptDiagnosticReportResult,
  args: ChatGptDiagnosticReportCliArgs
): void {
  if (args.jsonSummary) {
    console.log(JSON.stringify(report.summary, null, 2));
    return;
  }
  console.log(formatChatGptDiagnosticReportHumanSummary(report.summary));
}
