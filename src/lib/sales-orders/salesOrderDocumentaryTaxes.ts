/**
 * TRIB-04 — Extração/consolidação de tributos documentais (camada A).
 *
 * Fonte oficial: NomusNfeFiscalSummary + NomusNfeTaxLine (HEADER).
 * Não recalcula imposto por alíquota quando o valor oficial existe.
 * Não interpreta como “impostos pagos”.
 */

import { roundMoney } from "@/src/lib/commissions/commission-money.shared.js";
import {
  filterPresentTaxAmounts,
  labelForFiscalTaxType,
  sortFiscalTaxAmounts,
  type SalesOrderFiscalTaxAmount,
} from "./salesOrderFiscalTaxesClient.js";

export { filterPresentTaxAmounts } from "./salesOrderFiscalTaxesClient.js";

/** Mapeamento dos totais oficiais do resumo → taxType HEADER. */
export const DOCUMENTARY_SUMMARY_TAX_FIELDS = [
  { field: "vICMS", taxType: "ICMS", baseField: "vBC" },
  { field: "vICMSDeson", taxType: "ICMS_DESON", baseField: null },
  { field: "vST", taxType: "ICMS_ST", baseField: "vBCST" },
  { field: "vFCP", taxType: "FCP", baseField: null },
  { field: "vFCPST", taxType: "FCP_ST", baseField: null },
  { field: "vFCPSTRet", taxType: "FCP_ST_RET", baseField: null },
  { field: "vIPI", taxType: "IPI", baseField: null },
  { field: "vIPIDevol", taxType: "IPI_DEVOL", baseField: null },
  { field: "vPIS", taxType: "PIS", baseField: null },
  { field: "vCOFINS", taxType: "COFINS", baseField: null },
  { field: "vII", taxType: "II", baseField: null },
  { field: "vISS", taxType: "ISS", baseField: null },
] as const;

export type DocumentarySummaryTaxTotals = {
  vICMS?: unknown;
  vICMSDeson?: unknown;
  vST?: unknown;
  vFCP?: unknown;
  vFCPST?: unknown;
  vFCPSTRet?: unknown;
  vIPI?: unknown;
  vIPIDevol?: unknown;
  vPIS?: unknown;
  vCOFINS?: unknown;
  vII?: unknown;
  vISS?: unknown;
  vBC?: unknown;
  vBCST?: unknown;
};

export type DocumentaryTaxLineInput = {
  taxType: string;
  scope: string;
  amount: unknown;
  baseAmount?: unknown;
  rate?: unknown;
};

/** Centavos inteiros via `roundMoney` — evita Number comum em somas. */
export function toDocumentaryMoneyCents(value: number): number {
  return Math.round(roundMoney(value) * 100);
}

export function fromDocumentaryMoneyCents(cents: number): number {
  return roundMoney(cents / 100);
}

/** Converte Decimal/number; null se ausente ou inválido (0 é valor válido). */
export function parseDocumentaryMoney(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? roundMoney(value) : null;
  }
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? roundMoney(n) : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(",", ".").trim());
    return Number.isFinite(n) ? roundMoney(n) : null;
  }
  return null;
}

/**
 * Soma monetária em centavos.
 * `null`/ausente é ignorado; `0` entra na soma.
 * Se nenhum valor presente → 0 (contrato do resumo consolidado).
 */
export function sumDocumentaryMoney(
  values: ReadonlyArray<number | null | undefined>
): number {
  let cents = 0;
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    cents += toDocumentaryMoneyCents(value);
  }
  return fromDocumentaryMoneyCents(cents);
}

/**
 * Deduplica NF-es do audit por `nfeExternalId` (primeira ocorrência vence).
 * Evita consolidar duas vezes a mesma NF vindas de fontes distintas.
 */
export function dedupeDocumentaryNfesByExternalId<
  T extends { nfeExternalId: number },
>(nfes: readonly T[]): T[] {
  const seen = new Map<number, T>();
  for (const nfe of nfes) {
    if (!Number.isFinite(nfe.nfeExternalId)) continue;
    if (!seen.has(nfe.nfeExternalId)) {
      seen.set(nfe.nfeExternalId, nfe);
    }
  }
  return [...seen.values()];
}

type MutableTax = {
  taxType: string;
  amountCents: number;
  baseAmountCents: number | null;
  hasBase: boolean;
};

/**
 * Monta HEADER a partir de TaxLines + totais do summary.
 * - amount presente (incl. 0) entra;
 * - amount ausente não inventa via rate×base;
 * - summary preenche taxType ainda sem linha.
 */
