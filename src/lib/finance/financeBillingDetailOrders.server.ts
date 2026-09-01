/**
 * Financeiro > Faturamento > Detalhamento — loader Prisma read-only.
 *
 * Granularidade: 1 linha lógica por PEDIDO DE VENDA. As NF-e e os Documentos
 * de Saída do período viram referências agregadas na própria linha, então um
 * JOIN 1:N nunca duplica o pedido.
 *
 * Cadeia oficial (somente evidência persistida, sem fuzzy match):
 *   SalesOrder ─ SalesOrderNfeLink ─ NomusNfe ─(idNfe)─ NomusStockDocument
 *
 * Sem rawJson, sem chamada Nomus HTTP, sem N+1: no máximo 5 queries em lote
 * por requisição, independentemente da quantidade de linhas.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { NOMUS_STOCK_DOCUMENT_TIPO_SAIDA } from "@/src/lib/output-documents/auditOutputDocumentsDb.js";
import { paginateRows } from "@/src/lib/output-documents/outputDocumentsList.js";
import { isNomusNfeCancelled } from "@/src/lib/finance/nfeStatus.js";
import {
  buildFinanceBillingDetailOrderTerms,
  compareFinanceBillingDetailOrders,
  financeBillingDetailPeriodLabel,
  FINANCE_BILLING_DETAIL_SCOPE_NOTE,
  isWithinFinanceBillingDetailPeriod,
  onlyDigits,
  parseFinanceBillingDetailExternalId,
  parseFinanceBillingDetailOrdersQuery,
  resolveFinanceBillingDetailCompetenceDate,
  resolveFinanceBillingDetailPeriod,
  type FinanceBillingDetailFilters,
  type FinanceBillingDetailInvoiceRef,
  type FinanceBillingDetailOrderItem,
  type FinanceBillingDetailOrdersPayload,
  type FinanceBillingDetailOutputDocumentRef,
} from "@/src/lib/finance/financeBillingDetailOrders.js";

type PrismaLike = Pick<
  PrismaClient,
  "nomusNfe" | "salesOrderNfeLink" | "salesOrder" | "nomusStockDocument"
>;

async function resolveDefaultPrisma(): Promise<PrismaLike> {
  const mod = await import("@/src/lib/prisma.js");
  return mod.prisma;
}

/**
 * Teto defensivo de vínculos lidos por competência. Um ano inteiro de NF-e
 * fica ordens de grandeza abaixo disto; o limite só evita varredura acidental.
 */
const MAX_PERIOD_LINKS = 50_000;
const MAX_PERIOD_NFES = 50_000;

type NfeRow = {
  externalId: number;
  numero: string | null;
  serie: string | null;
  status: number | null;
  xmlDhEmi: Date | null;
  dataProcessamento: Date | null;
};

type LinkRow = {
  salesOrderId: string;
  nfeExternalId: number;
  nfeNumber: string | null;
  nfeSerie: string | null;
  nfeStatus: number | null;
  dataProcessamento: Date | null;
};

type OrderRow = {
  id: string;
  orderCode: string;
  externalSalesOrderCode: string | null;
  externalSalesOrderId: number | null;
  customerId: string;
  companyIssuer: string | null;
  Customer: {
    id: string;
    companyName: string | null;
    tradeName: string | null;
    taxId: string | null;
  } | null;
};

type StockDocumentRow = {
  externalId: number;
  idNfe: number | null;
  documentNumber: string | null;
  dataDocumento: Date | null;
  isCancelled: boolean;
};

/** Vínculo já resolvido: NF válida do pedido com competência no período. */
type ResolvedLink = {
  salesOrderId: string;
  nfeExternalId: number;
  number: string | null;
  serie: string | null;
  competenceDate: Date;
};

function toIso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/**
 * NF-e cuja competência (COALESCE(xmlDhEmi, dataProcessamento)) cai no período.
 * Ambas as colunas são indexadas — o OR usa índice, não varre a tabela.
 */
async function loadPeriodNfes(
  db: PrismaLike,
  period: { gte: Date; lt: Date } | null
): Promise<NfeRow[]> {
  if (!period) return [];
  return db.nomusNfe.findMany({
    where: {
      OR: [
        { xmlDhEmi: { gte: period.gte, lt: period.lt } },
        {
          AND: [
            { xmlDhEmi: null },
            { dataProcessamento: { gte: period.gte, lt: period.lt } },
          ],
        },
      ],
    },
    select: {
      externalId: true,
      numero: true,
      serie: true,
      status: true,
      xmlDhEmi: true,
      dataProcessamento: true,
    },
    take: MAX_PERIOD_NFES,
  });
}

