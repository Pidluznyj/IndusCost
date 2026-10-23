import type { Prisma } from "@prisma/client";
import { isNomusPurchaseOrderOpenStage, isNomusPurchaseOrderOverdue } from "./nomusPurchaseOrderClassifier.js";
import type { PurchaseOrderFinancialStatus } from "./nomusPurchaseOrder360.js";
import type { NomusPurchaseOrderStage } from "./nomusPurchaseOrderTypes.js";
import { PAYMENT_TERMS_BUCKETS, type PaymentTermsBucket } from "@/src/lib/purchasing/purchasePaymentTerms.js";
import { parsePurchaseOrderPresenceFilter, type PurchaseOrderPresenceFilter } from "./nomusPurchaseOrderSyncUi.js";
import type { PaymentTermsCellDto } from "@/src/lib/purchasing/purchasePaymentTermsAnalysis.js";

/** Filtros e ordenação do Prazo de Pagamento sobre linhas já calculadas (mesmo motor). */
export function applyPaymentTermsListFilters<T extends { paymentTerms: PaymentTermsCellDto; issuedAt?: string | null }>(
  rows: T[],
  filters: Pick<NomusPurchaseOrderListFilters, "paymentTermsBucket" | "paymentTermsTarget" | "sort">
): T[] {
  let out = rows;
  if (filters.paymentTermsBucket) out = out.filter((r) => r.paymentTerms.bucket === filters.paymentTermsBucket);
  if (filters.paymentTermsTarget === "BELOW") out = out.filter((r) => r.paymentTerms.belowTarget === true);
  if (filters.paymentTermsTarget === "MEETS") out = out.filter((r) => r.paymentTerms.belowTarget === false);
  if (filters.sort) {
    const dir = filters.sort === "pmp_asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      const pa = a.paymentTerms.pmpDays;
      const pb = b.paymentTerms.pmpDays;
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return (pa - pb) * dir;
    });
  }
  return out;
}

export function hasPaymentTermsListFilters(
  filters: Pick<NomusPurchaseOrderListFilters, "paymentTermsBucket" | "paymentTermsTarget" | "sort">
): boolean {
  return Boolean(filters.paymentTermsBucket || filters.paymentTermsTarget || filters.sort);
}

export type NomusPurchaseOrderFiscalFilter = "WITH_NFE" | "WITHOUT_NFE";

export type NomusPurchaseOrderListFilters = {
  q?: string | null;
  orderNumber?: string | null;
  supplier?: string | null;
  extraSupplierExternalIds?: number[];
  extraSearchSupplierExternalIds?: number[];
  status?: string | null;
  stage?: string | null;
  product?: string | null;
  issuedFrom?: Date | null;
  issuedTo?: Date | null;
  expectedFrom?: Date | null;
  expectedTo?: Date | null;
  openOnly?: boolean;
  overdueOnly?: boolean;
  canceledOnly?: boolean;
  fiscalStatus?: NomusPurchaseOrderFiscalFilter | null;
  financialStatus?: PurchaseOrderFinancialStatus | null;
  /** Faixa do PMP (Prazo de Pagamento). */
  paymentTermsBucket?: PaymentTermsBucket | null;
  /** Comparação com a meta de PMP (só com meta configurada). */
  paymentTermsTarget?: "BELOW" | "MEETS" | null;
  /** Ordenação pelo PMP em dias (não identificados sempre ao final). */
  sort?: "pmp_asc" | "pmp_desc" | null;
  /**
   * Presença no Nomus. Padrão ACTIVE: carteira sem "Ausente no Nomus — confirmado"
   * (histórico só com MISSING_CONFIRMED/ALL). Em verificação continua na carteira.
   */
  presence?: PurchaseOrderPresenceFilter;
  page?: number;
  pageSize?: number;
};

