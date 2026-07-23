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
  resolveOutputDocumentsEmissionDateBounds,
  serializeOutputDocumentsListFilters,
} from "@/src/lib/output-documents/outputDocumentsListQuery.js";
import type {
  OutputDocumentsListFilters,
  OutputDocumentsListPayload,
  OutputDocumentsSummaryPayload,
} from "@/src/lib/output-documents/outputDocumentsListTypes.js";
import type { OutputDocumentFinancialReceivableInput } from "@/src/lib/output-documents/outputDocumentFinancialStatusResolver.js";
import { normalizeOutputDocumentOrderCode } from "@/src/lib/sales/salesOrderOutputDocumentLinkResolver.js";

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
    orderCodesByDoc: new Map(),
    customerNameByDoc: new Map(),
    companyNameByDoc: new Map(),
    referenceDate,
  };
}

type LinkedDocumentKeys = { externalIds: number[]; idNfes: number[] };

/** Termos de busca de pedido: "2716", "PD 02716", "PD02716". */
export function buildOutputDocumentsOrderSearchTerms(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const terms = new Set<string>([trimmed]);
  const normalized = normalizeOutputDocumentOrderCode(trimmed);
  if (normalized) {
    terms.add(normalized);
    const digits = normalized.replace(/^PD/i, "");
    terms.add(`PD ${digits}`);
    terms.add(digits);
  }
  const asInt = Number.parseInt(trimmed, 10);
  if (Number.isFinite(asInt) && String(asInt) === trimmed) {
    terms.add(`PD${asInt}`);
    terms.add(`PD ${String(asInt).padStart(5, "0")}`);
    terms.add(String(asInt).padStart(5, "0"));
  }
  return [...terms];
}