export function buildDocumentaryHeaderTaxes(input: {
  taxLines?: readonly DocumentaryTaxLineInput[] | null;
  summaryTotals?: DocumentarySummaryTaxTotals | null;
}): SalesOrderFiscalTaxAmount[] {
  const byType = new Map<string, MutableTax>();

  for (const line of input.taxLines ?? []) {
    if (line.scope !== "HEADER") continue;
    const amount = parseDocumentaryMoney(line.amount);
    if (amount == null) continue; // ausente ≠ zero; não recalcular por alíquota
    const taxType = String(line.taxType ?? "").trim();
    if (!taxType) continue;
    const base = parseDocumentaryMoney(line.baseAmount);
    const cur = byType.get(taxType);
    if (!cur) {
      byType.set(taxType, {
        taxType,
        amountCents: toDocumentaryMoneyCents(amount),
        baseAmountCents: base == null ? null : toDocumentaryMoneyCents(base),
        hasBase: base != null,
      });
    } else {
      cur.amountCents += toDocumentaryMoneyCents(amount);
      if (base != null) {
        cur.baseAmountCents =
          (cur.baseAmountCents ?? 0) + toDocumentaryMoneyCents(base);
        cur.hasBase = true;
      }
    }
  }

  const totals = input.summaryTotals ?? null;
  if (totals) {
    for (const row of DOCUMENTARY_SUMMARY_TAX_FIELDS) {
      if (byType.has(row.taxType)) continue;
      const amount = parseDocumentaryMoney(
        (totals as Record<string, unknown>)[row.field]
      );
      if (amount == null) continue;
      const base =
        row.baseField != null
          ? parseDocumentaryMoney(
              (totals as Record<string, unknown>)[row.baseField]
            )
          : null;
      byType.set(row.taxType, {
        taxType: row.taxType,
        amountCents: toDocumentaryMoneyCents(amount),
        baseAmountCents: base == null ? null : toDocumentaryMoneyCents(base),
        hasBase: base != null,
      });
    }
  }

  const rows: SalesOrderFiscalTaxAmount[] = [...byType.values()].map((row) => ({
    taxType: row.taxType,
    label: labelForFiscalTaxType(row.taxType),
    amount: fromDocumentaryMoneyCents(row.amountCents),
    baseAmount: row.hasBase
      ? fromDocumentaryMoneyCents(row.baseAmountCents ?? 0)
      : null,
  }));

  return sortFiscalTaxAmounts(rows);
}

/**
 * Consolida HEADER de várias NF-es válidas (já deduplicadas).
 * Soma em centavos; zeros oficiais permanecem.
 */
export function consolidateDocumentaryHeaderTaxes(
  perNfeHeaderTaxes: ReadonlyArray<readonly SalesOrderFiscalTaxAmount[]>
): SalesOrderFiscalTaxAmount[] {
  const map = new Map<
    string,
    { amountCents: number; baseAmountCents: number | null; hasBase: boolean }
  >();

  for (const taxes of perNfeHeaderTaxes) {
    for (const t of taxes) {
      if (t.taxType === "OTHER") continue;
      if (t.amount == null || !Number.isFinite(t.amount) || t.amount < 0) continue;
      const cur = map.get(t.taxType) ?? {
        amountCents: 0,
        baseAmountCents: null,
        hasBase: false,
      };
      cur.amountCents += toDocumentaryMoneyCents(t.amount);
      if (t.baseAmount != null && Number.isFinite(t.baseAmount)) {
        cur.baseAmountCents =
          (cur.baseAmountCents ?? 0) + toDocumentaryMoneyCents(t.baseAmount);
        cur.hasBase = true;
      }
      map.set(t.taxType, cur);
    }
  }

  // Fallback OTHER só se não houver nenhum tipado.
  if (map.size === 0) {
    for (const taxes of perNfeHeaderTaxes) {
      for (const t of taxes) {
        if (t.amount == null || !Number.isFinite(t.amount) || t.amount < 0) continue;
        const cur = map.get(t.taxType) ?? {
          amountCents: 0,
          baseAmountCents: null,
          hasBase: false,
        };
        cur.amountCents += toDocumentaryMoneyCents(t.amount);
        map.set(t.taxType, cur);
      }
    }
  }

  return filterPresentTaxAmounts(
    [...map.entries()].map(([taxType, row]) => ({
      taxType,
      label: labelForFiscalTaxType(taxType),
      amount: fromDocumentaryMoneyCents(row.amountCents),
      baseAmount: row.hasBase
        ? fromDocumentaryMoneyCents(row.baseAmountCents ?? 0)
        : null,
    }))
  );
}

/** Produtos líquidos documentais: vProd − vDesc quando ambos existem. */
export function resolveDocumentaryProductsNet(input: {
  productsValue: number | null;
  discountsValue: number | null;
}): number | null {
  if (input.productsValue == null) return null;
  if (input.discountsValue == null) return input.productsValue;
  return fromDocumentaryMoneyCents(
    Math.max(
      0,
      toDocumentaryMoneyCents(input.productsValue) -
        toDocumentaryMoneyCents(input.discountsValue)
    )
  );
}
