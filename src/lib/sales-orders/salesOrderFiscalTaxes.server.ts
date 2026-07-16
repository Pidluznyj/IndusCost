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
  buildDocumentaryHeaderTaxes,
  consolidateDocumentaryHeaderTaxes,
  dedupeDocumentaryNfesByExternalId,
  fromDocumentaryMoneyCents,
  parseDocumentaryMoney,
  resolveDocumentaryProductsNet,
  sumDocumentaryMoney,
  toDocumentaryMoneyCents,
} from "./salesOrderDocumentaryTaxes.js";
import {
  attachSalesOrderFiscalTaxesContract,
  buildSalesOrderFiscalNfeLinkOrigins,
} from "./salesOrderFiscalTaxesContract.js";
import {
  collectionLabelForGuide,
  emptySalesOrderFiscalSettlementsBlock,
  filterPresentTaxAmounts,
  labelForFiscalTaxType,
  resolveSalesOrderFiscalSettlementStatus,
  SALES_ORDER_FISCAL_SETTLEMENT_STATUS_LABELS,
  type SalesOrderFiscalNfeDto,
  type SalesOrderFiscalSettlementAllocationDto,
  type SalesOrderFiscalSettlementGuideDto,
  type SalesOrderFiscalSettlementHistoryDto,
  type SalesOrderFiscalSettlementsBlock,
  type SalesOrderFiscalTaxAmount,
  type SalesOrderFiscalTaxLineDto,
  type SalesOrderFiscalTaxMatrixRow,
  type SalesOrderFiscalTaxesPayload,
} from "./salesOrderFiscalTaxesClient.js";
import {
  FISCAL_ALLOCATION_METHOD_LABELS,
  FISCAL_GUIDE_STATUS_LABELS,
  FISCAL_GUIDE_TYPE_LABELS,
  type FiscalAllocationMethodCode,
  type FiscalGuideStatusCode,
  type FiscalGuideTypeCode,
} from "@/src/lib/finance/fiscalSettlementClient.js";

type PrismaLike = PrismaClient;

function round2(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return fromDocumentaryMoneyCents(toDocumentaryMoneyCents(n));
}

