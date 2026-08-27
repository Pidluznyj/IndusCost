/**
 * Montagem PURA do DRE Gerencial a partir das séries brutas das fontes oficiais.
 *
 * Este módulo não faz I/O: recebe `FinanceDreRawSourceSeries` (carregadas ao
 * vivo pelos motores oficiais OU lidas do snapshot anual materializado) e
 * produz o `FinanceDreReport` com a MESMA matemática nos dois caminhos —
 * paridade LIVE == SNAPSHOT por construção.
 *
 * Regras temporais são de read-time: `availableThroughMonth` vem de
 * `resolveFinanceDreAvailableThroughMonth(year, referenceNow)` no momento da
 * leitura (nunca do snapshot), e o roleMap de centros de custo vigente é
 * aplicado na leitura sobre as séries brutas por CC.
 */

import {
  bucketCostCenterSpendByDreRole,
  DRE_COST_CENTER_ROLE_LABELS,
  type DreCostCenterRole,
} from "@/src/lib/financeDreCostCenterRoles.js";
import {
  buildEstimatedCorporateTaxSeriesFromEntityBases,
  FINANCE_DRE_ESTIMATED_TAX_DISCLAIMER,
  type FinanceDreEstimatedCorporateTaxesBlock,
  type FinanceDreTaxEntitySeries,
} from "@/src/lib/financeDreEstimatedCorporateTaxes.js";
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "@/src/lib/financeInternalGroupExclusions.js";
import { mapExecutiveReportCompanyToEmitterCnpj } from "@/src/lib/financeExecutiveReportCompany.js";
import {
  buildFinanceDreInformativeReport,
  buildFinanceDreLines,
  buildFinanceDreSourceChecks,
  computeFinanceDreEstimatedTaxBaseSeries,
  emptyDreSeries,
  financeDreMonthLabels,
  roundDreMoney,
  zeroDreSeriesAfterMonth,
  ytdThroughMonth,
  type FinanceDreMathInput,
} from "@/src/lib/financeDreMath.js";
import {
  FINANCE_DRE_OFFICIAL_SOURCES,
  type FinanceDreCompany,
  type FinanceDreCostCenterBreakdownRow,
  type FinanceDreFilters,
  type FinanceDreReport,
} from "@/src/lib/financeDreTypes.js";

/** Pessoas jurídicas distintas do grupo (CNPJ próprio) — filtro "Todas as empresas". */
export const FINANCE_DRE_LEGAL_ENTITY_COMPANIES: Exclude<FinanceDreCompany, "all">[] = [
  "lazarios",
  "koppetel",
  "sm",
];

export function financeDreCompanyLabel(company: FinanceDreCompany): string {
  switch (company) {
    case "lazarios":
      return "Lazarios";
    case "koppetel":
      return "Koppetel";
    case "sm":
      return "SM";
    default:
      return "Todas as empresas";
  }
}

function sumSeriesSafeLocal(a: number[], b: number[]): number[] {
  return Array.from({ length: 12 }, (_, i) => roundDreMoney((a[i] ?? 0) + (b[i] ?? 0)));
}

/**
 * Séries BRUTAS de 12 meses das fontes oficiais para um (year, company) —
 * SEM clamp temporal e SEM bucketing por papel (ambos são read-time).
 * É exatamente o que o snapshot anual materializa.
 */
export type FinanceDreRawSourceSeries = {
  year: number;
  company: FinanceDreCompany;
  /** SUM(valorLiquido) NF-e MARKET_REVENUE por mês de emissão. */
  receitaBrutaByMonth: number[];
  deductions: {
    cofins: number[];
    icms: number[];
    icmsSt: number[];
    ipi: number[];
    pis: number[];
    devolucoes: number[];
    taxSummaryGapCount: number;
  };
  cmv: {
    cmvByMonth: number[];
    missingItemsRevenueByMonth: number[];
    missingProductRevenueByMonth: number[];
    missingCostRevenueByMonth: number[];
    missingItemsNfeCount: number;
    missingProductLineCount: number;
    missingCostLineCount: number;
    pricedLineCount: number;
  };
  costCenters: {
    /** Gasto AP mensal agregado por centro de custo (série oficial byCostCenter). */
    byCostCenter: Array<{
      costCenterId: string;
      code: string;
      name: string;
      byMonth: number[];
    }>;
    /** AP sem centro de custo (totals.unclassifiedAmount). */
    unclassifiedByMonth: number[];
  };
};

