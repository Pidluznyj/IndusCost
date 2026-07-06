/**
 * Escopo COMMISSION_RECEIPT_CLOSING — relatório analisável para Fechamento por Recebimento.
 * Read-only; captura preview, erros Prisma/API e diagnósticos de materialização.
 */
import type { PrismaClient } from "@prisma/client";
import { getReceiptClosingPreviewPage } from "../commissions/commissionReceiptClosingApi.server.js";
import type {
  ReceiptClosingApiLine,
  ReceiptClosingPagePayload,
} from "../commissions/commissionReceiptClosingApi.js";
import {
  markReceivableReceivedAnchors,
} from "../commissions/commissionReceiptClosingApi.js";
import type { CommissionReceiptPreviewLine } from "../commissions/commissionReceiptEngine.js";
import {
  detectDuplicateReceived,
} from "../commissions/commissionNomusReceiptReconciliation.js";
import { roundMoney } from "../commissions/commission-money.js";
import type {
  DiagnosticFinding,
  DiagnosticFindingSeverity,
  DiagnosticScopeContext,
  DiagnosticSourceRef,
} from "./chatgptDiagnosticTypes.js";
import {
  type BuildDiagnosticBundleInput,
  type BuildDiagnosticBundleResult,
  buildAndWriteDiagnosticBundle,
} from "./diagnosticBundleBuilder.server.js";
import {
  createDiagnosticSourceRef,
  createSourcedValue,
} from "./diagnosticSourceRefs.server.js";
import {
  sanitizeDiagnosticError,
  sanitizeDiagnosticLogLines,
  sanitizeDiagnosticText,
} from "./sanitizeDiagnosticPayload.server.js";

export type CommissionReceiptClosingDiagnosticContext = {
  year: number;
  month: number;
  seller?: string | null;
  customer?: string | null;
  nomusBase?: number | null;
  nomusCommission?: number | null;
  errorMessage?: string | null;
  screenRoute?: string | null;
  screenTitle?: string | null;
  userId?: string | null;
  userEmail?: string | null;
};

export type CommissionReceiptClosingDiagnosticRequest = {
  scope: "COMMISSION_RECEIPT_CLOSING";
  context: CommissionReceiptClosingDiagnosticContext;
};

export type CommissionAutoDiagnostic = {
  code: string;
  severity: DiagnosticFindingSeverity;
  title: string;
  message: string;
  hypothesis?: string | null;
};

export class CommissionReceiptClosingDiagnosticValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommissionReceiptClosingDiagnosticValidationError";
  }
}

const COMMISSION_SCREEN_ROUTE = "/commissions/receipt-closing";
const PREVIEW_API_PATH = "/api/commissions/receipt-closing/preview";

export type CommissionPreviewCapture = {
  ok: boolean;
  preview: ReceiptClosingPagePayload | null;
  error: {
    name: string;
    message: string;
    classification: string;
    sanitized: Record<string, unknown>;
  } | null;
  apiTrace: {
    method: string;
    path: string;
    query: Record<string, string | number>;
    status: number | null;
    durationMs: number | null;
    errorMessage: string | null;
  };
  generatedAt: string;
};

export function parseCommissionReceiptClosingDiagnosticRequest(
  body: unknown
): CommissionReceiptClosingDiagnosticRequest {
  if (!body || typeof body !== "object") {
    throw new CommissionReceiptClosingDiagnosticValidationError("Corpo JSON inválido.");
  }
  const raw = body as Record<string, unknown>;
  const scope = String(raw.scope ?? "").trim().toUpperCase();
  if (scope !== "COMMISSION_RECEIPT_CLOSING") {
    throw new CommissionReceiptClosingDiagnosticValidationError(
      'scope deve ser "COMMISSION_RECEIPT_CLOSING".'
    );
  }
  const ctxRaw = raw.context;
  if (!ctxRaw || typeof ctxRaw !== "object") {
    throw new CommissionReceiptClosingDiagnosticValidationError("context é obrigatório.");
  }
  const ctx = ctxRaw as Record<string, unknown>;
  const year = Number(ctx.year);
  const month = Number(ctx.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new CommissionReceiptClosingDiagnosticValidationError("context.year inválido.");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new CommissionReceiptClosingDiagnosticValidationError("context.month inválido (1-12).");
  }

  return {
    scope: "COMMISSION_RECEIPT_CLOSING",
    context: {
      year,
      month,
      seller: typeof ctx.seller === "string" ? ctx.seller.trim() || null : null,
      customer: typeof ctx.customer === "string" ? ctx.customer.trim() || null : null,
      nomusBase: ctx.nomusBase != null ? Number(ctx.nomusBase) : null,
      nomusCommission: ctx.nomusCommission != null ? Number(ctx.nomusCommission) : null,
      errorMessage:
        typeof ctx.errorMessage === "string" ? ctx.errorMessage.trim() || null : null,
      screenRoute:
        typeof ctx.screenRoute === "string" ? ctx.screenRoute.trim() || null : null,
      screenTitle:
        typeof ctx.screenTitle === "string" ? ctx.screenTitle.trim() || null : null,
      userId: typeof ctx.userId === "string" ? ctx.userId.trim() || null : null,
      userEmail: typeof ctx.userEmail === "string" ? ctx.userEmail.trim() || null : null,
    },
  };
}