/**
 * Vínculos candidatos: NF do período, ou vínculo cuja própria
 * `dataProcessamento` cai no período (NF-e ausente do stage local).
 * `presentInLastPayload = false` sai — mesma regra de `salesOrderLinkedNfe`.
 */
async function loadCandidateLinks(
  db: PrismaLike,
  period: { gte: Date; lt: Date } | null,
  periodNfeIds: number[]
): Promise<LinkRow[]> {
  if (!period) return [];
  const or: Prisma.SalesOrderNfeLinkWhereInput[] = [
    { dataProcessamento: { gte: period.gte, lt: period.lt } },
  ];
  if (periodNfeIds.length > 0) {
    or.push({ nfeExternalId: { in: periodNfeIds } });
  }
  return db.salesOrderNfeLink.findMany({
    where: { presentInLastPayload: true, OR: or },
    select: {
      salesOrderId: true,
      nfeExternalId: true,
      nfeNumber: true,
      nfeSerie: true,
      nfeStatus: true,
      dataProcessamento: true,
    },
    take: MAX_PERIOD_LINKS,
  });
}

/**
 * Aplica a regra canônica de faturamento a cada vínculo:
 *   - NF cancelada (status 7) não fatura;
 *   - competência = COALESCE(NF.xmlDhEmi, NF.dataProcessamento, link.dataProcessamento);
 *   - competência precisa cair no período.
 */
export function resolveFinanceBillingDetailLinks(
  links: ReadonlyArray<LinkRow>,
  nfeByExternalId: ReadonlyMap<number, NfeRow>,
  period: { gte: Date; lt: Date } | null
): ResolvedLink[] {
  const resolved: ResolvedLink[] = [];
  for (const link of links) {
    const nfe = nfeByExternalId.get(link.nfeExternalId) ?? null;
    const status = nfe?.status ?? link.nfeStatus ?? null;
    if (isNomusNfeCancelled(status)) continue;

    const competenceDate = resolveFinanceBillingDetailCompetenceDate({
      nfeIssueDate: nfe?.xmlDhEmi ?? null,
      nfeProcessingDate: nfe?.dataProcessamento ?? null,
      linkProcessingDate: link.dataProcessamento ?? null,
    });
    if (!isWithinFinanceBillingDetailPeriod(competenceDate, period)) continue;

    resolved.push({
      salesOrderId: link.salesOrderId,
      nfeExternalId: link.nfeExternalId,
      number: nfe?.numero?.trim() || link.nfeNumber?.trim() || null,
      serie: nfe?.serie?.trim() || link.nfeSerie?.trim() || null,
      competenceDate: competenceDate as Date,
    });
  }
  return resolved;
}

/** Pedido casa com o termo digitado (código interno, externo ou id externo). */
export function matchesFinanceBillingDetailOrderTerm(
  order: Pick<
    OrderRow,
    "orderCode" | "externalSalesOrderCode" | "externalSalesOrderId"
  >,
  term: string
): boolean {
  const trimmed = term.trim();
  if (!trimmed) return true;
  const terms = buildFinanceBillingDetailOrderTerms(trimmed).map((t) =>
    t.toLowerCase()
  );
  const haystack = [order.orderCode, order.externalSalesOrderCode]
    .map((v) => v?.trim().toLowerCase())
    .filter((v): v is string => Boolean(v));
  if (haystack.some((value) => terms.some((t) => value.includes(t)))) return true;

  const externalId = parseFinanceBillingDetailExternalId(trimmed);
  return externalId != null && order.externalSalesOrderId === externalId;
}

/** Cliente casa por id canônico, CNPJ (só dígitos) ou nome. */
export function matchesFinanceBillingDetailCustomer(
  order: OrderRow,
  filters: Pick<
    FinanceBillingDetailFilters,
    "customerId" | "customerName" | "customerDocument"
  >
): boolean {
  if (filters.customerId && order.customerId !== filters.customerId) return false;

  if (filters.customerDocument) {
    const wanted = onlyDigits(filters.customerDocument);
    if (wanted) {
      const actual = onlyDigits(order.Customer?.taxId ?? null);
      if (!actual.includes(wanted)) return false;
    }
  }

  if (filters.customerName && !filters.customerId) {
    const wanted = filters.customerName.toLowerCase();
    const names = [order.Customer?.companyName, order.Customer?.tradeName]
      .map((v) => v?.trim().toLowerCase())
      .filter((v): v is string => Boolean(v));
    if (!names.some((name) => name.includes(wanted))) return false;
  }

  return true;
}

function resolveCustomerName(order: OrderRow): string {
  return (
    order.Customer?.tradeName?.trim() ||
    order.Customer?.companyName?.trim() ||
    "—"
  );
}

