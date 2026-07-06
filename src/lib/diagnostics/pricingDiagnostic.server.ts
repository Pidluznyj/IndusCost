/**
 * Escopo PUBLISHED_PRICE — relatório analisável para Formação de Preço / Preço Publicado.
 * Read-only; usa snapshots congelados — não recalcula preço publicado.
 */
import type { PrismaClient } from "@prisma/client";
import { startOfCivilDate } from "../financeCivilDate.js";
import { buildPublishedPriceTrace } from "../audit/costToCashTrace.server.js";
import { resolvePublishedPriceItemIdForTrace } from "../audit/costToCashTraceResolve.server.js";
import type { PublishedPriceTrace } from "../audit/publishedPriceTrace.js";
import {
  PUBLISHED_TRACE_NEWER_COST_WARNING,
  PUBLISHED_TRACE_UNAVAILABLE_LABEL,
} from "../audit/publishedPriceTrace.js";
import { getEffectiveProductProductionCost } from "../productionCostTables.server.js";
import { hasProductionCostDifference } from "../productEngineeringCostWarning.js";
import type {
  DiagnosticEvidence,
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

export type PublishedPriceDiagnosticContext = {
  sku?: string | null;
  productId?: string | null;
  tableCode?: string | null;
  tableId?: string | null;
  priceItemId?: string | null;
  priceTableVersionId?: string | null;
  referenceDate?: Date;
  errorMessage?: string | null;
  screenRoute?: string | null;
  screenTitle?: string | null;
  userId?: string | null;
  userEmail?: string | null;
};

export type PublishedPriceDiagnosticRequest = {
  scope: "PUBLISHED_PRICE";
  context: PublishedPriceDiagnosticContext;
};

export type PublishedPriceAutoDiagnostic = {
  code: string;
  severity: DiagnosticFindingSeverity;
  title: string;
  message: string;
  hypothesis?: string | null;
};

export class PublishedPriceDiagnosticValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishedPriceDiagnosticValidationError";
  }
}

const PUBLISHED_PRICE_SCREEN_ROUTE = "/pricing";
const READ_ONLY_NOTE =
  "Valores lidos de snapshots congelados na publicação — sem recálculo silencioso.";