function sourceRef(
  input: Omit<DiagnosticSourceRef, "path"> & { path: string }
): DiagnosticSourceRef {
  return createDiagnosticSourceRef(input);
}

export function classifyCommissionPreviewError(error: unknown): {
  code: string;
  severity: DiagnosticFindingSeverity;
  title: string;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "Error";

  if (/Unknown field `.+` for select statement on model/.test(message)) {
    return {
      code: "UNKNOWN_FIELD_IN_SELECT",
      severity: "critical",
      title: "Campo Prisma inválido no select",
      message,
    };
  }
  if (
    name === "PrismaClientValidationError" ||
    /Invalid `.+` invocation/.test(message) ||
    /Argument `.+` is missing/.test(message)
  ) {
    return {
      code: "PRISMA_VALIDATION_ERROR",
      severity: "critical",
      title: "Erro de validação Prisma",
      message,
    };
  }
  return {
    code: "API_500_ERROR",
    severity: "critical",
    title: "Erro na prévia de fechamento",
    message,
  };
}

export async function captureCommissionReceiptClosingPreview(
  context: CommissionReceiptClosingDiagnosticContext
): Promise<CommissionPreviewCapture> {
  const generatedAt = new Date().toISOString();
  const query: Record<string, string | number> = {
    year: context.year,
    month: context.month,
  };
  if (context.seller) query.seller = context.seller;
  if (context.customer) query.customer = context.customer;

  const started = Date.now();
  try {
    const preview = await getReceiptClosingPreviewPage({
      year: context.year,
      month: context.month,
      seller: context.seller ?? null,
      customer: context.customer ?? null,
      nomusBase: context.nomusBase ?? null,
      nomusCommission: context.nomusCommission ?? null,
      includeExcluded: true,
      includeExceptions: true,
    });
    return {
      ok: true,
      preview,
      error: null,
      apiTrace: {
        method: "GET",
        path: PREVIEW_API_PATH,
        query,
        status: 200,
        durationMs: Date.now() - started,
        errorMessage: null,
      },
      generatedAt,
    };
  } catch (error) {
    const classified = classifyCommissionPreviewError(error);
    const sanitized = sanitizeDiagnosticError(error);
    return {
      ok: false,
      preview: null,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: classified.message,
        classification: classified.code,
        sanitized,
      },
      apiTrace: {
        method: "GET",
        path: PREVIEW_API_PATH,
        query,
        status: 500,
        durationMs: Date.now() - started,
        errorMessage: classified.message,
      },
      generatedAt,
    };
  }
}

export function sumUniqueReceivedFromLines(lines: ReceiptClosingApiLine[]): number {
  const anchored = markReceivableReceivedAnchors(lines);
  return roundMoney(anchored.reduce((sum, line) => roundMoney(sum + line.uniqueReceivedAmount), 0));
}

export function countUniqueReceivables(lines: ReceiptClosingApiLine[]): number {
  const seen = new Set<number>();
  for (const line of lines) {
    if (line.nomusReceivableId != null) seen.add(line.nomusReceivableId);
  }
  return seen.size;
}