export type DreSeriesBundle = {
  mathInput: FinanceDreMathInput;
  costCenterBreakdown: FinanceDreCostCenterBreakdownRow[];
  unclassifiedYtd: number;
  gapRevenueByMonth: number[];
  gapLineCount: number;
  missingItemsRevenueByMonth: number[];
  missingProductRevenueByMonth: number[];
  missingCostRevenueByMonth: number[];
  personnel: number[];
  taxCc: number[];
  rawMaterial: number[];
  unclassified: number[];
  pricedLineCount: number;
  taxSummaryGapCount: number;
};

const ROLE_LABELS = DRE_COST_CENTER_ROLE_LABELS;

/**
 * Deriva o bundle (mathInput + breakdown + qualidade) das séries brutas.
 * Mesma matemática do caminho live anterior — apenas movida para função pura.
 */
export function deriveFinanceDreSeriesBundle(
  raw: FinanceDreRawSourceSeries,
  filters: Pick<FinanceDreFilters, "year" | "highlightMonth">,
  availableThroughMonth: number,
  roleMap: ReadonlyMap<string, DreCostCenterRole> | null
): DreSeriesBundle {
  const ccRows: Array<{
    month: number;
    year: number;
    costCenterId?: string;
    code: string;
    name: string;
    amount: number;
  }> = [];
  for (const cc of raw.costCenters.byCostCenter) {
    for (let month = 1; month <= 12; month += 1) {
      const amount = cc.byMonth[month - 1] ?? 0;
      if (amount === 0) continue;
      ccRows.push({
        month,
        year: filters.year,
        costCenterId: cc.costCenterId,
        code: cc.code,
        name: cc.name,
        amount,
      });
    }
  }
  const unclassifiedRows = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    year: filters.year,
    unclassifiedAmount: raw.costCenters.unclassifiedByMonth[i] ?? 0,
  }));

  const { buckets: ccBuckets, roleRows } = bucketCostCenterSpendByDreRole(
    ccRows,
    filters.year,
    unclassifiedRows,
    filters.highlightMonth,
    roleMap
  );

  const despesasAdmin = sumSeriesSafeLocal(ccBuckets.admin, ccBuckets.unclassified);
  const unclassifiedYtd = ytdThroughMonth(ccBuckets.unclassified, filters.highlightMonth);

  const gapRevenueByMonth = sumSeriesSafeLocal(
    sumSeriesSafeLocal(
      raw.cmv.missingItemsRevenueByMonth,
      raw.cmv.missingProductRevenueByMonth
    ),
    raw.cmv.missingCostRevenueByMonth
  );
  const gapRevenueYtd = ytdThroughMonth(gapRevenueByMonth, filters.highlightMonth);
  const gapLineCount =
    raw.cmv.missingItemsNfeCount +
    raw.cmv.missingProductLineCount +
    raw.cmv.missingCostLineCount;

  const costCenterBreakdown: FinanceDreCostCenterBreakdownRow[] = roleRows.map((row) => ({
    costCenterId: row.costCenterId,
    code: row.code,
    name: row.name,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role],
    highlightAmount: row.highlightAmount,
    ytdAmount: row.ytdAmount,
  }));

  const clamp = (series: number[]) => zeroDreSeriesAfterMonth(series, availableThroughMonth);

  const mathInput: FinanceDreMathInput = {
    highlightMonth: filters.highlightMonth,
    availableThroughMonth,
    receitaBruta: clamp(raw.receitaBrutaByMonth),
    cofins: clamp(raw.deductions.cofins),
    icms: clamp(raw.deductions.icms),
    icmsSt: clamp(raw.deductions.icmsSt),
    ipi: clamp(raw.deductions.ipi),
    pis: clamp(raw.deductions.pis),
    devolucoes: clamp(raw.deductions.devolucoes),
    cmv: clamp(raw.cmv.cmvByMonth),
    fretes: clamp(ccBuckets.logistics),
    embalagens: clamp(ccBuckets.packaging),
    despesasAdmin: clamp(despesasAdmin),
    investimentoSocios: clamp(ccBuckets.partnerInvestment),
    despesasPessoal: clamp(ccBuckets.personnel),
    impostosCc: clamp(ccBuckets.tax),
    materiaPrimaCc: clamp(ccBuckets.rawMaterial),
    unclassifiedCcAmount: clamp(ccBuckets.unclassified),
    quality: {
      unlinkedNfeCount: gapLineCount,
      unlinkedNfeRevenue: gapRevenueYtd,
      taxSummaryGapCount: raw.deductions.taxSummaryGapCount,
      missingItemsNfeCount: raw.cmv.missingItemsNfeCount,
      missingProductLineCount: raw.cmv.missingProductLineCount,
      missingCostLineCount: raw.cmv.missingCostLineCount,
      pricedLineCount: raw.cmv.pricedLineCount,
    },
  };

  return {
    mathInput,
    costCenterBreakdown,
    unclassifiedYtd,
    gapRevenueByMonth: clamp(gapRevenueByMonth),
    gapLineCount,
    missingItemsRevenueByMonth: clamp(raw.cmv.missingItemsRevenueByMonth),
    missingProductRevenueByMonth: clamp(raw.cmv.missingProductRevenueByMonth),
    missingCostRevenueByMonth: clamp(raw.cmv.missingCostRevenueByMonth),
    personnel: clamp(ccBuckets.personnel),
    taxCc: clamp(ccBuckets.tax),
    rawMaterial: clamp(ccBuckets.rawMaterial),
    unclassified: clamp(ccBuckets.unclassified),
    pricedLineCount: raw.cmv.pricedLineCount,
    taxSummaryGapCount: raw.deductions.taxSummaryGapCount,
  };
}

