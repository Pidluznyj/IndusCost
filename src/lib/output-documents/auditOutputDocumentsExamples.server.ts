/**
 * Loader read-only dos exemplos parametrizados (DS-02.7).
 * Consultas limitadas pelas chaves oficiais. Não inventa resultados.
 */
import { Prisma } from "@prisma/client";
import {
  NOMUS_STOCK_DOCUMENT_TIPO_SAIDA,
  toAuditIsoDate,
  toAuditNumber,
  toAuditNullableNumber,
} from "./auditOutputDocumentsDb.js";
import {
  buildFoundExampleLookup,
  buildNfeExampleFromFixture,
  buildNotFoundExampleLookup,
  buildOutputDocumentExampleFromFixture,
  buildSalesOrderExampleFromFixture,
  markStrategy,
  planDocumentLookupStrategies,
  planNfeLookupStrategies,
  planSalesOrderLookupStrategies,
  type ExampleAllocationSummary,
  type ExampleReceivableSummary,
  type ExamplesSection,
} from "./auditOutputDocumentsExamples.js";
import { toMoneyCents } from "./auditOutputDocumentsFinancial.js";

export type ExamplesAuditPrisma = {
  $queryRaw: <T = unknown>(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) => Promise<T>;
};

export type ExamplesAuditOptions = {
  document: number;
  order: string;
  nfe: number;
};

type SalesOrderRow = {
  id: unknown;
  order_code: unknown;
  external_id: unknown;
  external_code: unknown;
  status: unknown;
  issue_date: unknown;
  company_issuer: unknown;
  payment_terms: unknown;
  payment_method: unknown;
  total_net: unknown;
  total_gross: unknown;
  customer_id: unknown;
  customer_name: unknown;
  customer_tax_id: unknown;
};

type NfeRow = {
  external_id: unknown;
  chave: unknown;
  numero: unknown;
  serie: unknown;
  status: unknown;
  billing_classification: unknown;
  is_fiscal_billing: unknown;
  is_market_sale: unknown;
  data_processamento: unknown;
  xml_dh_emi: unknown;
  synced_at: unknown;
  xml_vprod: unknown;
  xml_vdesc: unknown;
  xml_vnf: unknown;
  valor_liquido: unknown;
  justificativa: unknown;
  xml_cancelamento: unknown;
};

const SALES_ORDER_SELECT = Prisma.sql`
  so.id AS id,
  so."orderCode" AS order_code,
  so."externalSalesOrderId" AS external_id,
  so."externalSalesOrderCode" AS external_code,
  so.status::text AS status,
  so."issueDate" AS issue_date,
  so."companyIssuer" AS company_issuer,
  so."paymentTerms" AS payment_terms,
  so."paymentMethod" AS payment_method,
  so."totalNetValue" AS total_net,
  so."totalGrossValue" AS total_gross,
  c.id AS customer_id,
  c."companyName" AS customer_name,
  c."taxId" AS customer_tax_id
`;

const NFE_SELECT = Prisma.sql`
  n."externalId" AS external_id,
  n.chave AS chave,
  n.numero AS numero,
  n.serie AS serie,
  n.status AS status,
  n."billingClassification"::text AS billing_classification,
  n."isFiscalBilling" AS is_fiscal_billing,
  n."isMarketSale" AS is_market_sale,
  n."dataProcessamento" AS data_processamento,
  n."xmlDhEmi" AS xml_dh_emi,
  n."syncedAt" AS synced_at,
  n."xmlVProd" AS xml_vprod,
  n."xmlVDesc" AS xml_vdesc,
  n."xmlVNF" AS xml_vnf,
  n."valorLiquido" AS valor_liquido,
  n."justificativaCancelamento" AS justificativa,
  n."xmlCancelamento" AS xml_cancelamento
`;

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

function mapReceivableRows(
  rows: Array<{
    external_id: unknown;
    amount_receivable: unknown;
    amount_received: unknown;
    balance_receivable: unknown;
    due_date: unknown;
    settlement_date: unknown;
  }>
): ExampleReceivableSummary[] {
  return rows.map((row) => ({
    externalId: toAuditNumber(row.external_id),
    amountReceivableCents: toMoneyCents(row.amount_receivable),
    amountReceivedCents: toMoneyCents(row.amount_received),
    balanceReceivableCents: toMoneyCents(row.balance_receivable),
    dueDate: toAuditIsoDate(row.due_date),
    settlementDate: toAuditIsoDate(row.settlement_date),
  }));
}