function previewLinesFromApi(lines: ReceiptClosingApiLine[]): CommissionReceiptPreviewLine[] {
  return lines.map((line) => ({
    year: 0,
    month: 0,
    nomusReceivableId: line.nomusReceivableId ?? 0,
    receivableNumber: line.receivableNumber,
    installmentNumber: line.installmentNumber,
    settlementDate: line.settlementDate,
    dueDate: line.dueDate,
    receivableAmount: line.receivedAmount,
    receivedAmount: line.receivedAmount,
    receivedSharePercent: line.receivedAmount > 0 ? 100 : 0,
    customerExternalId: line.customerExternalId,
    customerId: line.customerId,
    customerName: line.customerName,
    nomusNfeId: line.nomusNfeId,
    nfeNumber: line.nfeNumber,
    orderCode: line.orderCode,
    localOrderId: line.localOrderId,
    nomusOrderItemId: line.nomusOrderItemId,
    localItemId: line.localItemId,
    productCode: line.productCode,
    productName: line.productName,
    rawSellerId: line.rawSellerId,
    rawSellerName: line.rawSellerName,
    canonicalSellerId: line.canonicalSellerId,
    canonicalSellerName: line.canonicalSellerName,
    sellerResolutionStatus: line.sellerResolutionStatus,
    commissionRecordId: null,
    commissionPaymentScheduleId: null,
    commissionReceivableScheduleId: line.commissionReceivableScheduleId,
    ruleId: line.ruleId,
    ruleName: line.ruleName,
    ratePercent: line.ratePercent,
    commissionableBaseAmount: line.commissionableBaseAmount,
    expectedCommissionAmount: line.expectedCommissionAmount,
    releasedCommissionAmount: line.releasedCommissionAmount,
    grossCommissionAmount: line.grossCommissionAmount,
    status: line.status,
    statusReason: line.statusReason,
    exclusionRuleId: null,
    exclusionReason: line.exclusionReason,
    source: line.source,
  }));
}

export function evaluateCommissionAutoDiagnostics(input: {
  capture: CommissionPreviewCapture;
  preview: ReceiptClosingPagePayload | null;
}): CommissionAutoDiagnostic[] {
  const diagnostics: CommissionAutoDiagnostic[] = [];
  const push = (diag: CommissionAutoDiagnostic) => {
    if (!diagnostics.some((d) => d.code === diag.code)) diagnostics.push(diag);
  };

  if (!input.capture.ok && input.capture.error) {
    push({
      code: input.capture.error.classification,
      severity: "critical",
      title: input.capture.error.classification.replace(/_/g, " "),
      message: input.capture.error.message,
      hypothesis:
        input.capture.error.classification === "UNKNOWN_FIELD_IN_SELECT"
          ? "Query Prisma referencia campo inexistente no schema (ex.: exclusionRuleId removido do model)."
          : "Preview GET falhou — UI retorna 500.",
    });
    return diagnostics;
  }

  const preview = input.preview;
  if (!preview) return diagnostics;

  push({
    code: "PREVIEW_OK",
    severity: "info",
    title: "Prévia executada com sucesso",
    message: `Modo ${preview.mode} — ${preview.lines.length} linha(s) de comissão.`,
  });

  const summary = preview.materializationSummary;
  if (summary.receivablesWithoutScheduleCount > 0) {
    push({
      code: "NO_SCHEDULE",
      severity: "warning",
      title: "Títulos sem schedule materializado",
      message: `${summary.receivablesWithoutScheduleCount} título(s) recebido(s) sem CommissionReceivableSchedule.`,
      hypothesis: "Status auditável NO_SCHEDULE — não é erro fatal da API.",
    });
  }

  if (summary.staleScheduleCount > 0) {
    push({
      code: "STALE_SCHEDULE",
      severity: "warning",
      title: "Schedules desatualizados",
      message: `${summary.staleScheduleCount} título(s) com schedule stale.`,
    });
  }

  if (summary.excludedCustomerCount > 0) {
    push({
      code: "CUSTOMER_EXCLUDED",
      severity: "info",
      title: "Clientes excluídos",
      message: `${summary.excludedCustomerCount} cliente(s)/título(s) com CUSTOMER_EXCLUDED — comissão final zero, base preservada.`,
    });
  }

  if (summary.sellerUnresolvedCount > 0) {
    push({
      code: "SELLER_UNRESOLVED",
      severity: "warning",
      title: "Vendedor não resolvido",
      message: `${summary.sellerUnresolvedCount} título(s) com vendedor não resolvido.`,
    });
  }

  const noRuleCount = preview.summary.countByStatus?.NO_RULE ?? 0;
  if (noRuleCount > 0) {
    push({
      code: "NO_RULE",
      severity: "warning",
      title: "Regra de comissão ausente",
      message: `${noRuleCount} linha(s) com status NO_RULE.`,
    });
  }

  const duplicates = detectDuplicateReceived(previewLinesFromApi(preview.lines));
  if (duplicates.length > 0) {
    push({
      code: "RECEIPT_DUPLICATED_BY_ITEM",
      severity: "warning",
      title: "Recebido duplicado por item",
      message: `${duplicates.length} título(s) com mesmo valor recebido repetido em múltiplas linhas — usar soma por receivable único.`,
      hypothesis: "markReceivableReceivedAnchors zera uniqueReceivedAmount nas linhas duplicadas.",
    });
  }

  const partialCount = preview.lines.filter(
    (line) =>
      line.nomusReceivableId != null &&
      line.receivedAmount > 0 &&
      line.commissionableBaseAmount > 0 &&
      line.releasedCommissionAmount < line.expectedCommissionAmount * 0.999 &&
      line.status === "COMMISSIONABLE"
  ).length;
  if (partialCount > 0) {
    push({
      code: "PARTIAL_RECEIPT",
      severity: "info",
      title: "Baixa parcial detectada",
      message: `${partialCount} linha(s) com comissão liberada menor que esperada (baixa parcial).`,
    });
  }

  const recon = preview.reconciliation;
  if (recon.nomusCommission != null && recon.diffCommissionFinal != null) {
    if (recon.diffExplanation?.trim()) {
      push({
        code: "NOMUS_DIFF_EXPLAINED",
        severity: "info",
        title: "Diferença Nomus explicada",
        message: recon.diffExplanation,
      });
    } else if (Math.abs(recon.diffCommissionFinal) > 0.01) {
      push({
        code: "NOMUS_DIFF_UNEXPLAINED",
        severity: "warning",
        title: "Diferença Nomus não explicada",
        message: `Diff comissão final: ${recon.diffCommissionFinal.toFixed(2)}`,
      });
    }
  }

  return diagnostics;
}