export function parseOptionalDate(value: unknown): Date | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseNomusPurchaseOrderListFilters(
  query: Record<string, unknown>
): NomusPurchaseOrderListFilters {
  const flag = (key: string) => {
    const raw = String(query[key] ?? "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "sim";
  };
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize ?? "25"), 10) || 25));
  const fiscalRaw = String(query.fiscalStatus ?? query.situacaoFiscal ?? "").trim().toUpperCase();
  const financialRaw = String(query.financialStatus ?? query.situacaoFinanceira ?? "").trim().toUpperCase();
  const fiscalStatus: NomusPurchaseOrderFiscalFilter | null =
    fiscalRaw === "WITH_NFE" || fiscalRaw === "COM_NF" || fiscalRaw === "COM-NF"
      ? "WITH_NFE"
      : fiscalRaw === "WITHOUT_NFE" || fiscalRaw === "SEM_NF" || fiscalRaw === "SEM-NF"
        ? "WITHOUT_NFE"
        : null;
  const financialAliases: Record<string, PurchaseOrderFinancialStatus> = {
    PLANNED_ONLY: "PLANNED_ONLY",
    PLANEJADO: "PLANNED_ONLY",
    PARTIALLY_CONFIRMED: "PARTIALLY_CONFIRMED",
    CONFIRMED: "CONFIRMED",
    CONFIRMADO: "CONFIRMED",
    PARTIALLY_PAID: "PARTIALLY_PAID",
    PARCIAL_PAGO: "PARTIALLY_PAID",
    PAID: "PAID",
    PAGO: "PAID",
    NO_FINANCIAL_DATA: "NO_FINANCIAL_DATA",
    SEM_VINCULO: "NO_FINANCIAL_DATA",
  };
  return {
    q: String(query.q ?? query.search ?? "").trim() || null,
    orderNumber: String(query.orderNumber ?? query.pedido ?? "").trim() || null,
    supplier: String(query.supplier ?? query.fornecedor ?? "").trim() || null,
    status: String(query.status ?? "").trim() || null,
    stage: String(query.stage ?? query.fase ?? "").trim() || null,
    product: String(query.product ?? query.produto ?? "").trim() || null,
    fiscalStatus,
    financialStatus: financialAliases[financialRaw] ?? null,
    paymentTermsBucket: PAYMENT_TERMS_BUCKETS.find(
      (b) => b === String(query.paymentTermsBucket ?? query.faixaPmp ?? "").trim().toUpperCase()
    ) ?? null,
    paymentTermsTarget: (() => {
      const raw = String(query.paymentTermsTarget ?? query.metaPmp ?? "").trim().toUpperCase();
      return raw === "BELOW" || raw === "ABAIXO" ? "BELOW" : raw === "MEETS" || raw === "ATENDE" ? "MEETS" : null;
    })(),
    sort: (() => {
      const raw = String(query.sort ?? "").trim().toLowerCase();
      return raw === "pmp_asc" || raw === "pmp_desc" ? raw : null;
    })(),
    issuedFrom: parseOptionalDate(query.issuedFrom ?? query.emissaoDe),
    issuedTo: parseOptionalDate(query.issuedTo ?? query.emissaoAte),
    expectedFrom: parseOptionalDate(query.expectedFrom ?? query.previsaoDe),
    expectedTo: parseOptionalDate(query.expectedTo ?? query.previsaoAte),
    openOnly: flag("openOnly") || flag("somenteAbertos"),
    overdueOnly: flag("overdueOnly") || flag("somenteAtrasados"),
    canceledOnly: flag("canceledOnly") || flag("somenteCancelados"),
    presence: parsePurchaseOrderPresenceFilter(query.presence ?? query.presenca),
    page,
    pageSize,
  };
}

