/**
 * Enriquecimento 360º do Pedido de Compra Nomus a partir do mirror local.
 * Sem chamada live ao Nomus. Resolução em lote para evitar N+1.
 */
import { prisma } from "@/src/lib/prisma.js";
import { normalizeSupplierDocument, normalizeSupplierName } from "@/src/lib/financeSupplierIdentity.js";
import { isNomusPurchaseOrderOverdue, isNomusPurchaseOrderOpenStage } from "./nomusPurchaseOrderClassifier.js";
import { extractPurchaseOrderHeaderFields, extractPurchaseOrderItemFields } from "./nomusPurchaseOrder360.js";
import {
  buildPurchaseOrderFinancialBundle,
  extractDirectNomusNfeRefs,
  extractDocumentEntryPurchaseOrderId,
  formatSupplierDisplayName,
  lastInvoiceNumberFromLinks,
  resolvePurchaseOrderSupplier,
  summarizeItemStatuses,
  type ConfirmedPayableSnapshot,
  type LinkedNomusNfeSnapshot,
  type NomusPurchaseOrderListRowDto,
  type ResolvedPurchaseOrderSupplier,
} from "./nomusPurchaseOrder360.js";
import type { NomusPurchaseOrderStage } from "./nomusPurchaseOrderTypes.js";

type DecimalLike = { toString(): string } | null;

export type PurchaseOrderMirrorHeader = {
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
  totalAmount: DecimalLike;
  itemCount: number;
  orderedQuantity: DecimalLike;
  receivedQuantity: DecimalLike;
  remainingQuantity: DecimalLike;
  syncedAt: Date;
  lastSeenAt: Date;
  firstSeenAt?: Date;
  payloadHash?: string;
  paymentTerms?: string | null;
  comments?: string | null;
  currency?: string | null;
  discountAmount?: DecimalLike;
  freightAmount?: DecimalLike;
  createdAtNomus?: Date | null;
  modifiedAtNomus?: Date | null;
  rawPayload: unknown;
};

export type PurchaseOrderMirrorItem = {
  id: string;
  lineIndex: number;
  lineExternalId: number | null;
  productExternalId: number | null;
  productCode: string | null;
  description: string | null;
  unit: string | null;
  orderedQuantity: DecimalLike;
  receivedQuantity: DecimalLike;
  remainingQuantity: DecimalLike;
  unitPrice: DecimalLike;
  totalAmount: DecimalLike;
  rawPayload: unknown;
};