export function buildCommissionFindings(
  autoDiagnostics: CommissionAutoDiagnostic[],
  capture: CommissionPreviewCapture
): DiagnosticFinding[] {
  return autoDiagnostics.map((diag, index) => ({
    id: `cr_finding_${String(index + 1).padStart(3, "0")}`,
    severity: diag.severity,
    code: diag.code,
    title: diag.title,
    message: diag.message,
    businessImpact:
      diag.code === "API_500_ERROR" || diag.code === "UNKNOWN_FIELD_IN_SELECT"
        ? "Tela de fechamento por recebimento indisponível."
        : diag.code === "NO_SCHEDULE"
          ? "Comissão não liberada até materialização do schedule."
          : "Impacto na apuração/comissão do período.",
    technicalImpact: diag.hypothesis ?? diag.message,
    evidenceRefs: [
      "evidence/commission-trace.json",
      "08_API_TRACE.json",
      "09_DATABASE_EVIDENCE.json",
    ],
    sourceRefs: [
      sourceRef({
        type: "service",
        name: "getReceiptClosingPreviewPage",
        path: "08_API_TRACE.json#/preview",
        field: diag.code,
      }),
    ],
    suggestedNextSteps: buildCommissionSuggestedSteps(diag.code, capture),
  }));
}

function buildCommissionSuggestedSteps(code: string, capture: CommissionPreviewCapture): string[] {
  switch (code) {
    case "UNKNOWN_FIELD_IN_SELECT":
    case "PRISMA_VALIDATION_ERROR":
      return [
        "Corrigir select Prisma em commissionReceiptEngine.server.ts",
        "Rodar npm run test:commissions",
        "Regenerar bundle COMMISSION_RECEIPT_CLOSING",
      ];
    case "NO_SCHEDULE":
      return [
        "Materializar CommissionReceivableSchedule para títulos pendentes",
        "npx tsx scripts/validate-commission-receipt-closing.ts --year=... --month=...",
      ];
    case "RECEIPT_DUPLICATED_BY_ITEM":
      return [
        "Somar recebido por nomusReceivableId único (uniqueReceivedAmount)",
        "Verificar detectDuplicateReceived no relatório",
      ];
    default:
      return [
        `GET ${PREVIEW_API_PATH}?year=${capture.apiTrace.query.year}&month=${capture.apiTrace.query.month}`,
        "Anexar ZIP ao ChatGPT",
      ];
  }
}