async function loadReceivablesForNfe(
  prisma: ExamplesAuditPrisma,
  nfeId: number
): Promise<ExampleReceivableSummary[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      external_id: unknown;
      amount_receivable: unknown;
      amount_received: unknown;
      balance_receivable: unknown;
      due_date: unknown;
      settlement_date: unknown;
    }>
  >(Prisma.sql`
    SELECT
      ar."externalId" AS external_id,
      ar."amountReceivable" AS amount_receivable,
      ar."amountReceived" AS amount_received,
      ar."balanceReceivable" AS balance_receivable,
      ar."dueDate" AS due_date,
      ar."settlementDate" AS settlement_date
    FROM "NomusAccountsReceivable" ar
    WHERE ar."sourceInvoiceId" = ${nfeId}
    ORDER BY ar."externalId" ASC
    LIMIT 50
  `);
  return mapReceivableRows(rows);
}

async function loadAllocationsForDocument(
  prisma: ExamplesAuditPrisma,
  documentExternalId: number
): Promise<ExampleAllocationSummary[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      order_code: unknown;
      allocated_doc: unknown;
      allocated_order: unknown;
    }>
  >(Prisma.sql`
    SELECT
      f."orderCode" AS order_code,
      SUM(f."allocatedValueByDocumentPrice") AS allocated_doc,
      SUM(f."allocatedValueByOrderPrice") AS allocated_order
    FROM "OrderToCashAuditFact" f
    WHERE f."stockDocumentExternalId" = ${documentExternalId}
    GROUP BY f."orderCode"
    ORDER BY f."orderCode" ASC NULLS LAST
    LIMIT 50
  `);
  return rows.map((row) => ({
    orderCode:
      row.order_code == null ? null : String(row.order_code).trim() || null,
    allocatedValueByDocumentPriceCents: toMoneyCents(row.allocated_doc),
    allocatedValueByOrderPriceCents: toMoneyCents(row.allocated_order),
    source: "order_to_cash_fact" as const,
  }));
}

async function loadAllocationsForOrder(
  prisma: ExamplesAuditPrisma,
  salesOrderId: string
): Promise<ExampleAllocationSummary[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      order_code: unknown;
      allocated_doc: unknown;
      allocated_order: unknown;
    }>
  >(Prisma.sql`
    SELECT
      f."orderCode" AS order_code,
      SUM(f."allocatedValueByDocumentPrice") AS allocated_doc,
      SUM(f."allocatedValueByOrderPrice") AS allocated_order
    FROM "OrderToCashAuditFact" f
    WHERE f."salesOrderId" = ${salesOrderId}
    GROUP BY f."orderCode"
    ORDER BY f."orderCode" ASC NULLS LAST
    LIMIT 50
  `);
  return rows.map((row) => ({
    orderCode:
      row.order_code == null ? null : String(row.order_code).trim() || null,
    allocatedValueByDocumentPriceCents: toMoneyCents(row.allocated_doc),
    allocatedValueByOrderPriceCents: toMoneyCents(row.allocated_order),
    source: "order_to_cash_fact" as const,
  }));
}