export function parsePublishedPriceDiagnosticRequest(
  body: unknown
): PublishedPriceDiagnosticRequest {
  if (!body || typeof body !== "object") {
    throw new PublishedPriceDiagnosticValidationError("Corpo JSON inválido.");
  }
  const raw = body as Record<string, unknown>;
  const scope = String(raw.scope ?? "").trim().toUpperCase();
  if (scope !== "PUBLISHED_PRICE") {
    throw new PublishedPriceDiagnosticValidationError('scope deve ser "PUBLISHED_PRICE".');
  }
  const ctxRaw = raw.context;
  if (!ctxRaw || typeof ctxRaw !== "object") {
    throw new PublishedPriceDiagnosticValidationError("context é obrigatório.");
  }
  const ctx = ctxRaw as Record<string, unknown>;
  const sku = typeof ctx.sku === "string" ? ctx.sku.trim() || null : null;
  const productId = typeof ctx.productId === "string" ? ctx.productId.trim() || null : null;
  const priceItemId = typeof ctx.priceItemId === "string" ? ctx.priceItemId.trim() || null : null;
  const tableCode = typeof ctx.tableCode === "string" ? ctx.tableCode.trim() || null : null;
  const tableId = typeof ctx.tableId === "string" ? ctx.tableId.trim() || null : null;
  const priceTableVersionId =
    typeof ctx.priceTableVersionId === "string" ? ctx.priceTableVersionId.trim() || null : null;

  if (!priceItemId && !sku && !productId) {
    throw new PublishedPriceDiagnosticValidationError(
      "Informe context.priceItemId ou context.sku (com tableCode) ou context.productId."
    );
  }

  return {
    scope: "PUBLISHED_PRICE",
    context: {
      sku,
      productId,
      tableCode,
      tableId,
      priceItemId,
      priceTableVersionId,
      referenceDate:
        typeof ctx.referenceDate === "string" && ctx.referenceDate.trim()
          ? startOfCivilDate(new Date(ctx.referenceDate))
          : undefined,
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

function fmtMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(6);
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return PUBLISHED_TRACE_UNAVAILABLE_LABEL;
  return `${value.toFixed(4)}%`;
}

export type PublishedPriceCostComparison = {
  costUsedInPrice: number | null;
  currentOfficialCost: number | null;
  currentOfficialVersionCode: string | null;
  currentOfficialRevision: number | null;
  differenceFromCurrentOfficial: number | null;
  priceUsesLatestOfficial: boolean | null;
};

export async function loadCurrentOfficialCostForProduct(
  db: PrismaClient,
  productId: string,
  referenceDate: Date
): Promise<PublishedPriceCostComparison["currentOfficialCost"] extends infer _T
  ? {
      unitProductionCost: number | null;
      versionId: string | null;
      versionCode: string | null;
      revision: number | null;
    }
  : never> {
  const effective = await getEffectiveProductProductionCost(db, productId, referenceDate);
  if (effective.status !== "OK") {
    return { unitProductionCost: null, versionId: null, versionCode: null, revision: null };
  }
  return {
    unitProductionCost: effective.unitProductionCost,
    versionId: effective.costTableVersionId,
    versionCode: effective.versionCode,
    revision: effective.revision,
  };
}

export function buildPublishedPriceCostComparison(
  trace: PublishedPriceTrace,
  currentOfficial: {
    unitProductionCost: number | null;
    versionId: string | null;
    versionCode: string | null;
    revision: number | null;
  }
): PublishedPriceCostComparison {
  const costUsed = trace.costSource.industrialCost;
  const current = currentOfficial.unitProductionCost;
  const diff =
    costUsed != null && current != null
      ? Math.round((current - costUsed) * 1_000_000) / 1_000_000
      : null;
  const priceVersionId = trace.costSource.productionCostTableVersionId;
  const priceUsesLatest =
    priceVersionId != null && currentOfficial.versionId != null
      ? priceVersionId === currentOfficial.versionId
      : current != null && costUsed != null
        ? !hasProductionCostDifference(current, costUsed)
        : null;

  return {
    costUsedInPrice: costUsed,
    currentOfficialCost: current,
    currentOfficialVersionCode: currentOfficial.versionCode,
    currentOfficialRevision: currentOfficial.revision,
    differenceFromCurrentOfficial: diff,
    priceUsesLatestOfficial: priceUsesLatest,
  };
}

export function evaluatePublishedPriceAutoDiagnostics(
  trace: PublishedPriceTrace,
  costComparison: PublishedPriceCostComparison
): PublishedPriceAutoDiagnostic[] {
  const diagnostics: PublishedPriceAutoDiagnostic[] = [];
  const push = (diag: PublishedPriceAutoDiagnostic) => {
    if (!diagnostics.some((d) => d.code === diag.code)) diagnostics.push(diag);
  };

  if (
    trace.costSource.status === "NOT_AVAILABLE" ||
    !trace.costSource.productionCostTableVersionId
  ) {
    push({
      code: "ERROR_MISSING_COST_SOURCE",
      severity: "error",
      title: "Fonte de custo ausente",
      message: "Preço publicado sem vínculo claro com ProductionCostTableVersion/Item.",
    });
  }

  if (trace.taxSource.status === "NOT_AVAILABLE" || (!trace.taxSource.taxRuleId && trace.taxSource.taxAmount == null)) {
    push({
      code: "ERROR_MISSING_TAX_SOURCE",
      severity: "error",
      title: "Fonte fiscal ausente",
      message: "Regra fiscal ou valor de imposto não disponível no snapshot publicado.",
    });
  }

  if (!trace.availability.hasFullSnapshot || trace.availability.missingFields.length > 0) {
    push({
      code: "LEGACY_PRICE_WITH_INCOMPLETE_SNAPSHOT",
      severity: "warning",
      title: "Snapshot incompleto",
      message: `Campos ausentes: ${trace.availability.missingFields.join(", ") || "—"}`,
      hypothesis: "Publicação anterior à captura completa de costSnapshotJson/formulaSnapshotJson.",
    });
  }

  if (trace.costSource.newerPublishedVersionWarning) {
    push({
      code: "WARNING_NEWER_COST_EXISTS",
      severity: "warning",
      title: "Custo mais recente disponível",
      message: trace.costSource.newerPublishedVersionWarning,
      hypothesis:
        "Existe revisão PUBLISHED mais nova da tabela de custo — preço congelado pode estar desatualizado.",
    });
  } else if (
    costComparison.currentOfficialCost != null &&
    costComparison.costUsedInPrice != null &&
    hasProductionCostDifference(costComparison.currentOfficialCost, costComparison.costUsedInPrice) &&
    costComparison.priceUsesLatestOfficial === false
  ) {
    push({
      code: "WARNING_NEWER_COST_EXISTS",
      severity: "warning",
      title: "Custo oficial vigente difere do usado no preço",
      message: `Custo no preço: ${fmtMoney(costComparison.costUsedInPrice)}; oficial vigente: ${fmtMoney(costComparison.currentOfficialCost)}.`,
      hypothesis: "Custo industrial publicado na tabela de produção avançou desde a formação deste preço.",
    });
  }

  if (
    trace.costSource.productionCostItemId &&
    trace.costSource.industrialCost != null &&
    costComparison.currentOfficialCost != null &&
    trace.costSource.productionCostTableVersionId !== null &&
    costComparison.priceUsesLatestOfficial === false &&
    hasProductionCostDifference(trace.costSource.industrialCost, costComparison.currentOfficialCost)
  ) {
    push({
      code: "ERROR_PRICE_COST_DIFFERS_FROM_SOURCE",
      severity: "error",
      title: "Custo do preço diverge da fonte vigente",
      message: `Preço congelou ${fmtMoney(trace.costSource.industrialCost)} mas custo oficial atual é ${fmtMoney(costComparison.currentOfficialCost)}.`,
    });
  }

  const hasErrors = diagnostics.some((d) => d.severity === "error");
  if (
    !hasErrors &&
    trace.costSource.status !== "NOT_AVAILABLE" &&
    trace.costSource.industrialCost != null
  ) {
    push({
      code: "OK_PRICE_USES_PUBLISHED_COST",
      severity: "info",
      title: "Preço usa custo publicado congelado",
      message: `Custo industrial ${fmtMoney(trace.costSource.industrialCost)} lido do snapshot (${READ_ONLY_NOTE})`,
    });
  }

  return diagnostics;
}

export function buildPublishedPriceFindings(
  trace: PublishedPriceTrace,
  autoDiagnostics: PublishedPriceAutoDiagnostic[]
): DiagnosticFinding[] {
  const sku = trace.product.sku;
  const table = trace.commercialPrice.tableCode;
  return autoDiagnostics.map((diag, index) => ({
    id: `pp_finding_${String(index + 1).padStart(3, "0")}`,
    severity: diag.severity,
    code: diag.code,
    title: diag.title,
    message: diag.message,
    businessImpact:
      diag.code === "WARNING_NEWER_COST_EXISTS"
        ? "Margem comercial pode estar calculada sobre custo industrial antigo."
        : diag.code === "LEGACY_PRICE_WITH_INCOMPLETE_SNAPSHOT"
          ? "Fonte do Preço pode exibir campos indisponíveis na UI."
          : diag.code === "ERROR_MISSING_COST_SOURCE" || diag.code === "ERROR_MISSING_TAX_SOURCE"
            ? "Rastreabilidade incompleta — auditoria de formação de preço comprometida."
            : "Verificar coerência entre preço publicado e custo oficial.",
    technicalImpact: diag.hypothesis ?? `Diagnóstico automático SKU ${sku} tabela ${table}.`,
    evidenceRefs: [
      "evidence/published-price-trace.json",
      "09_DATABASE_EVIDENCE.json",
      "10_CALCULATION_TRACE.json",
    ],
    sourceRefs: [
      sourceRef({
        type: "service",
        name: "buildPublishedPriceTrace",
        path: "evidence/published-price-trace.json",
        recordId: trace.commercialPrice.priceItemId,
        field: diag.code,
      }),
    ],
    suggestedNextSteps: buildPublishedPriceSuggestedSteps(diag.code, trace),
  }));
}

function buildPublishedPriceSuggestedSteps(code: string, trace: PublishedPriceTrace): string[] {
  switch (code) {
    case "WARNING_NEWER_COST_EXISTS":
      return [
        "Gerar nova DRAFT de preço com custo industrial vigente",
        "Republicar versão da tabela comercial após validar margem",
        `Conferir aba Fonte do Preço para ${trace.commercialPrice.tableCode}`,
      ];
    case "LEGACY_PRICE_WITH_INCOMPLETE_SNAPSHOT":
      return [
        "Republicar item com snapshots completos (costSnapshotJson + formulaSnapshotJson)",
        "Evitar recalcular — republicar via fluxo oficial de formação de preço",
      ];
    case "ERROR_MISSING_COST_SOURCE":
    case "ERROR_MISSING_TAX_SOURCE":
      return [
        "Verificar PriceTableItem snapshots e vínculo ProductionCostTableVersion",
        "Republicar preço após corrigir dados de origem",
      ];
    default:
      return [
        `npx tsx scripts/audit-published-price-trace.ts --sku=${trace.product.sku} --table-code=${trace.commercialPrice.tableCode} --json`,
        "Anexar ZIP ao ChatGPT para análise da formação de preço",
      ];
  }
}

export function buildPublishedPriceExecutiveSummaryMarkdown(
  trace: PublishedPriceTrace,
  costComparison: PublishedPriceCostComparison,
  autoDiagnostics: PublishedPriceAutoDiagnostic[]
): string {
  const unavailable = trace.availability.missingFields.length
    ? trace.availability.missingFields.join(", ")
    : "Nenhum";

  const coherent =
    autoDiagnostics.some((d) => d.code === "ERROR_PRICE_COST_DIFFERS_FROM_SOURCE") ||
    autoDiagnostics.some((d) => d.code === "ERROR_MISSING_COST_SOURCE")
      ? "Não — inconsistências detectadas"
      : autoDiagnostics.some((d) => d.code === "WARNING_NEWER_COST_EXISTS")
        ? "Parcial — preço válido na publicação, mas custo mais novo existe"
        : "Sim — custo congelado coerente com fonte publicada";

  return `# Resumo Executivo — Preço Publicado

## 1. Qual preço foi analisado?

| Campo | Valor |
| --- | --- |
| SKU | ${trace.product.sku} |
| Produto | ${trace.product.name} |
| Tabela | ${trace.commercialPrice.tableCode} (${trace.commercialPrice.tableName}) |
| Versão comercial | ${trace.commercialPrice.versionNumber} |
| priceItemId | ${trace.commercialPrice.priceItemId} |
| Preço publicado | ${fmtMoney(trace.commercialPrice.salePrice)} |
| Publicado em | ${trace.commercialPrice.publishedAt ?? "—"} |
| Vigência | ${trace.commercialPrice.effectiveFrom ?? "—"} → ${trace.commercialPrice.effectiveTo ?? "—"} |

## 2. Qual custo ele usou?

| Campo | Valor |
| --- | --- |
| Custo industrial congelado | ${fmtMoney(trace.costSource.industrialCost)} |
| MP no preço | ${fmtMoney(trace.costSource.materialCostInPrice)} |
| HH no preço | ${fmtMoney(trace.costSource.laborCostInPrice)} |
| HM no preço | ${fmtMoney(trace.costSource.machineCostInPrice)} |
| Modo | **Somente leitura de snapshot** — sem recálculo |

## 3. Qual tabela/versão de custo?

| Campo | Valor |
| --- | --- |
| ProductionCostTableVersion | ${trace.costSource.productionCostTableCode ?? "—"} rev.${trace.costSource.productionCostRevision ?? "—"} |
| productionCostItemId | ${trace.costSource.productionCostItemId ?? "—"} |
| Vigência custo | ${trace.costSource.productionCostEffectiveFrom ?? "—"} |
| Tabela MP | ${trace.materialSource.materialCostTableCode ?? "—"} rev.${trace.materialSource.materialCostRevision ?? "—"} |

## 4. Qual margem/comissão/imposto?

| Campo | Valor |
| --- | --- |
| Margem publicada | ${fmtPct(trace.marginSource.publishedMarginPercent)} |
| Markup | ${trace.marginSource.markup ?? PUBLISHED_TRACE_UNAVAILABLE_LABEL} |
| Comissão % | ${fmtPct(trace.commissionSource.commissionPercent)} |
| Comissão R$ | ${fmtMoney(trace.commissionSource.commissionAmount)} |
| Imposto % | ${fmtPct(trace.taxSource.taxPercent)} |
| Imposto R$ | ${fmtMoney(trace.taxSource.taxAmount)} |
| Regra fiscal | ${trace.taxSource.taxRuleName ?? PUBLISHED_TRACE_UNAVAILABLE_LABEL} |
| Frete | ${fmtMoney(trace.deductions.freightAmount)} |
| Outras deduções | ${fmtMoney(trace.deductions.otherVariablesAmount)} |

## 5. Existe custo mais novo?

| Campo | Valor |
| --- | --- |
| Custo oficial vigente hoje | ${fmtMoney(costComparison.currentOfficialCost)} (${costComparison.currentOfficialVersionCode ?? "—"} rev.${costComparison.currentOfficialRevision ?? "—"}) |
| Diferença vs preço | ${fmtMoney(costComparison.differenceFromCurrentOfficial)} |
| Preço usa última revisão? | ${costComparison.priceUsesLatestOfficial === true ? "Sim" : costComparison.priceUsesLatestOfficial === false ? "Não" : "—"} |
| Aviso trace | ${trace.costSource.newerPublishedVersionWarning ?? "—"} |

## 6. O preço está coerente?

**${coherent}**

## 7. Quais campos estão indisponíveis?

${unavailable}

## Alertas automáticos

${
  autoDiagnostics.length
    ? autoDiagnostics.map((d) => `- **${d.code}** (${d.severity}): ${d.message}`).join("\n")
    : "- Nenhum"
}
`;
}

export function buildPublishedPriceProblemContextMarkdown(
  context: PublishedPriceDiagnosticContext,
  trace: PublishedPriceTrace
): string {
  return `# Contexto do Problema — Preço Publicado

## Identificação

\`\`\`json
${JSON.stringify(
  {
    sku: context.sku ?? trace.product.sku,
    productId: context.productId ?? trace.product.productId,
    tableCode: context.tableCode ?? trace.commercialPrice.tableCode,
    priceItemId: context.priceItemId ?? trace.commercialPrice.priceItemId,
    priceTableVersionId: context.priceTableVersionId ?? trace.commercialPrice.versionId,
  },
  null,
  2
)}
\`\`\`

## Regra deste pacote

${READ_ONLY_NOTE}

Qualquer valor marcado como **diagnóstico** em \`10_CALCULATION_TRACE.json\` não substitui o preço publicado.

## Snapshot

| Verificação | Resultado |
| --- | --- |
| Snapshot completo | ${trace.availability.hasFullSnapshot ? "sim" : "não"} |
| costSnapshotJson | ${trace.availability.missingFields.includes("costSnapshotJson") ? "ausente" : "presente"} |
| formulaSnapshotJson | ${trace.availability.missingFields.includes("formulaSnapshotJson") ? "ausente" : "presente"} |
| Fonte custo produção | ${trace.costSource.productionCostTableVersionId ? "vinculada" : "ausente"} |
| Fonte fiscal | ${trace.taxSource.taxRuleId ? trace.taxSource.taxRuleName ?? trace.taxSource.taxRuleId : "ausente"} |
`;
}

export function buildPublishedPriceDatabaseEvidence(
  trace: PublishedPriceTrace,
  costComparison: PublishedPriceCostComparison
): Record<string, unknown> {
  const priceItemId = trace.commercialPrice.priceItemId;
  return {
    scope: "PUBLISHED_PRICE",
    readOnly: true,
    recalculated: false,
    product: {
      productId: createSourcedValue(trace.product.productId, {
        type: "database",
        name: "Product",
        path: "09_DATABASE_EVIDENCE.json#/product/productId",
        table: "Product",
        recordId: trace.product.productId,
        field: "id",
      }),
      sku: createSourcedValue(trace.product.sku, {
        type: "database",
        name: "Product",
        path: "09_DATABASE_EVIDENCE.json#/product/sku",
        table: "Product",
        recordId: trace.product.productId,
        field: "sku",
      }),
      name: trace.product.name,
    },
    commercialTable: {
      tableId: trace.commercialPrice.tableId,
      tableCode: trace.commercialPrice.tableCode,
      tableName: trace.commercialPrice.tableName,
      versionId: trace.commercialPrice.versionId,
      versionNumber: trace.commercialPrice.versionNumber,
      versionStatus: trace.commercialPrice.versionStatus,
      effectiveFrom: trace.commercialPrice.effectiveFrom,
      effectiveTo: trace.commercialPrice.effectiveTo,
      publishedAt: trace.commercialPrice.publishedAt,
    },
    priceItem: {
      priceItemId: createSourcedValue(priceItemId, {
        type: "database",
        name: "PriceTableItem",
        path: "09_DATABASE_EVIDENCE.json#/priceItem/priceItemId",
        table: "PriceTableItem",
        recordId: priceItemId,
        field: "id",
      }),
      salePrice: createSourcedValue(trace.commercialPrice.salePrice, {
        type: "database",
        name: "PriceTableItem",
        path: "09_DATABASE_EVIDENCE.json#/priceItem/salePrice",
        table: "PriceTableItem",
        recordId: priceItemId,
        field: "salePrice",
      }),
      marginPercent: trace.marginSource.publishedMarginPercent,
      commissionPercent: trace.commissionSource.commissionPercent,
      commissionAmount: trace.commissionSource.commissionAmount,
      taxPercent: trace.taxSource.taxPercent,
      taxAmount: trace.taxSource.taxAmount,
      markup: trace.marginSource.markup,
    },
    costSource: {
      productionCostTableVersionId: trace.costSource.productionCostTableVersionId,
      productionCostTableCode: trace.costSource.productionCostTableCode,
      productionCostRevision: trace.costSource.productionCostRevision,
      productionCostItemId: trace.costSource.productionCostItemId,
      costUsedInPrice: createSourcedValue(trace.costSource.industrialCost, {
        type: "database",
        name: "PriceTableItem",
        path: "09_DATABASE_EVIDENCE.json#/costSource/costUsedInPrice",
        table: "PriceTableItem",
        recordId: priceItemId,
        field: "frozenTotalCost",
      }),
      currentOfficialCost: costComparison.currentOfficialCost,
      currentOfficialVersionCode: costComparison.currentOfficialVersionCode,
      differenceFromCurrentOfficial: costComparison.differenceFromCurrentOfficial,
      priceUsesLatestOfficial: costComparison.priceUsesLatestOfficial,
      status: trace.costSource.status,
    },
    taxSource: trace.taxSource,
    materialSource: trace.materialSource,
    deductions: trace.deductions,
    availability: trace.availability,
  };
}

export function buildPublishedPriceCalculationTrace(
  trace: PublishedPriceTrace,
  costComparison: PublishedPriceCostComparison
): Record<string, unknown> {
  return {
    mode: "read-only",
    recalculatedInFrontend: false,
    publishedPriceRecalculated: false,
    note: READ_ONLY_NOTE,
    diagnosticOnly: {
      currentOfficialCost: costComparison.currentOfficialCost,
      differenceFromCurrentOfficial: costComparison.differenceFromCurrentOfficial,
      label: "Comparação diagnóstica — NÃO é preço recalculado",
    },
    publishedPrice: {
      salePrice: trace.commercialPrice.salePrice,
      industrialCostUsed: trace.costSource.industrialCost,
      marginPercent: trace.marginSource.publishedMarginPercent,
      markup: trace.marginSource.markup,
      commissionPercent: trace.commissionSource.commissionPercent,
      commissionAmount: trace.commissionSource.commissionAmount,
      taxPercent: trace.taxSource.taxPercent,
      taxAmount: trace.taxSource.taxAmount,
      freight: trace.deductions.freightAmount,
      otherVariables: trace.deductions.otherVariablesAmount,
    },
    costSourceFrozen: trace.costSource,
    materialSourceFrozen: trace.materialSource,
    taxSourceFrozen: trace.taxSource,
    traces: [
      {
        name: "publishedPriceTrace",
        service: "buildPublishedPriceTrace",
        priceItemId: trace.commercialPrice.priceItemId,
        tableCode: trace.commercialPrice.tableCode,
      },
    ],
  };
}

export function buildPublishedPriceEvidencePayload(
  trace: PublishedPriceTrace,
  costComparison: PublishedPriceCostComparison,
  autoDiagnostics: PublishedPriceAutoDiagnostic[]
): Record<string, unknown> {
  return {
    scope: "PUBLISHED_PRICE",
    generatedBy: "buildPublishedPriceDiagnosticBundle",
    readOnly: true,
    trace,
    product: trace.product,
    commercialTable: trace.commercialPrice,
    price: {
      priceItemId: trace.commercialPrice.priceItemId,
      salePrice: trace.commercialPrice.salePrice,
      costUsed: trace.costSource.industrialCost,
      margin: trace.marginSource.publishedMarginPercent,
      commission: trace.commissionSource.commissionPercent,
      commissionAmount: trace.commissionSource.commissionAmount,
      tax: trace.taxSource.taxPercent,
      taxAmount: trace.taxSource.taxAmount,
      markup: trace.marginSource.markup,
      deductions: trace.deductions,
    },
    costSource: {
      ...trace.costSource,
      currentOfficialCost: costComparison.currentOfficialCost,
      currentOfficialVersionCode: costComparison.currentOfficialVersionCode,
      differenceFromCurrentOfficial: costComparison.differenceFromCurrentOfficial,
      priceUsesLatestOfficial: costComparison.priceUsesLatestOfficial,
    },
    taxSource: trace.taxSource,
    materialSource: trace.materialSource,
    availability: trace.availability,
    autoDiagnostics,
    sourceRefs: [
      sourceRef({
        type: "service",
        name: "buildPublishedPriceTrace",
        path: "evidence/published-price-trace.json",
        recordId: trace.commercialPrice.priceItemId,
      }),
    ],
  };
}

export function buildPublishedPriceBusinessRulesMarkdown(trace: PublishedPriceTrace): string {
  return `# Regras de Negócio — Preço Publicado

- Escopo: **PUBLISHED_PRICE** (formação de preço / tabela comercial).
- **Preço publicado não recalcula** — valores vêm de \`PriceTableItem\` + snapshots congelados.
- \`frozenTotalCost\`, \`frozenMaterialCost\`, \`frozenTaxCost\` etc. são a fonte auditável.
- \`costSnapshotJson\` / \`formulaSnapshotJson\` registram origem na publicação.
- Vínculo com \`ProductionCostTableVersion\` via versão comercial ou snapshot.
- Imposto: \`TaxRule\` da \`PriceTableVersion\` + taxas em formulaSnapshot.
- Margem/comissão: campos do item + formulaSnapshot (sem recomputar).
- **Preço antigo válido**: versão comercial vigente na data — custo congelado intencional.
- **Preço desatualizado**: existe revisão PUBLISHED mais nova de custo (\`${PUBLISHED_TRACE_NEWER_COST_WARNING}\`).
- Comparações com custo vigente em \`10_CALCULATION_TRACE.json#diagnosticOnly\` são **diagnóstico**, não valor oficial.

## Códigos de diagnóstico

| Código | Significado |
| --- | --- |
| OK_PRICE_USES_PUBLISHED_COST | Custo congelado legível e fonte presente |
| WARNING_NEWER_COST_EXISTS | Revisão de custo mais nova que a usada |
| ERROR_PRICE_COST_DIFFERS_FROM_SOURCE | Divergência entre preço e custo oficial vigente |
| ERROR_MISSING_COST_SOURCE | Sem ProductionCostTableVersion/Item |
| ERROR_MISSING_TAX_SOURCE | Sem regra/valor fiscal |
| LEGACY_PRICE_WITH_INCOMPLETE_SNAPSHOT | Snapshots incompletos |

Tabela analisada: **${trace.commercialPrice.tableCode}** v${trace.commercialPrice.versionNumber}.
`;
}

export async function resolvePublishedPriceTraceForDiagnostic(
  db: PrismaClient,
  context: PublishedPriceDiagnosticContext
): Promise<{ trace: PublishedPriceTrace; resolvedPriceItemId: string }> {
  const referenceDate = context.referenceDate ?? startOfCivilDate(new Date());
  const resolved = await resolvePublishedPriceItemIdForTrace(db, {
    priceItemId: context.priceItemId,
    sku: context.sku,
    productId: context.productId,
    tableCode: context.tableCode,
    tableId: context.tableId,
    referenceDate,
  });

  if (!resolved.priceItemId) {
    throw new PublishedPriceDiagnosticValidationError(
      resolved.errorMessage ?? "Não foi possível resolver priceItemId."
    );
  }

  const trace = await buildPublishedPriceTrace(db, {
    priceItemId: resolved.priceItemId,
    productId: context.productId ?? null,
    versionId: context.priceTableVersionId ?? null,
    tableId: context.tableId ?? null,
  });

  return { trace, resolvedPriceItemId: resolved.priceItemId };
}

export async function buildPublishedPriceDiagnosticBundleInput(
  db: PrismaClient,
  context: PublishedPriceDiagnosticContext
): Promise<BuildDiagnosticBundleInput> {
  const referenceDate = context.referenceDate ?? startOfCivilDate(new Date());
  const { trace } = await resolvePublishedPriceTraceForDiagnostic(db, context);

  const currentOfficial = await loadCurrentOfficialCostForProduct(
    db,
    trace.product.productId,
    referenceDate
  );
  const costComparison = buildPublishedPriceCostComparison(trace, currentOfficial);
  const autoDiagnostics = evaluatePublishedPriceAutoDiagnostics(trace, costComparison);
  const findings = buildPublishedPriceFindings(trace, autoDiagnostics);

  const scopeContext: DiagnosticScopeContext = {
    scope: "PUBLISHED_PRICE",
    screenRoute: context.screenRoute ?? PUBLISHED_PRICE_SCREEN_ROUTE,
    screenTitle: context.screenTitle ?? "Formação de Preço",
    filters: {
      sku: context.sku ?? trace.product.sku,
      productId: context.productId ?? trace.product.productId,
      tableCode: context.tableCode ?? trace.commercialPrice.tableCode,
      priceItemId: context.priceItemId ?? trace.commercialPrice.priceItemId,
      priceTableVersionId: context.priceTableVersionId ?? trace.commercialPrice.versionId,
    },
    userId: context.userId ?? null,
    userEmail: context.userEmail ?? null,
    errorMessage: context.errorMessage ?? null,
    notes: "Bundle PUBLISHED_PRICE — snapshots congelados, sem recálculo.",
  };

  const evidencePayload = buildPublishedPriceEvidencePayload(trace, costComparison, autoDiagnostics);

  return {
    scope: "PUBLISHED_PRICE",
    context: scopeContext,
    findings,
    evidence: [
      {
        id: "evidence_published_price_trace",
        scope: "PUBLISHED_PRICE",
        label: "Rastreabilidade de preço publicado (Fonte do Preço)",
        bundlePath: "evidence/published-price-trace.json",
        payload: evidencePayload,
      },
    ],
    executiveSummaryMarkdown: buildPublishedPriceExecutiveSummaryMarkdown(
      trace,
      costComparison,
      autoDiagnostics
    ),
    problemContextMarkdown: buildPublishedPriceProblemContextMarkdown(context, trace),
    databaseEvidence: buildPublishedPriceDatabaseEvidence(trace, costComparison),
    calculationTrace: buildPublishedPriceCalculationTrace(trace, costComparison),
    businessRulesMarkdown: buildPublishedPriceBusinessRulesMarkdown(trace),
    logs: [
      `[published-price] sku=${trace.product.sku} table=${trace.commercialPrice.tableCode}`,
      `[published-price] salePrice=${fmtMoney(trace.commercialPrice.salePrice)} costUsed=${fmtMoney(trace.costSource.industrialCost)}`,
      `[published-price] margin=${fmtPct(trace.marginSource.publishedMarginPercent)} commission=${fmtPct(trace.commissionSource.commissionPercent)} tax=${fmtPct(trace.taxSource.taxPercent)}`,
      `[published-price] currentOfficial=${fmtMoney(costComparison.currentOfficialCost)} diff=${fmtMoney(costComparison.differenceFromCurrentOfficial)}`,
      `[published-price] diagnostics=${autoDiagnostics.map((d) => d.code).join(",")}`,
    ],
    rawLimitedEvidence: {
      sku: trace.product.sku,
      tableCode: trace.commercialPrice.tableCode,
      priceItemId: trace.commercialPrice.priceItemId,
      salePrice: trace.commercialPrice.salePrice,
      costUsed: trace.costSource.industrialCost,
      currentOfficialCost: costComparison.currentOfficialCost,
      diagnosticCodes: autoDiagnostics.map((d) => d.code),
      missingFields: trace.availability.missingFields,
    },
    reproductionCommands: [
      {
        label: "Gerar bundle PUBLISHED_PRICE",
        command: `npx tsx scripts/generate-diagnostic-bundle.ts --scope=PUBLISHED_PRICE --sku=${trace.product.sku} --table-code=${trace.commercialPrice.tableCode}`,
        note: "Read-only; grava em tmp/diagnostic-bundles/",
      },
      {
        label: "Auditoria preço publicado (JSON)",
        command: `npx tsx scripts/audit-published-price-trace.ts --sku=${trace.product.sku} --table-code=${trace.commercialPrice.tableCode} --json`,
      },
    ],
    systemSnapshot: {
      scope: "PUBLISHED_PRICE",
      auditServicesUsed: ["buildPublishedPriceTrace", "resolvePublishedPriceItemIdForTrace"],
      readOnly: true,
      recalculated: false,
      product: trace.product,
      tableCode: trace.commercialPrice.tableCode,
    },
  };
}

export async function buildAndWritePublishedPriceDiagnosticBundle(
  db: PrismaClient,
  context: PublishedPriceDiagnosticContext
): Promise<BuildDiagnosticBundleResult> {
  const input = await buildPublishedPriceDiagnosticBundleInput(db, context);
  return buildAndWriteDiagnosticBundle(input);
}