export function buildCommissionExecutiveSummaryMarkdown(input: {
  context: CommissionReceiptClosingDiagnosticContext;
  capture: CommissionPreviewCapture;
  preview: ReceiptClosingPagePayload | null;
  autoDiagnostics: CommissionAutoDiagnostic[];
}): string {
  const { context, capture, preview, autoDiagnostics } = input;
  const filters = {
    year: context.year,
    month: context.month,
    seller: context.seller ?? null,
    customer: context.customer ?? null,
    generatedAt: capture.generatedAt,
  };

  const previewFailed = !capture.ok;
  const technicalError = capture.error?.message ?? "—";
  const uniqueReceived = preview ? sumUniqueReceivedFromLines(preview.lines) : 0;
  const uniqueTitles = preview ? countUniqueReceivables(preview.lines) : 0;
  const cards = preview?.cards;
  const problems = autoDiagnostics
    .filter((d) => d.severity !== "info")
    .map((d) => `- **${d.code}**: ${d.message}`)
    .join("\n");

  return `# Resumo Executivo — Fechamento por Recebimento

## Filtros

| Campo | Valor |
| --- | --- |
| Ano | ${filters.year} |
| Mês | ${filters.month} |
| Vendedor | ${filters.seller ?? "—"} |
| Cliente | ${filters.customer ?? "—"} |
| Gerado em | ${filters.generatedAt} |

## 1. A prévia quebrou ou rodou?

**${previewFailed ? "Quebrou" : "Rodou"}** — status HTTP ${capture.apiTrace.status ?? "—"} em \`${PREVIEW_API_PATH}\`.

## 2. Se quebrou, qual erro técnico?

${previewFailed ? `\`${capture.error?.classification ?? "—"}\`: ${technicalError}` : "Nenhum — prévia OK."}

## 3. Quantos títulos foram analisados?

${uniqueTitles} título(s) recebível(is) únicos (${preview?.lines.length ?? 0} linhas de item).

## 4. Quanto foi recebido único?

**${uniqueReceived.toFixed(2)}** (soma por receivable único — \`uniqueReceivedAmount\`, não duplica por item).

## 5. Quanto gerou comissão?

| Métrica | Valor |
| --- | --- |
| Base comissionável | ${cards?.commissionableBaseAmount?.toFixed(2) ?? "—"} |
| Comissão bruta | ${cards?.grossCommissionAmount?.toFixed(2) ?? "—"} |
| Comissão excluída | ${cards?.excludedCommissionAmount?.toFixed(2) ?? "—"} |
| Comissão final | ${cards?.finalCommissionAmount?.toFixed(2) ?? "—"} |
| Comissão liberada | ${cards?.finalCommissionAmount?.toFixed(2) ?? preview?.summary.totalReleasedCommission?.toFixed(2) ?? "—"} |

## 6. Quanto foi excluído?

${cards?.excludedCommissionAmount?.toFixed(2) ?? preview?.summary.totalExcludedAmount?.toFixed(2) ?? "—"} — clientes excluídos: ${preview?.materializationSummary.excludedCustomerCount ?? 0}.

## 7. Quais os maiores problemas?

${problems || "- Nenhum alerta além de PREVIEW_OK."}

## 8. O que fazer primeiro?

${buildCommissionSuggestedSteps(autoDiagnostics[0]?.code ?? "PREVIEW_OK", capture)
  .map((s) => `- ${s}`)
  .join("\n")}

## Regra crítica

Valor recebido soma por **título/receivable único**, não por linha de item (\`markReceivableReceivedAnchors\`).
`;
}