async function investigateOutputDocument(
  prisma: ExamplesAuditPrisma,
  documentRef: number
): Promise<ExamplesSection["outputDocument"]> {
  let strategies = planDocumentLookupStrategies(documentRef);
  const query = { document: documentRef };

  const docs = await prisma.$queryRaw<
    Array<{
      external_id: unknown;
      id_nfe: unknown;
      tipo: unknown;
      data_documento: unknown;
      synced_at: unknown;
      raw_json: unknown;
    }>
  >(Prisma.sql`
    SELECT
      d."externalId" AS external_id,
      d."idNfe" AS id_nfe,
      d."tipoDocumentoEstoque" AS tipo,
      d."dataDocumento" AS data_documento,
      d."syncedAt" AS synced_at,
      d."rawJson" AS raw_json
    FROM "NomusStockDocument" d
    WHERE d."externalId" = ${documentRef}
    LIMIT 1
  `);

  const doc = docs[0];
  strategies = markStrategy(
    strategies,
    "NomusStockDocument.externalId",
    Boolean(doc)
  );

  if (!doc) {
    return buildNotFoundExampleLookup({ query, strategies });
  }

  const externalId = toAuditNumber(doc.external_id);
  const idNfe = toAuditNullableNumber(doc.id_nfe);

  const itemRows = await prisma.$queryRaw<
    Array<{
      external_item_id: unknown;
      external_product_id: unknown;
      quantity: unknown;
      unit_value: unknown;
      estimated_total: unknown;
    }>
  >(Prisma.sql`
    SELECT
      i."externalItemId" AS external_item_id,
      i."externalProductId" AS external_product_id,
      i.quantity AS quantity,
      i."unitValue" AS unit_value,
      i."estimatedTotalValue" AS estimated_total
    FROM "NomusStockDocumentItem" i
    INNER JOIN "NomusStockDocument" d ON d.id = i."stockDocumentId"
    WHERE d."externalId" = ${externalId}
    ORDER BY i."externalItemId" ASC NULLS LAST
    LIMIT 200
  `);

  let localNfe: { externalId: number; status: number | null } | null = null;
  if (idNfe != null) {
    const nfeRows = await prisma.$queryRaw<
      Array<{ external_id: unknown; status: unknown }>
    >(Prisma.sql`
      SELECT n."externalId" AS external_id, n.status AS status
      FROM "NomusNfe" n
      WHERE n."externalId" = ${idNfe}
      LIMIT 1
    `);
    if (nfeRows[0]) {
      localNfe = {
        externalId: toAuditNumber(nfeRows[0].external_id),
        status: toAuditNullableNumber(nfeRows[0].status),
      };
    }
  }

  const orderRows =
    idNfe == null
      ? []
      : await prisma.$queryRaw<
          Array<{ sales_order_id: unknown; order_code: unknown }>
        >(Prisma.sql`
          SELECT
            l."salesOrderId" AS sales_order_id,
            COALESCE(so."orderCode", l."orderCode") AS order_code
          FROM "SalesOrderNfeLink" l
          LEFT JOIN "SalesOrder" so ON so.id = l."salesOrderId"
          WHERE l."nfeExternalId" = ${idNfe}
          ORDER BY order_code ASC NULLS LAST
          LIMIT 50
        `);

  const allocations = await loadAllocationsForDocument(prisma, externalId);
  const accountsReceivable =
    idNfe == null ? [] : await loadReceivablesForNfe(prisma, idNfe);

  const data = buildOutputDocumentExampleFromFixture({
    externalId,
    idNfe,
    tipoDocumentoEstoque: doc.tipo == null ? null : String(doc.tipo),
    dataDocumento: toAuditIsoDate(doc.data_documento),
    syncedAt: toAuditIsoDate(doc.synced_at),
    items: itemRows.map((row) => ({
      externalItemId: toAuditNullableNumber(row.external_item_id),
      externalProductId: toAuditNullableNumber(row.external_product_id),
      quantity: toAuditNullableNumber(row.quantity),
      unitValue: toAuditNullableNumber(row.unit_value),
      estimatedTotalValue: toAuditNullableNumber(row.estimated_total),
    })),
    rawJson: parseJson(doc.raw_json),
    localNfe,
    orders: orderRows.map((row) => ({
      orderCode:
        row.order_code == null ? null : String(row.order_code).trim() || null,
      salesOrderId:
        row.sales_order_id == null ? null : String(row.sales_order_id),
      source: "sales_order_nfe_link",
    })),
    allocations,
    accountsReceivable,
  });

  return buildFoundExampleLookup({
    query,
    strategies,
    data,
    notes: [
      "Documento resolvido por NomusStockDocument.externalId.",
      "Empresa/cliente/pagamento no rawJson são evidências sanitizadas (hipótese).",
    ],
  });
}