async function resolveOrderLinkedDocumentKeys(
  db: PrismaLike,
  order: string
): Promise<LinkedDocumentKeys> {
  const trimmed = order.trim();
  if (!trimmed) return { externalIds: [], idNfes: [] };

  const terms = buildOutputDocumentsOrderSearchTerms(trimmed);
  const asInt = Number.parseInt(trimmed, 10);
  const numeric =
    Number.isFinite(asInt) && String(asInt) === trimmed ? asInt : null;

  const orderCodeOr: Prisma.SalesOrderWhereInput[] = terms.map((term) => ({
    orderCode: { contains: term, mode: "insensitive" as const },
  }));
  if (numeric != null) {
    orderCodeOr.push({ externalSalesOrderId: numeric });
  }

  const linkCodeOr: Prisma.SalesOrderNfeLinkWhereInput[] = terms.map((term) => ({
    orderCode: { contains: term, mode: "insensitive" as const },
  }));

  const o2cOr: Prisma.OrderToCashAuditFactWhereInput[] = terms.map((term) => ({
    orderCode: { contains: term, mode: "insensitive" as const },
  }));
  if (numeric != null) {
    // só externalId do DS — não misturar com idNfe (ruído)
    o2cOr.push({ stockDocumentExternalId: numeric });
  }

  const [orders, links, o2cFacts] = await Promise.all([
    db.salesOrder.findMany({
      where: { OR: orderCodeOr },
      select: { id: true },
      take: 500,
    }),
    db.salesOrderNfeLink.findMany({
      where: { OR: linkCodeOr },
      select: { nfeExternalId: true },
      take: 2000,
    }),
    db.orderToCashAuditFact.findMany({
      where: { OR: o2cOr },
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

    const moreFacts = await db.orderToCashAuditFact.findMany({
      where: { salesOrderId: { in: [...orderIds] } },
      select: {
        stockDocumentExternalId: true,
        stockDocumentIdNfe: true,
      },
      take: 5000,
    });
    for (const fact of moreFacts) {
      if (fact.stockDocumentExternalId != null) {
        externalIds.add(fact.stockDocumentExternalId);
      }
      if (fact.stockDocumentIdNfe != null) {
        idNfes.add(fact.stockDocumentIdNfe);
      }
    }
  }

  for (const fact of o2cFacts) {
    if (fact.stockDocumentExternalId != null) {
      externalIds.add(fact.stockDocumentExternalId);
    }
    if (fact.stockDocumentIdNfe != null) {
      idNfes.add(fact.stockDocumentIdNfe);
    }
  }

  // chute: número puro = externalId do documento de estoque
  if (numeric != null) {
    externalIds.add(numeric);
  }

  return {
    externalIds: [...externalIds],
    idNfes: [...idNfes],
  };
}

/**
 * Documentos ligados ao cliente via Pedido (SalesOrder.Customer / externalCustomerId),
 * além do person* no stage — cobre linhas com Cliente enriquecido e personName nulo.
 */
async function resolveCustomerLinkedDocumentKeys(
  db: PrismaLike,
  filters: Pick<
    OutputDocumentsListFilters,
    "customer" | "customerId" | "personExternalId"
  >
): Promise<LinkedDocumentKeys | null> {
  const hasCustomerFilter =
    filters.customerId != null ||
    filters.personExternalId != null ||
    Boolean(filters.customer?.trim());
  if (!hasCustomerFilter) return null;

  const or: Prisma.SalesOrderWhereInput[] = [];
  if (filters.customerId) {
    or.push({ customerId: filters.customerId });
  }
  if (filters.personExternalId != null) {
    or.push({ externalCustomerId: filters.personExternalId });
  }
  if (filters.customer?.trim()) {
    const name = filters.customer.trim();
    or.push({
      Customer: { is: { companyName: { contains: name, mode: "insensitive" } } },
    });
    or.push({
      Customer: { is: { tradeName: { contains: name, mode: "insensitive" } } },
    });
  }

  const orders = await db.salesOrder.findMany({
    where: { OR: or },
    select: { id: true },
    take: 1000,
  });
  if (orders.length === 0) return { externalIds: [], idNfes: [] };

  const orderIds = orders.map((o) => o.id);
  const [links, facts] = await Promise.all([
    db.salesOrderNfeLink.findMany({
      where: { salesOrderId: { in: orderIds } },
      select: { nfeExternalId: true },
      take: 5000,
    }),
    db.orderToCashAuditFact.findMany({
      where: { salesOrderId: { in: orderIds } },
      select: {
        stockDocumentExternalId: true,
        stockDocumentIdNfe: true,
      },
      take: 10_000,
    }),
  ]);

  const idNfes = new Set<number>();
  const externalIds = new Set<number>();
  for (const link of links) idNfes.add(link.nfeExternalId);
  for (const fact of facts) {
    if (fact.stockDocumentExternalId != null) {
      externalIds.add(fact.stockDocumentExternalId);
    }
    if (fact.stockDocumentIdNfe != null) {
      idNfes.add(fact.stockDocumentIdNfe);
    }
  }
  return { externalIds: [...externalIds], idNfes: [...idNfes] };
}

function linkedKeysToWhere(
  keys: LinkedDocumentKeys
): Prisma.NomusStockDocumentWhereInput | null {
  const or: Prisma.NomusStockDocumentWhereInput[] = [];
  if (keys.externalIds.length) {
    or.push({ externalId: { in: keys.externalIds } });
  }
  if (keys.idNfes.length) {
    or.push({ idNfe: { in: keys.idNfes } });
  }
  if (or.length === 0) return null;
  return or.length === 1 ? or[0]! : { OR: or };
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

  const emissionBounds = resolveOutputDocumentsEmissionDateBounds({
    from: filters.from,
    to: filters.to,
    year: filters.year,
    month: filters.month,
  });
  if (emissionBounds) {
    and.push({ dataDocumento: emissionBounds });
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

  const hasCustomerFilter =
    filters.customerId != null ||
    filters.personExternalId != null ||
    Boolean(filters.customer?.trim());
  if (hasCustomerFilter) {
    const customerOr: Prisma.NomusStockDocumentWhereInput[] = [];
    if (filters.personExternalId != null) {
      customerOr.push({ personExternalId: filters.personExternalId });
    }
    if (filters.customer?.trim()) {
      customerOr.push({
        personName: {
          contains: filters.customer.trim(),
          mode: "insensitive",
        },
      });
    }
    const customerLinked = await resolveCustomerLinkedDocumentKeys(db, filters);
    if (customerLinked) {
      const linkedWhere = linkedKeysToWhere(customerLinked);
      if (linkedWhere) customerOr.push(linkedWhere);
    }
    if (customerOr.length === 0) return null;
    and.push(customerOr.length === 1 ? customerOr[0]! : { OR: customerOr });
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
    const linkedWhere = linkedKeysToWhere(linked);
    if (!linkedWhere) return null;
    and.push(linkedWhere);
  }

  if (filters.search) {
    const q = filters.search.trim();
    const asInt = Number.parseInt(q, 10);
    const numeric =
      Number.isFinite(asInt) && String(asInt) === q ? asInt : null;
    const searchOr: Prisma.NomusStockDocumentWhereInput[] = [
      { documentNumber: { contains: q, mode: "insensitive" } },
      { personName: { contains: q, mode: "insensitive" } },
      { companyName: { contains: q, mode: "insensitive" } },
      { statusRaw: { contains: q, mode: "insensitive" } },
    ];
    if (numeric != null) {
      searchOr.push({ externalId: numeric }, { idNfe: numeric });
    }

    const orderKeys = await resolveOrderLinkedDocumentKeys(db, q);
    const orderWhere = linkedKeysToWhere(orderKeys);
    if (orderWhere) searchOr.push(orderWhere);

    const searchNfeIds = await resolveNfeFilterIds(db, {
      ...filters,
      nfe: q,
      idNfe: null,
    });
    if (searchNfeIds && searchNfeIds.length > 0) {
      searchOr.push({ idNfe: { in: searchNfeIds } });
    }

    and.push({ OR: searchOr });
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

  const [nfes, receivables, o2cFacts, nfeLinks] = await Promise.all([
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
        orderCode: true,
      },
      take: 20_000,
    }),
    nfeIds.length
      ? db.salesOrderNfeLink.findMany({
          where: { nfeExternalId: { in: nfeIds } },
          select: {
            nfeExternalId: true,
            salesOrderId: true,
            orderCode: true,
          },
          take: 20_000,
        })
      : Promise.resolve([]),
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

  const docsByNfe = new Map<number, number[]>();
  for (const row of rows) {
    if (row.idNfe == null) continue;
    const list = docsByNfe.get(row.idNfe) ?? [];
    list.push(row.externalId);
    docsByNfe.set(row.idNfe, list);
  }

  const orderIdsByDoc = new Map<number, Set<string>>();
  const orderCodesByDoc = new Map<number, Set<string>>();

  const addOrder = (
    docExternalId: number,
    salesOrderId: string | null | undefined,
    orderCode: string | null | undefined
  ) => {
    if (salesOrderId) {
      const ids = orderIdsByDoc.get(docExternalId) ?? new Set<string>();
      ids.add(salesOrderId);
      orderIdsByDoc.set(docExternalId, ids);
    }
    const code = orderCode?.trim();
    if (code) {
      const codes = orderCodesByDoc.get(docExternalId) ?? new Set<string>();
      codes.add(code);
      orderCodesByDoc.set(docExternalId, codes);
    }
  };

  for (const fact of o2cFacts) {
    if (fact.stockDocumentExternalId == null) continue;
    addOrder(fact.stockDocumentExternalId, fact.salesOrderId, fact.orderCode);
  }

  for (const link of nfeLinks) {
    const docs = docsByNfe.get(link.nfeExternalId) ?? [];
    for (const docExternalId of docs) {
      addOrder(docExternalId, link.salesOrderId, link.orderCode);
    }
  }

  const allOrderIds = [
    ...new Set(
      [...orderIdsByDoc.values()].flatMap((set) => [...set])
    ),
  ];

  const salesOrders =
    allOrderIds.length > 0
      ? await db.salesOrder.findMany({
          where: { id: { in: allOrderIds } },
          select: {
            id: true,
            orderCode: true,
            companyIssuer: true,
            Customer: {
              select: { tradeName: true, companyName: true },
            },
          },
          take: 10_000,
        })
      : [];

  const orderById = new Map(
    salesOrders.map((order) => [order.id, order] as const)
  );

  for (const [docExternalId, orderIds] of orderIdsByDoc) {
    enrichment.allocatedOrdersCountByDoc.set(docExternalId, orderIds.size);

    const codes = orderCodesByDoc.get(docExternalId) ?? new Set<string>();
    for (const orderId of orderIds) {
      const order = orderById.get(orderId);
      if (order?.orderCode?.trim()) codes.add(order.orderCode.trim());
    }
    const sortedCodes = [...codes].sort((a, b) =>
      a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" })
    );
    enrichment.orderCodesByDoc.set(docExternalId, sortedCodes);

    if (!enrichment.customerNameByDoc.has(docExternalId)) {
      for (const orderId of orderIds) {
        const order = orderById.get(orderId);
        const name =
          order?.Customer?.tradeName?.trim() ||
          order?.Customer?.companyName?.trim() ||
          null;
        if (name) {
          enrichment.customerNameByDoc.set(docExternalId, name);
          break;
        }
      }
    }

    if (!enrichment.companyNameByDoc.has(docExternalId)) {
      for (const orderId of orderIds) {
        const issuer = orderById.get(orderId)?.companyIssuer?.trim();
        if (issuer) {
          enrichment.companyNameByDoc.set(docExternalId, issuer);
          break;
        }
      }
    }
  }

  // Documentos só com código via link (sem salesOrderId resolvido) ainda contam.
  for (const [docExternalId, codes] of orderCodesByDoc) {
    if (!enrichment.allocatedOrdersCountByDoc.has(docExternalId)) {
      enrichment.allocatedOrdersCountByDoc.set(docExternalId, codes.size);
    }
    if (!enrichment.orderCodesByDoc.has(docExternalId)) {
      enrichment.orderCodesByDoc.set(
        docExternalId,
        [...codes].sort((a, b) =>
          a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" })
        )
      );
    }
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
