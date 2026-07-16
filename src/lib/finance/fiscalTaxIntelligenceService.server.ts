/**
 * Agregação inteligência tributária (T07) — leitura only.
 * Não altera NF, AP, guias nem alocações.
 */

import type { PrismaClient } from "@prisma/client";
import { NOMUS_NFE_STATUS_CANCELLED } from "@/src/lib/nomusNfeClassification.js";
import {
  buildFiscalTaxIntelKpisFromParts,
  FISCAL_TAX_INTEL_COLUMN_SOURCES,
  FISCAL_TAX_INTEL_GROUP_BY_LABELS,
  parseFiscalTaxIntelGroupBy,
  roundFiscalIntelMoney,
  type FiscalTaxIntelDrillLevel,
  type FiscalTaxIntelDrillNode,
  type FiscalTaxIntelFilters,
  type FiscalTaxIntelGroupBy,
  type FiscalTaxIntelPayload,
  type FiscalTaxIntelRow,
} from "./fiscalTaxIntelligenceClient.js";

type PrismaLike = PrismaClient;

function dec(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseDateOnly(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

function emptyRow(
  groupBy: FiscalTaxIntelGroupBy,
  groupKey: string,
  groupLabel: string
): FiscalTaxIntelRow {
  return {
    groupKey,
    groupLabel,
    groupBy,
    highlightedAmount: 0,
    creditsAmount: 0,
    assessedAmount: 0,
    amountDue: 0,
    amountPaid: 0,
    interestAmount: 0,
    fineAmount: 0,
    guideBalanceDue: 0,
    allocatedAmount: 0,
    revenueBase: 0,
    highlightedVsAssessed: 0,
    assessedVsPaid: 0,
    fiscalLoadOnRevenue: null,
  };
}

function finalizeRow(row: FiscalTaxIntelRow): FiscalTaxIntelRow {
  row.highlightedAmount = roundFiscalIntelMoney(row.highlightedAmount);
  row.creditsAmount = roundFiscalIntelMoney(row.creditsAmount);
  row.assessedAmount = roundFiscalIntelMoney(row.assessedAmount);
  row.amountDue = roundFiscalIntelMoney(row.amountDue);
  row.amountPaid = roundFiscalIntelMoney(row.amountPaid);
  row.interestAmount = roundFiscalIntelMoney(row.interestAmount);
  row.fineAmount = roundFiscalIntelMoney(row.fineAmount);
  row.guideBalanceDue = roundFiscalIntelMoney(row.guideBalanceDue);
  row.allocatedAmount = roundFiscalIntelMoney(row.allocatedAmount);
  row.revenueBase = roundFiscalIntelMoney(row.revenueBase);
  row.highlightedVsAssessed = roundFiscalIntelMoney(
    row.highlightedAmount - row.assessedAmount
  );
  row.assessedVsPaid = roundFiscalIntelMoney(row.assessedAmount - row.amountPaid);
  row.fiscalLoadOnRevenue =
    row.revenueBase > 0.009
      ? roundFiscalIntelMoney((row.amountPaid / row.revenueBase) * 100)
      : null;
  return row;
}

export function parseFiscalTaxIntelFilters(
  query: Record<string, unknown>
): FiscalTaxIntelFilters {
  const today = new Date();
  const defaultEnd = today.toISOString().slice(0, 10);
  const defaultStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
  )
    .toISOString()
    .slice(0, 10);

  return {
    periodStart:
      typeof query.periodStart === "string" && query.periodStart.trim()
        ? query.periodStart.trim().slice(0, 10)
        : defaultStart,
    periodEnd:
      typeof query.periodEnd === "string" && query.periodEnd.trim()
        ? query.periodEnd.trim().slice(0, 10)
        : defaultEnd,
    taxType:
      typeof query.taxType === "string" && query.taxType.trim()
        ? query.taxType.trim().toUpperCase()
        : null,
    jurisdiction:
      typeof query.jurisdiction === "string" && query.jurisdiction.trim()
        ? query.jurisdiction.trim().toUpperCase()
        : null,
    guideStatus:
      typeof query.guideStatus === "string" && query.guideStatus.trim()
        ? query.guideStatus.trim().toUpperCase()
        : null,
    customerId:
      typeof query.customerId === "string" && query.customerId.trim()
        ? query.customerId.trim()
        : null,
    salesOrderId:
      typeof query.salesOrderId === "string" && query.salesOrderId.trim()
        ? query.salesOrderId.trim()
        : null,
    groupBy: parseFiscalTaxIntelGroupBy(query.groupBy),
  };
}

export async function buildFiscalTaxIntelligenceReport(
  prisma: PrismaLike,
  filters: FiscalTaxIntelFilters
): Promise<FiscalTaxIntelPayload> {
  if (parseDateOnly(filters.periodEnd) < parseDateOnly(filters.periodStart)) {
    throw Object.assign(new Error("periodEnd deve ser >= periodStart."), {
      status: 400,
    });
  }

  const periodStart = parseDateOnly(filters.periodStart);
  const periodEnd = parseDateOnly(filters.periodEnd);
  // inclusive end-of-day for DateTime fields
  const periodEndExclusive = new Date(periodEnd);
  periodEndExclusive.setUTCDate(periodEndExclusive.getUTCDate() + 1);

  const guideWhere: Record<string, unknown> = {
    periodStart: { lte: periodEnd },
    periodEnd: { gte: periodStart },
  };
  if (filters.taxType) guideWhere.taxType = filters.taxType;
  if (filters.jurisdiction) guideWhere.jurisdiction = filters.jurisdiction;
  if (filters.guideStatus) guideWhere.status = filters.guideStatus;

  const [guides, apurationLines, nfeRows] = await Promise.all([
    prisma.fiscalPaymentGuide.findMany({
      where: guideWhere as never,
      include: {
        allocations: {
          select: {
            id: true,
            allocatedAmount: true,
            salesOrderId: true,
            nomusNfeId: true,
            taxType: true,
          },
        },
        period: {
          select: { id: true, status: true, uf: true, companyName: true },
        },
      },
      take: 5000,
    }),
    prisma.fiscalApurationLine.findMany({
      where: {
        ...(filters.taxType ? { taxType: filters.taxType } : {}),
        period: {
          periodStart: { lte: periodEnd },
          periodEnd: { gte: periodStart },
          status: { not: "CANCELLED" },
        },
      },
      include: {
        period: {
          select: {
            id: true,
            periodStart: true,
            periodEnd: true,
            jurisdiction: true,
            uf: true,
            companyName: true,
            status: true,
          },
        },
      },
      take: 5000,
    }),
    prisma.nomusNfe.findMany({
      where: {
        OR: [
          {
            xmlDhEmi: {
              gte: periodStart,
              lt: periodEndExclusive,
            },
          },
          {
            xmlDhEmi: null,
            dataProcessamento: {
              gte: periodStart,
              lt: periodEndExclusive,
            },
          },
        ],
      },
      select: {
        id: true,
        externalId: true,
        numero: true,
        serie: true,
        status: true,
        cnpjEmitente: true,
        xmlDhEmi: true,
        dataProcessamento: true,
        valorLiquido: true,
        xmlVProd: true,
        xmlVDesc: true,
        fiscalSummary: {
          select: {
            vProd: true,
            vDesc: true,
            isCancelled: true,
            taxLines: {
              where: {
                // HEADER = SoT de destacado para totais; ITEM só para dimensões produto/NCM/CFOP.
                scope: {
                  in:
                    filters.groupBy === "ncm" ||
                    filters.groupBy === "cfop" ||
                    filters.groupBy === "product"
                      ? (["HEADER", "ITEM"] as const)
                      : (["HEADER"] as const),
                },
                ...(filters.taxType ? { taxType: filters.taxType } : {}),
              },
              select: {
                taxType: true,
                amount: true,
                ncm: true,
                cfop: true,
                scope: true,
                itemNumber: true,
              },
            },
          },
        },
      },
      take: 8000,
    }),
  ]);

  const itemDimGroup =
    filters.groupBy === "ncm" ||
    filters.groupBy === "cfop" ||
    filters.groupBy === "product";

  const nfeExternalIds = nfeRows.map((n) => n.externalId);
  const allocatedOrderIds = [
    ...new Set(
      guides
        .flatMap((g) => g.allocations.map((a) => a.salesOrderId))
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const nfeLinks =
    nfeExternalIds.length === 0
      ? []
      : await prisma.salesOrderNfeLink.findMany({
          where: { nfeExternalId: { in: nfeExternalIds } },
          select: {
            nfeExternalId: true,
            salesOrderId: true,
            orderCode: true,
            nomusNfeId: true,
          },
          take: 20000,
        });

  const linkOrderIds = [...new Set(nfeLinks.map((l) => l.salesOrderId))];
  const allOrderIds = [
    ...new Set([
      ...allocatedOrderIds,
      ...linkOrderIds,
      ...(filters.salesOrderId ? [filters.salesOrderId] : []),
    ]),
  ];
  const orderRows =
    allOrderIds.length === 0
      ? []
      : await prisma.salesOrder.findMany({
          where: {
            id: { in: allOrderIds },
            ...(filters.customerId ? { customerId: filters.customerId } : {}),
            ...(filters.salesOrderId ? { id: filters.salesOrderId } : {}),
          },
          select: {
            id: true,
            orderCode: true,
            customerId: true,
            Customer: { select: { id: true, name: true } },
          },
          take: 10000,
        });

  const orderById = new Map(orderRows.map((o) => [o.id, o] as const));
  const linksByNfeExt = new Map<number, typeof nfeLinks>();
  for (const l of nfeLinks) {
    const arr = linksByNfeExt.get(l.nfeExternalId) ?? [];
    arr.push(l);
    linksByNfeExt.set(l.nfeExternalId, arr);
  }

  const bucket = new Map<string, FiscalTaxIntelRow>();

  const ensure = (key: string, label: string, extra?: Partial<FiscalTaxIntelRow>) => {
    let row = bucket.get(key);
    if (!row) {
      row = { ...emptyRow(filters.groupBy, key, label), ...extra };
      bucket.set(key, row);
    }
    return row;
  };

  // —— Camada C/B via guias ——
  let cancelledGuideCount = 0;
  let validGuideCount = 0;
  for (const g of guides) {
    const cancelled =
      g.status === "CANCELLED" || g.status === "REVERSED";
    if (cancelled) cancelledGuideCount += 1;
    else validGuideCount += 1;

    // Dimensões de item NF: guias não têm NCM/CFOP/produto — não misturar B/C nestas visões.
    if (itemDimGroup) continue;

    const assessed = dec(g.assessedAmount);
    const credits = dec(g.creditsAmount);
    const due = dec(g.amountDue);
    const paid = cancelled ? 0 : dec(g.amountPaid);
    const interest = cancelled ? 0 : dec(g.interestAmount);
    const fine = cancelled ? 0 : dec(g.fineAmount);
    const balance = cancelled ? 0 : dec(g.balanceDue);
    const allocated = g.allocations.reduce(
      (s, a) => s + dec(a.allocatedAmount),
      0
    );

    // Optional filter by sales order / customer via allocations
    if (filters.salesOrderId || filters.customerId) {
      const matchingAlloc = g.allocations.some((a) => {
        if (!a.salesOrderId) return false;
        if (filters.salesOrderId && a.salesOrderId !== filters.salesOrderId) {
          return false;
        }
        if (filters.customerId) {
          const ord = orderById.get(a.salesOrderId);
          return ord?.customerId === filters.customerId;
        }
        return true;
      });
      if (!matchingAlloc) continue;
    }

    const keys = resolveGroupKeys({
      groupBy: filters.groupBy,
      taxType: g.taxType,
      guideId: g.id,
      guideNumber: g.guideNumber,
      guideType: g.guideType,
      guideStatus: g.status,
      jurisdiction: g.jurisdiction,
      uf: g.period?.uf ?? null,
      companyName: g.period?.companyName ?? null,
      periodStart: isoDate(g.periodStart),
      periodEnd: isoDate(g.periodEnd),
      allocations: g.allocations.map((a) => ({
        salesOrderId: a.salesOrderId,
        orderCode: a.salesOrderId
          ? orderById.get(a.salesOrderId)?.orderCode ?? null
          : null,
        customerId: a.salesOrderId
          ? orderById.get(a.salesOrderId)?.customerId ?? null
          : null,
        customerName: a.salesOrderId
          ? orderById.get(a.salesOrderId)?.Customer?.name ?? null
          : null,
        nomusNfeId: a.nomusNfeId,
      })),
    });

    for (const k of keys) {
      const row = ensure(k.key, k.label, k.extra);
      if (!cancelled) {
        row.assessedAmount += assessed;
        row.creditsAmount += credits;
        row.amountDue += due;
        row.amountPaid += paid;
        row.interestAmount += interest;
        row.fineAmount += fine;
        row.guideBalanceDue += balance;
      }
      row.allocatedAmount += allocated;
    }
  }

  // —— Camada B suplementar: linhas de apuração sem guia (só assessed/credits) ——
  for (const line of apurationLines) {
    if (itemDimGroup) continue;
    if (filters.salesOrderId || filters.customerId) continue; // apuração não é por pedido
    const keys = resolveGroupKeys({
      groupBy: filters.groupBy,
      taxType: line.taxType,
      guideId: null,
      guideNumber: null,
      guideType: null,
      guideStatus: null,
      jurisdiction: line.period.jurisdiction,
      uf: line.period.uf,
      companyName: line.period.companyName,
      periodStart: isoDate(line.period.periodStart),
      periodEnd: isoDate(line.period.periodEnd),
      allocations: [],
    });
    // Evitar double-count se já somamos assessed das guias do mesmo período/taxType:
    // só adiciona assessed/credits de linhas quando groupBy não é guide.
    if (filters.groupBy === "guide") continue;
    for (const k of keys) {
      const row = ensure(k.key, k.label, k.extra);
      // Apuration lines: use as complementary — only credits/assessed when no guide bucket yet
      // Safer: add assessed from apuration only for DEBIT nature; credits for CREDIT.
      if (line.nature === "CREDIT" || line.nature === "COMPENSATION") {
        row.creditsAmount += dec(line.creditsAmount) + dec(line.assessedAmount);
      } else if (line.nature === "INTEREST") {
        row.interestAmount += dec(line.amountDue) || dec(line.assessedAmount);
      } else if (line.nature === "FINE") {
        row.fineAmount += dec(line.amountDue) || dec(line.assessedAmount);
      } else {
        // For DEBIT: don't double-count if guides already carry assessed for taxType+period.
        // Add only when guides empty for this tax — approximate: always add amountDue from line
        // as "apurado" supplemental is risky. Prefer guide assessed as SoT for B when guides exist.
        // Here we only add if no valid guides for this taxType.
        const hasGuideForTax = guides.some(
          (g) =>
            g.taxType === line.taxType &&
            g.status !== "CANCELLED" &&
            g.status !== "REVERSED"
        );
        if (!hasGuideForTax) {
          row.assessedAmount += dec(line.assessedAmount);
          row.amountDue += dec(line.amountDue);
          row.creditsAmount += dec(line.creditsAmount);
        }
      }
    }
  }

  // —— Camada A: HEADER tax lines + receita ——
  let nfeCount = 0;
  for (const nfe of nfeRows) {
    const cancelled =
      nfe.status === NOMUS_NFE_STATUS_CANCELLED ||
      nfe.fiscalSummary?.isCancelled === true;
    if (cancelled) continue;
    nfeCount += 1;

    const links = linksByNfeExt.get(nfe.externalId) ?? [];
    if (filters.salesOrderId) {
      if (!links.some((l) => l.salesOrderId === filters.salesOrderId)) continue;
    }
    if (filters.customerId) {
      if (
        !links.some((l) => orderById.get(l.salesOrderId)?.customerId === filters.customerId)
      ) {
        continue;
      }
    }

    const vProd = dec(nfe.fiscalSummary?.vProd ?? nfe.xmlVProd);
    const vDesc = dec(nfe.fiscalSummary?.vDesc ?? nfe.xmlVDesc);
    const revenue =
      vProd > 0 ? Math.max(0, vProd - vDesc) : dec(nfe.valorLiquido);

    const allLines = nfe.fiscalSummary?.taxLines ?? [];
    const headerLines = allLines.filter((l) => l.scope === "HEADER");
    const itemLines = allLines.filter((l) => l.scope === "ITEM");
    // Dimensões de item usam ITEM (nunca somar HEADER+ITEM no mesmo total).
    const linesForHighlight = itemDimGroup ? itemLines : headerLines;
    const dt = nfe.xmlDhEmi ?? nfe.dataProcessamento;
    const pStart = isoDate(dt);
    const pMonth = dt ? monthKey(dt instanceof Date ? dt : new Date(dt)) : "—";

    // guide / guideStatus não recebem destacado de NF (só guias).
    if (filters.groupBy === "guide" || filters.groupBy === "guideStatus") {
      continue;
    }

    const linkAllocations = links.map((l) => ({
      salesOrderId: l.salesOrderId,
      orderCode: orderById.get(l.salesOrderId)?.orderCode ?? l.orderCode,
      customerId: orderById.get(l.salesOrderId)?.customerId ?? null,
      customerName: orderById.get(l.salesOrderId)?.Customer?.name ?? null,
      nomusNfeId: l.nomusNfeId ?? nfe.id,
    }));

    if (linesForHighlight.length === 0) {
      const keys = resolveGroupKeys({
        groupBy: filters.groupBy,
        taxType: filters.taxType ?? "OTHER",
        guideId: null,
        guideNumber: null,
        guideType: null,
        guideStatus: null,
        jurisdiction: null,
        uf: null,
        companyName: nfe.cnpjEmitente,
        periodStart: pStart,
        periodEnd: pStart,
        periodMonth: pMonth,
        nfeExternalId: nfe.externalId,
        nomusNfeId: nfe.id,
        nfeNumero: nfe.numero,
        allocations: linkAllocations,
        ncm: null,
        cfop: null,
        itemNumber: null,
      });
      for (const k of keys) {
        const row = ensure(k.key, k.label, k.extra);
        row.revenueBase += revenue;
      }
      continue;
    }

    for (const line of linesForHighlight) {
      const amt = dec(line.amount);
      const keys = resolveGroupKeys({
        groupBy: filters.groupBy,
        taxType: line.taxType,
        guideId: null,
        guideNumber: null,
        guideType: null,
        guideStatus: null,
        jurisdiction: null,
        uf: null,
        companyName: nfe.cnpjEmitente,
        periodStart: pStart,
        periodEnd: pStart,
        periodMonth: pMonth,
        nfeExternalId: nfe.externalId,
        nomusNfeId: nfe.id,
        nfeNumero: nfe.numero,
        allocations: linkAllocations,
        ncm: line.ncm,
        cfop: line.cfop,
        itemNumber: line.itemNumber ?? null,
      });
      for (const k of keys) {
        const row = ensure(k.key, k.label, k.extra);
        row.highlightedAmount += amt;
      }
    }

    const revenueKeys = new Set<string>();
    for (const line of linesForHighlight) {
      const keys = resolveGroupKeys({
        groupBy: filters.groupBy,
        taxType: line.taxType,
        guideId: null,
        guideNumber: null,
        guideType: null,
        guideStatus: null,
        jurisdiction: null,
        uf: null,
        companyName: nfe.cnpjEmitente,
        periodStart: pStart,
        periodEnd: pStart,
        periodMonth: pMonth,
        nfeExternalId: nfe.externalId,
        nomusNfeId: nfe.id,
        nfeNumero: nfe.numero,
        allocations: linkAllocations,
        ncm: line.ncm,
        cfop: line.cfop,
        itemNumber: line.itemNumber ?? null,
      });
      for (const k of keys) revenueKeys.add(k.key);
    }
    for (const key of revenueKeys) {
      const row = bucket.get(key);
      if (row) row.revenueBase += revenue;
    }
  }

  const rows = [...bucket.values()].map(finalizeRow).sort((a, b) =>
    a.groupLabel.localeCompare(b.groupLabel, "pt-BR")
  );

  const kpis = buildFiscalTaxIntelKpisFromParts({
    highlightedAmount: rows.reduce((s, r) => s + r.highlightedAmount, 0),
    creditsAmount: rows.reduce((s, r) => s + r.creditsAmount, 0),
    assessedAmount: rows.reduce((s, r) => s + r.assessedAmount, 0),
    amountDue: rows.reduce((s, r) => s + r.amountDue, 0),
    amountPaid: rows.reduce((s, r) => s + r.amountPaid, 0),
    interestAmount: rows.reduce((s, r) => s + r.interestAmount, 0),
    fineAmount: rows.reduce((s, r) => s + r.fineAmount, 0),
    guideBalanceDue: rows.reduce((s, r) => s + r.guideBalanceDue, 0),
    allocatedAmount: rows.reduce((s, r) => s + r.allocatedAmount, 0),
    // KPI receita: soma distinta de NFs — use nfe loop total
    revenueBase: (() => {
      // Prefer unique NF revenue already counted in nfeCount path
      let total = 0;
      for (const nfe of nfeRows) {
        const cancelled =
          nfe.status === NOMUS_NFE_STATUS_CANCELLED ||
          nfe.fiscalSummary?.isCancelled === true;
        if (cancelled) continue;
        const vProd = dec(nfe.fiscalSummary?.vProd ?? nfe.xmlVProd);
        const vDesc = dec(nfe.fiscalSummary?.vDesc ?? nfe.xmlVDesc);
        total +=
          vProd > 0 ? Math.max(0, vProd - vDesc) : dec(nfe.valorLiquido);
      }
      return total;
    })(),
    cancelledGuideCount,
    validGuideCount,
    nfeCount,
  });

  // Fix KPI double-count for highlighted/paid when groupBy multiplies — use source totals
  const kpiFromSources = buildFiscalTaxIntelKpisFromParts({
    highlightedAmount: (() => {
      let t = 0;
      for (const nfe of nfeRows) {
        if (
          nfe.status === NOMUS_NFE_STATUS_CANCELLED ||
          nfe.fiscalSummary?.isCancelled
        ) {
          continue;
        }
        for (const line of nfe.fiscalSummary?.taxLines ?? []) {
          if (line.scope !== "HEADER") continue;
          t += dec(line.amount);
        }
      }
      return t;
    })(),
    creditsAmount: guides
      .filter((g) => g.status !== "CANCELLED" && g.status !== "REVERSED")
      .reduce((s, g) => s + dec(g.creditsAmount), 0),
    assessedAmount: guides
      .filter((g) => g.status !== "CANCELLED" && g.status !== "REVERSED")
      .reduce((s, g) => s + dec(g.assessedAmount), 0),
    amountDue: guides
      .filter((g) => g.status !== "CANCELLED" && g.status !== "REVERSED")
      .reduce((s, g) => s + dec(g.amountDue), 0),
    amountPaid: guides
      .filter((g) => g.status !== "CANCELLED" && g.status !== "REVERSED")
      .reduce((s, g) => s + dec(g.amountPaid), 0),
    interestAmount: guides
      .filter((g) => g.status !== "CANCELLED" && g.status !== "REVERSED")
      .reduce((s, g) => s + dec(g.interestAmount), 0),
    fineAmount: guides
      .filter((g) => g.status !== "CANCELLED" && g.status !== "REVERSED")
      .reduce((s, g) => s + dec(g.fineAmount), 0),
    guideBalanceDue: guides
      .filter((g) => g.status !== "CANCELLED" && g.status !== "REVERSED")
      .reduce((s, g) => s + dec(g.balanceDue), 0),
    allocatedAmount: guides.reduce(
      (s, g) =>
        s +
        g.allocations.reduce((ss, a) => ss + dec(a.allocatedAmount), 0),
      0
    ),
    revenueBase: kpis.revenueBase,
    cancelledGuideCount,
    validGuideCount,
    nfeCount,
  });

  void kpis;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    filters,
    columnSources: FISCAL_TAX_INTEL_COLUMN_SOURCES,
    disclaimer:
      "Destacado (XML) ≠ Apurado (período) ≠ Pago (guia/AP) ≠ Alocado (gerencial). Totalizadores KPI usam fontes sem duplicar por dimensão.",
    kpis: kpiFromSources,
    rows,
  };
}

type GroupKeyInput = {
  groupBy: FiscalTaxIntelGroupBy;
  taxType: string;
  guideId: string | null;
  guideNumber: string | null;
  guideType: string | null;
  guideStatus: string | null;
  jurisdiction: string | null;
  uf: string | null;
  companyName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  periodMonth?: string | null;
  nfeExternalId?: number | null;
  nomusNfeId?: string | null;
  nfeNumero?: string | null;
  ncm?: string | null;
  cfop?: string | null;
  itemNumber?: number | null;
  allocations: Array<{
    salesOrderId: string | null;
    orderCode: string | null;
    customerId: string | null;
    customerName: string | null;
    nomusNfeId: string | null;
  }>;
};

function resolveGroupKeys(
  input: GroupKeyInput
): Array<{ key: string; label: string; extra?: Partial<FiscalTaxIntelRow> }> {
  switch (input.groupBy) {
    case "taxType":
      return [
        {
          key: input.taxType || "OTHER",
          label: input.taxType || "OTHER",
          extra: { taxType: input.taxType },
        },
      ];
    case "period": {
      const key =
        input.periodMonth ||
        `${input.periodStart ?? "?"}→${input.periodEnd ?? "?"}`;
      return [
        {
          key,
          label: key,
          extra: {
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
          },
        },
      ];
    }
    case "guide":
      if (!input.guideId) return [];
      return [
        {
          key: input.guideId,
          label: `${input.guideType ?? "GUIA"} ${input.guideNumber ?? input.guideId.slice(0, 8)}`,
          extra: {
            guideId: input.guideId,
            taxType: input.taxType,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
          },
        },
      ];
    case "guideStatus":
      return [
        {
          key: input.guideStatus ?? "UNKNOWN",
          label: input.guideStatus ?? "Sem status",
        },
      ];
    case "jurisdiction": {
      const key = [input.jurisdiction, input.uf].filter(Boolean).join("/") || "—";
      return [{ key, label: key }];
    }
    case "company":
      return [
        {
          key: input.companyName ?? "—",
          label: input.companyName ?? "Sem empresa",
        },
      ];
    case "nfe":
      if (input.nfeExternalId == null) return [];
      return [
        {
          key: String(input.nfeExternalId),
          label: `NF ${input.nfeNumero ?? input.nfeExternalId}`,
          extra: {
            nfeExternalId: input.nfeExternalId,
            nomusNfeId: input.nomusNfeId ?? null,
          },
        },
      ];
    case "ncm":
      return [
        {
          key: input.ncm ?? "—",
          label: input.ncm ?? "Sem NCM",
          extra: { taxType: input.taxType },
        },
      ];
    case "cfop":
      return [
        {
          key: input.cfop ?? "—",
          label: input.cfop ?? "Sem CFOP",
          extra: { taxType: input.taxType },
        },
      ];
    case "product": {
      if (input.itemNumber == null && !input.ncm) return [];
      const key = `item:${input.itemNumber ?? "?"}|ncm:${input.ncm ?? "—"}`;
      return [
        {
          key,
          label:
            input.itemNumber != null
              ? `Item ${input.itemNumber}${input.ncm ? ` · NCM ${input.ncm}` : ""}`
              : `NCM ${input.ncm}`,
          extra: { taxType: input.taxType },
        },
      ];
    }
    case "order": {
      const out: Array<{ key: string; label: string; extra?: Partial<FiscalTaxIntelRow> }> = [];
      for (const a of input.allocations) {
        if (!a.salesOrderId) continue;
        out.push({
          key: a.salesOrderId,
          label: a.orderCode ?? a.salesOrderId.slice(0, 8),
          extra: {
            salesOrderId: a.salesOrderId,
            orderCode: a.orderCode,
            taxType: input.taxType,
          },
        });
      }
      return out;
    }
    case "customer": {
      const out: Array<{ key: string; label: string; extra?: Partial<FiscalTaxIntelRow> }> = [];
      for (const a of input.allocations) {
        if (!a.customerId) continue;
        out.push({
          key: a.customerId,
          label: a.customerName ?? a.customerId.slice(0, 8),
        });
      }
      return out;
    }
    default:
      return [
        {
          key: input.taxType || "OTHER",
          label: input.taxType || "OTHER",
        },
      ];
  }
}

export async function buildFiscalTaxIntelligenceDrilldown(
  prisma: PrismaLike,
  input: {
    level: FiscalTaxIntelDrillLevel;
    periodStart: string;
    periodEnd: string;
    taxType?: string | null;
    guideId?: string | null;
    nfeExternalId?: number | null;
  }
): Promise<FiscalTaxIntelPayload["drill"]> {
  const filters = parseFiscalTaxIntelFilters({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    taxType: input.taxType,
    groupBy:
      input.level === "period"
        ? "period"
        : input.level === "taxType"
          ? "taxType"
          : input.level === "guide"
            ? "guide"
            : input.level === "nfe"
              ? "nfe"
              : "order",
  });

  if (input.level === "period") {
    filters.groupBy = "period";
    const report = await buildFiscalTaxIntelligenceReport(prisma, filters);
    const nodes: FiscalTaxIntelDrillNode[] = report.rows.map((r) => ({
      level: "period",
      key: r.groupKey,
      label: r.groupLabel,
      metrics: {
        highlightedAmount: r.highlightedAmount,
        assessedAmount: r.assessedAmount,
        amountDue: r.amountDue,
        amountPaid: r.amountPaid,
        allocatedAmount: r.allocatedAmount,
        guideBalanceDue: r.guideBalanceDue,
      },
      childrenCount: 1,
      next: {
        level: "taxType",
        periodStart: r.periodStart ?? filters.periodStart,
        periodEnd: r.periodEnd ?? filters.periodEnd,
      },
    }));
    return {
      level: "period",
      path: [{ level: "period", key: "root", label: "Períodos" }],
      nodes,
    };
  }

  if (input.level === "taxType") {
    filters.groupBy = "taxType";
    const report = await buildFiscalTaxIntelligenceReport(prisma, filters);
    return {
      level: "taxType",
      path: [
        { level: "period", key: filters.periodStart, label: `${filters.periodStart}→${filters.periodEnd}` },
        { level: "taxType", key: "all", label: "Tributos" },
      ],
      nodes: report.rows.map((r) => ({
        level: "taxType",
        key: r.groupKey,
        label: r.groupLabel,
        metrics: {
          highlightedAmount: r.highlightedAmount,
          assessedAmount: r.assessedAmount,
          amountDue: r.amountDue,
          amountPaid: r.amountPaid,
          allocatedAmount: r.allocatedAmount,
          guideBalanceDue: r.guideBalanceDue,
        },
        childrenCount: 1,
        next: {
          level: "guide",
          periodStart: filters.periodStart,
          periodEnd: filters.periodEnd,
          taxType: r.taxType ?? r.groupKey,
        },
      })),
    };
  }

  if (input.level === "guide") {
    filters.groupBy = "guide";
    filters.taxType = input.taxType ?? filters.taxType;
    const report = await buildFiscalTaxIntelligenceReport(prisma, filters);
    return {
      level: "guide",
      path: [
        { level: "period", key: filters.periodStart, label: `${filters.periodStart}→${filters.periodEnd}` },
        { level: "taxType", key: filters.taxType ?? "all", label: filters.taxType ?? "Tributos" },
        { level: "guide", key: "all", label: "Guias" },
      ],
      nodes: report.rows.map((r) => ({
        level: "guide",
        key: r.groupKey,
        label: r.groupLabel,
        metrics: {
          highlightedAmount: r.highlightedAmount,
          assessedAmount: r.assessedAmount,
          amountDue: r.amountDue,
          amountPaid: r.amountPaid,
          allocatedAmount: r.allocatedAmount,
          guideBalanceDue: r.guideBalanceDue,
        },
        childrenCount: 1,
        next: {
          level: "nfe",
          periodStart: filters.periodStart,
          periodEnd: filters.periodEnd,
          taxType: filters.taxType ?? undefined,
          guideId: r.guideId ?? r.groupKey,
        },
      })),
    };
  }

  if (input.level === "nfe") {
    // NFs via allocations of the guide
    const guideId = input.guideId;
    if (!guideId) {
      return { level: "nfe", path: [], nodes: [] };
    }
    const allocs = await prisma.fiscalAllocation.findMany({
      where: { guideId },
      select: { nomusNfeId: true, salesOrderId: true, allocatedAmount: true, taxType: true },
    });
    const nfeIds = [
      ...new Set(allocs.map((a) => a.nomusNfeId).filter((id): id is string => Boolean(id))),
    ];
    const nfes =
      nfeIds.length === 0
        ? []
        : await prisma.nomusNfe.findMany({
            where: { id: { in: nfeIds } },
            select: { id: true, externalId: true, numero: true },
          });
    const nodes: FiscalTaxIntelDrillNode[] = nfes.map((n) => {
      const allocated = allocs
        .filter((a) => a.nomusNfeId === n.id)
        .reduce((s, a) => s + dec(a.allocatedAmount), 0);
      return {
        level: "nfe",
        key: String(n.externalId),
        label: `NF ${n.numero ?? n.externalId}`,
        metrics: {
          highlightedAmount: 0,
          assessedAmount: 0,
          amountDue: 0,
          amountPaid: 0,
          allocatedAmount: roundFiscalIntelMoney(allocated),
          guideBalanceDue: 0,
        },
        childrenCount: 1,
        next: {
          level: "order",
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          guideId,
          nfeExternalId: n.externalId,
        },
      };
    });
    return {
      level: "nfe",
      path: [
        { level: "guide", key: guideId, label: `Guia ${guideId.slice(0, 8)}` },
        { level: "nfe", key: "all", label: "NF-e" },
      ],
      nodes,
    };
  }

  // order
  const guideId = input.guideId;
  const allocWhere: Record<string, unknown> = {};
  if (guideId) allocWhere.guideId = guideId;
  if (input.nfeExternalId != null) {
    const nfe = await prisma.nomusNfe.findFirst({
      where: { externalId: input.nfeExternalId },
      select: { id: true },
    });
    if (nfe) allocWhere.nomusNfeId = nfe.id;
  }
  const allocs = await prisma.fiscalAllocation.findMany({
    where: allocWhere as never,
    select: {
      salesOrderId: true,
      allocatedAmount: true,
      taxType: true,
    },
  });
  const orderIds = [
    ...new Set(allocs.map((a) => a.salesOrderId).filter((id): id is string => Boolean(id))),
  ];
  const orderRows =
    orderIds.length === 0
      ? []
      : await prisma.salesOrder.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, orderCode: true },
        });
  const nodes: FiscalTaxIntelDrillNode[] = orderRows.map((o) => {
    const allocated = allocs
      .filter((a) => a.salesOrderId === o.id)
      .reduce((s, a) => s + dec(a.allocatedAmount), 0);
    return {
      level: "order",
      key: o.id,
      label: o.orderCode ?? o.id.slice(0, 8),
      metrics: {
        highlightedAmount: 0,
        assessedAmount: 0,
        amountDue: 0,
        amountPaid: 0,
        allocatedAmount: roundFiscalIntelMoney(allocated),
        guideBalanceDue: 0,
      },
      childrenCount: 0,
    };
  });
  return {
    level: "order",
    path: [
      { level: "nfe", key: String(input.nfeExternalId ?? ""), label: "NF" },
      { level: "order", key: "all", label: "Pedidos" },
    ],
    nodes,
  };
}

export { FISCAL_TAX_INTEL_GROUP_BY_LABELS };