function money(value: DecimalLike): number | null {
  if (value == null) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export async function expandPurchaseOrderSupplierSearchIds(term: string | null | undefined): Promise<number[]> {
  const q = (term ?? "").trim();
  if (!q) return [];
  const ids = new Set<number>();
  if (/^\d+$/.test(q)) ids.add(Number(q));

  const [aliases, suppliers, apRows] = await Promise.all([
    prisma.financialSupplierAlias.findMany({
      where: {
        OR: [
          { originalName: { contains: q, mode: "insensitive" } },
          { supplier: { displayName: { contains: q, mode: "insensitive" } } },
        ],
      },
      select: { externalSupplierId: true },
      take: 200,
    }),
    prisma.financialSupplier.findMany({
      where: {
        OR: [
          { displayName: { contains: q, mode: "insensitive" } },
          { legalName: { contains: q, mode: "insensitive" } },
          { normalizedName: { contains: normalizeSupplierName(q) ?? q, mode: "insensitive" } },
        ],
      },
      select: { aliases: { select: { externalSupplierId: true } } },
      take: 100,
    }),
    prisma.nomusAccountsPayable.findMany({
      where: { personName: { contains: q, mode: "insensitive" } },
      select: { personId: true },
      take: 200,
    }),
  ]);

  for (const row of aliases) {
    if (row.externalSupplierId != null) ids.add(row.externalSupplierId);
  }
  for (const row of suppliers) {
    for (const alias of row.aliases) {
      if (alias.externalSupplierId != null) ids.add(alias.externalSupplierId);
    }
  }
  for (const row of apRows) {
    if (row.personId != null) ids.add(row.personId);
  }
  return [...ids];
}

async function loadSupplierMaps(
  orders: Array<Pick<PurchaseOrderMirrorHeader, "supplierExternalId" | "supplierName" | "supplierTaxId">>
) {
  const supplierIds = [
    ...new Set(orders.map((row) => row.supplierExternalId).filter((id): id is number => id != null)),
  ];
  const documents = [
    ...new Set(
      orders
        .map((row) => normalizeSupplierDocument(row.supplierTaxId))
        .filter((value): value is string => !!value)
    ),
  ];
  const names = [
    ...new Set(
      orders
        .map((row) => normalizeSupplierName(row.supplierName))
        .filter((value): value is string => !!value)
    ),
  ];

  const [aliases, documentRows, nameRows, apRows] = await Promise.all([
    supplierIds.length
      ? prisma.financialSupplierAlias.findMany({
          where: { externalSupplierId: { in: supplierIds } },
          select: {
            externalSupplierId: true,
            supplierId: true,
            originalName: true,
            originalDocument: true,
            normalizedDocument: true,
            normalizedName: true,
            supplier: { select: { displayName: true, document: true } },
          },
        })
      : Promise.resolve([]),
    documents.length
      ? prisma.financialSupplier.findMany({
          where: { normalizedDocument: { in: documents } },
          select: { id: true, displayName: true, document: true, normalizedDocument: true },
        })
      : Promise.resolve([]),
    names.length
      ? prisma.financialSupplier.findMany({
          where: { normalizedName: { in: names } },
          select: { id: true, displayName: true, normalizedName: true },
        })
      : Promise.resolve([]),
    supplierIds.length
      ? prisma.nomusAccountsPayable.findMany({
          where: { personId: { in: supplierIds } },
          select: { personId: true, personName: true, personCnpj: true },
          take: 2000,
        })
      : Promise.resolve([]),
  ]);

  return {
    aliases: aliases.map((row) => ({
      externalSupplierId: row.externalSupplierId,
      financialSupplierId: row.supplierId,
      displayName: row.supplier.displayName ?? row.originalName,
      document: row.originalDocument ?? row.supplier.document,
      normalizedDocument: row.normalizedDocument,
      normalizedName: row.normalizedName,
    })),
    documents: documentRows.map((row) => ({
      financialSupplierId: row.id,
      displayName: row.displayName,
      document: row.document,
      normalizedDocument: row.normalizedDocument,
    })),
    nameCandidates: nameRows.map((row) => ({
      financialSupplierId: row.id,
      displayName: row.displayName,
      normalizedName: row.normalizedName,
    })),
    apIdentities: apRows,
  };
}

function resolveOneSupplier(
  order: Pick<PurchaseOrderMirrorHeader, "supplierExternalId" | "supplierName" | "supplierTaxId">,
  maps: Awaited<ReturnType<typeof loadSupplierMaps>>
): ResolvedPurchaseOrderSupplier {
  return resolvePurchaseOrderSupplier({
    supplierExternalId: order.supplierExternalId,
    supplierName: order.supplierName,
    supplierTaxId: order.supplierTaxId,
    aliases: maps.aliases,
    documents: maps.documents,
    apIdentities: maps.apIdentities,
    nameCandidates: maps.nameCandidates,
  });
}

export async function resolveNomusOrderSuppliersBatch(
  orders: Array<Pick<PurchaseOrderMirrorHeader, "supplierExternalId" | "supplierName" | "supplierTaxId">>
): Promise<ResolvedPurchaseOrderSupplier[]> {
  if (orders.length === 0) return [];
  const maps = await loadSupplierMaps(orders);
  return orders.map((order) => resolveOneSupplier(order, maps));
}

function toNfeSnapshot(
  ref: { externalId: number; number: string | null; series: string | null; key: string | null },
  local:
    | {
        externalId: number;
        numero: string | null;
        serie: string | null;
        chave: string | null;
        xmlDhEmi: Date | null;
        dataProcessamento: Date | null;
        cnpjEmitente: string | null;
        status: number | null;
        tipoOperacao: number | null;
        xmlVNF: DecimalLike;
        xmlCancelamento: string | null;
        justificativaCancelamento: string | null;
      }
    | undefined
): LinkedNomusNfeSnapshot {
  return {
    externalId: ref.externalId,
    number: local?.numero ?? ref.number,
    series: local?.serie ?? ref.series,
    key: local?.chave ?? ref.key,
    issuedAt: local?.xmlDhEmi ?? null,
    processedAt: local?.dataProcessamento ?? null,
    issuerDocument: local?.cnpjEmitente ?? null,
    status: local?.status ?? null,
    operationType: local?.tipoOperacao ?? null,
    amount: money(local?.xmlVNF ?? null),
    canceled: Boolean(local?.xmlCancelamento || local?.justificativaCancelamento),
    foundLocally: !!local,
    relationMethod: "DIRECT_NOMUS_NFE",
    confidence: "EXACT",
  };
}

function toPayableSnapshot(row: {
  externalId: number;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  personId: number | null;
  personName: string | null;
  personCnpj: string | null;
  dueDate: Date | null;
  paymentDate: Date | null;
  settlementDate: Date | null;
  amountPayable: DecimalLike;
  amountPaid: DecimalLike;
  balancePayable: DecimalLike;
  paymentMethodName: string | null;
  description: string | null;
  comments: string | null;
  classification: string | null;
  status: boolean | null;
  suspendPayment: boolean | null;
}): ConfirmedPayableSnapshot {
  return {
    externalId: row.externalId,
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    personId: row.personId,
    personName: row.personName,
    personCnpj: row.personCnpj,
    dueDate: row.dueDate,
    paymentDate: row.paymentDate,
    settlementDate: row.settlementDate,
    amountPayable: money(row.amountPayable),
    amountPaid: money(row.amountPaid),
    balancePayable: money(row.balancePayable),
    paymentMethodName: row.paymentMethodName,
    description: row.description,
    comments: row.comments,
    classification: row.classification,
    nomusStatus: row.status,
    suspendPayment: row.suspendPayment,
  };
}

async function loadFiscalMaps(orders: PurchaseOrderMirrorHeader[]) {
  const refsByOrderId = new Map<string, ReturnType<typeof extractDirectNomusNfeRefs>>();
  const nfeIds = new Set<number>();
  for (const order of orders) {
    const refs = extractDirectNomusNfeRefs(order.rawPayload);
    refsByOrderId.set(order.id, refs);
    for (const ref of refs) nfeIds.add(ref.externalId);
  }

  const nfeIdList = [...nfeIds];
  const [nfes, payables, stockDocs] = await Promise.all([
    nfeIdList.length
      ? prisma.nomusNfe.findMany({
          where: { externalId: { in: nfeIdList } },
          select: {
            externalId: true,
            numero: true,
            serie: true,
            chave: true,
            xmlDhEmi: true,
            dataProcessamento: true,
            cnpjEmitente: true,
            status: true,
            tipoOperacao: true,
            xmlVNF: true,
            xmlCancelamento: true,
            justificativaCancelamento: true,
          },
        })
      : Promise.resolve([]),
    nfeIdList.length
      ? prisma.nomusAccountsPayable.findMany({
          where: { sourceInvoiceId: { in: nfeIdList } },
          select: {
            externalId: true,
            sourceInvoiceId: true,
            sourceInvoiceNumber: true,
            personId: true,
            personName: true,
            personCnpj: true,
            dueDate: true,
            paymentDate: true,
            settlementDate: true,
            amountPayable: true,
            amountPaid: true,
            balancePayable: true,
            paymentMethodName: true,
            description: true,
            comments: true,
            classification: true,
            status: true,
            suspendPayment: true,
          },
        })
      : Promise.resolve([]),
    nfeIdList.length
      ? prisma.nomusStockDocument.findMany({
          where: { idNfe: { in: nfeIdList } },
          select: {
            externalId: true,
            idNfe: true,
            tipoDocumentoEstoque: true,
            documentNumber: true,
            rawJson: true,
          },
          take: 200,
        })
      : Promise.resolve([]),
  ]);

  const nfeById = new Map(nfes.map((row) => [row.externalId, row]));
  const payablesByNfeId = new Map<number, ConfirmedPayableSnapshot[]>();
  for (const row of payables) {
    if (row.sourceInvoiceId == null) continue;
    const list = payablesByNfeId.get(row.sourceInvoiceId) ?? [];
    list.push(toPayableSnapshot(row));
    payablesByNfeId.set(row.sourceInvoiceId, list);
  }

  const documentEntryByNfeId = new Map<number, Array<{
    externalId: number;
    idNfe: number | null;
    type: string | null;
    documentNumber: string | null;
    purchaseOrderId: number | null;
  }>>();
  for (const row of stockDocs) {
    if (row.idNfe == null) continue;
    const list = documentEntryByNfeId.get(row.idNfe) ?? [];
    list.push({
      externalId: row.externalId,
      idNfe: row.idNfe,
      type: row.tipoDocumentoEstoque,
      documentNumber: row.documentNumber,
      purchaseOrderId: extractDocumentEntryPurchaseOrderId(row.rawJson),
    });
    documentEntryByNfeId.set(row.idNfe, list);
  }

  return { refsByOrderId, nfeById, payablesByNfeId, documentEntryByNfeId };
}

function bundleForOrder(
  order: PurchaseOrderMirrorHeader,
  fiscal: Awaited<ReturnType<typeof loadFiscalMaps>>
) {
  const refs = fiscal.refsByOrderId.get(order.id) ?? [];
  const invoices = refs.map((ref) => toNfeSnapshot(ref, fiscal.nfeById.get(ref.externalId)));
  const confirmedPayables = invoices.flatMap((nfe) => fiscal.payablesByNfeId.get(nfe.externalId) ?? []);
  return {
    ...buildPurchaseOrderFinancialBundle({
      rawPayload: order.rawPayload,
      invoices,
      confirmedPayables,
    }),
    documentEntries: invoices.flatMap((nfe) => fiscal.documentEntryByNfeId.get(nfe.externalId) ?? []),
  };
}

export async function enrichNomusPurchaseOrderListRows(
  orders: PurchaseOrderMirrorHeader[],
  now: Date = new Date()
): Promise<NomusPurchaseOrderListRowDto[]> {
  if (orders.length === 0) return [];
  const [supplierMaps, fiscalMaps] = await Promise.all([
    loadSupplierMaps(orders),
    loadFiscalMaps(orders),
  ]);

  return orders.map((order) => {
    const supplier = resolveOneSupplier(order, supplierMaps);
    const bundle = bundleForOrder(order, fiscalMaps);
    const header = extractPurchaseOrderHeaderFields(order.rawPayload);
    const stage = order.stage as NomusPurchaseOrderStage;
    return {
      id: order.id,
      externalId: order.externalId,
      orderNumber: order.orderNumber,
      supplierExternalId: order.supplierExternalId,
      supplierName: supplier.nomusName ?? order.supplierName,
      supplierTaxId: supplier.nomusDocument ?? order.supplierTaxId,
      supplierResolvedName: formatSupplierDisplayName({
        resolvedName: supplier.resolvedName,
        nomusName: supplier.nomusName ?? order.supplierName,
        supplierExternalId: order.supplierExternalId,
      }),
      supplierMatched: supplier.matched,
      supplierMatchMethod: supplier.matchMethod,
      buyerPersonId: typeof header.buyerPersonId === "number" ? header.buyerPersonId : null,
      statusRaw: order.statusRaw,
      canceled: order.canceled,
      stage,
      issuedAt: iso(order.issuedAt),
      expectedAt: iso(order.expectedAt),
      itemCount: order.itemCount,
      plannedInstallmentsTotal: bundle.plannedInstallmentsTotal,
      plannedInstallmentsCount: bundle.plannedInstallmentsCount,
      invoiceCount: bundle.invoices.length,
      lastInvoiceNumber: lastInvoiceNumberFromLinks(bundle.invoices),
      financialStatus: bundle.financialStatus,
      payableCount: bundle.payableSummary.count,
      confirmedAmount: bundle.payableSummary.confirmedAmount,
      paidAmount: bundle.payableSummary.paidAmount,
      openAmount: bundle.payableSummary.openAmount,
      overdue: isNomusPurchaseOrderOverdue({ stage, expectedAt: order.expectedAt, now }),
      open: isNomusPurchaseOrderOpenStage(stage),
      syncedAt: order.syncedAt.toISOString(),
    };
  });
}

export async function buildNomusPurchaseOrder360(input: {
  order: PurchaseOrderMirrorHeader & { items: PurchaseOrderMirrorItem[] };
  includeRaw: boolean;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const { order } = input;
  const productKeys = [
    ...new Set(
      order.items
        .map((item) => item.productExternalId)
        .filter((id): id is number => id != null)
        .map(String)
    ),
  ];

  const [supplierMaps, fiscalMaps, products, catalogs] = await Promise.all([
    loadSupplierMaps([order]),
    loadFiscalMaps([order]),
    productKeys.length
      ? prisma.product.findMany({
          where: { sourceExternalId: { in: productKeys } },
          select: { sourceExternalId: true, sku: true, name: true },
        })
      : Promise.resolve([]),
    productKeys.length
      ? prisma.nomusProductCatalog.findMany({
          where: { externalProductId: { in: productKeys } },
          select: { externalProductId: true, code: true, description: true },
        })
      : Promise.resolve([]),
  ]);

  const productByExternal = new Map(
    products
      .filter((row) => row.sourceExternalId)
      .map((row) => [row.sourceExternalId as string, row])
  );
  const catalogByExternal = new Map(
    catalogs
      .filter((row) => row.externalProductId)
      .map((row) => [row.externalProductId as string, row])
  );

  const supplier = resolveOneSupplier(order, supplierMaps);
  const bundle = bundleForOrder(order, fiscalMaps);
  const header = extractPurchaseOrderHeaderFields(order.rawPayload);
  const itemStatusCodes = order.items.map((item) => {
    const fields = extractPurchaseOrderItemFields(item.rawPayload);
    return typeof fields.itemStatusCode === "number" ? fields.itemStatusCode : null;
  });
  const stage = order.stage as NomusPurchaseOrderStage;

  const items = order.items.map((item) => {
    const fields = extractPurchaseOrderItemFields(item.rawPayload);
    const key = item.productExternalId != null ? String(item.productExternalId) : "";
    const localProduct = key ? productByExternal.get(key) : undefined;
    const catalog = key ? catalogByExternal.get(key) : undefined;
    const description =
      item.description ||
      localProduct?.name ||
      catalog?.description ||
      null;
    const descriptionSource = item.description
      ? "pedido"
      : localProduct?.name
        ? "produto_induscost"
        : catalog?.description
          ? "catalogo_nomus"
          : null;
    return {
      id: item.id,
      lineIndex: item.lineIndex,
      lineExternalId: item.lineExternalId,
      lineCode: (fields.lineCode as string | null) ?? null,
      productExternalId: item.productExternalId,
      productCode: item.productCode ?? localProduct?.sku ?? catalog?.code ?? null,
      description,
      descriptionSource,
      unit: item.unit ?? null,
      orderedQuantity: money(item.orderedQuantity),
      receivedQuantity: money(item.receivedQuantity),
      remainingQuantity: money(item.remainingQuantity),
      unitPrice: money(item.unitPrice),
      discountPercent: (fields.discountPercent as number | null) ?? null,
      discountAmount: (fields.discountAmount as number | null) ?? null,
      surchargePercent: (fields.surchargePercent as number | null) ?? null,
      surchargeAmount: (fields.surchargeAmount as number | null) ?? null,
      totalAmount: money(item.totalAmount),
      deliveryDate: (fields.deliveryDate as string | null) ?? null,
      comments: (fields.comments as string | null) ?? null,
      itemStatusCode: (fields.itemStatusCode as number | null) ?? null,
      itemStatusKey: (fields.itemStatusKey as string | null) ?? null,
      itemStatusLabel: (fields.itemStatusLabel as string | null) ?? null,
      unitId: (fields.unitId as number | null) ?? null,
      entrySectorId: (fields.entrySectorId as number | null) ?? null,
      financialClassificationId: (fields.financialClassificationId as number | null) ?? null,
      movementTypeId: (fields.movementTypeId as number | null) ?? null,
    };
  });

  const receiving = {
    stage,
    itemCount: order.items.length,
    ...summarizeItemStatuses(itemStatusCodes),
    receivingQuantityAvailable: order.items.some((item) => item.receivedQuantity != null),
  };

  return {
    order: {
      id: order.id,
      externalId: order.externalId,
      orderNumber: order.orderNumber,
      statusRaw: order.statusRaw,
      canceled: order.canceled,
      stage,
      issuedAt: iso(order.issuedAt),
      expectedAt: iso(order.expectedAt),
      overdue: isNomusPurchaseOrderOverdue({ stage, expectedAt: order.expectedAt, now }),
      open: isNomusPurchaseOrderOpenStage(stage),
      paymentTerms: order.paymentTerms ?? null,
      comments: order.comments ?? null,
      currency: order.currency ?? null,
      totalAmount: money(order.totalAmount),
      discountAmount: money(order.discountAmount ?? null),
      freightAmount: money(order.freightAmount ?? null),
      header,
    },
    supplier,
    items,
    plannedInstallments: bundle.plannedInstallments.map((row) => ({
      ...row,
      dueDate: iso(row.dueDate),
    })),
    receiving,
    fiscal: {
      invoices: bundle.invoices.map((nfe) => ({
        ...nfe,
        issuedAt: iso(nfe.issuedAt),
        processedAt: iso(nfe.processedAt),
      })),
      documentEntries: bundle.documentEntries,
      documentEntryLinkDiscovered: bundle.documentEntries.some((row) => row.purchaseOrderId != null),
      unresolvedLabel:
        bundle.invoices.length === 0
          ? "Nenhuma NF-e vinculada foi identificada pelos dados disponíveis."
          : null,
    },
    confirmedPayables: bundle.confirmedPayables.map((row) => ({
      ...row,
      dueDate: iso(row.dueDate),
      paymentDate: iso(row.paymentDate),
      settlementDate: iso(row.settlementDate),
      hasBoletoDocument: false,
      boletoIsPaymentMethodOnly: /boleto/i.test(row.paymentMethodName ?? ""),
    })),
    financialSummary: {
      plannedInstallmentsTotal: bundle.plannedInstallmentsTotal,
      plannedInstallmentsCount: bundle.plannedInstallmentsCount,
      financialStatus: bundle.financialStatus,
      ...bundle.payableSummary,
      hasBoletoDocument: false,
    },
    relationEvidence: bundle.relationEvidence,
    syncMetadata: {
      firstSeenAt: iso(order.firstSeenAt ?? null),
      lastSeenAt: iso(order.lastSeenAt),
      syncedAt: order.syncedAt.toISOString(),
      payloadHash: order.payloadHash ?? null,
      createdAtNomus: iso(order.createdAtNomus ?? null),
      modifiedAtNomus: iso(order.modifiedAtNomus ?? null),
    },
    rawPayload: input.includeRaw ? order.rawPayload : undefined,
  };
}
