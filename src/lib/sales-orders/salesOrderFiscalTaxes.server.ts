/**
 * Monta o DTO da aba Tributos a partir das NFs do pedido + resumos fiscais T02.
 * Uma query para summaries/lines — sem N+1.
 */

import type { PrismaClient } from "@prisma/client";
import { NFE_FISCAL_PARSER_VERSION } from "@/src/lib/nfeFiscalXmlParser.js";
import {
  computeAmountToInvoice,
  resolveFinancialBalanceFromCr,
} from "@/src/lib/sales/orderFiscalFinancialMetrics.js";
import type { OrderFullAuditNfe, OrderFullAuditPayload } from "@/src/lib/finance/orderFullAuditClient.js";
import {
  filterPositiveTaxAmounts,
  labelForFiscalTaxType,
  type SalesOrderFiscalNfeDto,
  type SalesOrderFiscalTaxAmount,
  type SalesOrderFiscalTaxLineDto,
  type SalesOrderFiscalTaxesPayload,
} from "./salesOrderFiscalTaxesClient.js";

type PrismaLike = PrismaClient;

function round2(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function dec(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

function aggregateHeaderTaxes(
  lines: Array<{ taxType: string; amount: unknown; scope: string }>
): SalesOrderFiscalTaxAmount[] {
  const map = new Map<string, number>();
  for (const line of lines) {
    if (line.scope !== "HEADER") continue;
    const amount = dec(line.amount);
    if (amount == null) continue;
    map.set(line.taxType, round2((map.get(line.taxType) ?? 0) + amount));
  }
  return filterPositiveTaxAmounts(
    [...map.entries()].map(([taxType, amount]) => ({
      taxType,
      label: labelForFiscalTaxType(taxType),
      amount,
    }))
  );
}

function mapItemLines(
  lines: Array<{
    lineKey: string;
    taxType: string;
    scope: string;
    itemNumber: number | null;
    baseAmount: unknown;
    rate: unknown;
    amount: unknown;
    cst: string | null;
    csosn: string | null;
    cfop: string | null;
    ncm: string | null;
    metadata: unknown;
  }>
): SalesOrderFiscalTaxLineDto[] {
  return lines
    .filter((l) => l.scope === "ITEM")
    .map((l) => {
      const meta =
        l.metadata && typeof l.metadata === "object"
          ? (l.metadata as Record<string, unknown>)
          : null;
      return {
        lineKey: l.lineKey,
        taxType: l.taxType,
        label: labelForFiscalTaxType(l.taxType),
        scope: "ITEM" as const,
        itemNumber: l.itemNumber,
        baseAmount: dec(l.baseAmount),
        rate: dec(l.rate),
        amount: dec(l.amount),
        cst: l.cst,
        csosn: l.csosn,
        cfop: l.cfop,
        ncm: l.ncm,
        productSku: typeof meta?.productSku === "string" ? meta.productSku : null,
        productName: typeof meta?.productName === "string" ? meta.productName : null,
      };
    });
}

function buildNfeDto(
  auditNfe: OrderFullAuditNfe,
  fiscal: {
    id: string;
    finalidade: number | null;
    vProd: unknown;
    vDesc: unknown;
    vFrete: unknown;
    vSeg: unknown;
    vOutro: unknown;
    vNF: unknown;
    highlightedResidual: unknown;
    parsedAt: Date;
    parserVersion: string;
    source: string;
    qualityAlert: string | null;
    taxLines: Array<{
      lineKey: string;
      taxType: string;
      scope: string;
      itemNumber: number | null;
      baseAmount: unknown;
      rate: unknown;
      amount: unknown;
      cst: string | null;
      csosn: string | null;
      cfop: string | null;
      ncm: string | null;
      metadata: unknown;
    }>;
  } | null
): SalesOrderFiscalNfeDto {
  const isCancelled = auditNfe.isCanceled;
  const isValidForTotals = !isCancelled && auditNfe.isValidForBilling !== false;

  if (!fiscal) {
    const products = auditNfe.valorLiquido;
    const total = auditNfe.valorTotal;
    const highlighted = auditNfe.highlightedTaxesValue;
    const compositionIncomplete =
      highlighted != null && highlighted > 0.05;
    return {
      nomusNfeId: null,
      nfeExternalId: auditNfe.nfeExternalId,
      numero: auditNfe.numero,
      serie: auditNfe.serie,
      chave: auditNfe.chave,
      emissionDate: auditNfe.dataEmissao ?? auditNfe.dataProcessamento,
      status: auditNfe.status,
      statusLabel: auditNfe.statusLabel,
      isCancelled,
      isValidForTotals,
      finalidade: null,
      productsValue: products,
      discountsValue: null,
      freightValue: null,
      insuranceValue: null,
      otherExpensesValue: null,
      taxesTotalHeader: highlighted,
      highlightedTaxesFallback: highlighted,
      totalValue: total,
      compositionIncomplete,
      source: products != null && total != null ? "HEADER_DIFF" : "MISSING",
      parsedAt: null,
      parserVersion: null,
      headerTaxes:
        highlighted != null && highlighted > 0.009
          ? [
              {
                taxType: "OTHER",
                label: "Destacados (agregado)",
                amount: round2(highlighted),
              },
            ]
          : [],
      itemTaxLines: [],
    };
  }

  const headerTaxes = aggregateHeaderTaxes(fiscal.taxLines);
  const taxesTotalHeader = round2(
    headerTaxes.reduce((acc, t) => acc + t.amount, 0)
  );
  const residual = dec(fiscal.highlightedResidual) ?? 0;
  const compositionIncomplete =
    residual > 0.05 ||
    fiscal.source === "PARTIAL" ||
    fiscal.source === "MISSING" ||
    (headerTaxes.length === 0 &&
      (dec(fiscal.vNF) ?? 0) - ((dec(fiscal.vProd) ?? 0) - (dec(fiscal.vDesc) ?? 0)) >
        0.05);

  return {
    nomusNfeId: fiscal.id,
    nfeExternalId: auditNfe.nfeExternalId,
    numero: auditNfe.numero,
    serie: auditNfe.serie,
    chave: auditNfe.chave,
    emissionDate: auditNfe.dataEmissao ?? auditNfe.dataProcessamento,
    status: auditNfe.status,
    statusLabel: auditNfe.statusLabel,
    isCancelled,
    isValidForTotals,
    finalidade: fiscal.finalidade,
    productsValue: dec(fiscal.vProd),
    discountsValue: dec(fiscal.vDesc),
    freightValue: dec(fiscal.vFrete),
    insuranceValue: dec(fiscal.vSeg),
    otherExpensesValue: dec(fiscal.vOutro),
    taxesTotalHeader: headerTaxes.length ? taxesTotalHeader : auditNfe.highlightedTaxesValue,
    highlightedTaxesFallback: auditNfe.highlightedTaxesValue,
    totalValue: dec(fiscal.vNF) ?? auditNfe.valorTotal,
    compositionIncomplete,
    source: "FISCAL_SUMMARY",
    parsedAt: iso(fiscal.parsedAt),
    parserVersion: fiscal.parserVersion,
    headerTaxes,
    itemTaxLines: mapItemLines(fiscal.taxLines),
  };
}

export async function buildSalesOrderFiscalTaxesPayload(
  prisma: PrismaLike,
  audit: OrderFullAuditPayload
): Promise<SalesOrderFiscalTaxesPayload> {
  const nfes = audit.nfes ?? [];
  const externalIds = nfes.map((n) => n.nfeExternalId);

  const nomusRows =
    externalIds.length === 0
      ? []
      : await prisma.nomusNfe.findMany({
          where: { externalId: { in: externalIds } },
          select: {
            id: true,
            externalId: true,
            fiscalSummary: {
              select: {
                id: true,
                finalidade: true,
                vProd: true,
                vDesc: true,
                vFrete: true,
                vSeg: true,
                vOutro: true,
                vNF: true,
                highlightedResidual: true,
                parsedAt: true,
                parserVersion: true,
                source: true,
                qualityAlert: true,
                taxLines: {
                  select: {
                    lineKey: true,
                    taxType: true,
                    scope: true,
                    itemNumber: true,
                    baseAmount: true,
                    rate: true,
                    amount: true,
                    cst: true,
                    csosn: true,
                    cfop: true,
                    ncm: true,
                    metadata: true,
                  },
                },
              },
            },
          },
        });

  const byExternal = new Map(
    nomusRows.map((r) => [r.externalId, r] as const)
  );

  const built: SalesOrderFiscalNfeDto[] = nfes.map((nfe) => {
    const row = byExternal.get(nfe.nfeExternalId);
    const summary = row?.fiscalSummary
      ? { ...row.fiscalSummary, id: row.id }
      : null;
    // fiscalSummary.id is summary id; we need nomusNfeId = row.id
    const fiscal = row?.fiscalSummary
      ? {
          id: row.id,
          finalidade: row.fiscalSummary.finalidade,
          vProd: row.fiscalSummary.vProd,
          vDesc: row.fiscalSummary.vDesc,
          vFrete: row.fiscalSummary.vFrete,
          vSeg: row.fiscalSummary.vSeg,
          vOutro: row.fiscalSummary.vOutro,
          vNF: row.fiscalSummary.vNF,
          highlightedResidual: row.fiscalSummary.highlightedResidual,
          parsedAt: row.fiscalSummary.parsedAt,
          parserVersion: row.fiscalSummary.parserVersion,
          source: row.fiscalSummary.source,
          qualityAlert: row.fiscalSummary.qualityAlert,
          taxLines: row.fiscalSummary.taxLines,
        }
      : null;
    void summary;
    return buildNfeDto(nfe, fiscal);
  });

  const valid = built.filter((n) => n.isValidForTotals);
  const cancelled = built.filter((n) => n.isCancelled);
  const activeNfes = built.filter((n) => !n.isCancelled);

  const sum = (pick: (n: SalesOrderFiscalNfeDto) => number | null) =>
    round2(valid.reduce((acc, n) => acc + (pick(n) ?? 0), 0));

  /** Produtos líquidos = vProd − vDesc (quando ambos existem). */
  const productsValue = sum((n) => {
    if (n.productsValue != null && n.discountsValue != null) {
      return Math.max(0, n.productsValue - n.discountsValue);
    }
    return n.productsValue;
  });
  const discountsValue = sum((n) => n.discountsValue);
  const freightValue = sum((n) => n.freightValue);
  const insuranceValue = sum((n) => n.insuranceValue);
  const otherExpensesValue = sum((n) => n.otherExpensesValue);
  const nfeValidTotal = sum((n) => n.totalValue);

  const taxMap = new Map<string, number>();
  for (const nfe of valid) {
    for (const t of nfe.headerTaxes) {
      if (t.taxType === "OTHER" && nfe.source !== "FISCAL_SUMMARY") continue;
      taxMap.set(t.taxType, round2((taxMap.get(t.taxType) ?? 0) + t.amount));
    }
  }
  // Se nenhuma composição tipada, exibir fallback agregado (HEADER_DIFF).
  if (taxMap.size === 0) {
    for (const nfe of valid) {
      for (const t of nfe.headerTaxes) {
        taxMap.set(t.taxType, round2((taxMap.get(t.taxType) ?? 0) + t.amount));
      }
    }
  }

  const highlightedTaxes = filterPositiveTaxAmounts(
    [...taxMap.entries()].map(([taxType, amount]) => ({
      taxType,
      label: labelForFiscalTaxType(taxType),
      amount,
    }))
  );

  const orderActiveValue = round2(audit.summary.activeOrderValue ?? 0);
  const amountToInvoice = computeAmountToInvoice(orderActiveValue, nfeValidTotal);

  const hasCr = (audit.receivables?.length ?? 0) > 0;
  const financialBalance = resolveFinancialBalanceFromCr({
    hasOfficialCr: hasCr,
    crOriginal: audit.receivablesTotal?.totalAmount ?? 0,
    crReceived: audit.receivablesTotal?.receivedAmount ?? 0,
    crOpen: audit.receivablesTotal?.openAmount ?? 0,
  });

  const compositionIncomplete = valid.some((n) => n.compositionIncomplete);
  const lastParsedAt =
    built
      .map((n) => n.parsedAt)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null;
  const parserVersion =
    built.find((n) => n.parserVersion)?.parserVersion ?? NFE_FISCAL_PARSER_VERSION;

  // Enriquecer ITEM com SKU/nome do audit.nfeItems (sem N+1).
  const nfeItems = audit.nfeItems ?? [];
  const itemMetaByKey = new Map<string, { sku: string | null; name: string | null; qty: number | null; value: number | null }>();
  for (const it of nfeItems) {
    const idx = it.nfeItemIndex;
    if (idx == null) continue;
    itemMetaByKey.set(`${it.nfeExternalId}:${idx}`, {
      sku: it.productSku,
      name: it.productName,
      qty: it.quantityNfe,
      value: it.totalValueNfe,
    });
  }

  const itemTaxLines = activeNfes.flatMap((n) =>
    n.itemTaxLines.map((line) => {
      const meta =
        line.itemNumber != null
          ? itemMetaByKey.get(`${n.nfeExternalId}:${line.itemNumber}`)
          : null;
      return {
        ...line,
        productSku: line.productSku ?? meta?.sku ?? null,
        productName: line.productName ?? meta?.name ?? null,
        quantity: meta?.qty ?? null,
        itemValue: meta?.value ?? null,
        nfeExternalId: n.nfeExternalId,
        nfeNumero: n.numero,
      };
    })
  );

  return {
    summary: {
      orderActiveValue,
      productsValue,
      discountsValue,
      freightValue,
      insuranceValue,
      otherExpensesValue,
      nfeValidTotal,
      amountToInvoice,
      financialBalance,
      financialBalanceLabel:
        financialBalance == null
          ? "Sem CR gerado"
          : `R$ ${financialBalance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
      validNfeCount: valid.length,
      cancelledNfeCount: cancelled.length,
      compositionIncomplete,
      compositionIncompleteReason: compositionIncomplete
        ? "Composição não totalmente disponível"
        : null,
      sourceLabel: "XML NF-e",
      lastParsedAt,
      parserVersion,
    },
    highlightedTaxes,
    nfes: activeNfes,
    cancelledNfes: cancelled,
    itemTaxLines,
    technical: {
      source: "NomusNfeFiscalSummary + NomusNfeTaxLine (HEADER) · fallback highlightedTaxes",
      note: "Não somar HEADER e ITEM. Destacados ≠ pagos. Residual ≠ saldo financeiro. Saldo financeiro = CR aberto.",
      doNotSumHeaderAndItem: true,
    },
  };
}