function dec(value: unknown): number | null {
  return parseDocumentaryMoney(value);
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

function aggregateHeaderTaxes(
  lines: Array<{ taxType: string; amount: unknown; scope: string; baseAmount?: unknown }>,
  summaryTotals?: Parameters<typeof buildDocumentaryHeaderTaxes>[0]["summaryTotals"]
): SalesOrderFiscalTaxAmount[] {
  return buildDocumentaryHeaderTaxes({ taxLines: lines, summaryTotals });
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
      const amount = dec(l.amount);
      // Valor oficial ausente: não recalcular por rate × base.
      return {
        lineKey: l.lineKey,
        taxType: l.taxType,
        label: labelForFiscalTaxType(l.taxType),
        scope: "ITEM" as const,
        itemNumber: l.itemNumber,
        baseAmount: dec(l.baseAmount),
        rate: dec(l.rate),
        amount,
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
      linkOrigin: auditNfe.linkOrigin ?? null,
      linkOrigins: auditNfe.linkOrigin ? [auditNfe.linkOrigin] : [],
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

  const summaryTotals = {
    vICMS: fiscal.vICMS,
    vICMSDeson: fiscal.vICMSDeson,
    vST: fiscal.vST,
    vFCP: fiscal.vFCP,
    vFCPST: fiscal.vFCPST,
    vFCPSTRet: fiscal.vFCPSTRet,
    vIPI: fiscal.vIPI,
    vIPIDevol: fiscal.vIPIDevol,
    vPIS: fiscal.vPIS,
    vCOFINS: fiscal.vCOFINS,
    vII: fiscal.vII,
    vISS: fiscal.vISS,
    vBC: fiscal.vBC,
    vBCST: fiscal.vBCST,
  };

  const headerTaxes = aggregateHeaderTaxes(fiscal.taxLines, summaryTotals);
  const taxesTotalHeader = sumDocumentaryMoney(headerTaxes.map((t) => t.amount));
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
    linkOrigin: auditNfe.linkOrigin ?? null,
    linkOrigins: auditNfe.linkOrigin ? [auditNfe.linkOrigin] : [],
    headerTaxes,
    itemTaxLines: mapItemLines(fiscal.taxLines),
  };
}

export async function buildSalesOrderFiscalTaxesPayload(
  prisma: PrismaLike,
  audit: OrderFullAuditPayload
): Promise<SalesOrderFiscalTaxesPayload> {
  const nfes = dedupeDocumentaryNfesByExternalId(audit.nfes ?? []);
  const externalIds = nfes
    .map((n) => n.nfeExternalId)
    .filter((id) => Number.isFinite(id) && id > 0);

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
                vICMS: true,
                vICMSDeson: true,
                vST: true,
                vFCP: true,
                vFCPST: true,
                vFCPSTRet: true,
                vIPI: true,
                vIPIDevol: true,
                vPIS: true,
                vCOFINS: true,
                vII: true,
                vISS: true,
                vBC: true,
                vBCST: true,
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
          vICMS: row.fiscalSummary.vICMS,
          vICMSDeson: row.fiscalSummary.vICMSDeson,
          vST: row.fiscalSummary.vST,
          vFCP: row.fiscalSummary.vFCP,
          vFCPST: row.fiscalSummary.vFCPST,
          vFCPSTRet: row.fiscalSummary.vFCPSTRet,
          vIPI: row.fiscalSummary.vIPI,
          vIPIDevol: row.fiscalSummary.vIPIDevol,
          vPIS: row.fiscalSummary.vPIS,
          vCOFINS: row.fiscalSummary.vCOFINS,
          vII: row.fiscalSummary.vII,
          vISS: row.fiscalSummary.vISS,
          vBC: row.fiscalSummary.vBC,
          vBCST: row.fiscalSummary.vBCST,
          highlightedResidual: row.fiscalSummary.highlightedResidual,
          parsedAt: row.fiscalSummary.parsedAt,
          parserVersion: row.fiscalSummary.parserVersion,
          source: row.fiscalSummary.source,
          qualityAlert: row.fiscalSummary.qualityAlert,
          taxLines: row.fiscalSummary.taxLines,
        }
      : null;
    return buildNfeDto(nfe, fiscal);
  });

  const valid = built.filter((n) => n.isValidForTotals);
  const cancelled = built.filter((n) => n.isCancelled);
  const activeNfes = built.filter((n) => !n.isCancelled);

  const productsValue = sumDocumentaryMoney(
    valid.map((n) =>
      resolveDocumentaryProductsNet({
        productsValue: n.productsValue,
        discountsValue: n.discountsValue,
      })
    )
  );
  const discountsValue = sumDocumentaryMoney(valid.map((n) => n.discountsValue));
  const freightValue = sumDocumentaryMoney(valid.map((n) => n.freightValue));
  const insuranceValue = sumDocumentaryMoney(valid.map((n) => n.insuranceValue));
  const otherExpensesValue = sumDocumentaryMoney(
    valid.map((n) => n.otherExpensesValue)
  );
  const nfeValidTotal = sumDocumentaryMoney(valid.map((n) => n.totalValue));

  const highlightedTaxes = consolidateDocumentaryHeaderTaxes(
    valid.map((n) => n.headerTaxes)
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

  const nomusNfeIds = built
    .map((n) => n.nomusNfeId)
    .filter((id): id is string => Boolean(id));

  let settlements: SalesOrderFiscalSettlementsBlock;
  try {
    settlements = await buildSalesOrderFiscalSettlementsBlock(prisma, {
      salesOrderId: audit.salesOrderId,
      highlightedTaxes,
      nomusNfeIds,
    });
  } catch (err) {
    console.error("buildSalesOrderFiscalSettlementsBlock", err);
    settlements = emptySalesOrderFiscalSettlementsBlock(new Date().toISOString());
  }

  return attachSalesOrderFiscalTaxesContract(
    {
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
      highlightedTaxes: filterPresentTaxAmounts(highlightedTaxes),
      nfes: activeNfes,
      cancelledNfes: cancelled,
      itemTaxLines,
      settlements,
      technical: {
        source:
          "NomusNfeFiscalSummary + NomusNfeTaxLine (HEADER) · FiscalPaymentGuide/Allocation (B/C/D)",
        note: "Tributos documentais destacados na NF — não são impostos pagos. Não somar HEADER e ITEM. Residual ≠ saldo financeiro.",
        doNotSumHeaderAndItem: true,
      },
    },
    {
      linkOrigins: buildSalesOrderFiscalNfeLinkOrigins([
        ...activeNfes,
        ...cancelled,
        ...nfes.map((n) => ({
          nfeExternalId: n.nfeExternalId,
          numero: n.numero,
          linkOrigin: n.linkOrigin,
        })),
      ]),
    }
  );
}