export function buildCommissionProblemContextMarkdown(
  context: CommissionReceiptClosingDiagnosticContext,
  capture: CommissionPreviewCapture
): string {
  return `# Contexto — Comissões / Fechamento por Recebimento

## Filtros

\`\`\`json
${JSON.stringify(
  {
    year: context.year,
    month: context.month,
    seller: context.seller ?? null,
    customer: context.customer ?? null,
  },
  null,
  2
)}
\`\`\`

## Erro reportado em produção (referência)

\`GET /api/commissions/receipt-closing/preview?year=2026&month=6\`  
Exemplo: \`Unknown field exclusionRuleId for select statement on model CommissionOrderItemSnapshot\`.

## Captura deste bundle

- Preview OK: **${capture.ok ? "sim" : "não"}**
- Classificação: **${capture.error?.classification ?? "PREVIEW_OK"}**
- Duração API: ${capture.apiTrace.durationMs ?? "—"} ms

## Regra de negócio

Venda calcula comissão → condição de pagamento distribui → recebimento libera → fechamento congela.
`;
}

export function buildCommissionDatabaseEvidence(
  capture: CommissionPreviewCapture,
  preview: ReceiptClosingPagePayload | null
): Record<string, unknown> {
  return {
    scope: "COMMISSION_RECEIPT_CLOSING",
    readOnly: true,
    filters: capture.apiTrace.query,
    previewOk: capture.ok,
    summary: preview
      ? createSourcedValue(
          {
            totalReceivedUnique: sumUniqueReceivedFromLines(preview.lines),
            uniqueReceivableCount: countUniqueReceivables(preview.lines),
            commissionableBase: preview.cards.commissionableBaseAmount,
            grossCommission: preview.cards.grossCommissionAmount,
            excludedCommission: preview.cards.excludedCommissionAmount,
            finalCommission: preview.cards.finalCommissionAmount,
            receivablesWithSchedule: preview.materializationSummary.receivablesWithScheduleCount,
            receivablesWithoutSchedule:
              preview.materializationSummary.receivablesWithoutScheduleCount,
            excludedCustomers: preview.materializationSummary.excludedCustomerCount,
            sellerUnresolved: preview.materializationSummary.sellerUnresolvedCount,
          },
          {
            type: "service",
            name: "getReceiptClosingPreviewPage",
            path: "09_DATABASE_EVIDENCE.json#/summary",
          }
        )
      : null,
    error: capture.error,
    entities: {
      CommissionOrderItemSnapshot: "snapshot da venda por item",
      CommissionReceivableSchedule: "schedule por título/recebível",
      CommissionReceiptLedgerLine: "ledger após fechamento congelado",
    },
  };
}

export function buildCommissionCalculationTrace(
  preview: ReceiptClosingPagePayload | null,
  capture: CommissionPreviewCapture
): Record<string, unknown> {
  if (!preview) {
    return {
      mode: "read-only",
      previewFailed: true,
      error: capture.error,
      note: "Sem trace de cálculo — preview não executou.",
    };
  }

  const anchored = markReceivableReceivedAnchors(preview.lines);
  const scheduleLines = anchored
    .filter((l) => l.commissionReceivableScheduleId)
    .slice(0, 50)
    .map((l) => ({
      receivableId: l.nomusReceivableId,
      receivableCode: l.receivableNumber,
      scheduleId: l.commissionReceivableScheduleId,
      orderCode: l.orderCode,
      sku: l.productCode,
      soldAmount: l.commissionableBaseAmount,
      ratePercent: l.ratePercent,
      scheduledCommission: l.scheduledCommissionAmount,
      status: l.status,
    }));

  const receiptLines = anchored.slice(0, 50).map((l) => ({
    receivableId: l.nomusReceivableId,
    settlementDate: l.settlementDate,
    receivedAmount: l.receivedAmount,
    uniqueReceivedAmount: l.uniqueReceivedAmount,
    releasedCommission: l.releasedCommissionAmount,
    pendingCommission: roundMoney(
      Math.max(0, (l.expectedCommissionAmount ?? 0) - l.releasedCommissionAmount)
    ),
    status: l.status,
    partial: l.releasedCommissionAmount < (l.expectedCommissionAmount ?? 0) * 0.999,
  }));

  return {
    mode: "read-only",
    recalculatedInFrontend: false,
    previewFailed: false,
    businessFlow: "Venda → Schedule → Recebimento → Fechamento",
    uniqueReceivedTotal: sumUniqueReceivedFromLines(preview.lines),
    duplicateDetection: detectDuplicateReceived(previewLinesFromApi(preview.lines)),
    schedules: scheduleLines,
    receipts: receiptLines,
    nomusReconciliation: preview.reconciliation,
    countByStatus: preview.summary.countByStatus,
  };
}