/** NF casa pelo NÚMERO da nota (nunca idNfe / chave de acesso). */
function invoiceMatchesFilter(
  invoice: FinanceBillingDetailInvoiceRef,
  term: string
): boolean {
  const wanted = term.trim().toLowerCase();
  if (!wanted) return true;
  const number = invoice.number?.trim().toLowerCase() ?? "";
  if (number && number.includes(wanted)) return true;
  // Compara sem zeros à esquerda ("0123" ↔ "123").
  const wantedInt = parseFinanceBillingDetailExternalId(wanted);
  const numberInt = parseFinanceBillingDetailExternalId(number);
  return wantedInt != null && numberInt != null && wantedInt === numberInt;
}

/** Documento de Saída casa pelo número comercial ou pelo id externo Nomus. */
function outputDocumentMatchesFilter(
  document: FinanceBillingDetailOutputDocumentRef,
  term: string
): boolean {
  const wanted = term.trim().toLowerCase();
  if (!wanted) return true;
  if (document.number.toLowerCase().includes(wanted)) return true;
  const wantedInt = parseFinanceBillingDetailExternalId(wanted);
  return wantedInt != null && document.externalId === wantedInt;
}

export type LoadFinanceBillingDetailOrdersOptions = {
  prisma?: PrismaLike;
  now?: Date;
  referenceDate?: Date;
};

