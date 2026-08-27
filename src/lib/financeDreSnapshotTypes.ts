/**
 * Contrato do payload persistido do snapshot anual da DRE (puro, sem backend).
 *
 * O JSONB nunca é confiado cegamente: `parseFinanceDreSnapshotSeriesPayload`
 * valida shape, tamanhos (séries de 12 meses), números finitos e
 * `schemaVersion`. Qualquer incompatibilidade → `null` (tratado como MISS,
 * nunca como snapshot válido).
 */

import type { FinanceDreRawSourceSeries } from "@/src/lib/financeDreReportBuilder.js";
import type {
  FinanceDreCompany,
  FinanceDreReportSnapshotMeta,
} from "@/src/lib/financeDreTypes.js";

export const FINANCE_DRE_SNAPSHOT_SCHEMA_VERSION = 1;

export const FINANCE_DRE_SNAPSHOT_COMPANIES: readonly FinanceDreCompany[] = [
  "all",
  "lazarios",
  "koppetel",
  "sm",
];

export function isFinanceDreSnapshotCompany(value: unknown): value is FinanceDreCompany {
  return (
    typeof value === "string" &&
    (FINANCE_DRE_SNAPSHOT_COMPANIES as readonly string[]).includes(value)
  );
}

export type FinanceDreSnapshotFreshness = FinanceDreReportSnapshotMeta["freshness"];

export type { FinanceDreReportSnapshotMeta };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseMonthlySeries(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 12) return null;
  const out: number[] = [];
  for (const item of value) {
    if (!isFiniteNumber(item)) return null;
    out.push(item);
  }
  return out;
}

function parseCount(value: unknown): number | null {
  return isFiniteNumber(value) && value >= 0 && Number.isInteger(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Serializa as séries brutas para o JSONB do snapshot.
 * O shape persistido é exatamente `FinanceDreRawSourceSeries` + schemaVersion.
 */
export function serializeFinanceDreSnapshotSeriesPayload(
  raw: FinanceDreRawSourceSeries
): Record<string, unknown> {
  return {
    schemaVersion: FINANCE_DRE_SNAPSHOT_SCHEMA_VERSION,
    year: raw.year,
    company: raw.company,
    receitaBrutaByMonth: [...raw.receitaBrutaByMonth],
    deductions: {
      cofins: [...raw.deductions.cofins],
      icms: [...raw.deductions.icms],
      icmsSt: [...raw.deductions.icmsSt],
      ipi: [...raw.deductions.ipi],
      pis: [...raw.deductions.pis],
      devolucoes: [...raw.deductions.devolucoes],
      taxSummaryGapCount: raw.deductions.taxSummaryGapCount,
    },
    cmv: {
      cmvByMonth: [...raw.cmv.cmvByMonth],
      missingItemsRevenueByMonth: [...raw.cmv.missingItemsRevenueByMonth],
      missingProductRevenueByMonth: [...raw.cmv.missingProductRevenueByMonth],
      missingCostRevenueByMonth: [...raw.cmv.missingCostRevenueByMonth],
      missingItemsNfeCount: raw.cmv.missingItemsNfeCount,
      missingProductLineCount: raw.cmv.missingProductLineCount,
      missingCostLineCount: raw.cmv.missingCostLineCount,
      pricedLineCount: raw.cmv.pricedLineCount,
    },
    costCenters: {
      byCostCenter: raw.costCenters.byCostCenter.map((cc) => ({
        costCenterId: cc.costCenterId,
        code: cc.code,
        name: cc.name,
        byMonth: [...cc.byMonth],
      })),
      unclassifiedByMonth: [...raw.costCenters.unclassifiedByMonth],
    },
  };
}

/**
 * Valida e converte o JSONB persistido de volta para as séries brutas.
 * `null` = payload ausente, corrompido ou de schemaVersion incompatível.
 */
export function parseFinanceDreSnapshotSeriesPayload(
  value: unknown
): FinanceDreRawSourceSeries | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== FINANCE_DRE_SNAPSHOT_SCHEMA_VERSION) return null;
  if (!isFiniteNumber(value.year) || !Number.isInteger(value.year)) return null;
  if (!isFinanceDreSnapshotCompany(value.company)) return null;

  const receitaBrutaByMonth = parseMonthlySeries(value.receitaBrutaByMonth);
  if (!receitaBrutaByMonth) return null;

  if (!isRecord(value.deductions)) return null;
  const d = value.deductions;
  const cofins = parseMonthlySeries(d.cofins);
  const icms = parseMonthlySeries(d.icms);
  const icmsSt = parseMonthlySeries(d.icmsSt);
  const ipi = parseMonthlySeries(d.ipi);
  const pis = parseMonthlySeries(d.pis);
  const devolucoes = parseMonthlySeries(d.devolucoes);
  const taxSummaryGapCount = parseCount(d.taxSummaryGapCount);
  if (!cofins || !icms || !icmsSt || !ipi || !pis || !devolucoes || taxSummaryGapCount == null) {
    return null;
  }

  if (!isRecord(value.cmv)) return null;
  const c = value.cmv;
  const cmvByMonth = parseMonthlySeries(c.cmvByMonth);
  const missingItemsRevenueByMonth = parseMonthlySeries(c.missingItemsRevenueByMonth);
  const missingProductRevenueByMonth = parseMonthlySeries(c.missingProductRevenueByMonth);
  const missingCostRevenueByMonth = parseMonthlySeries(c.missingCostRevenueByMonth);
  const missingItemsNfeCount = parseCount(c.missingItemsNfeCount);
  const missingProductLineCount = parseCount(c.missingProductLineCount);
  const missingCostLineCount = parseCount(c.missingCostLineCount);
  const pricedLineCount = parseCount(c.pricedLineCount);
  if (
    !cmvByMonth ||
    !missingItemsRevenueByMonth ||
    !missingProductRevenueByMonth ||
    !missingCostRevenueByMonth ||
    missingItemsNfeCount == null ||
    missingProductLineCount == null ||
    missingCostLineCount == null ||
    pricedLineCount == null
  ) {
    return null;
  }

  if (!isRecord(value.costCenters)) return null;
  const rawCc = value.costCenters;
  if (!Array.isArray(rawCc.byCostCenter)) return null;
  const byCostCenter: FinanceDreRawSourceSeries["costCenters"]["byCostCenter"] = [];
  for (const entry of rawCc.byCostCenter) {
    if (!isRecord(entry)) return null;
    const byMonth = parseMonthlySeries(entry.byMonth);
    if (
      typeof entry.costCenterId !== "string" ||
      typeof entry.code !== "string" ||
      typeof entry.name !== "string" ||
      !byMonth
    ) {
      return null;
    }
    byCostCenter.push({
      costCenterId: entry.costCenterId,
      code: entry.code,
      name: entry.name,
      byMonth,
    });
  }
  const unclassifiedByMonth = parseMonthlySeries(rawCc.unclassifiedByMonth);
  if (!unclassifiedByMonth) return null;

  return {
    year: value.year,
    company: value.company,
    receitaBrutaByMonth,
    deductions: { cofins, icms, icmsSt, ipi, pis, devolucoes, taxSummaryGapCount },
    cmv: {
      cmvByMonth,
      missingItemsRevenueByMonth,
      missingProductRevenueByMonth,
      missingCostRevenueByMonth,
      missingItemsNfeCount,
      missingProductLineCount,
      missingCostLineCount,
      pricedLineCount,
    },
    costCenters: { byCostCenter, unclassifiedByMonth },
  };
}