export function buildCommissionEvidencePayload(
  capture: CommissionPreviewCapture,
  preview: ReceiptClosingPagePayload | null,
  autoDiagnostics: CommissionAutoDiagnostic[]
): Record<string, unknown> {
  const limitedLines = preview?.lines.slice(0, 100) ?? [];
  return {
    scope: "COMMISSION_RECEIPT_CLOSING",
    generatedBy: "buildCommissionReceiptClosingDiagnosticBundle",
    readOnly: true,
    capture: {
      ok: capture.ok,
      generatedAt: capture.generatedAt,
      apiTrace: capture.apiTrace,
      error: capture.error,
    },
    preview: preview
      ? {
          mode: preview.mode,
          year: preview.year,
          month: preview.month,
          cards: preview.cards,
          materializationSummary: preview.materializationSummary,
          reconciliation: preview.reconciliation,
          summary: preview.summary,
          lineCount: preview.lines.length,
          linesSample: limitedLines,
        }
      : null,
    autoDiagnostics,
    uniqueReceivedTotal: preview ? sumUniqueReceivedFromLines(preview.lines) : null,
    sourceRefs: [
      sourceRef({
        type: "service",
        name: "getReceiptClosingPreviewPage",
        path: "evidence/commission-trace.json",
      }),
    ],
  };
}

export function buildCommissionBusinessRulesMarkdown(
  preview: ReceiptClosingPagePayload | null
): string {
  return `# Regras de Negócio — Fechamento por Recebimento

- Escopo: **COMMISSION_RECEIPT_CLOSING**
- **Venda** materializa \`CommissionOrderItemSnapshot\` (comissão por item).
- **Condição de pagamento** distribui via \`CommissionReceivableSchedule\`.
- **Recebimento** libera comissão proporcional ao título baixado.
- **Fechamento** congela ledger — imutável após CLOSED.

## Status auditáveis (não são erro 500)

| Status | Significado |
| --- | --- |
| NO_SCHEDULE | Título recebido sem schedule materializado |
| CUSTOMER_EXCLUDED | Cliente excluído — comissão final zero |
| SELLER_UNRESOLVED | Vendedor Nomus não mapeado |
| NO_RULE | Item sem regra de comissão |
| STALE_SCHEDULE | Schedule desatualizado vs snapshot |

## Regra crítica — recebido único

\`markReceivableReceivedAnchors\`: primeira linha do receivable mantém \`uniqueReceivedAmount\`; demais linhas do mesmo título = 0.

## Comparação Nomus

Exclusões internas separadas antes de comparar totais (\`buildNomusReceiptReconciliationReport\`).

Período analisado: ${preview ? `${preview.month}/${preview.year}` : "—"}.
`;
}

