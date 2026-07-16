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
  collectionLabelForGuide,
  emptySalesOrderFiscalSettlementsBlock,
  filterPositiveTaxAmounts,
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
    settlements,
    technical: {
      source:
        "NomusNfeFiscalSummary + NomusNfeTaxLine (HEADER) · FiscalPaymentGuide/Allocation (B/C/D)",
      note: "Não somar HEADER e ITEM. Destacado ≠ apurado ≠ pago ≠ alocado. Residual ≠ saldo financeiro.",
      doNotSumHeaderAndItem: true,
    },
  };
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
