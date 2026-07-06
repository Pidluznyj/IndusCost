/**
 * Escopo PRODUCT_ENGINEERING — relatório analisável para Engenharia de Produto.
 * Read-only; reutiliza buildProductCostTrace + bundle ChatGPT.
 */
import type { PrismaClient } from "@prisma/client";
import { startOfCivilDate } from "../financeCivilDate.js";
import { buildProductCostTrace } from "../audit/costToCashTrace.server.js";
import { createProductCostAnalysisEngine } from "../productCostAnalysisEngine.server.js";
import { evaluateProductEngineeringCost } from "../productEngineeringCostSnapshot.server.js";
import type { ProductCostTraceAuditReport } from "../productCostTraceAudit.js";
import { rankCostLinesByTotal } from "../productCostTraceAudit.js";
import {
  PRODUCT_ENGINEERING_COST_TOLERANCE,
  type ProductEngineeringCostWarningStatus,
} from "../productEngineeringCostWarning.js";
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

export type ProductEngineeringDiagnosticContext = {
  sku?: string | null;
  productId?: string | null;
  referenceDate?: Date;
  errorMessage?: string | null;
  screenRoute?: string | null;
  screenTitle?: string | null;
  userId?: string | null;
  userEmail?: string | null;
};

export type ProductEngineeringDiagnosticRequest = {
  scope: "PRODUCT_ENGINEERING";
  context: ProductEngineeringDiagnosticContext;
};

export type ProductEngineeringAutoDiagnostic = {
  code: string;
  severity: DiagnosticFindingSeverity;
  title: string;
  message: string;
  hypothesis?: string | null;
};

export class ProductEngineeringDiagnosticValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductEngineeringDiagnosticValidationError";
  }
}

const PRODUCT_ENGINEERING_SCREEN_ROUTE = "/products/engineering";