export async function buildCommissionReceiptClosingDiagnosticBundleInput(
  _db: PrismaClient,
  context: CommissionReceiptClosingDiagnosticContext
): Promise<BuildDiagnosticBundleInput> {
  const capture = await captureCommissionReceiptClosingPreview(context);
  const preview = capture.preview;
  const autoDiagnostics = evaluateCommissionAutoDiagnostics({ capture, preview });
  const findings = buildCommissionFindings(autoDiagnostics, capture);

  const scopeContext: DiagnosticScopeContext = {
    scope: "COMMISSION_RECEIPT_CLOSING",
    screenRoute: context.screenRoute ?? COMMISSION_SCREEN_ROUTE,
    screenTitle: context.screenTitle ?? "Fechamento por Recebimento",
    filters: {
      year: context.year,
      month: context.month,
      seller: context.seller ?? null,
      customer: context.customer ?? null,
    },
    errorMessage: context.errorMessage ?? capture.error?.message ?? null,
    apiCalls: [
      {
        method: capture.apiTrace.method,
        path: capture.apiTrace.path,
        status: capture.apiTrace.status,
        durationMs: capture.apiTrace.durationMs,
      },
    ],
    notes: "Bundle COMMISSION_RECEIPT_CLOSING — preview read-only.",
  };

  const logLines = [
    `[commission-closing] year=${context.year} month=${context.month} seller=${context.seller ?? "—"}`,
    `[commission-closing] previewOk=${capture.ok} status=${capture.apiTrace.status}`,
  ];
  if (capture.error) {
    logLines.push(`[commission-closing] error=${capture.error.classification}: ${capture.error.message}`);
    if (capture.error.sanitized.stack) {
      logLines.push(String(capture.error.sanitized.stack).split("\n")[0] ?? "");
    }
  }
  if (preview) {
    logLines.push(
      `[commission-closing] uniqueReceived=${sumUniqueReceivedFromLines(preview.lines)} titles=${countUniqueReceivables(preview.lines)}`
    );
    logLines.push(
      `[commission-closing] finalCommission=${preview.cards.finalCommissionAmount} excluded=${preview.materializationSummary.excludedCustomerCount}`
    );
  }

  return {
    scope: "COMMISSION_RECEIPT_CLOSING",
    context: scopeContext,
    findings,
    evidence: [
      {
        id: "evidence_commission_trace",
        scope: "COMMISSION_RECEIPT_CLOSING",
        label: "Fechamento por recebimento — preview e materialização",
        bundlePath: "evidence/commission-trace.json",
        payload: buildCommissionEvidencePayload(capture, preview, autoDiagnostics),
      },
    ],
    executiveSummaryMarkdown: buildCommissionExecutiveSummaryMarkdown({
      context,
      capture,
      preview,
      autoDiagnostics,
    }),
    problemContextMarkdown: buildCommissionProblemContextMarkdown(context, capture),
    databaseEvidence: buildCommissionDatabaseEvidence(capture, preview),
    calculationTrace: buildCommissionCalculationTrace(preview, capture),
    businessRulesMarkdown: buildCommissionBusinessRulesMarkdown(preview),
    logs: logLines,
    rawLimitedEvidence: {
      year: context.year,
      month: context.month,
      previewOk: capture.ok,
      errorClassification: capture.error?.classification ?? null,
      uniqueReceived: preview ? sumUniqueReceivedFromLines(preview.lines) : null,
      diagnosticCodes: autoDiagnostics.map((d) => d.code),
    },
    reproductionCommands: [
      {
        label: "Gerar bundle COMMISSION_RECEIPT_CLOSING",
        command: `npx tsx scripts/generate-diagnostic-bundle.ts --scope=COMMISSION_RECEIPT_CLOSING --year=${context.year} --month=${context.month}`,
        note: "Read-only; grava em tmp/diagnostic-bundles/",
      },
      {
        label: "Validar fechamento (CLI)",
        command: `npx tsx scripts/validate-commission-receipt-closing.ts --year=${context.year} --month=${context.month} --json`,
      },
      {
        label: "Preview API",
        command: `GET ${PREVIEW_API_PATH}?year=${context.year}&month=${context.month}`,
      },
    ],
    systemSnapshot: {
      scope: "COMMISSION_RECEIPT_CLOSING",
      auditServicesUsed: ["getReceiptClosingPreviewPage", "loadCommissionReceiptPreview"],
      previewOk: capture.ok,
      errorClassification: capture.error?.classification ?? null,
    },
  };
}

export async function buildAndWriteCommissionReceiptClosingDiagnosticBundle(
  db: PrismaClient,
  context: CommissionReceiptClosingDiagnosticContext
): Promise<BuildDiagnosticBundleResult> {
  const input = await buildCommissionReceiptClosingDiagnosticBundleInput(db, context);
  return buildAndWriteDiagnosticBundle(input);
}

/** Converte erro Prisma conhecido para diagnóstico (testável sem DB). */
export function diagnoseKnownPrismaSelectError(message: string): CommissionAutoDiagnostic | null {
  const classified = classifyCommissionPreviewError(new Error(message));
  if (classified.code !== "UNKNOWN_FIELD_IN_SELECT") return null;
  return {
    code: classified.code,
    severity: classified.severity,
    title: classified.title,
    message: classified.message,
    hypothesis: "Campo removido do schema ainda referenciado em select Prisma.",
  };
}

export { sanitizeDiagnosticText, sanitizeDiagnosticLogLines };
