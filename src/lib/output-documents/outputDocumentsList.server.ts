/**
 * DS-04.1 — Loader Prisma read-only de lista/resumo de Documentos de Saída.
 * Sem rawJson. Sem N+1. Sem chamada Nomus HTTP.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { NOMUS_STOCK_DOCUMENT_TIPO_SAIDA } from "@/src/lib/output-documents/auditOutputDocumentsDb.js";
import {
  buildOutputDocumentListItem,
  buildOutputDocumentsListSummary,
  compareOutputDocumentListRows,
  matchesFinancialFilters,
  needsFinancialPostFilter,
  paginateRows,
  resolveListDocumentFinancialStatus,
  type OutputDocumentListEnrichment,
  type OutputDocumentListNfeRow,
  type OutputDocumentListStageRow,
} from "@/src/lib/output-documents/outputDocumentsList.js";
import {
  parseOutputDocumentsListQuery,
  serializeOutputDocumentsListFilters,
} from "@/src/lib/output-documents/outputDocumentsListQuery.js";
import type {
  OutputDocumentsListFilters,
  OutputDocumentsListPayload,
  OutputDocumentsSummaryPayload,
} from "@/src/lib/output-documents/outputDocumentsListTypes.js";
import type { OutputDocumentFinancialReceivableInput } from "@/src/lib/output-documents/outputDocumentFinancialStatusResolver.js";

type PrismaLike = Pick<
  PrismaClient,
  | "nomusStockDocument"
  | "nomusNfe"
  | "nomusAccountsReceivable"
  | "salesOrderNfeLink"
  | "salesOrder"
  | "orderToCashAuditFact"
>;

async function resolveDefaultPrisma(): Promise<PrismaLike> {
  const mod = await import("@/src/lib/prisma.js");
  return mod.prisma;
}
const STAGE_SELECT = {
  id: true,
  externalId: true,
  idNfe: true,
  tipoDocumentoEstoque: true,
  dataDocumento: true,
  documentNumber: true,
  statusRaw: true,
  isCancelled: true,
  totalValue: true,
  personExternalId: true,
  personName: true,
  companyExternalId: true,
  companyName: true,
  paymentTermsRaw: true,
  syncedAt: true,
} as const;

function emptyEnrichment(referenceDate?: Date): OutputDocumentListEnrichment {
  return {
    nfeByExternalId: new Map(),
    receivablesByNfe: new Map(),
    allocatedOrdersCountByDoc: new Map(),
    referenceDate,
  };
}

async function resolveOrderLinkedDocumentKeys(
  db: PrismaLike,
  order: string
): Promise<{ externalIds: number[]; idNfes: number[] }> {
  const trimmed = order.trim();
  if (!trimmed) return { externalIds: [], idNfes: [] };

  const asInt = Number.parseInt(trimmed, 10);
  const numeric =
    Number.isFinite(asInt) && String(asInt) === trimmed ? asInt : null;

  const orderWhere: Prisma.SalesOrderWhereInput = {
    OR: [
      { orderCode: { contains: trimmed, mode: "insensitive" } },
      ...(numeric != null ? [{ externalSalesOrderId: numeric }] : []),
    ],
  };

  const [orders, links, o2cFacts] = await Promise.all([
    db.salesOrder.findMany({
      where: orderWhere,
      select: { id: true },
      take: 500,
    }),
    db.salesOrderNfeLink.findMany({
      where: {
        OR: [
          { orderCode: { contains: trimmed, mode: "insensitive" } },
          ...(numeric != null ? [{ nfeExternalId: numeric }] : []),
        ],
      },
      select: { nfeExternalId: true },
      take: 2000,
    }),
    db.orderToCashAuditFact.findMany({
      where: {
        OR: [
          { orderCode: { contains: trimmed, mode: "insensitive" } },
          ...(numeric != null
            ? [
                { stockDocumentExternalId: numeric },
                { nfeExternalId: numeric },
              ]
            : []),
        ],
      },
      select: {
        stockDocumentExternalId: true,
        stockDocumentIdNfe: true,
        salesOrderId: true,
      },
      take: 5000,
    }),
  ]);

  const orderIds = new Set(orders.map((o) => o.id));
  const idNfes = new Set<number>();
  const externalIds = new Set<number>();

  for (const link of links) idNfes.add(link.nfeExternalId);

  if (orderIds.size > 0) {
    const moreLinks = await db.salesOrderNfeLink.findMany({
      where: { salesOrderId: { in: [...orderIds] } },
      select: { nfeExternalId: true },
      take: 2000,
    });
    for (const link of moreLinks) idNfes.add(link.nfeExternalId);
  }

  for (const fact of o2cFacts) {
    if (fact.stockDocumentExternalId != null) {
      externalIds.add(fact.stockDocumentExternalId);
    }
    if (fact.stockDocumentIdNfe != null) {
      idNfes.add(fact.stockDocumentIdNfe);
    }
  }

  if (numeric != null) {
    externalIds.add(numeric);
    idNfes.add(numeric);
  }

  return {
    externalIds: [...externalIds],
    idNfes: [...idNfes],
  };
}

async function resolveNfeFilterIds(
  db: PrismaLike,
  filters: OutputDocumentsListFilters
): Promise<number[] | null> {
  if (filters.idNfe != null) return [filters.idNfe];
  if (!filters.nfe) return null;

  const trimmed = filters.nfe.trim();
  const asInt = Number.parseInt(trimmed, 10);
  const numeric =
    Number.isFinite(asInt) && String(asInt) === trimmed ? asInt : null;

  const nfes = await db.nomusNfe.findMany({
    where: {
      OR: [
        { numero: { contains: trimmed, mode: "insensitive" } },
        ...(numeric != null ? [{ externalId: numeric }] : []),
      ],
    },
    select: { externalId: true },
    take: 500,
  });

  const ids = nfes.map((n) => n.externalId);
  if (numeric != null && !ids.includes(numeric)) ids.push(numeric);
  return ids;
}

async function buildStageWhere(
  db: PrismaLike,
  filters: OutputDocumentsListFilters
): Promise<Prisma.NomusStockDocumentWhereInput | null> {
  const and: Prisma.NomusStockDocumentWhereInput[] = [
    { tipoDocumentoEstoque: NOMUS_STOCK_DOCUMENT_TIPO_SAIDA },
  ];

  if (filters.from || filters.to) {
    and.push({
      dataDocumento: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      },
    });
  }

  if (filters.cancelled === "yes") and.push({ isCancelled: true });
  if (filters.cancelled === "no") and.push({ isCancelled: false });

  if (filters.companyExternalId != null) {
    and.push({ companyExternalId: filters.companyExternalId });
  } else if (filters.company) {
    and.push({
      companyName: { contains: filters.company, mode: "insensitive" },
    });
  }

  if (filters.personExternalId != null) {
    and.push({ personExternalId: filters.personExternalId });
  } else if (filters.customer) {
    and.push({
      personName: { contains: filters.customer, mode: "insensitive" },
    });
  }

  if (filters.status) {
    and.push({
      statusRaw: { contains: filters.status, mode: "insensitive" },
    });
  }

  const nfeIds = await resolveNfeFilterIds(db, filters);
  if (nfeIds != null) {
    if (nfeIds.length === 0) return null;
    and.push({ idNfe: { in: nfeIds } });
  }

  if (filters.order) {
    const linked = await resolveOrderLinkedDocumentKeys(db, filters.order);
    if (linked.externalIds.length === 0 && linked.idNfes.length === 0) {
      return null;
    }
    and.push({
      OR: [
        ...(linked.externalIds.length
          ? [{ externalId: { in: linked.externalIds } }]
          : []),
        ...(linked.idNfes.length ? [{ idNfe: { in: linked.idNfes } }] : []),
      ],
    });
  }

  if (filters.search) {
    const q = filters.search.trim();
    const asInt = Number.parseInt(q, 10);
    const numeric =
      Number.isFinite(asInt) && String(asInt) === q ? asInt : null;
    and.push({
      OR: [
        { documentNumber: { contains: q, mode: "insensitive" } },
        { personName: { contains: q, mode: "insensitive" } },
        { companyName: { contains: q, mode: "insensitive" } },
        { statusRaw: { contains: q, mode: "insensitive" } },
        ...(numeric != null
          ? [{ externalId: numeric }, { idNfe: numeric }]
          : []),
      ],
    });
  }

  return { AND: and };
}

async function loadEnrichment(
  db: PrismaLike,
  rows: ReadonlyArray<OutputDocumentListStageRow>,
  referenceDate?: Date
): Promise<OutputDocumentListEnrichment> {
  const enrichment = emptyEnrichment(referenceDate);
  if (rows.length === 0) return enrichment;

  const nfeIds = [
    ...new Set(
      rows
        .map((r) => r.idNfe)
        .filter((id): id is number => id != null && id > 0)
    ),
  ];
  const docExternalIds = rows.map((r) => r.externalId);

  const [nfes, receivables, o2cFacts] = await Promise.all([
    nfeIds.length
      ? db.nomusNfe.findMany({
          where: { externalId: { in: nfeIds } },
          select: {
            externalId: true,
            numero: true,
            status: true,
            valorLiquido: true,
            xmlVNF: true,
          },
        })
      : Promise.resolve([]),
    nfeIds.length
      ? db.nomusAccountsReceivable.findMany({
          where: { sourceInvoiceId: { in: nfeIds } },
          select: {
            id: true,
            externalId: true,
            sourceInvoiceId: true,
            amountReceivable: true,
            amountReceived: true,
            balanceReceivable: true,
            dueDate: true,
            settlementDate: true,
            status: true,
          },
        })
      : Promise.resolve([]),
    db.orderToCashAuditFact.findMany({
      where: { stockDocumentExternalId: { in: docExternalIds } },
      select: {
        stockDocumentExternalId: true,
        salesOrderId: true,
      },
      take: 20_000,
    }),
  ]);

  for (const nfe of nfes) {
    const row: OutputDocumentListNfeRow = {
      externalId: nfe.externalId,
      numero: nfe.numero,
      status: nfe.status,
      valorLiquido: nfe.valorLiquido,
      xmlVNF: nfe.xmlVNF,
    };
    enrichment.nfeByExternalId.set(nfe.externalId, row);
  }

  for (const ar of receivables) {
    if (ar.sourceInvoiceId == null) continue;
    const list: OutputDocumentFinancialReceivableInput[] =
      enrichment.receivablesByNfe.get(ar.sourceInvoiceId) ?? [];
    list.push({
      id: ar.id,
      externalId: ar.externalId,
      sourceInvoiceId: ar.sourceInvoiceId,
      amountReceivable: ar.amountReceivable,
      amountReceived: ar.amountReceived,
      balanceReceivable: ar.balanceReceivable,
      dueDate: ar.dueDate,
      settlementDate: ar.settlementDate,
      status: ar.status,
    });
    enrichment.receivablesByNfe.set(ar.sourceInvoiceId, list);
  }

  const ordersByDoc = new Map<number, Set<string>>();
  for (const fact of o2cFacts) {
    if (fact.stockDocumentExternalId == null || !fact.salesOrderId) continue;
    const set =
      ordersByDoc.get(fact.stockDocumentExternalId) ?? new Set<string>();
    set.add(fact.salesOrderId);
    ordersByDoc.set(fact.stockDocumentExternalId, set);
  }
  for (const [docId, set] of ordersByDoc) {
    enrichment.allocatedOrdersCountByDoc.set(docId, set.size);
  }

  return enrichment;
}

function toStageRows(
  rows: Array<{
    id: string;
    externalId: number;
    idNfe: number | null;
    tipoDocumentoEstoque: string | null;
    dataDocumento: Date | null;
    documentNumber: string | null;
    statusRaw: string | null;
    isCancelled: boolean;
    totalValue: unknown;
    personExternalId: number | null;
    personName: string | null;
    companyExternalId: number | null;
    companyName: string | null;
    paymentTermsRaw: string | null;
    syncedAt: Date;
  }>
): OutputDocumentListStageRow[] {
  return rows.map((row) => ({
    id: row.id,
    externalId: row.externalId,
    idNfe: row.idNfe,
    tipoDocumentoEstoque: row.tipoDocumentoEstoque,
    dataDocumento: row.dataDocumento,
    documentNumber: row.documentNumber,
    statusRaw: row.statusRaw,
    isCancelled: row.isCancelled,
    totalValue: row.totalValue,
    personExternalId: row.personExternalId,
    personName: row.personName,
    companyExternalId: row.companyExternalId,
    companyName: row.companyName,
    paymentTermsRaw: row.paymentTermsRaw,
    syncedAt: row.syncedAt,
  }));
}

async function loadFilteredStageRows(
  db: PrismaLike,
  filters: OutputDocumentsListFilters,
  scopeWhere?: Prisma.NomusStockDocumentWhereInput | null
): Promise<OutputDocumentListStageRow[]> {
  const where = await buildStageWhere(db, filters);
  if (!where) return [];

  const finalWhere: Prisma.NomusStockDocumentWhereInput = scopeWhere
    ? { AND: [where, scopeWhere] }
    : where;

  const rows = await db.nomusStockDocument.findMany({
    where: finalWhere,
    select: STAGE_SELECT,
  });
  return toStageRows(rows);
}

function applyFinancialAndSort(
  rows: OutputDocumentListStageRow[],
  filters: OutputDocumentsListFilters,
  enrichment: OutputDocumentListEnrichment
): OutputDocumentListStageRow[] {
  let filtered = rows;
  if (needsFinancialPostFilter(filters)) {
    filtered = rows.filter((row) => {
      const financial = resolveListDocumentFinancialStatus(row, enrichment);
      return matchesFinancialFilters(financial, filters);
    });
  }

  return [...filtered].sort((a, b) =>
    compareOutputDocumentListRows(a, b, filters.sortBy, filters.sortDir)
  );
}

export type LoadOutputDocumentsListOptions = {
  prisma?: PrismaLike;
  referenceDate?: Date;
  now?: Date;
  /** Filtro adicional de escopo comercial (carteira). */
  scopeWhere?: Prisma.NomusStockDocumentWhereInput | null;
};