/** Filtro de presença no Nomus — o mesmo where alimenta lista, KPIs, total e paginação. */
export function buildPurchaseOrderPresenceWhere(
  presence: PurchaseOrderPresenceFilter | null | undefined
): Prisma.NomusPurchaseOrderWhereInput | null {
  switch (presence ?? "ACTIVE") {
    case "ALL":
      return null;
    case "MISSING":
      return { sourcePresenceStatus: { in: ["MISSING_CANDIDATE", "MISSING_CONFIRMED"] } };
    case "MISSING_CANDIDATE":
      return { sourcePresenceStatus: "MISSING_CANDIDATE" };
    case "MISSING_CONFIRMED":
      return { sourcePresenceStatus: "MISSING_CONFIRMED" };
    default:
      return { sourcePresenceStatus: { not: "MISSING_CONFIRMED" } };
  }
}

export function buildNomusPurchaseOrderWhere(
  filters: NomusPurchaseOrderListFilters,
  now: Date = new Date()
): Prisma.NomusPurchaseOrderWhereInput {
  const AND: Prisma.NomusPurchaseOrderWhereInput[] = [];

  const presenceWhere = buildPurchaseOrderPresenceWhere(filters.presence);
  if (presenceWhere) AND.push(presenceWhere);

  if (filters.q) {
    const numericId = /^\d+$/.test(filters.q) ? Number(filters.q) : null;
    AND.push({
      OR: [
        { orderNumber: { contains: filters.q, mode: "insensitive" } },
        { supplierName: { contains: filters.q, mode: "insensitive" } },
        { supplierTaxId: { contains: filters.q, mode: "insensitive" } },
        { statusRaw: { contains: filters.q, mode: "insensitive" } },
        ...(numericId != null
          ? [{ externalId: numericId }, { supplierExternalId: numericId }]
          : []),
        ...((filters.extraSearchSupplierExternalIds?.length ?? 0) > 0
          ? [{ supplierExternalId: { in: filters.extraSearchSupplierExternalIds } }]
          : []),
        { items: { some: { OR: [
          { productCode: { contains: filters.q, mode: "insensitive" } },
          { description: { contains: filters.q, mode: "insensitive" } },
        ] } } },
      ],
    });
  }
  if (filters.orderNumber) {
    AND.push({ orderNumber: { contains: filters.orderNumber, mode: "insensitive" } });
  }
  if (filters.supplier || (filters.extraSupplierExternalIds?.length ?? 0) > 0) {
    AND.push({
      OR: [
        ...(filters.supplier
          ? [
              { supplierName: { contains: filters.supplier, mode: "insensitive" as const } },
              { supplierTaxId: { contains: filters.supplier, mode: "insensitive" as const } },
              ...(/^\d+$/.test(filters.supplier)
                ? [{ supplierExternalId: Number(filters.supplier) }]
                : []),
            ]
          : []),
        ...((filters.extraSupplierExternalIds?.length ?? 0) > 0
          ? [{ supplierExternalId: { in: filters.extraSupplierExternalIds } }]
          : []),
      ],
    });
  }
  if (filters.status) {
    AND.push({ statusRaw: { contains: filters.status, mode: "insensitive" } });
  }
  if (filters.stage) {
    AND.push({ stage: filters.stage });
  }
  if (filters.product) {
    AND.push({
      items: {
        some: {
          OR: [
            { productCode: { contains: filters.product, mode: "insensitive" } },
            { description: { contains: filters.product, mode: "insensitive" } },
          ],
        },
      },
    });
  }
  if (filters.issuedFrom) AND.push({ issuedAt: { gte: filters.issuedFrom } });
  if (filters.issuedTo) AND.push({ issuedAt: { lte: filters.issuedTo } });
  if (filters.expectedFrom) AND.push({ expectedAt: { gte: filters.expectedFrom } });
  if (filters.expectedTo) AND.push({ expectedAt: { lte: filters.expectedTo } });
  if (filters.canceledOnly) {
    AND.push({ OR: [{ canceled: true }, { stage: "CANCELED" }] });
  }
  if (filters.openOnly) {
    AND.push({ stage: { in: ["OPEN", "APPROVED", "PARTIALLY_RECEIVED"] } });
  }
  if (filters.overdueOnly) {
    AND.push({
      expectedAt: { lt: now },
      stage: { in: ["OPEN", "APPROVED", "PARTIALLY_RECEIVED"] },
    });
  }

  return AND.length > 0 ? { AND } : {};
}