export async function loadFinanceBillingDetailOrders(
  query: Record<string, unknown>,
  options: LoadFinanceBillingDetailOrdersOptions = {}
): Promise<FinanceBillingDetailOrdersPayload> {
  const db = options.prisma ?? (await resolveDefaultPrisma());
  const now = options.now ?? new Date();
  const filters = parseFinanceBillingDetailOrdersQuery(
    query,
    options.referenceDate ?? now
  );
  const period = resolveFinanceBillingDetailPeriod(filters);

  const emptyPayload = (): FinanceBillingDetailOrdersPayload => ({
    generatedAt: now.toISOString(),
    period: {
      year: filters.year,
      month: filters.month,
      label: financeBillingDetailPeriodLabel(filters.year, filters.month),
    },
    scopeNote: FINANCE_BILLING_DETAIL_SCOPE_NOTE,
    filters,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      totalItems: 0,
      totalPages: 1,
    },
    items: [],
  });

  // 1) NF-e da competência.
  const periodNfes = await loadPeriodNfes(db, period);
  const nfeByExternalId = new Map<number, NfeRow>(
    periodNfes.map((row) => [row.externalId, row])
  );

  // 2) Vínculos candidatos (NF do período ∪ vínculo datado no período).
  const candidateLinks = await loadCandidateLinks(
    db,
    period,
    periodNfes.map((row) => row.externalId)
  );
  if (candidateLinks.length === 0) return emptyPayload();

  // Vínculos cuja NF não estava na busca por competência (fallback do link):
  // busca pontual das NF-e faltantes para aplicar status/número oficiais.
  const missingNfeIds = [
    ...new Set(
      candidateLinks
        .map((link) => link.nfeExternalId)
        .filter((id) => !nfeByExternalId.has(id))
    ),
  ];
  if (missingNfeIds.length > 0) {
    const extraNfes = await db.nomusNfe.findMany({
      where: { externalId: { in: missingNfeIds } },
      select: {
        externalId: true,
        numero: true,
        serie: true,
        status: true,
        xmlDhEmi: true,
        dataProcessamento: true,
      },
    });
    for (const row of extraNfes) nfeByExternalId.set(row.externalId, row);
  }

  const resolvedLinks = resolveFinanceBillingDetailLinks(
    candidateLinks,
    nfeByExternalId,
    period
  );
  if (resolvedLinks.length === 0) return emptyPayload();

  const linksByOrderId = new Map<string, ResolvedLink[]>();
  for (const link of resolvedLinks) {
    const list = linksByOrderId.get(link.salesOrderId) ?? [];
    list.push(link);
    linksByOrderId.set(link.salesOrderId, list);
  }

  // 3) Pedidos — cancelados ficam de fora (regra canônica de billingStatus).
  const orderWhere: Prisma.SalesOrderWhereInput = {
    id: { in: [...linksByOrderId.keys()] },
    status: { not: "CANCELLED" },
  };
  if (filters.customerId) orderWhere.customerId = filters.customerId;

  const orders = await db.salesOrder.findMany({
    where: orderWhere,
    select: {
      id: true,
      orderCode: true,
      externalSalesOrderCode: true,
      externalSalesOrderId: true,
      customerId: true,
      companyIssuer: true,
      Customer: {
        select: {
          id: true,
          companyName: true,
          tradeName: true,
          taxId: true,
        },
      },
    },
  });
  if (orders.length === 0) return emptyPayload();

  const filteredOrders = orders.filter((order) => {
    if (!matchesFinanceBillingDetailCustomer(order, filters)) return false;
    if (
      filters.salesOrder &&
      !matchesFinanceBillingDetailOrderTerm(order, filters.salesOrder)
    ) {
      return false;
    }
    return true;
  });
  if (filteredOrders.length === 0) return emptyPayload();

  // 4) Documentos de Saída ligados às NF-e do período (relação persistida idNfe).
  const nfeIdsInScope = [
    ...new Set(
      filteredOrders.flatMap((order) =>
        (linksByOrderId.get(order.id) ?? []).map((link) => link.nfeExternalId)
      )
    ),
  ];
  const stockDocuments: StockDocumentRow[] =
    nfeIdsInScope.length > 0
      ? await db.nomusStockDocument.findMany({
          where: {
            tipoDocumentoEstoque: NOMUS_STOCK_DOCUMENT_TIPO_SAIDA,
            idNfe: { in: nfeIdsInScope },
          },
          select: {
            externalId: true,
            idNfe: true,
            documentNumber: true,
            dataDocumento: true,
            isCancelled: true,
          },
        })
      : [];

  const documentsByNfe = new Map<number, StockDocumentRow[]>();
  for (const doc of stockDocuments) {
    if (doc.idNfe == null) continue;
    const list = documentsByNfe.get(doc.idNfe) ?? [];
    list.push(doc);
    documentsByNfe.set(doc.idNfe, list);
  }

  const invoiceTerm = filters.invoice ?? "";
  const outputDocumentTerm = filters.outputDocument ?? "";

  const items: FinanceBillingDetailOrderItem[] = [];
  for (const order of filteredOrders) {
    const links = [...(linksByOrderId.get(order.id) ?? [])].sort(
      (a, b) => a.competenceDate.getTime() - b.competenceDate.getTime()
    );
    if (links.length === 0) continue;

    const invoices: FinanceBillingDetailInvoiceRef[] = [];
    const seenInvoices = new Set<number>();
    for (const link of links) {
      if (seenInvoices.has(link.nfeExternalId)) continue;
      seenInvoices.add(link.nfeExternalId);
      invoices.push({
        nfeExternalId: link.nfeExternalId,
        number: link.number,
        serie: link.serie,
        competenceDate: toIso(link.competenceDate),
      });
    }

    const outputDocuments: FinanceBillingDetailOutputDocumentRef[] = [];
    const seenDocuments = new Set<number>();
    for (const invoice of invoices) {
      for (const doc of documentsByNfe.get(invoice.nfeExternalId) ?? []) {
        if (seenDocuments.has(doc.externalId)) continue;
        seenDocuments.add(doc.externalId);
        outputDocuments.push({
          externalId: doc.externalId,
          number: doc.documentNumber?.trim() || String(doc.externalId),
          documentDate: toIso(doc.dataDocumento),
          isCancelled: doc.isCancelled,
        });
      }
    }
    outputDocuments.sort((a, b) => a.externalId - b.externalId);

    if (
      invoiceTerm &&
      !invoices.some((invoice) => invoiceMatchesFilter(invoice, invoiceTerm))
    ) {
      continue;
    }
    if (
      outputDocumentTerm &&
      !outputDocuments.some((doc) =>
        outputDocumentMatchesFilter(doc, outputDocumentTerm)
      )
    ) {
      continue;
    }

    items.push({
      salesOrderId: order.id,
      orderCode: order.orderCode,
      externalSalesOrderCode: order.externalSalesOrderCode,
      externalSalesOrderId: order.externalSalesOrderId,
      customerId: order.Customer?.id ?? order.customerId ?? null,
      customerName: resolveCustomerName(order),
      customerDocument: order.Customer?.taxId?.trim() || null,
      companyName: order.companyIssuer?.trim() || null,
      firstInvoiceDate: toIso(links[0]!.competenceDate),
      lastInvoiceDate: toIso(links[links.length - 1]!.competenceDate),
      invoices,
      outputDocuments,
    });
  }

  const sorted = [...items].sort((a, b) =>
    compareFinanceBillingDetailOrders(a, b, filters.sortBy, filters.sortDir)
  );
  const page = paginateRows(sorted, filters.page, filters.pageSize);

  return {
    generatedAt: now.toISOString(),
    period: {
      year: filters.year,
      month: filters.month,
      label: financeBillingDetailPeriodLabel(filters.year, filters.month),
    },
    scopeNote: FINANCE_BILLING_DETAIL_SCOPE_NOTE,
    filters,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      totalItems: page.totalItems,
      totalPages: page.totalPages,
    },
    items: page.items,
  };
}
