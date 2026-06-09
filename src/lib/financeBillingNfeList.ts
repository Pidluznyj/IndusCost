import { NomusNfeBillingClassification, Prisma } from "@prisma/client";
import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";
import { prisma } from "@/src/lib/prisma.js";
import { NOMUS_NFE_STATUS_CANCELLED } from "@/src/lib/nomusNfeClassification.js";

export type FinanceBillingNfeClassificationFilter =
  | "all"
  | "market"
  | "group"
  | "logistics";

export type FinanceBillingNfeStatusFilter = "all" | "authorized" | "cancelled";

export type FinanceBillingNfeFilters = {
  year: number;
  month: number | null;
  customerCnpj: string | null;
  documentNumber: string | null;
  classification: FinanceBillingNfeClassificationFilter;
  status: FinanceBillingNfeStatusFilter;
};

export type FinanceBillingNfeListItem = {
  id: string;
  externalId: number;
  numero: string | null;
  serie: string | null;
  status: number | null;
  billingClassification: NomusNfeBillingClassification | null;
  xmlDestCnpjCpf: string | null;
  xmlNatOp: string | null;
  fiscalDate: string | null;
  dataProcessamento: string | null;
  valorLiquido: number | null;
  isMarketSale: boolean;
  syncedAt: string;
};

export type FinanceBillingNfeListPayload = {
  filters: FinanceBillingNfeFilters;
  total: number;
  items: FinanceBillingNfeListItem[];
  generatedAt: string;
};

const CLASSIFICATION_MAP: Record<
  Exclude<FinanceBillingNfeClassificationFilter, "all">,
  NomusNfeBillingClassification
> = {
  market: NomusNfeBillingClassification.MARKET_REVENUE,
  group: NomusNfeBillingClassification.INTERCOMPANY,
  logistics: NomusNfeBillingClassification.LOGISTICS_NOT_REVENUE,
};

function parseYear(value: unknown): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(n) && n >= 2000 && n <= 2100) return n;
  return new Date().getFullYear();
}

function parseMonth(value: unknown): number | null {
  if (value == null || value === "" || value === "all") return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : null;
}

function normalizeCnpjQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits : null;
}

function normalizeDocumentNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function parseFinanceBillingNfeFilters(query: Record<string, unknown>): FinanceBillingNfeFilters {
  const classificationRaw = String(query.classification ?? "all").toLowerCase();
  const statusRaw = String(query.status ?? "all").toLowerCase();
  const classification: FinanceBillingNfeClassificationFilter =
    classificationRaw === "market" ||
    classificationRaw === "group" ||
    classificationRaw === "logistics"
      ? classificationRaw
      : "all";
  const status: FinanceBillingNfeStatusFilter =
    statusRaw === "authorized" || statusRaw === "cancelled" ? statusRaw : "all";

  return {
    year: parseYear(query.year),
    month: parseMonth(query.month),
    customerCnpj: normalizeCnpjQuery(query.customerCnpj ?? query.cnpj),
    documentNumber: normalizeDocumentNumber(query.documentNumber ?? query.nfNumber),
    classification,
    status,
  };
}

function buildPrismaWhere(filters: FinanceBillingNfeFilters): Prisma.NomusNfeWhereInput {
  const yearStart = new Date(filters.year, 0, 1);
  const yearEnd = new Date(filters.year, 11, 31, 23, 59, 59, 999);

  const where: Prisma.NomusNfeWhereInput = {
    OR: [
      { xmlDhEmi: { gte: yearStart, lte: yearEnd } },
      { xmlDhEmi: null, dataProcessamento: { gte: yearStart, lte: yearEnd } },
    ],
  };

  if (filters.month != null) {
    const monthStart = new Date(filters.year, filters.month - 1, 1);
    const monthEnd = new Date(filters.year, filters.month, 0, 23, 59, 59, 999);
    where.AND = [
      {
        OR: [
          { xmlDhEmi: { gte: monthStart, lte: monthEnd } },
          { xmlDhEmi: null, dataProcessamento: { gte: monthStart, lte: monthEnd } },
        ],
      },
    ];
  }

  if (filters.customerCnpj) {
    where.xmlDestCnpjCpf = { contains: filters.customerCnpj };
  }

  if (filters.documentNumber) {
    where.numero = { contains: filters.documentNumber };
  }

  if (filters.classification !== "all") {
    where.billingClassification = CLASSIFICATION_MAP[filters.classification];
  }

  if (filters.status === "authorized") {
    where.status = { not: NOMUS_NFE_STATUS_CANCELLED };
  } else if (filters.status === "cancelled") {
    where.status = NOMUS_NFE_STATUS_CANCELLED;
  }

  return where;
}

function resolveNfeListLimit(query: Record<string, unknown>): number {
  const raw = Number.parseInt(String(query.limit ?? "50"), 10);
  const isExport = String(query.format ?? "").toLowerCase() === "csv";
  const max = isExport ? 10000 : 200;
  return Math.min(max, Math.max(1, Number.isFinite(raw) ? raw : isExport ? 10000 : 50));
}

export async function buildFinanceBillingNfeList(
  query: Record<string, unknown>
): Promise<FinanceBillingNfeListPayload> {
  const filters = parseFinanceBillingNfeFilters(query);
  const where = buildPrismaWhere(filters);
  const limit = resolveNfeListLimit(query);

  const [total, rows] = await Promise.all([
    prisma.nomusNfe.count({ where }),
    prisma.nomusNfe.findMany({
      where,
      orderBy: [{ xmlDhEmi: "desc" }, { dataProcessamento: "desc" }],
      take: limit,
      select: {
        id: true,
        externalId: true,
        numero: true,
        serie: true,
        status: true,
        billingClassification: true,
        xmlDestCnpjCpf: true,
        xmlNatOp: true,
        xmlDhEmi: true,
        dataProcessamento: true,
        valorLiquido: true,
        isMarketSale: true,
        syncedAt: true,
      },
    }),
  ]);

  return {
    filters,
    total,
    items: rows.map((row) => ({
      id: row.id,
      externalId: row.externalId,
      numero: row.numero,
      serie: row.serie,
      status: row.status,
      billingClassification: row.billingClassification,
      xmlDestCnpjCpf: row.xmlDestCnpjCpf,
      xmlNatOp: row.xmlNatOp,
      fiscalDate: row.xmlDhEmi?.toISOString() ?? null,
      dataProcessamento: row.dataProcessamento?.toISOString() ?? null,
      valorLiquido: decimalToNumber(row.valorLiquido),
      isMarketSale: row.isMarketSale,
      syncedAt: row.syncedAt.toISOString(),
    })),
    generatedAt: new Date().toISOString(),
  };
}