/**
 * Camadas B/C/D para o pedido — 2–3 queries (allocations → guides → audit), sem N+1.
 * Não altera NF, AP nem baixas; só lê.
 */
export async function buildSalesOrderFiscalSettlementsBlock(
  prisma: PrismaLike,
  input: {
    salesOrderId: string;
    highlightedTaxes: SalesOrderFiscalTaxAmount[];
    nomusNfeIds: string[];
  }
): Promise<SalesOrderFiscalSettlementsBlock> {
  const salesOrderId = input.salesOrderId?.trim();
  if (!salesOrderId) {
    return emptySalesOrderFiscalSettlementsBlock(new Date().toISOString());
  }

  const orFilters: Array<Record<string, unknown>> = [{ salesOrderId }];
  if (input.nomusNfeIds.length > 0) {
    orFilters.push({ nomusNfeId: { in: input.nomusNfeIds } });
  }

  const allocationRows = await prisma.fiscalAllocation.findMany({
    where: { OR: orFilters },
    orderBy: [{ calculatedAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });

  const guideIds = [...new Set(allocationRows.map((a) => a.guideId))];

  const guideRows =
    guideIds.length === 0
      ? []
      : await prisma.fiscalPaymentGuide.findMany({
          where: { id: { in: guideIds } },
          include: {
            period: { select: { id: true, status: true, periodStart: true, periodEnd: true } },
            proofs: { select: { id: true } },
            allocations: {
              where: { OR: orFilters },
              select: {
                id: true,
                allocatedAmount: true,
                allocationMethod: true,
                salesOrderId: true,
              },
            },
          },
        });

  const guideById = new Map(guideRows.map((g) => [g.id, g] as const));

  const allocations: SalesOrderFiscalSettlementAllocationDto[] =
    allocationRows.map((a) => {
      const method = a.allocationMethod as FiscalAllocationMethodCode;
      return {
        id: a.id,
        settlementId: a.guideId,
        guideId: a.guideId,
        taxType: a.taxType,
        allocatedAmount: dec(a.allocatedAmount) ?? 0,
        allocationMethod: method,
        allocationMethodLabel:
          FISCAL_ALLOCATION_METHOD_LABELS[method] ?? method,
        allocationBase: dec(a.allocationBase),
        periodStart: isoDate(a.periodStart),
        periodEnd: isoDate(a.periodEnd),
        calculatedAt: a.calculatedAt.toISOString(),
        version: a.version,
        manualOverride: a.manualOverride,
        notes: a.notes,
        nomusNfeId: a.nomusNfeId,
        isManagerialOnly: true,
      };
    });

  const guides: SalesOrderFiscalSettlementGuideDto[] = guideRows.map((g) => {
    const guideType = g.guideType as FiscalGuideTypeCode;
    const status = g.status as FiscalGuideStatusCode;
    const amountDue = dec(g.amountDue) ?? 0;
    const amountPaid = dec(g.amountPaid) ?? 0;
    const balanceDue = dec(g.balanceDue) ?? 0;
    const allocatedToThisOrder = round2(
      g.allocations.reduce((s, a) => s + (dec(a.allocatedAmount) ?? 0), 0)
    );
    const methodLabels = [
      ...new Set(
        g.allocations.map((a) => {
          const m = a.allocationMethod as FiscalAllocationMethodCode;
          return FISCAL_ALLOCATION_METHOD_LABELS[m] ?? m;
        })
      ),
    ];
    return {
      guideId: g.id,
      taxType: g.taxType,
      guideType,
      guideTypeLabel: FISCAL_GUIDE_TYPE_LABELS[guideType] ?? guideType,
      guideNumber: g.guideNumber,
      status,
      statusLabel: FISCAL_GUIDE_STATUS_LABELS[status] ?? status,
      periodStart: isoDate(g.periodStart)!,
      periodEnd: isoDate(g.periodEnd)!,
      dueDate: isoDate(g.dueDate),
      assessedAmount: dec(g.assessedAmount) ?? 0,
      creditsAmount: dec(g.creditsAmount) ?? 0,
      compensationsAmount: dec(g.compensationsAmount) ?? 0,
      interestAmount: dec(g.interestAmount) ?? 0,
      fineAmount: dec(g.fineAmount) ?? 0,
      amountDue,
      amountPaid,
      balanceDue,
      paidAt: iso(g.paidAt),
      accountsPayableExternalId: g.accountsPayableExternalId,
      accountsPayableDocumentNumber: null,
      proofCount: g.proofs.length,
      allocatedToThisOrder,
      allocationMethodLabels: methodLabels,
      collectionLabel: collectionLabelForGuide({
        status,
        amountDue,
        amountPaid,
        balanceDue,
      }),
    };
  });

  // Enriquecer documento AP em lote (sem N+1).
  const apIds = guides
    .map((g) => g.accountsPayableExternalId)
    .filter((n): n is number => n != null);
  if (apIds.length > 0) {
    const apRows = await prisma.nomusAccountsPayable.findMany({
      where: { externalId: { in: [...new Set(apIds)] } },
      select: { externalId: true, documentNumber: true },
    });
    const apDoc = new Map(apRows.map((r) => [r.externalId, r.documentNumber]));
    for (const g of guides) {
      if (g.accountsPayableExternalId != null) {
        g.accountsPayableDocumentNumber =
          apDoc.get(g.accountsPayableExternalId) ?? null;
      }
    }
  }

  // Matriz por tributo: união destacados + alocações + guias.
  const taxTypes = new Set<string>();
  for (const t of input.highlightedTaxes) taxTypes.add(t.taxType);
  for (const a of allocations) taxTypes.add(a.taxType);
  for (const g of guides) taxTypes.add(g.taxType);

  const highlightedMap = new Map(
    input.highlightedTaxes.map((t) => [t.taxType, t.amount] as const)
  );

  const taxMatrix: SalesOrderFiscalTaxMatrixRow[] = [...taxTypes]
    .sort((a, b) => a.localeCompare(b))
    .map((taxType) => {
      const allocs = allocations.filter((a) => a.taxType === taxType);
      const relatedGuides = guides.filter((g) => g.taxType === taxType);
      const primaryGuide = relatedGuides[0] ?? null;
      const guideFromAlloc =
        allocs.length > 0 ? guideById.get(allocs[0]!.guideId) ?? null : null;
      const periodStatus = guideFromAlloc?.period?.status ?? null;

      const allocatedToOrder = round2(
        allocs.reduce((s, a) => s + a.allocatedAmount, 0)
      );
      const assessedAmount = primaryGuide
        ? round2(relatedGuides.reduce((s, g) => s + g.assessedAmount, 0))
        : null;
      const creditsAmount = primaryGuide
        ? round2(relatedGuides.reduce((s, g) => s + g.creditsAmount, 0))
        : null;
      const amountDue = primaryGuide
        ? round2(relatedGuides.reduce((s, g) => s + g.amountDue, 0))
        : null;
      const amountPaid = primaryGuide
        ? round2(relatedGuides.reduce((s, g) => s + g.amountPaid, 0))
        : null;
      const interestAmount = primaryGuide
        ? round2(relatedGuides.reduce((s, g) => s + g.interestAmount, 0))
        : null;
      const fineAmount = primaryGuide
        ? round2(relatedGuides.reduce((s, g) => s + g.fineAmount, 0))
        : null;
      const guideBalanceDue = primaryGuide
        ? round2(relatedGuides.reduce((s, g) => s + g.balanceDue, 0))
        : null;

      const paidAts = relatedGuides
        .map((g) => g.paidAt)
        .filter((d): d is string => Boolean(d))
        .sort();
      const methods = [
        ...new Set(allocs.map((a) => a.allocationMethodLabel)),
      ];

      const statusCode = resolveSalesOrderFiscalSettlementStatus({
        hasGuide: relatedGuides.length > 0,
        guideStatus: primaryGuide?.status ?? null,
        periodStatus,
        assessedAmount,
        amountDue,
        amountPaid,
        allocatedAmount: allocatedToOrder,
      });

      return {
        taxType,
        label: labelForFiscalTaxType(taxType),
        highlightedAmount: highlightedMap.get(taxType) ?? null,
        periodStart:
          primaryGuide?.periodStart ??
          allocs[0]?.periodStart ??
          null,
        periodEnd:
          primaryGuide?.periodEnd ?? allocs[0]?.periodEnd ?? null,
        periodStatus,
        assessedAmount,
        creditsAmount,
        amountDue,
        amountPaid,
        interestAmount,
        fineAmount,
        paidAt: paidAts.at(-1) ?? null,
        guideType: primaryGuide?.guideTypeLabel ?? null,
        guideNumber: primaryGuide?.guideNumber ?? null,
        guideStatus: primaryGuide?.statusLabel ?? null,
        guideBalanceDue,
        allocatedToOrder: allocatedToOrder > 0 ? allocatedToOrder : null,
        allocationMethod: allocs[0]?.allocationMethod ?? null,
        allocationMethodLabel: methods.join(" · ") || null,
        statusCode,
        statusLabel: SALES_ORDER_FISCAL_SETTLEMENT_STATUS_LABELS[statusCode],
      };
    });

  // Histórico recente das entidades envolvidas (1 query).
  const entityIds = [
    ...guideIds,
    ...allocationRows.map((a) => a.id),
  ];
  const historyRows =
    entityIds.length === 0
      ? []
      : await prisma.fiscalSettlementAuditLog.findMany({
          where: { entityId: { in: entityIds } },
          orderBy: { createdAt: "desc" },
          take: 30,
        });

  const history: SalesOrderFiscalSettlementHistoryDto[] = historyRows.map(
    (h) => ({
      at: h.createdAt.toISOString(),
      entityType: h.entityType,
      entityId: h.entityId,
      action: h.action,
      summary: `${h.entityType} · ${h.action}${h.userName ? ` · ${h.userName}` : ""}`,
    })
  );

  const updatedAt =
    [
      ...allocations.map((a) => a.calculatedAt),
      ...guides.map((g) => g.paidAt).filter((d): d is string => Boolean(d)),
      ...history.map((h) => h.at),
    ]
      .sort()
      .at(-1) ?? new Date().toISOString();

  const highlightedTotal = round2(
    input.highlightedTaxes.reduce((s, t) => s + t.amount, 0)
  );
  const assessedTotal = round2(
    taxMatrix.reduce((s, r) => s + (r.assessedAmount ?? 0), 0)
  );
  const amountDueTotal = round2(
    taxMatrix.reduce((s, r) => s + (r.amountDue ?? 0), 0)
  );
  const amountPaidTotal = round2(
    taxMatrix.reduce((s, r) => s + (r.amountPaid ?? 0), 0)
  );
  const allocatedToOrderTotal = round2(
    allocations.reduce((s, a) => s + a.allocatedAmount, 0)
  );

  // Se há destacados mas nenhuma guia/alocação, ainda assim listar matriz A-only.
  if (taxMatrix.length === 0 && input.highlightedTaxes.length > 0) {
    for (const t of input.highlightedTaxes) {
      const statusCode = resolveSalesOrderFiscalSettlementStatus({
        hasGuide: false,
        allocatedAmount: 0,
      });
      taxMatrix.push({
        taxType: t.taxType,
        label: t.label,
        highlightedAmount: t.amount,
        periodStart: null,
        periodEnd: null,
        periodStatus: null,
        assessedAmount: null,
        creditsAmount: null,
        amountDue: null,
        amountPaid: null,
        interestAmount: null,
        fineAmount: null,
        paidAt: null,
        guideType: null,
        guideNumber: null,
        guideStatus: null,
        guideBalanceDue: null,
        allocatedToOrder: null,
        allocationMethod: null,
        allocationMethodLabel: null,
        statusCode,
        statusLabel: SALES_ORDER_FISCAL_SETTLEMENT_STATUS_LABELS[statusCode],
      });
    }
  }

  return {
    apurationSourceLabel: "Fechamento fiscal do período",
    collectionSourceLabel: "Guia + baixa/comprovante",
    allocationSourceLabel: "Metodologia gerencial explicitamente indicada",
    updatedAt,
    taxMatrix,
    guides,
    allocations,
    history,
    totals: {
      highlightedTotal,
      assessedTotal,
      amountDueTotal,
      amountPaidTotal,
      allocatedToOrderTotal,
    },
    emptyStates: {
      noGuides: guides.length === 0,
      noApuration: !guides.some((g) => g.assessedAmount > 0.009),
      noAllocations: allocations.length === 0,
    },
  };
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