/** Override IRPJ/CSLL por pessoa jurídica (company=all) a partir das séries brutas por PJ. */
export function buildPerEntityTaxOverrideFromRaws(
  perEntityRaws: readonly FinanceDreRawSourceSeries[],
  filters: Pick<FinanceDreFilters, "year" | "highlightMonth">,
  availableThroughMonth: number,
  roleMap: ReadonlyMap<string, DreCostCenterRole> | null
): FinanceDreEstimatedCorporateTaxesBlock {
  const entities: FinanceDreTaxEntitySeries[] = FINANCE_DRE_LEGAL_ENTITY_COMPANIES.map(
    (company, idx) => {
      const raw = perEntityRaws[idx];
      const bundle = raw
        ? deriveFinanceDreSeriesBundle(raw, filters, availableThroughMonth, roleMap)
        : null;
      const cnpj =
        mapExecutiveReportCompanyToEmitterCnpj(company) ??
        FINANCE_INTERNAL_GROUP_COMPANIES.find((c) =>
          c.aliases.some((a) => a.toLowerCase().includes(company))
        )?.cnpj ??
        "";
      return {
        companyKey: company,
        companyLabel: financeDreCompanyLabel(company),
        cnpjDigits: cnpj,
        baseByMonth: bundle
          ? computeFinanceDreEstimatedTaxBaseSeries(bundle.mathInput)
          : emptyDreSeries(),
      };
    }
  );
  return buildEstimatedCorporateTaxSeriesFromEntityBases(
    entities,
    filters.highlightMonth,
    "per_legal_entity"
  );
}

export type FinanceDreReportComputationInput = {
  filters: FinanceDreFilters;
  /** Resolvido em read-time por resolveFinanceDreAvailableThroughMonth. */
  availableThroughMonth: number;
  /** RoleMap vigente (read-time) — null usa apenas o classificador. */
  roleMap: ReadonlyMap<string, DreCostCenterRole> | null;
  consolidated: FinanceDreRawSourceSeries;
  /**
   * Para company=all: séries por PJ na ordem FINANCE_DRE_LEGAL_ENTITY_COMPANIES
   * (para IRPJ/CSLL por pessoa jurídica). Ignorado para PJ única.
   */
  perEntity: readonly FinanceDreRawSourceSeries[] | null;
  /** Determinístico para testes; default = agora. */
  generatedAt?: string;
};

