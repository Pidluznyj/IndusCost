/**
 * Loader read-only de métricas de vínculo Documento ↔ NF-e ↔ Pedido (DS-02.5).
 * Apenas SELECT/agregações. Não cria nem corrige vínculos.
 */
import { Prisma } from "@prisma/client";
import {
  NOMUS_STOCK_DOCUMENT_TIPO_SAIDA,
  toAuditNumber,
} from "./auditOutputDocumentsDb.js";
import {
  NOMUS_NFE_CANCELLED_STATUS,
  buildEmptyNfeLinksSection,
  buildEmptySalesOrderLinksSection,
  classifyDocumentNfeLink,
  classifyDocumentSalesOrderLink,
  emptyClassificationCounts,
  extractNfeIdsFromRawJsonHypothesis,
  extractOrderRefsFromRawJsonHypothesis,
  isDependentOnO2c,
  isResolvedByItem,
  isResolvedByNfeOnly,
  summarizeOrderCardinality,
  type DocumentNfeLinkEvidence,
  type DocumentSalesOrderLinkEvidence,
  type NfeLinksSection,
  type SalesOrderLinksSection,
} from "./auditOutputDocumentsLinks.js";

export type LinksAuditPrisma = {
  $queryRaw: <T = unknown>(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) => Promise<T>;
};

export type LinksAuditLoad = {
  nfeLinks: NfeLinksSection;
  salesOrderLinks: SalesOrderLinksSection;
};

function parseJson(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  return raw;
}