export function serializeNomusPurchaseOrderListRow(row: {
  id: string;
  externalId: number;
  orderNumber: string | null;
  supplierExternalId: number | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  statusRaw: string | null;
  canceled: boolean | null;
  stage: string;
  issuedAt: Date | null;
  expectedAt: Date | null;
  totalAmount: { toString(): string } | null;
  itemCount: number;
  orderedQuantity: { toString(): string } | null;
  receivedQuantity: { toString(): string } | null;
  remainingQuantity: { toString(): string } | null;
  syncedAt: Date;
  lastSeenAt: Date;
  sourcePresenceStatus?: string | null;
  missingSince?: Date | null;
}, now: Date = new Date()) {
  const stage = row.stage as NomusPurchaseOrderStage;
  return {
    id: row.id,
    externalId: row.externalId,
    orderNumber: row.orderNumber,
    supplierExternalId: row.supplierExternalId,
    supplierName: row.supplierName,
    supplierTaxId: row.supplierTaxId,
    statusRaw: row.statusRaw,
    canceled: row.canceled,
    stage,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    expectedAt: row.expectedAt?.toISOString() ?? null,
    totalAmount: row.totalAmount ? Number(row.totalAmount.toString()) : null,
    itemCount: row.itemCount,
    orderedQuantity: row.orderedQuantity ? Number(row.orderedQuantity.toString()) : null,
    receivedQuantity: row.receivedQuantity ? Number(row.receivedQuantity.toString()) : null,
    remainingQuantity: row.remainingQuantity ? Number(row.remainingQuantity.toString()) : null,
    overdue: isNomusPurchaseOrderOverdue({ stage, expectedAt: row.expectedAt, now }),
    open: isNomusPurchaseOrderOpenStage(stage),
    syncedAt: row.syncedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    sourcePresenceStatus: row.sourcePresenceStatus ?? "PRESENT",
    missingSince: row.missingSince?.toISOString() ?? null,
  };
}

export function buildNomusPurchaseOrderKpis(
  rows: Array<{
    stage: string;
    expectedAt: Date | null;
    totalAmount: { toString(): string } | null;
  }>,
  now: Date = new Date()
) {
  const inDays = (days: number) => {
    const limit = new Date(now);
    limit.setDate(limit.getDate() + days);
    return limit;
  };
  const horizon7 = inDays(7);
  const horizon30 = inDays(30);

  let openCount = 0;
  let openAmount = 0;
  let overdueCount = 0;
  let partialCount = 0;
  let expected7 = 0;
  let expected30 = 0;

  for (const row of rows) {
    const stage = row.stage as NomusPurchaseOrderStage;
    const amount = row.totalAmount ? Number(row.totalAmount.toString()) : 0;
    if (isNomusPurchaseOrderOpenStage(stage)) {
      openCount += 1;
      openAmount += Number.isFinite(amount) ? amount : 0;
    }
    if (isNomusPurchaseOrderOverdue({ stage, expectedAt: row.expectedAt, now })) overdueCount += 1;
    if (stage === "PARTIALLY_RECEIVED") partialCount += 1;
    if (isNomusPurchaseOrderOpenStage(stage) && row.expectedAt) {
      if (row.expectedAt >= now && row.expectedAt <= horizon7) expected7 += 1;
      if (row.expectedAt >= now && row.expectedAt <= horizon30) expected30 += 1;
    }
  }

  return {
    openCount,
    openAmount,
    overdueCount,
    partialCount,
    expectedNext7Days: expected7,
    expectedNext30Days: expected30,
  };
}