/**
 * Monta o FinanceDreReport completo (linhas, KPIs, impostos estimados,
 * sourceChecks, informativo, breakdown, alertas) — pura; usada pelo caminho
 * live e pelo caminho de snapshot.
 */
export function buildFinanceDreReportFromRawSources(
  input: FinanceDreReportComputationInput
): FinanceDreReport {
  const { filters, availableThroughMonth, roleMap } = input;

  const consolidated = deriveFinanceDreSeriesBundle(
    input.consolidated,
    filters,
    availableThroughMonth,
    roleMap
  );

  const estimatedCorporateTaxesOverride =
    filters.company === "all" && input.perEntity
      ? buildPerEntityTaxOverrideFromRaws(
          input.perEntity,
          filters,
          availableThroughMonth,
          roleMap
        )
      : undefined;

  const { lines, kpis, qualityAlerts, estimatedCorporateTaxes } = buildFinanceDreLines({
    ...consolidated.mathInput,
    estimatedCorporateTaxesOverride,
  });

  const sourceChecks = buildFinanceDreSourceChecks({
    unlinkedNfeCount: consolidated.gapLineCount,
    taxSummaryGapCount: consolidated.taxSummaryGapCount,
    unclassifiedYtd: consolidated.unclassifiedYtd,
    pricedLineCount: consolidated.pricedLineCount,
  });

  const informativeReport = buildFinanceDreInformativeReport({
    highlightMonth: filters.highlightMonth,
    despesasPessoal: consolidated.personnel,
    impostosCc: consolidated.taxCc,
    materiaPrimaCc: consolidated.rawMaterial,
    unclassifiedCcAmount: consolidated.unclassified,
    unlinkedNfeRevenueByMonth: consolidated.gapRevenueByMonth,
    unlinkedNfeCount: consolidated.gapLineCount,
    missingItemsNfeCount: consolidated.mathInput.quality.missingItemsNfeCount,
    missingItemsRevenueByMonth: consolidated.missingItemsRevenueByMonth,
    missingProductLineCount: consolidated.mathInput.quality.missingProductLineCount,
    missingProductRevenueByMonth: consolidated.missingProductRevenueByMonth,
    missingCostLineCount: consolidated.mathInput.quality.missingCostLineCount,
    missingCostRevenueByMonth: consolidated.missingCostRevenueByMonth,
  });

  const monthName =
    financeDreMonthLabels()[filters.highlightMonth - 1] ?? String(filters.highlightMonth);
  const consolidationHint =
    estimatedCorporateTaxes.consolidationMode === "per_legal_entity"
      ? " IRPJ/CSLL estimados por pessoa jurídica (CNPJ) e somados — sem compensação entre empresas."
      : "";
  const ytdHint =
    " YTD de IRPJ/CSLL = soma das estimativas mensais independentes (não é apuração acumulada com limite × meses).";

  return {
    schemaVersion: 1,
    title: "DRE Gerencial Mensal",
    subtitle: `${financeDreCompanyLabel(filters.company)} · ${monthName}/${filters.year} · competência emissão NF-e`,
    disclaimer:
      "Demonstrativo gerencial para o conselho. Não substitui o DRE contábil. Receita = NF-e emitida; CMV = quantidade faturada × custo vigente na data da nota; despesas via centros de custo. " +
      FINANCE_DRE_ESTIMATED_TAX_DISCLAIMER +
      consolidationHint +
      ytdHint,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    filters,
    companyLabel: financeDreCompanyLabel(filters.company),
    monthLabels: financeDreMonthLabels(),
    kpis,
    lines,
    estimatedCorporateTaxes,
    sourceChecks,
    informativeReport,
    costCenterBreakdown: consolidated.costCenterBreakdown,
    qualityAlerts,
    sources: FINANCE_DRE_OFFICIAL_SOURCES,
  };
}