async function investigateSalesOrder(
  prisma: ExamplesAuditPrisma,
  orderRef: string
): Promise<ExamplesSection["salesOrder"]> {
  const trimmed = orderRef.trim();
  let strategies = planSalesOrderLookupStrategies(trimmed);
  const query = { order: trimmed };
  const linkSources: string[] = [];
  let orderRow: SalesOrderRow | undefined;

  {
    const rows = await prisma.$queryRaw<SalesOrderRow[]>(Prisma.sql`
      SELECT ${SALES_ORDER_SELECT}
      FROM "SalesOrder" so
      LEFT JOIN "Customer" c ON c.id = so."customerId"
      WHERE so."orderCode" = ${trimmed}
      LIMIT 1
    `);
    orderRow = rows[0];
    strategies = markStrategy(
      strategies,
      "SalesOrder.orderCode",
      Boolean(orderRow)
    );
    if (orderRow) linkSources.push("SalesOrder.orderCode");
  }

  if (!orderRow) {
    const rows = await prisma.$queryRaw<SalesOrderRow[]>(Prisma.sql`
      SELECT ${SALES_ORDER_SELECT}
      FROM "SalesOrder" so
      LEFT JOIN "Customer" c ON c.id = so."customerId"
      WHERE so."externalSalesOrderCode" = ${trimmed}
      ORDER BY so."issueDate" DESC NULLS LAST
      LIMIT 5
    `);
    orderRow = rows[0];
    strategies = markStrategy(
      strategies,
      "SalesOrder.externalSalesOrderCode",
      Boolean(orderRow)
    );
    if (orderRow) linkSources.push("SalesOrder.externalSalesOrderCode");
  }

  if (!orderRow && /^\d+$/.test(trimmed)) {
    const externalId = Number.parseInt(trimmed, 10);
    const rows = await prisma.$queryRaw<SalesOrderRow[]>(Prisma.sql`
      SELECT ${SALES_ORDER_SELECT}
      FROM "SalesOrder" so
      LEFT JOIN "Customer" c ON c.id = so."customerId"
      WHERE so."externalSalesOrderId" = ${externalId}
      ORDER BY so."issueDate" DESC NULLS LAST
      LIMIT 5
    `);
    orderRow = rows[0];
    strategies = markStrategy(
      strategies,
      "SalesOrder.externalSalesOrderId",
      Boolean(orderRow)
    );
    if (orderRow) linkSources.push("SalesOrder.externalSalesOrderId");
  }

  if (!orderRow) {
    return buildNotFoundExampleLookup({ query, strategies });
  }

  const salesOrderId = String(orderRow.id);
  const orderCode = String(orderRow.order_code);

  const itemRows = await prisma.$queryRaw<
    Array<{
      sku: unknown;
      name: unknown;
      quantity: unknown;
      negotiated: unknown;
      total_net: unknown;
    }>
  >(Prisma.sql`
    SELECT
      i."skuSnapshot" AS sku,
      i."productNameSnapshot" AS name,
      i.quantity AS quantity,
      i."negotiatedPrice" AS negotiated,
      i."totalNetValue" AS total_net
    FROM "SalesOrderItem" i
    WHERE i."salesOrderId" = ${salesOrderId}
    ORDER BY i."nomusItemSequence" ASC NULLS LAST, i."createdAt" ASC
    LIMIT 200
  `);

  const nfeLinkRows = await prisma.$queryRaw<
    Array<{
      nfe_external_id: unknown;
      nfe_number: unknown;
      nfe_status: unknown;
    }>
  >(Prisma.sql`
    SELECT
      l."nfeExternalId" AS nfe_external_id,
      l."nfeNumber" AS nfe_number,
      l."nfeStatus" AS nfe_status
    FROM "SalesOrderNfeLink" l
    WHERE l."salesOrderId" = ${salesOrderId}
    ORDER BY l."nfeExternalId" ASC
    LIMIT 50
  `);
  if (nfeLinkRows.length > 0) linkSources.push("sales_order_nfe_link");

  const nfeIds = nfeLinkRows.map((r) => toAuditNumber(r.nfe_external_id));
  let documentRows: Array<{ external_id: unknown; id_nfe: unknown }> = [];
  if (nfeIds.length > 0) {
    documentRows = await prisma.$queryRaw<
      Array<{ external_id: unknown; id_nfe: unknown }>
    >(Prisma.sql`
      SELECT d."externalId" AS external_id, d."idNfe" AS id_nfe
      FROM "NomusStockDocument" d
      WHERE d."tipoDocumentoEstoque" = ${NOMUS_STOCK_DOCUMENT_TIPO_SAIDA}
        AND d."idNfe" IN (${Prisma.join(nfeIds)})
      ORDER BY d."externalId" ASC
      LIMIT 50
    `);
    if (documentRows.length > 0) linkSources.push("stock_document_idNfe");
  }

  const allocations = await loadAllocationsForOrder(prisma, salesOrderId);

  let accountsReceivable: ExampleReceivableSummary[] = [];
  if (nfeIds.length > 0) {
    const arRows = await prisma.$queryRaw<
      Array<{
        external_id: unknown;
        amount_receivable: unknown;
        amount_received: unknown;
        balance_receivable: unknown;
        due_date: unknown;
        settlement_date: unknown;
      }>
    >(Prisma.sql`
      SELECT
        ar."externalId" AS external_id,
        ar."amountReceivable" AS amount_receivable,
        ar."amountReceived" AS amount_received,
        ar."balanceReceivable" AS balance_receivable,
        ar."dueDate" AS due_date,
        ar."settlementDate" AS settlement_date
      FROM "NomusAccountsReceivable" ar
      WHERE ar."sourceInvoiceId" IN (${Prisma.join(nfeIds)})
      ORDER BY ar."externalId" ASC
      LIMIT 50
    `);
    accountsReceivable = mapReceivableRows(arRows);
  }

  const data = buildSalesOrderExampleFromFixture({
    id: salesOrderId,
    orderCode,
    externalSalesOrderId: toAuditNullableNumber(orderRow.external_id),
    externalSalesOrderCode:
      orderRow.external_code == null ? null : String(orderRow.external_code),
    status: orderRow.status == null ? null : String(orderRow.status),
    issueDate: toAuditIsoDate(orderRow.issue_date),
    companyIssuer:
      orderRow.company_issuer == null ? null : String(orderRow.company_issuer),
    paymentTerms:
      orderRow.payment_terms == null ? null : String(orderRow.payment_terms),
    paymentMethod:
      orderRow.payment_method == null ? null : String(orderRow.payment_method),
    totalNetValue: toAuditNullableNumber(orderRow.total_net),
    totalGrossValue: toAuditNullableNumber(orderRow.total_gross),
    customer: {
      id: orderRow.customer_id == null ? null : String(orderRow.customer_id),
      companyName:
        orderRow.customer_name == null ? null : String(orderRow.customer_name),
      taxId:
        orderRow.customer_tax_id == null
          ? null
          : String(orderRow.customer_tax_id),
    },
    items: itemRows.map((row) => ({
      skuSnapshot: row.sku == null ? null : String(row.sku),
      productNameSnapshot: row.name == null ? null : String(row.name),
      quantity: toAuditNullableNumber(row.quantity),
      negotiatedPrice: toAuditNullableNumber(row.negotiated),
      totalNetValue: toAuditNullableNumber(row.total_net),
    })),
    nfes: nfeLinkRows.map((row) => ({
      nfeExternalId: toAuditNumber(row.nfe_external_id),
      nfeNumber: row.nfe_number == null ? null : String(row.nfe_number),
      nfeStatus: toAuditNullableNumber(row.nfe_status),
    })),
    documents: documentRows.map((row) => ({
      externalId: toAuditNumber(row.external_id),
      idNfe: toAuditNullableNumber(row.id_nfe),
      source: "idNfe+SalesOrderNfeLink",
    })),
    allocations,
    accountsReceivable,
    linkSources: [...new Set(linkSources)],
  });

  return buildFoundExampleLookup({
    query,
    strategies,
    data,
    notes: [
      "Pedido resolvido por chaves oficiais limitadas (sem LIKE ilimitado).",
      "Previsão original vem do próprio Pedido; CR vem das NF vinculadas.",
    ],
  });
}