async function loadAggregateNfeMetrics(prisma: LinksAuditPrisma): Promise<{
  documentsTotal: number;
  documentsWithIdNfe: number;
  documentsWithoutIdNfe: number;
  nfeFoundLocally: number;
  nfeMissingLocally: number;
  nfeValid: number;
  nfeCancelled: number;
  nfeWithMultipleDocuments: number;
  multiDocumentNfeIds: number[];
}> {
  const summaryRows = await prisma.$queryRaw<
    Array<{
      documents_total: unknown;
      with_id_nfe: unknown;
      without_id_nfe: unknown;
      nfe_found: unknown;
      nfe_missing: unknown;
      nfe_valid: unknown;
      nfe_cancelled: unknown;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS documents_total,
      COUNT(*) FILTER (WHERE d."idNfe" IS NOT NULL)::bigint AS with_id_nfe,
      COUNT(*) FILTER (WHERE d."idNfe" IS NULL)::bigint AS without_id_nfe,
      COUNT(*) FILTER (
        WHERE d."idNfe" IS NOT NULL AND n."externalId" IS NOT NULL
      )::bigint AS nfe_found,
      COUNT(*) FILTER (
        WHERE d."idNfe" IS NOT NULL AND n."externalId" IS NULL
      )::bigint AS nfe_missing,
      COUNT(*) FILTER (
        WHERE d."idNfe" IS NOT NULL
          AND n."externalId" IS NOT NULL
          AND (n.status IS NULL OR n.status IS DISTINCT FROM ${NOMUS_NFE_CANCELLED_STATUS})
      )::bigint AS nfe_valid,
      COUNT(*) FILTER (
        WHERE d."idNfe" IS NOT NULL
          AND n."externalId" IS NOT NULL
          AND n.status = ${NOMUS_NFE_CANCELLED_STATUS}
      )::bigint AS nfe_cancelled
    FROM "NomusStockDocument" d
    LEFT JOIN "NomusNfe" n ON n."externalId" = d."idNfe"
    WHERE d."tipoDocumentoEstoque" = ${NOMUS_STOCK_DOCUMENT_TIPO_SAIDA}
  `);

  const multiRows = await prisma.$queryRaw<
    Array<{ id_nfe: unknown; doc_count: unknown }>
  >(Prisma.sql`
    SELECT d."idNfe" AS id_nfe, COUNT(*)::bigint AS doc_count
    FROM "NomusStockDocument" d
    WHERE d."tipoDocumentoEstoque" = ${NOMUS_STOCK_DOCUMENT_TIPO_SAIDA}
      AND d."idNfe" IS NOT NULL
    GROUP BY d."idNfe"
    HAVING COUNT(*) > 1
    ORDER BY doc_count DESC, id_nfe ASC
    LIMIT 50
  `);

  const summary = summaryRows[0];
  return {
    documentsTotal: toAuditNumber(summary?.documents_total),
    documentsWithIdNfe: toAuditNumber(summary?.with_id_nfe),
    documentsWithoutIdNfe: toAuditNumber(summary?.without_id_nfe),
    nfeFoundLocally: toAuditNumber(summary?.nfe_found),
    nfeMissingLocally: toAuditNumber(summary?.nfe_missing),
    nfeValid: toAuditNumber(summary?.nfe_valid),
    nfeCancelled: toAuditNumber(summary?.nfe_cancelled),
    nfeWithMultipleDocuments: multiRows.length,
    multiDocumentNfeIds: multiRows.map((r) => toAuditNumber(r.id_nfe)),
  };
}

async function loadAggregateSalesOrderMetrics(prisma: LinksAuditPrisma): Promise<{
  documentsWithZeroOrders: number;
  documentsWithOneOrder: number;
  documentsWithMultipleOrders: number;
  ordersWithMultipleDocuments: number;
  multiDocumentOrderCodes: string[];
}> {
  const cardinalityRows = await prisma.$queryRaw<
    Array<{
      zero_orders: unknown;
      one_order: unknown;
      many_orders: unknown;
    }>
  >(Prisma.sql`
    WITH doc_orders AS (
      SELECT
        d.id AS document_id,
        COUNT(DISTINCT l."salesOrderId")::bigint AS order_count
      FROM "NomusStockDocument" d
      LEFT JOIN "SalesOrderNfeLink" l
        ON d."idNfe" IS NOT NULL AND l."nfeExternalId" = d."idNfe"
      WHERE d."tipoDocumentoEstoque" = ${NOMUS_STOCK_DOCUMENT_TIPO_SAIDA}
      GROUP BY d.id
    )
    SELECT
      COUNT(*) FILTER (WHERE order_count = 0)::bigint AS zero_orders,
      COUNT(*) FILTER (WHERE order_count = 1)::bigint AS one_order,
      COUNT(*) FILTER (WHERE order_count > 1)::bigint AS many_orders
    FROM doc_orders
  `);

  const multiOrderDocs = await prisma.$queryRaw<
    Array<{ order_code: unknown; doc_count: unknown }>
  >(Prisma.sql`
    SELECT
      COALESCE(so."orderCode", l."orderCode", l."salesOrderId"::text) AS order_code,
      COUNT(DISTINCT d.id)::bigint AS doc_count
    FROM "SalesOrderNfeLink" l
    INNER JOIN "NomusStockDocument" d
      ON d."idNfe" = l."nfeExternalId"
     AND d."tipoDocumentoEstoque" = ${NOMUS_STOCK_DOCUMENT_TIPO_SAIDA}
    LEFT JOIN "SalesOrder" so ON so.id = l."salesOrderId"
    GROUP BY 1
    HAVING COUNT(DISTINCT d.id) > 1
    ORDER BY doc_count DESC, order_code ASC
    LIMIT 50
  `);

  const card = cardinalityRows[0];
  return {
    documentsWithZeroOrders: toAuditNumber(card?.zero_orders),
    documentsWithOneOrder: toAuditNumber(card?.one_order),
    documentsWithMultipleOrders: toAuditNumber(card?.many_orders),
    ordersWithMultipleDocuments: multiOrderDocs.length,
    multiDocumentOrderCodes: multiOrderDocs
      .map((r) => String(r.order_code ?? "").trim())
      .filter(Boolean),
  };
}

async function classifySampleDocuments(
  prisma: LinksAuditPrisma,
  sampleLimit: number
): Promise<{
  nfeClassificationCounts: ReturnType<typeof emptyClassificationCounts>;
  salesClassificationCounts: ReturnType<typeof emptyClassificationCounts>;
  missingNfeExternalIds: number[];
  cancelledNfeExternalIds: number[];
  conflictingNfeDocumentExternalIds: number[];
  multiOrderDocumentExternalIds: number[];
  conflictingSalesDocumentExternalIds: number[];
  resolvedByItem: number;
  resolvedByNfeOnly: number;
  dependentOnO2c: number;
  conflictsBetweenSources: number;
}> {
  const limit = Math.max(0, Math.trunc(sampleLimit));
  const nfeClassificationCounts = emptyClassificationCounts();
  const salesClassificationCounts = emptyClassificationCounts();
  const missingNfeExternalIds: number[] = [];
  const cancelledNfeExternalIds: number[] = [];
  const conflictingNfeDocumentExternalIds: number[] = [];
  const multiOrderDocumentExternalIds: number[] = [];
  const conflictingSalesDocumentExternalIds: number[] = [];
  let resolvedByItem = 0;
  let resolvedByNfeOnly = 0;
  let dependentOnO2c = 0;
  let conflictsBetweenSources = 0;

  if (limit === 0) {
    return {
      nfeClassificationCounts,
      salesClassificationCounts,
      missingNfeExternalIds,
      cancelledNfeExternalIds,
      conflictingNfeDocumentExternalIds,
      multiOrderDocumentExternalIds,
      conflictingSalesDocumentExternalIds,
      resolvedByItem,
      resolvedByNfeOnly,
      dependentOnO2c,
      conflictsBetweenSources,
    };
  }

  const pageSize = 50;
  let cursorId: string | null = null;
  let scanned = 0;

  while (scanned < limit) {
    const take = Math.min(pageSize, limit - scanned);
    const docs = cursorId
      ? await prisma.$queryRaw<
          Array<{
            id: string;
            externalId: number;
            idNfe: number | null;
            rawJson: unknown;
            nfeStatus: number | null;
            nfeFound: boolean;
          }>
        >(Prisma.sql`
          SELECT
            d.id,
            d."externalId",
            d."idNfe",
            d."rawJson",
            n.status AS "nfeStatus",
            (n."externalId" IS NOT NULL) AS "nfeFound"
          FROM "NomusStockDocument" d
          LEFT JOIN "NomusNfe" n ON n."externalId" = d."idNfe"
          WHERE d."tipoDocumentoEstoque" = ${NOMUS_STOCK_DOCUMENT_TIPO_SAIDA}
            AND d.id > ${cursorId}
          ORDER BY d.id ASC
          LIMIT ${take}
        `)
      : await prisma.$queryRaw<
          Array<{
            id: string;
            externalId: number;
            idNfe: number | null;
            rawJson: unknown;
            nfeStatus: number | null;
            nfeFound: boolean;
          }>
        >(Prisma.sql`
          SELECT
            d.id,
            d."externalId",
            d."idNfe",
            d."rawJson",
            n.status AS "nfeStatus",
            (n."externalId" IS NOT NULL) AS "nfeFound"
          FROM "NomusStockDocument" d
          LEFT JOIN "NomusNfe" n ON n."externalId" = d."idNfe"
          WHERE d."tipoDocumentoEstoque" = ${NOMUS_STOCK_DOCUMENT_TIPO_SAIDA}
          ORDER BY d.id ASC
          LIMIT ${take}
        `);

    if (docs.length === 0) break;

    const externalIds = docs.map((d) => d.externalId);
    const idNfes = [
      ...new Set(
        docs
          .map((d) => d.idNfe)
          .filter((v): v is number => typeof v === "number" && v > 0)
      ),
    ];

    const orderLinks =
      idNfes.length > 0
        ? await prisma.$queryRaw<
            Array<{ nfeExternalId: number; orderRef: string }>
          >(Prisma.sql`
            SELECT
              l."nfeExternalId",
              COALESCE(so."orderCode", l."orderCode", l."salesOrderId"::text) AS "orderRef"
            FROM "SalesOrderNfeLink" l
            LEFT JOIN "SalesOrder" so ON so.id = l."salesOrderId"
            WHERE l."nfeExternalId" IN (${Prisma.join(idNfes)})
          `)
        : [];

    const o2cRows =
      externalIds.length > 0
        ? await prisma.$queryRaw<
            Array<{
              stockDocumentExternalId: number;
              nfeExternalId: number | null;
              orderCode: string | null;
              salesOrderId: string | null;
              hasItem: boolean;
            }>
          >(Prisma.sql`
            SELECT
              f."stockDocumentExternalId",
              f."nfeExternalId",
              f."orderCode",
              f."salesOrderId",
              (f."salesOrderItemId" IS NOT NULL) AS "hasItem"
            FROM "OrderToCashAuditFact" f
            WHERE f."stockDocumentExternalId" IN (${Prisma.join(externalIds)})
          `)
        : [];

    const ordersByNfe = new Map<number, string[]>();
    for (const row of orderLinks) {
      const list = ordersByNfe.get(row.nfeExternalId) ?? [];
      if (row.orderRef?.trim()) list.push(row.orderRef.trim());
      ordersByNfe.set(row.nfeExternalId, list);
    }

    const o2cByDoc = new Map<
      number,
      { nfeIds: number[]; orders: string[]; hasItem: boolean }
    >();
    for (const row of o2cRows) {
      const bucket = o2cByDoc.get(row.stockDocumentExternalId) ?? {
        nfeIds: [],
        orders: [],
        hasItem: false,
      };
      if (row.nfeExternalId != null) bucket.nfeIds.push(row.nfeExternalId);
      const orderRef = (row.orderCode ?? row.salesOrderId ?? "").trim();
      if (orderRef) bucket.orders.push(orderRef);
      if (row.hasItem) bucket.hasItem = true;
      o2cByDoc.set(row.stockDocumentExternalId, bucket);
    }

    for (const doc of docs) {
      scanned += 1;
      cursorId = doc.id;
      const raw = parseJson(doc.rawJson);
      const o2c = o2cByDoc.get(doc.externalId);

      const nfeEvidence: DocumentNfeLinkEvidence = {
        documentExternalId: doc.externalId,
        persistedIdNfe: doc.idNfe,
        nfeExistsLocally: Boolean(doc.nfeFound),
        nfeStatus: doc.nfeStatus,
        rawJsonNfeIds: extractNfeIdsFromRawJsonHypothesis(raw),
        o2cNfeIds: o2c?.nfeIds ?? [],
      };
      const nfeClassified = classifyDocumentNfeLink(nfeEvidence);
      nfeClassificationCounts[nfeClassified.classification] += 1;
      if (nfeClassified.classification === "conflitante") {
        conflictingNfeDocumentExternalIds.push(doc.externalId);
      }
      if (doc.idNfe != null && !doc.nfeFound) {
        missingNfeExternalIds.push(doc.idNfe);
      }
      if (doc.idNfe != null && doc.nfeStatus === NOMUS_NFE_CANCELLED_STATUS) {
        cancelledNfeExternalIds.push(doc.idNfe);
      }

      const ordersViaNfeLink =
        doc.idNfe != null ? ordersByNfe.get(doc.idNfe) ?? [] : [];
      const salesEvidence: DocumentSalesOrderLinkEvidence = {
        documentExternalId: doc.externalId,
        persistedIdNfe: doc.idNfe,
        ordersViaNfeLink,
        ordersViaO2c: o2c?.orders ?? [],
        ordersViaRawJson: extractOrderRefsFromRawJsonHypothesis(raw),
        hasO2cItemResolution: Boolean(o2c?.hasItem),
      };
      const salesClassified = classifyDocumentSalesOrderLink(salesEvidence);
      salesClassificationCounts[salesClassified.classification] += 1;

      const allOrders = [
        ...new Set([
          ...salesEvidence.ordersViaNfeLink,
          ...salesEvidence.ordersViaO2c,
          ...salesEvidence.ordersViaRawJson,
        ]),
      ];
      if (summarizeOrderCardinality(allOrders) === "many") {
        multiOrderDocumentExternalIds.push(doc.externalId);
      }
      if (isResolvedByItem(salesEvidence)) resolvedByItem += 1;
      if (isResolvedByNfeOnly(salesEvidence)) resolvedByNfeOnly += 1;
      if (isDependentOnO2c(salesEvidence)) dependentOnO2c += 1;
      if (salesClassified.classification === "conflitante") {
        conflictsBetweenSources += 1;
        conflictingSalesDocumentExternalIds.push(doc.externalId);
      }

      if (scanned >= limit) break;
    }

    if (docs.length < take) break;
  }

  return {
    nfeClassificationCounts,
    salesClassificationCounts,
    missingNfeExternalIds: [...new Set(missingNfeExternalIds)].slice(0, limit),
    cancelledNfeExternalIds: [...new Set(cancelledNfeExternalIds)].slice(
      0,
      limit
    ),
    conflictingNfeDocumentExternalIds: [
      ...new Set(conflictingNfeDocumentExternalIds),
    ].slice(0, limit),
    multiOrderDocumentExternalIds: [
      ...new Set(multiOrderDocumentExternalIds),
    ].slice(0, limit),
    conflictingSalesDocumentExternalIds: [
      ...new Set(conflictingSalesDocumentExternalIds),
    ].slice(0, limit),
    resolvedByItem,
    resolvedByNfeOnly,
    dependentOnO2c,
    conflictsBetweenSources,
  };
}

export async function loadDocumentLinkAudit(
  prisma: LinksAuditPrisma,
  options: { sampleLimit: number }
): Promise<LinksAuditLoad> {
  const [nfeAgg, salesAgg, sample] = await Promise.all([
    loadAggregateNfeMetrics(prisma),
    loadAggregateSalesOrderMetrics(prisma),
    classifySampleDocuments(prisma, options.sampleLimit),
  ]);

  const nfeLinks = buildEmptyNfeLinksSection();
  nfeLinks.metrics = {
    documentsTotal: nfeAgg.documentsTotal,
    documentsWithIdNfe: nfeAgg.documentsWithIdNfe,
    documentsWithoutIdNfe: nfeAgg.documentsWithoutIdNfe,
    nfeFoundLocally: nfeAgg.nfeFoundLocally,
    nfeMissingLocally: nfeAgg.nfeMissingLocally,
    nfeValid: nfeAgg.nfeValid,
    nfeCancelled: nfeAgg.nfeCancelled,
    nfeWithMultipleDocuments: nfeAgg.nfeWithMultipleDocuments,
    classificationCounts: sample.nfeClassificationCounts,
  };
  nfeLinks.samples = {
    missingNfeExternalIds: sample.missingNfeExternalIds,
    cancelledNfeExternalIds: sample.cancelledNfeExternalIds,
    multiDocumentNfeIds: nfeAgg.multiDocumentNfeIds,
    conflictingDocumentExternalIds: sample.conflictingNfeDocumentExternalIds,
  };
  nfeLinks.notes.push(
    `classificationCounts calculados sobre amostra de até ${options.sampleLimit} documentos (paginada).`
  );

  const salesOrderLinks = buildEmptySalesOrderLinksSection();
  salesOrderLinks.metrics = {
    documentsTotal: nfeAgg.documentsTotal,
    documentsWithZeroOrders: salesAgg.documentsWithZeroOrders,
    documentsWithOneOrder: salesAgg.documentsWithOneOrder,
    documentsWithMultipleOrders: salesAgg.documentsWithMultipleOrders,
    ordersWithMultipleDocuments: salesAgg.ordersWithMultipleDocuments,
    resolvedByItem: sample.resolvedByItem,
    resolvedByNfeOnly: sample.resolvedByNfeOnly,
    dependentOnO2c: sample.dependentOnO2c,
    conflictsBetweenSources: sample.conflictsBetweenSources,
    classificationCounts: sample.salesClassificationCounts,
  };
  salesOrderLinks.samples = {
    multiOrderDocumentExternalIds: sample.multiOrderDocumentExternalIds,
    multiDocumentOrderCodes: salesAgg.multiDocumentOrderCodes,
    conflictingDocumentExternalIds: sample.conflictingSalesDocumentExternalIds,
  };
  salesOrderLinks.notes.push(
    "Cardinalidade zero/um/vários pedidos usa SalesOrderNfeLink via idNfe (agregação completa).",
    "resolvedByItem / dependentOnO2c / conflitos usam amostra paginada + O2C/rawJson."
  );

  return { nfeLinks, salesOrderLinks };
}