/**
 * Lista paginada com os mesmos filtros do resumo.
 */
export async function loadOutputDocumentsList(
  query: Record<string, unknown>,
  options: LoadOutputDocumentsListOptions = {}
): Promise<OutputDocumentsListPayload> {
  const db = options.prisma ?? (await resolveDefaultPrisma());
  const filters = parseOutputDocumentsListQuery(query);
  const generatedAt = (options.now ?? new Date()).toISOString();

  const stageRows = await loadFilteredStageRows(db, filters, options.scopeWhere);
  const enrichment = await loadEnrichment(
    db,
    stageRows,
    options.referenceDate
  );
  const sorted = applyFinancialAndSort(stageRows, filters, enrichment);
  const page = paginateRows(sorted, filters.page, filters.pageSize);

  return {
    filters: serializeOutputDocumentsListFilters(filters),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      totalItems: page.totalItems,
      totalPages: page.totalPages,
    },
    items: page.items.map((row) =>
      buildOutputDocumentListItem(row, enrichment)
    ),
    generatedAt,
  };
}

/**
 * Resumo executivo — mesmos filtros da lista.
 */
export async function loadOutputDocumentsSummary(
  query: Record<string, unknown>,
  options: LoadOutputDocumentsListOptions = {}
): Promise<OutputDocumentsSummaryPayload> {
  const db = options.prisma ?? (await resolveDefaultPrisma());
  const filters = parseOutputDocumentsListQuery(query);
  const generatedAt = (options.now ?? new Date()).toISOString();

  const stageRows = await loadFilteredStageRows(db, filters, options.scopeWhere);
  const enrichment = await loadEnrichment(
    db,
    stageRows,
    options.referenceDate
  );
  const sorted = applyFinancialAndSort(stageRows, filters, enrichment);

  return {
    filters: serializeOutputDocumentsListFilters(filters),
    summary: buildOutputDocumentsListSummary(sorted, enrichment),
    generatedAt,
  };
}