export function parseProductEngineeringDiagnosticRequest(
  body: unknown
): ProductEngineeringDiagnosticRequest {
  if (!body || typeof body !== "object") {
    throw new ProductEngineeringDiagnosticValidationError("Corpo JSON inválido.");
  }
  const raw = body as Record<string, unknown>;
  const scope = String(raw.scope ?? "").trim().toUpperCase();
  if (scope !== "PRODUCT_ENGINEERING") {
    throw new ProductEngineeringDiagnosticValidationError(
      'scope deve ser "PRODUCT_ENGINEERING".'
    );
  }
  const ctxRaw = raw.context;
  if (!ctxRaw || typeof ctxRaw !== "object") {
    throw new ProductEngineeringDiagnosticValidationError("context é obrigatório.");
  }
  const ctx = ctxRaw as Record<string, unknown>;
  const sku = typeof ctx.sku === "string" ? ctx.sku.trim() || null : null;
  const productId = typeof ctx.productId === "string" ? ctx.productId.trim() || null : null;
  if (!sku && !productId) {
    throw new ProductEngineeringDiagnosticValidationError(
      "Informe context.sku ou context.productId."
    );
  }
  return {
    scope: "PRODUCT_ENGINEERING",
    context: {
      sku,
      productId,
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

function fmtCost(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(6);
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

export function evaluateProductEngineeringAutoDiagnostics(
  trace: ProductCostTraceAuditReport
): ProductEngineeringAutoDiagnostic[] {
  const diagnostics: ProductEngineeringAutoDiagnostic[] = [];
  const warningStatus = trace.currentCost.warning?.warningStatus ?? "NONE";

  const push = (diag: ProductEngineeringAutoDiagnostic) => {
    if (!diagnostics.some((d) => d.code === diag.code)) diagnostics.push(diag);
  };

  for (const alert of trace.alerts) {
    const severity: DiagnosticFindingSeverity =
      alert.severity === "error"
        ? "error"
        : alert.severity === "warning"
          ? "warning"
          : "info";
    push({
      code: alert.code,
      severity,
      title: alert.code.replace(/_/g, " "),
      message: alert.message,
    });
  }

  const bomLineCount =
    trace.bom.componentCount + trace.materials.materialCount;
  if (bomLineCount === 0) {
    push({
      code: "BOM_EMPTY",
      severity: "warning",
      title: "BOM vazia",
      message: "Produto sem linhas de BOM (materiais ou componentes) no motor vivo.",
    });
  }

  if (
    !trace.process.included ||
    trace.process.processSource == null ||
    trace.process.processSource === "NONE"
  ) {
    push({
      code: "PROCESS_MISSING",
      severity: "warning",
      title: "Processo ausente",
      message: "Ciclo/cavidades não disponíveis (processSource NONE ou ausente).",
    });
  }

  if (warningStatus === "COST_DIFF_PENDING_PUBLICATION") {
    push({
      code: "COST_DIFF_PENDING_PUBLICATION",
      severity: "warning",
      title: "Custo pendente para publicação",
      message:
        trace.currentCost.warning?.message ??
        "Custo calculado difere do custo oficial publicado.",
      hypothesis:
        "Diferença numérica acima da tolerância entre engenharia e tabela publicada.",
    });
  }

  if (warningStatus === "TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT") {
    push({
      code: "TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT",
      severity: "info",
      title: "Snapshot técnico pendente sem impacto de custo",
      message:
        trace.currentCost.warning?.message ??
        "BOM/processo mudou mas custo permanece igual — DRAFT técnico pendente.",
      hypothesis:
        "Warning visual pode aparecer como pendência mesmo com diferença zero se calculationHash diverge do publicado.",
    });
  }

  if (warningStatus === "COST_PUBLISHED_OK") {
    push({
      code: "COST_PUBLISHED_OK",
      severity: "info",
      title: "Custo publicado alinhado",
      message: trace.currentCost.warning?.message ?? "Custo oficial atualizado.",
    });
  }

  if (warningStatus === "MISSING_OFFICIAL_COST") {
    push({
      code: "MISSING_OFFICIAL_COST",
      severity: "warning",
      title: "Sem custo oficial",
      message: trace.currentCost.warning?.message ?? "Produto sem custo oficial publicado.",
    });
  }

  for (const price of trace.commercialPrices) {
    if (price.staleVsOfficialCost) {
      push({
        code: "PRICE_OUTDATED_BY_NEW_COST",
        severity: "warning",
        title: "Preço comercial desatualizado",
        message: `Tabela ${price.priceTableCode}: custo congelado difere do oficial vigente.`,
      });
    }
  }

  return diagnostics;
}

export function buildProductEngineeringFindings(
  trace: ProductCostTraceAuditReport,
  autoDiagnostics: ProductEngineeringAutoDiagnostic[]
): DiagnosticFinding[] {
  const sku = trace.product?.sku ?? "—";
  return autoDiagnostics.map((diag, index) => ({
    id: `pe_finding_${String(index + 1).padStart(3, "0")}`,
    severity: diag.severity,
    code: diag.code,
    title: diag.title,
    message: diag.message,
    businessImpact:
      diag.code === "TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT"
        ? "Usuário pode ver alerta de pendência sem impacto financeiro imediato."
        : diag.code === "COST_DIFF_PENDING_PUBLICATION"
          ? "Custo industrial exibido pode divergir do publicado até nova publicação."
          : diag.code === "MATERIAL_WITHOUT_COST" || diag.code === "COMPONENT_WITHOUT_COST"
            ? "Custo calculado pode estar subestimado ou incompleto."
            : "Verificar engenharia e tabelas de custo antes de publicar preço.",
    technicalImpact: diag.hypothesis ?? `Diagnóstico automático para SKU ${sku}.`,
    evidenceRefs: [
      "evidence/product-cost-trace.json",
      "09_DATABASE_EVIDENCE.json",
      "10_CALCULATION_TRACE.json",
    ],
    sourceRefs: [
      sourceRef({
        type: "service",
        name: "buildProductCostTrace",
        path: "evidence/product-cost-trace.json#/currentCost",
        recordId: trace.product?.productId ?? null,
        field: diag.code,
      }),
    ],
    suggestedNextSteps: buildSuggestedSteps(diag.code, trace),
  }));
}

function buildSuggestedSteps(code: string, trace: ProductCostTraceAuditReport): string[] {
  switch (code) {
    case "TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT":
      return [
        "Comparar calculationHash publicado vs DRAFT em 10_CALCULATION_TRACE.json",
        "Publicar DRAFT técnico ou descartar se alteração foi revertida",
        "Confirmar se UI classifica corretamente snapshot sem impacto de custo",
      ];
    case "COST_DIFF_PENDING_PUBLICATION":
      return [
        "Revisar BOM/processo alterados desde última publicação",
        "Gerar e publicar nova versão da tabela de custo de produção",
      ];
    case "MATERIAL_WITHOUT_COST":
    case "COMPONENT_WITHOUT_COST":
      return [
        "Completar custo landed/ oficial do item na tabela de MP ou custo de produção do componente",
        "Regenerar DRAFT de custo após correção",
      ];
    case "PRICE_OUTDATED_BY_NEW_COST":
      return [
        "Republicar preço comercial com novo frozenTotalCost",
        "Validar margem após atualização do custo oficial",
      ];
    default:
      return [
        `Reexecutar: npx tsx scripts/audit-product-cost-trace.ts --sku=${trace.product?.sku ?? "SKU"}`,
        "Anexar ZIP ao ChatGPT para análise detalhada",
      ];
  }
}

export function buildProductEngineeringExecutiveSummaryMarkdown(
  trace: ProductCostTraceAuditReport,
  autoDiagnostics: ProductEngineeringAutoDiagnostic[]
): string {
  const product = trace.product;
  const warning = trace.currentCost.warning;
  const topMaterial = trace.materials.topCostRanking[0] ?? null;
  const topComponent = rankCostLinesByTotal(trace.bom.components)[0] ?? null;
  const primary = pickPrimaryHypothesis(autoDiagnostics, trace);

  const alertLines =
    autoDiagnostics.length > 0
      ? autoDiagnostics.map((d) => `- **${d.code}** (${d.severity}): ${d.message}`).join("\n")
      : "- Nenhum alerta automático.";

  return `# Resumo Executivo — Engenharia de Produto

## 1. Contexto

| Campo | Valor |
| --- | --- |
| SKU | ${product?.sku ?? "—"} |
| Produto | ${product?.name ?? "—"} |
| Tipo | ${product?.type ?? "—"} |
| Status | ${product?.status ?? "—"} |
| Data referência | ${trace.referenceDate} |
| Escopo | PRODUCT_ENGINEERING |

Relatório gerado para diagnóstico no ChatGPT — read-only, sem alteração de custo ou publicação.

## 2. Resultado principal

| Indicador | Valor |
| --- | --- |
| Status auditoria | ${trace.status} |
| Status do warning | ${warning?.warningStatus ?? "—"} |
| Mensagem UI | ${warning?.message ?? "—"} |
| Hipótese principal | ${primary} |

## 3. Custo oficial vs custo calculado

| Métrica | Valor | Fonte |
| --- | --- | --- |
| Custo calculado (engenharia) | ${fmtCost(trace.currentCost.engineeringCost)} | ${trace.currentCost.engineeringSource} |
| Custo oficial publicado | ${fmtCost(trace.currentCost.officialPublishedCost)} | ${trace.currentCost.officialSource} |
| Diferença | ${fmtCost(trace.currentCost.difference)} | tolerância ±${PRODUCT_ENGINEERING_COST_TOLERANCE} |
| Tabela custo | ${trace.officialVersion.versionCode ?? "—"} rev.${trace.officialVersion.revision ?? "—"} | vigência ${trace.officialVersion.effectiveDate ?? "—"} |
| Publicado em | ${trace.officialVersion.publishedAt ?? "—"} | — |
| Tabela MP | ${trace.officialVersion.materialCostTableVersionCode ?? "—"} | — |

## 4. Maior matéria-prima no custo

${
  topMaterial
    ? `| SKU | Consumo | Custo unit. | Total | Participação |
| --- | --- | --- | --- | --- |
| ${topMaterial.sku ?? "—"} | ${topMaterial.quantity ?? "—"} | ${fmtCost(topMaterial.unitCost)} | ${fmtCost(topMaterial.totalCost)} | ${fmtPct(topMaterial.sharePercent)} |`
    : "_Sem matérias-primas na BOM._"
}

## 5. Maior componente no custo

${
  topComponent
    ? `| SKU | Qtd | Custo unit. | Total | Participação |
| --- | --- | --- | --- | --- |
| ${topComponent.sku ?? "—"} | ${topComponent.quantity ?? "—"} | ${fmtCost(topComponent.unitCost)} | ${fmtCost(topComponent.totalCost)} | ${fmtPct(topComponent.sharePercent)} |`
    : "_Sem componentes na BOM._"
}

## 6. Alertas encontrados

${alertLines}

## 7. Hipótese principal de causa

${primary}

## 8. Próximos passos recomendados

${buildSuggestedSteps(autoDiagnostics[0]?.code ?? "DEFAULT", trace)
  .map((s) => `- ${s}`)
  .join("\n")}
`;
}

function pickPrimaryHypothesis(
  diagnostics: ProductEngineeringAutoDiagnostic[],
  trace: ProductCostTraceAuditReport
): string {
  const technical = diagnostics.find(
    (d) => d.code === "TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT"
  );
  if (technical?.hypothesis) return technical.hypothesis;

  const diffPending = diagnostics.find((d) => d.code === "COST_DIFF_PENDING_PUBLICATION");
  if (diffPending) return diffPending.hypothesis ?? diffPending.message;

  if (
    trace.currentCost.difference != null &&
    Math.abs(trace.currentCost.difference) <= PRODUCT_ENGINEERING_COST_TOLERANCE &&
    trace.currentCost.warning?.warningStatus === "TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT"
  ) {
    return "Custos numéricos iguais, mas hash técnico (BOM/processo) diverge — warning de pendência pode ser falso positivo visual.";
  }

  if (trace.currentCost.warning?.warningStatus === "COST_PUBLISHED_OK") {
    return "Custo oficial e calculado alinhados — sem pendência de publicação por diferença numérica.";
  }

  const first = diagnostics.find((d) => d.severity === "error" || d.severity === "warning");
  return first?.message ?? "Analisar evidence/product-cost-trace.json para detalhes.";
}

export function buildProductEngineeringProblemContextMarkdown(
  context: ProductEngineeringDiagnosticContext,
  trace: ProductCostTraceAuditReport
): string {
  return `# Contexto do Problema — Engenharia

## Identificação

\`\`\`json
${JSON.stringify(
  {
    sku: context.sku ?? trace.product?.sku ?? null,
    productId: context.productId ?? trace.product?.productId ?? null,
    referenceDate: trace.referenceDate,
    errorReported: context.errorMessage ?? null,
  },
  null,
  2
)}
\`\`\`

## Sintoma reportado

${context.errorMessage ?? "Warning de custo pendente na tela de Engenharia de Produto, possivelmente sem diferença numérica entre custo oficial e calculado."}

## Checklist rápido

| Verificação | Resultado |
| --- | --- |
| BOM presente | ${trace.checklist.hasBomTree === true ? "sim" : "não"} |
| Dados de processo | ${trace.checklist.hasProcessData === true ? "sim" : "não"} |
| Tabela MP publicada | ${trace.checklist.hasPublishedMaterialCostTable === true ? "sim" : "não"} |
| Custo produção publicado | ${trace.checklist.hasPublishedProductionCostTable === true ? "sim" : "não"} |
| MPs com custo vigente | ${trace.checklist.materialsHaveVigentCost === true ? "sim" : "não"} |
| Componentes com custo oficial | ${trace.checklist.bomComponentsHaveOfficialCost === true ? "sim" : "não"} |
`;
}

export function buildProductEngineeringDatabaseEvidence(
  trace: ProductCostTraceAuditReport,
  productExtras: { sourceSystem: string | null; sourceExternalId: string | null }
): Record<string, unknown> {
  const productId = trace.product?.productId ?? null;
  return {
    scope: "PRODUCT_ENGINEERING",
    product: trace.product
      ? {
          productId: createSourcedValue(trace.product.productId, {
            type: "database",
            name: "Product",
            path: "09_DATABASE_EVIDENCE.json#/product/productId",
            table: "Product",
            recordId: productId,
            field: "id",
          }),
          sku: createSourcedValue(trace.product.sku, {
            type: "database",
            name: "Product",
            path: "09_DATABASE_EVIDENCE.json#/product/sku",
            table: "Product",
            recordId: productId,
            field: "sku",
          }),
          name: createSourcedValue(trace.product.name, {
            type: "database",
            name: "Product",
            path: "09_DATABASE_EVIDENCE.json#/product/name",
            table: "Product",
            recordId: productId,
            field: "name",
          }),
          type: trace.product.type,
          status: trace.product.status,
          sourceSystem: productExtras.sourceSystem,
          externalId: productExtras.sourceExternalId,
        }
      : null,
    productionCost: {
      engineeringCost: createSourcedValue(trace.currentCost.engineeringCost, {
        type: "service",
        name: "evaluateProductEngineeringCost",
        path: "09_DATABASE_EVIDENCE.json#/productionCost/engineeringCost",
        recordId: productId,
        field: "finalUnitCost",
      }),
      officialPublishedCost: createSourcedValue(trace.currentCost.officialPublishedCost, {
        type: "service",
        name: "getEffectiveProductProductionCost",
        path: "09_DATABASE_EVIDENCE.json#/productionCost/officialPublishedCost",
        table: "ProductionCostTableItem",
        recordId: trace.officialVersion.versionId,
        field: "unitProductionCost",
      }),
      difference: createSourcedValue(trace.currentCost.difference, {
        type: "service",
        name: "resolveProductEngineeringCostWarning",
        path: "09_DATABASE_EVIDENCE.json#/productionCost/difference",
        recordId: productId,
      }),
      warningStatus: trace.currentCost.warning?.warningStatus ?? null,
      warningMessage: trace.currentCost.warning?.message ?? null,
      tolerance: PRODUCT_ENGINEERING_COST_TOLERANCE,
    },
    officialVersion: trace.officialVersion,
    costBreakdown: trace.costBreakdown,
    bomSummary: {
      componentCount: trace.bom.componentCount,
      materialCount: trace.materials.materialCount,
      source: trace.bom.source,
    },
    processSummary: {
      cycleTimeSeconds: trace.process.cycleTimeSeconds,
      cavities: trace.process.cavities,
      laborCost: trace.process.laborCost,
      machineCost: trace.process.machineCost,
      efficiencyExpectedPercent: trace.process.efficiencyExpectedPercent,
      processSource: trace.process.processSource,
      source: trace.process.source,
    },
    dataSources: trace.dataSources,
  };
}

export function buildProductEngineeringCalculationTrace(
  trace: ProductCostTraceAuditReport,
  hashes: { publishedHash: string | null; calculatedHash: string | null; hasDraft: boolean }
): Record<string, unknown> {
  const rankedMaterials = trace.materials.topCostRanking.slice(0, 15);
  const rankedComponents = rankCostLinesByTotal(trace.bom.components).slice(0, 15);

  return {
    mode: "read-only",
    recalculatedInFrontend: false,
    publishedPriceRecalculated: false,
    tolerance: PRODUCT_ENGINEERING_COST_TOLERANCE,
    warning: trace.currentCost.warning,
    hashes,
    costComparison: {
      engineeringCost: trace.currentCost.engineeringCost,
      officialPublishedCost: trace.currentCost.officialPublishedCost,
      difference: trace.currentCost.difference,
      hasTechnicalSnapshotPending: trace.currentCost.warning?.hasTechnicalSnapshotPending ?? false,
      hasCostImpact: trace.currentCost.warning?.hasCostImpact ?? false,
    },
    breakdown: trace.costBreakdown,
    engineering: {
      bom: {
        componentCount: trace.bom.componentCount,
        components: trace.bom.components,
        source: trace.bom.source,
      },
      materials: {
        materialCount: trace.materials.materialCount,
        materials: trace.materials.materials,
        topCostRanking: rankedMaterials,
        source: trace.materials.source,
      },
      process: trace.process,
    },
    rankings: {
      topMaterials: rankedMaterials,
      topComponents: rankedComponents,
    },
    traces: [
      {
        name: "productCostTrace",
        service: "buildProductCostTrace",
        status: trace.status,
        auditedAt: trace.auditedAt,
        referenceDate: trace.referenceDate,
      },
    ],
  };
}

export function buildProductEngineeringEvidencePayload(
  trace: ProductCostTraceAuditReport,
  productExtras: { sourceSystem: string | null; sourceExternalId: string | null },
  hashes: { publishedHash: string | null; calculatedHash: string | null; hasDraft: boolean }
): Record<string, unknown> {
  return {
    scope: "PRODUCT_ENGINEERING",
    generatedBy: "buildProductEngineeringDiagnosticBundle",
    trace,
    product: trace.product
      ? {
          ...trace.product,
          sourceSystem: productExtras.sourceSystem,
          externalId: productExtras.sourceExternalId,
        }
      : null,
    engineering: {
      bomUsed: "ProductBOM (motor vivo via ProductCostAnalysisEngine)",
      bomLineCount: trace.bom.componentCount + trace.materials.materialCount,
      components: trace.bom.components,
      materials: trace.materials.materials,
      process: {
        cycleTimeSeconds: trace.process.cycleTimeSeconds,
        cavities: trace.process.cavities,
        laborCostHH: trace.process.laborCost,
        machineCostHM: trace.process.machineCost,
        efficiencyExpectedPercent: trace.process.efficiencyExpectedPercent,
        setupTimeMin: trace.process.setupTimeMin,
        netPiecesPerHour: trace.process.netPiecesPerHour,
        processSource: trace.process.processSource,
      },
      snapshot: {
        publishedCalculationHash: hashes.publishedHash,
        liveCalculationHash: hashes.calculatedHash,
        hasDraftPending: hashes.hasDraft,
        warningStatus: trace.currentCost.warning?.warningStatus ?? null,
      },
    },
    cost: {
      calculatedCurrent: trace.currentCost.engineeringCost,
      officialPublished: trace.currentCost.officialPublishedCost,
      difference: trace.currentCost.difference,
      tolerance: PRODUCT_ENGINEERING_COST_TOLERANCE,
      warningStatus: trace.currentCost.warning?.warningStatus ?? null,
      warningMessage: trace.currentCost.warning?.message ?? null,
      officialVersion: trace.officialVersion,
      breakdown: trace.costBreakdown,
    },
    materialsRanking: trace.materials.topCostRanking,
    componentsRanking: rankCostLinesByTotal(trace.bom.components),
    alerts: trace.alerts,
    autoDiagnostics: evaluateProductEngineeringAutoDiagnostics(trace),
    sourceRefs: [
      sourceRef({
        type: "service",
        name: "buildProductCostTrace",
        path: "evidence/product-cost-trace.json",
        recordId: trace.product?.productId ?? null,
      }),
    ],
  };
}

export function buildProductEngineeringBusinessRulesMarkdown(
  trace: ProductCostTraceAuditReport
): string {
  const warningStatus = trace.currentCost.warning?.warningStatus ?? "NONE";
  return `# Regras de Negócio — Engenharia de Produto

- Escopo: **PRODUCT_ENGINEERING** (custo industrial, BOM, processo, publicação).
- Custo **oficial publicado** prevalece sobre recálculo ao vivo na operação.
- Motor de engenharia (\`ProductCostAnalysisEngine\`) calcula custo **vivo** — não grava automaticamente.
- Warning **COST_DIFF_PENDING_PUBLICATION**: diferença numérica acima de tolerância (${PRODUCT_ENGINEERING_COST_TOLERANCE}).
- Warning **TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT**: \`calculationHash\` diverge mas custo igual — pendência técnica, não financeira.
- Warning **COST_PUBLISHED_OK**: custo oficial alinhado ao calculado.
- Matéria-prima usa tabela versionada de MP vigente na publicação; motor vivo resolve MP atual.
- Componentes usam custo industrial recursivo do filho.
- HH/HM derivados de ciclo, cavidades, eficiência e tarifas globais.
- Status atual detectado: **${warningStatus}**.

## Códigos de diagnóstico automático

| Código | Significado |
| --- | --- |
| MATERIAL_WITHOUT_COST | MP na BOM sem custo landed/unitário válido |
| COMPONENT_WITHOUT_COST | Componente sem custo oficial |
| BOM_EMPTY | Sem linhas na BOM |
| PROCESS_MISSING | Sem ciclo/cavidades |
| COST_DIFF_PENDING_PUBLICATION | Custo calculado ≠ oficial |
| TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT | Snapshot técnico pendente, custo igual |
| COST_PUBLISHED_OK | Publicação alinhada |
| MISSING_OFFICIAL_COST | Sem custo oficial vigente |
| PRICE_OUTDATED_BY_NEW_COST | Preço comercial congelado desatualizado |
`;
}

async function loadProductExtras(
  db: PrismaClient,
  productId: string | null
): Promise<{ sourceSystem: string | null; sourceExternalId: string | null }> {
  if (!productId) return { sourceSystem: null, sourceExternalId: null };
  const row = await db.product.findUnique({
    where: { id: productId },
    select: { sourceSystem: true, sourceExternalId: true },
  });
  return {
    sourceSystem: row?.sourceSystem ?? null,
    sourceExternalId: row?.sourceExternalId ?? null,
  };
}

async function loadCostHashes(
  db: PrismaClient,
  productId: string | null,
  versionId: string | null
): Promise<{ publishedHash: string | null; calculatedHash: string | null; hasDraft: boolean }> {
  if (!productId) {
    return { publishedHash: null, calculatedHash: null, hasDraft: false };
  }

  const [publishedItem, draftItem] = await Promise.all([
    versionId
      ? db.productionCostTableItem.findFirst({
          where: { productId, costTableVersionId: versionId },
          select: { calculationHash: true },
        })
      : Promise.resolve(null),
    db.productionCostTableItem.findFirst({
      where: { productId, costTableVersion: { status: "DRAFT" } },
      orderBy: { createdAt: "desc" },
      select: { calculationHash: true },
    }),
  ]);

  let calculatedHash: string | null = null;
  try {
    const engine = createProductCostAnalysisEngine(db);
    const evaluated = await evaluateProductEngineeringCost(db, engine, productId);
    calculatedHash = evaluated.calculationHash;
  } catch {
    calculatedHash = null;
  }

  return {
    publishedHash: publishedItem?.calculationHash ?? null,
    calculatedHash,
    hasDraft: draftItem != null,
  };
}

export async function buildProductEngineeringDiagnosticBundleInput(
  db: PrismaClient,
  context: ProductEngineeringDiagnosticContext
): Promise<BuildDiagnosticBundleInput> {
  const referenceDate = context.referenceDate ?? startOfCivilDate(new Date());
  const trace = await buildProductCostTrace(db, {
    sku: context.sku ?? null,
    productId: context.productId ?? null,
    referenceDate,
    includeBom: true,
    includeProcess: true,
    includeMaterials: true,
  });

  const productId = trace.product?.productId ?? null;
  const [productExtras, hashes] = await Promise.all([
    loadProductExtras(db, productId),
    loadCostHashes(db, productId, trace.officialVersion.versionId),
  ]);

  const autoDiagnostics = evaluateProductEngineeringAutoDiagnostics(trace);
  const findings = buildProductEngineeringFindings(trace, autoDiagnostics);

  const scopeContext: DiagnosticScopeContext = {
    scope: "PRODUCT_ENGINEERING",
    screenRoute: context.screenRoute ?? PRODUCT_ENGINEERING_SCREEN_ROUTE,
    screenTitle: context.screenTitle ?? "Engenharia de Produto",
    filters: {
      sku: context.sku ?? trace.product?.sku ?? null,
      productId: context.productId ?? productId,
      referenceDate: trace.referenceDate,
    },
    userId: context.userId ?? null,
    userEmail: context.userEmail ?? null,
    errorMessage:
      context.errorMessage ??
      (trace.errorMessage
        ? trace.errorMessage
        : trace.currentCost.warning?.message ?? null),
    notes: "Bundle PRODUCT_ENGINEERING — diagnóstico de custo/BOM/processo/warnings.",
  };

  const evidencePayload = buildProductEngineeringEvidencePayload(trace, productExtras, hashes);
  const evidence: DiagnosticEvidence[] = [
    {
      id: "evidence_product_cost_trace",
      scope: "PRODUCT_ENGINEERING",
      label: "Rastreabilidade de custo do produto",
      bundlePath: "evidence/product-cost-trace.json",
      payload: evidencePayload,
    },
  ];

  const logs = [
    `[product-engineering] sku=${trace.product?.sku ?? "—"} status=${trace.status}`,
    `[product-engineering] engineering=${fmtCost(trace.currentCost.engineeringCost)} official=${fmtCost(trace.currentCost.officialPublishedCost)} diff=${fmtCost(trace.currentCost.difference)}`,
    `[product-engineering] warning=${trace.currentCost.warning?.warningStatus ?? "NONE"} message=${trace.currentCost.warning?.message ?? "—"}`,
    `[product-engineering] alerts=${trace.alerts.length} bomLines=${trace.bom.componentCount + trace.materials.materialCount}`,
  ];

  return {
    scope: "PRODUCT_ENGINEERING",
    context: scopeContext,
    findings,
    evidence,
    executiveSummaryMarkdown: buildProductEngineeringExecutiveSummaryMarkdown(trace, autoDiagnostics),
    problemContextMarkdown: buildProductEngineeringProblemContextMarkdown(context, trace),
    databaseEvidence: buildProductEngineeringDatabaseEvidence(trace, productExtras),
    calculationTrace: buildProductEngineeringCalculationTrace(trace, hashes),
    businessRulesMarkdown: buildProductEngineeringBusinessRulesMarkdown(trace),
    logs,
    rawLimitedEvidence: {
      productSku: trace.product?.sku ?? null,
      warningStatus: trace.currentCost.warning?.warningStatus ?? null,
      engineeringCost: trace.currentCost.engineeringCost,
      officialCost: trace.currentCost.officialPublishedCost,
      difference: trace.currentCost.difference,
      topMaterialSku: trace.materials.topCostRanking[0]?.sku ?? null,
      topComponentSku: trace.bom.components[0]?.sku ?? null,
      alertCodes: trace.alerts.map((a) => a.code),
      autoDiagnosticCodes: autoDiagnostics.map((d) => d.code),
    },
    reproductionCommands: [
      {
        label: "Gerar bundle PRODUCT_ENGINEERING",
        command: `npx tsx scripts/generate-diagnostic-bundle.ts --scope=PRODUCT_ENGINEERING --sku=${trace.product?.sku ?? context.sku ?? "SKU"}`,
        note: "Read-only; grava em tmp/diagnostic-bundles/",
      },
      {
        label: "Auditoria de custo (JSON)",
        command: `npx tsx scripts/audit-product-cost-trace.ts --sku=${trace.product?.sku ?? context.sku ?? "SKU"} --json`,
      },
    ],
    systemSnapshot: {
      scope: "PRODUCT_ENGINEERING",
      auditServicesUsed: ["buildProductCostTrace", "evaluateProductEngineeringCost"],
      product: trace.product,
      warningStatus: trace.currentCost.warning?.warningStatus ?? null,
    },
  };
}

export async function buildAndWriteProductEngineeringDiagnosticBundle(
  db: PrismaClient,
  context: ProductEngineeringDiagnosticContext
): Promise<BuildDiagnosticBundleResult> {
  const input = await buildProductEngineeringDiagnosticBundleInput(db, context);
  return buildAndWriteDiagnosticBundle(input);
}

export function isProductEngineeringWarningStatus(
  value: string
): value is ProductEngineeringCostWarningStatus {
  return (
    value === "NONE" ||
    value === "COST_DIFF_PENDING_PUBLICATION" ||
    value === "TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT" ||
    value === "COST_PUBLISHED_OK" ||
    value === "MISSING_OFFICIAL_COST" ||
    value === "ERROR"
  );
}