async function investigateNfe(
  prisma: ExamplesAuditPrisma,
  nfeRef: number
): Promise<ExamplesSection["nfe"]> {
  let strategies = planNfeLookupStrategies(nfeRef);
  const query = { nfe: nfeRef };
  let nfeRow: NfeRow | undefined;

  {
    const rows = await prisma.$queryRaw<NfeRow[]>(Prisma.sql`
      SELECT ${NFE_SELECT}
      FROM "NomusNfe" n
      WHERE n."externalId" = ${nfeRef}
      LIMIT 1
    `);
    nfeRow = rows[0];
    strategies = markStrategy(
      strategies,
      "NomusNfe.externalId",
      Boolean(nfeRow)
    );
  }

  if (!nfeRow) {
    const rows = await prisma.$queryRaw<NfeRow[]>(Prisma.sql`
      SELECT ${NFE_SELECT}
      FROM "NomusNfe" n
      WHERE n.numero = ${String(nfeRef)}
      ORDER BY n."externalId" ASC
      LIMIT 5
    `);
    nfeRow = rows[0];
    strategies = markStrategy(strategies, "NomusNfe.numero", Boolean(nfeRow));
  }

  const linkRows = await prisma.$queryRaw<
    Array<{
      sales_order_id: unknown;
      order_code: unknown;
      nfe_external_id: unknown;
    }>
  >(Prisma.sql`
    SELECT
      l."salesOrderId" AS sales_order_id,
      COALESCE(so."orderCode", l."orderCode") AS order_code,
      l."nfeExternalId" AS nfe_external_id
    FROM "SalesOrderNfeLink" l
    LEFT JOIN "SalesOrder" so ON so.id = l."salesOrderId"
    WHERE l."nfeExternalId" = ${nfeRef}
    ORDER BY order_code ASC NULLS LAST
    LIMIT 5
  `);
  strategies = markStrategy(
    strategies,
    "SalesOrderNfeLink.nfeExternalId",
    linkRows.length > 0
  );

  if (!nfeRow) {
    return buildNotFoundExampleLookup({
      query,
      strategies,
      notes:
        linkRows.length > 0
          ? [
              "Há SalesOrderNfeLink para o número, mas NomusNfe local não foi encontrada.",
            ]
          : undefined,
    });
  }

  const externalId = toAuditNumber(nfeRow.external_id);

  const documentRows = await prisma.$queryRaw<
    Array<{ external_id: unknown; tipo: unknown }>
  >(Prisma.sql`
    SELECT d."externalId" AS external_id, d."tipoDocumentoEstoque" AS tipo
    FROM "NomusStockDocument" d
    WHERE d."idNfe" = ${externalId}
    ORDER BY d."externalId" ASC
    LIMIT 50
  `);

  const orderRows =
    linkRows.length > 0
      ? linkRows
      : await prisma.$queryRaw<
          Array<{
            sales_order_id: unknown;
            order_code: unknown;
            nfe_external_id: unknown;
          }>
        >(Prisma.sql`
          SELECT
            l."salesOrderId" AS sales_order_id,
            COALESCE(so."orderCode", l."orderCode") AS order_code,
            l."nfeExternalId" AS nfe_external_id
          FROM "SalesOrderNfeLink" l
          LEFT JOIN "SalesOrder" so ON so.id = l."salesOrderId"
          WHERE l."nfeExternalId" = ${externalId}
          ORDER BY order_code ASC NULLS LAST
          LIMIT 50
        `);

  const accountsReceivable = await loadReceivablesForNfe(prisma, externalId);

  const data = buildNfeExampleFromFixture({
    externalId,
    chave: nfeRow.chave == null ? null : String(nfeRow.chave),
    numero: nfeRow.numero == null ? null : String(nfeRow.numero),
    serie: nfeRow.serie == null ? null : String(nfeRow.serie),
    status: toAuditNullableNumber(nfeRow.status),
    billingClassification:
      nfeRow.billing_classification == null
        ? null
        : String(nfeRow.billing_classification),
    isFiscalBilling:
      typeof nfeRow.is_fiscal_billing === "boolean"
        ? nfeRow.is_fiscal_billing
        : null,
    isMarketSale:
      typeof nfeRow.is_market_sale === "boolean"
        ? nfeRow.is_market_sale
        : null,
    dataProcessamento: toAuditIsoDate(nfeRow.data_processamento),
    xmlDhEmi: toAuditIsoDate(nfeRow.xml_dh_emi),
    syncedAt: toAuditIsoDate(nfeRow.synced_at),
    xmlVProd: toAuditNullableNumber(nfeRow.xml_vprod),
    xmlVDesc: toAuditNullableNumber(nfeRow.xml_vdesc),
    xmlVNF: toAuditNullableNumber(nfeRow.xml_vnf),
    valorLiquido: toAuditNullableNumber(nfeRow.valor_liquido),
    justificativaCancelamento:
      nfeRow.justificativa == null ? null : String(nfeRow.justificativa),
    hasXmlCancelamento: Boolean(nfeRow.xml_cancelamento),
    documents: documentRows.map((row) => ({
      externalId: toAuditNumber(row.external_id),
      tipoDocumentoEstoque: row.tipo == null ? null : String(row.tipo),
    })),
    orders: orderRows.map((row) => ({
      orderCode:
        row.order_code == null ? null : String(row.order_code).trim() || null,
      salesOrderId:
        row.sales_order_id == null ? null : String(row.sales_order_id),
    })),
    accountsReceivable,
  });

  return buildFoundExampleLookup({
    query,
    strategies,
    data,
    notes: [
      "NF resolvida por chaves oficiais limitadas (externalId → numero → link).",
      "Divergências NF×CR são auditoria; não alteram títulos.",
    ],
  });
}

/** Investigação parametrizada dos três exemplos. Ausência → found=false. */
export async function loadParameterizedExamplesAudit(
  prisma: ExamplesAuditPrisma,
  options: ExamplesAuditOptions
): Promise<ExamplesSection> {
  const [outputDocument, salesOrder, nfe] = await Promise.all([
    investigateOutputDocument(prisma, options.document),
    investigateSalesOrder(prisma, options.order),
    investigateNfe(prisma, options.nfe),
  ]);

  return { outputDocument, salesOrder, nfe };
}
