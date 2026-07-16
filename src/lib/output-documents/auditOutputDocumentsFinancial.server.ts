/**
 * Loader read-only de alocação financeira e Contas a Receber (DS-02.6).
 * Apenas SELECT/agregações. Não altera regras oficiais nem títulos.
 */
import { Prisma } from "@prisma/client";
import {
  NOMUS_STOCK_DOCUMENT_TIPO_SAIDA,
  toAuditIsoDate,
  toAuditNumber,
} from "./auditOutputDocumentsDb.js";
import {
  buildEmptyAccountsReceivableLinksSection,
  buildEmptyAllocationsSection,
  buildEmptyFinancialEvidenceSection,
  classifyAllocationCoverage,
  classifyNfeVsReceivablesSum,
  classifyReceivableDueStatus,
  classifyReceivableSettlement,
  emptyAllocationCoverageCounts,
  emptyEvidenceSourceCounts,
  emptySettlementCounts,
  resolveFinancialEvidenceWithoutDoubleCount,
  toMoneyCents,
  type AccountsReceivableLinksSection,
  type AllocationsSection,
  type FinancialEvidenceSection,
} from "./auditOutputDocumentsFinancial.js";

export type FinancialAuditPrisma = {
  $queryRaw: <T = unknown>(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) => Promise<T>;
};

export type FinancialAuditLoad = {
  allocations: AllocationsSection;
  accountsReceivableLinks: AccountsReceivableLinksSection;
  financialEvidence: FinancialEvidenceSection;
};

function pushSample(target: number[], value: number, limit = 50): void {
  if (target.length >= limit) return;
  if (!target.includes(value)) target.push(value);
}

async function loadDocumentValueRows(
  prisma: FinancialAuditPrisma
): Promise<
  Array<{
    externalId: number;
    idNfe: number | null;
    documentValueCents: number;
  }>
> {
  const rows = await prisma.$queryRaw<
    Array<{
      external_id: unknown;
      id_nfe: unknown;
      item_total: unknown;
    }>
  >(Prisma.sql`
    SELECT
      d."externalId" AS external_id,
      d."idNfe" AS id_nfe,
      COALESCE(SUM(i."estimatedTotalValue"), 0) AS item_total
    FROM "NomusStockDocument" d
    LEFT JOIN "NomusStockDocumentItem" i ON i."stockDocumentId" = d.id
    WHERE d."tipoDocumentoEstoque" = ${NOMUS_STOCK_DOCUMENT_TIPO_SAIDA}
    GROUP BY d.id, d."externalId", d."idNfe"
  `);

  return rows.map((row) => ({
    externalId: toAuditNumber(row.external_id),
    idNfe:
      row.id_nfe == null || row.id_nfe === ""
        ? null
        : toAuditNumber(row.id_nfe),
    documentValueCents: toMoneyCents(row.item_total),
  }));
}

async function loadO2cMoneyByDocument(
  prisma: FinancialAuditPrisma
): Promise<{
  allocatedByDoc: Map<number, number>;
  orderForecastByDoc: Map<number, number>;
}> {
  const rows = await prisma.$queryRaw<
    Array<{
      stock_document_external_id: unknown;
      allocated_total: unknown;
      order_forecast_total: unknown;
    }>
  >(Prisma.sql`
    SELECT
      f."stockDocumentExternalId" AS stock_document_external_id,
      COALESCE(SUM(f."allocatedValueByDocumentPrice"), 0) AS allocated_total,
      COALESCE(MAX(f."orderNetValue"), MAX(f."orderTotalValue"), 0) AS order_forecast_total
    FROM "OrderToCashAuditFact" f
    WHERE f."stockDocumentExternalId" IS NOT NULL
    GROUP BY f."stockDocumentExternalId"
  `);

  const allocatedByDoc = new Map<number, number>();
  const orderForecastByDoc = new Map<number, number>();
  for (const row of rows) {
    const id = toAuditNumber(row.stock_document_external_id);
    if (id <= 0) continue;
    allocatedByDoc.set(id, toMoneyCents(row.allocated_total));
    orderForecastByDoc.set(id, toMoneyCents(row.order_forecast_total));
  }
  return { allocatedByDoc, orderForecastByDoc };
}

async function loadReceivablesByNfe(
  prisma: FinancialAuditPrisma
): Promise<
  Map<
    number,
    Array<{
      externalId: number;
      amountReceivableCents: number;
      amountReceivedCents: number;
      balanceReceivableCents: number;
      dueDate: Date | null;
    }>
  >
> {
  const rows = await prisma.$queryRaw<
    Array<{
      source_invoice_id: unknown;
      external_id: unknown;
      amount_receivable: unknown;
      amount_received: unknown;
      balance_receivable: unknown;
      due_date: unknown;
    }>
  >(Prisma.sql`
    SELECT
      ar."sourceInvoiceId" AS source_invoice_id,
      ar."externalId" AS external_id,
      ar."amountReceivable" AS amount_receivable,
      ar."amountReceived" AS amount_received,
      ar."balanceReceivable" AS balance_receivable,
      ar."dueDate" AS due_date
    FROM "NomusAccountsReceivable" ar
    WHERE ar."sourceInvoiceId" IS NOT NULL
  `);

  const map = new Map<
    number,
    Array<{
      externalId: number;
      amountReceivableCents: number;
      amountReceivedCents: number;
      balanceReceivableCents: number;
      dueDate: Date | null;
    }>
  >();

  for (const row of rows) {
    const nfeId = toAuditNumber(row.source_invoice_id);
    if (nfeId <= 0) continue;
    const iso = toAuditIsoDate(row.due_date);
    const dueDate = iso ? new Date(iso) : null;
    const list = map.get(nfeId) ?? [];
    list.push({
      externalId: toAuditNumber(row.external_id),
      amountReceivableCents: toMoneyCents(row.amount_receivable),
      amountReceivedCents: toMoneyCents(row.amount_received),
      balanceReceivableCents: toMoneyCents(row.balance_receivable),
      dueDate,
    });
    map.set(nfeId, list);
  }
  return map;
}

async function loadNfeValues(
  prisma: FinancialAuditPrisma,
  nfeIds: number[]
): Promise<Map<number, number>> {
  if (nfeIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<
    Array<{
      external_id: unknown;
      xml_vnf: unknown;
      valor_liquido: unknown;
    }>
  >(Prisma.sql`
    SELECT
      n."externalId" AS external_id,
      n."xmlVNF" AS xml_vnf,
      n."valorLiquido" AS valor_liquido
    FROM "NomusNfe" n
    WHERE n."externalId" IN (${Prisma.join(nfeIds)})
  `);

  const map = new Map<number, number>();
  for (const row of rows) {
    const id = toAuditNumber(row.external_id);
    const xml = toMoneyCents(row.xml_vnf);
    const liquido = toMoneyCents(row.valor_liquido);
    map.set(id, xml > 0 ? xml : liquido);
  }
  return map;
}

/**
 * Agrega métricas financeiras read-only do stage DocumentoSaida.
 * Paginação implícita via agregações; amostras limitadas a 50 IDs.
 */
export async function loadDocumentFinancialAudit(
  prisma: FinancialAuditPrisma,
  options?: { referenceDate?: Date; sampleLimit?: number }
): Promise<FinancialAuditLoad> {
  const referenceDate = options?.referenceDate ?? new Date();
  const sampleLimit = Math.max(1, options?.sampleLimit ?? 50);

  const documents = await loadDocumentValueRows(prisma);
  const { allocatedByDoc, orderForecastByDoc } =
    await loadO2cMoneyByDocument(prisma);
  const receivablesByNfe = await loadReceivablesByNfe(prisma);

  const nfeIds = [
    ...new Set(
      documents
        .map((d) => d.idNfe)
        .filter((id): id is number => id != null && id > 0)
    ),
  ];
  const nfeValues = await loadNfeValues(prisma, nfeIds);

  const allocations = buildEmptyAllocationsSection();
  const accountsReceivableLinks = buildEmptyAccountsReceivableLinksSection();
  const financialEvidence = buildEmptyFinancialEvidenceSection();

  const coverageCounts = emptyAllocationCoverageCounts();
  const settlementCounts = emptySettlementCounts();
  const sourceCounts = emptyEvidenceSourceCounts();

  let totalDocumentValueCents = 0;
  let totalAllocatedToOrdersCents = 0;
  let documentsWithItemValue = 0;
  let documentsWithIdNfe = 0;
  let documentsWithReceivables = 0;
  let documentsWithoutReceivables = 0;
  let titlesOpen = 0;
  let titlesPartial = 0;
  let titlesReceived = 0;
  let titlesOverdue = 0;
  let titlesWithoutDueDate = 0;
  let doubleCountPrevented = 0;

  const multiTitleNfeIds: number[] = [];
  const divergentNfeIds: number[] = [];
  const overdueReceivableExternalIds: number[] = [];
  const documentsWithoutReceivableExternalIds: number[] = [];
  const seenNfeForTitleMetrics = new Set<number>();
  let nfeWithMultipleTitles = 0;
  let nfeReceivableSumDivergent = 0;
  let nfeReceivableSumRounding = 0;

  for (const doc of documents) {
    const allocated = allocatedByDoc.get(doc.externalId) ?? 0;
    totalDocumentValueCents += doc.documentValueCents;
    totalAllocatedToOrdersCents += allocated;
    if (doc.documentValueCents > 0) documentsWithItemValue += 1;

    const coverage = classifyAllocationCoverage({
      documentValueCents: doc.documentValueCents,
      allocatedToOrdersCents: allocated,
    });
    coverageCounts[coverage.status] += 1;
    if (coverage.status === "nao_alocado") {
      pushSample(
        allocations.samples.unallocatedDocumentExternalIds,
        doc.externalId,
        sampleLimit
      );
    } else if (coverage.status === "parcial") {
      pushSample(
        allocations.samples.partialDocumentExternalIds,
        doc.externalId,
        sampleLimit
      );
    } else if (coverage.status === "superalocado") {
      pushSample(
        allocations.samples.overAllocatedDocumentExternalIds,
        doc.externalId,
        sampleLimit
      );
    } else if (coverage.status === "arredondamento") {
      pushSample(
        allocations.samples.roundingDocumentExternalIds,
        doc.externalId,
        sampleLimit
      );
    }

    const titles =
      doc.idNfe != null ? receivablesByNfe.get(doc.idNfe) ?? [] : [];
    const receivableSumCents = titles.reduce(
      (s, t) => s + t.amountReceivableCents,
      0
    );

    if (doc.idNfe != null) {
      documentsWithIdNfe += 1;
      if (titles.length > 0) {
        documentsWithReceivables += 1;
      } else {
        documentsWithoutReceivables += 1;
        pushSample(
          documentsWithoutReceivableExternalIds,
          doc.externalId,
          sampleLimit
        );
      }

      if (!seenNfeForTitleMetrics.has(doc.idNfe)) {
        seenNfeForTitleMetrics.add(doc.idNfe);
        if (titles.length > 1) {
          nfeWithMultipleTitles += 1;
          pushSample(multiTitleNfeIds, doc.idNfe, sampleLimit);
        }
        const nfeCmp = classifyNfeVsReceivablesSum({
          nfeValueCents: nfeValues.get(doc.idNfe) ?? 0,
          titlesAmountReceivableCents: receivableSumCents,
        });
        if (nfeCmp.status === "divergente") {
          nfeReceivableSumDivergent += 1;
          pushSample(divergentNfeIds, doc.idNfe, sampleLimit);
        } else if (nfeCmp.status === "arredondamento") {
          nfeReceivableSumRounding += 1;
        }

        for (const title of titles) {
          const settlement = classifyReceivableSettlement(title);
          settlementCounts[settlement.status] += 1;
          if (settlement.status === "aberto") titlesOpen += 1;
          else if (settlement.status === "parcial") titlesPartial += 1;
          else titlesReceived += 1;

          const due = classifyReceivableDueStatus({
            dueDate: title.dueDate,
            referenceDate,
            settlement: settlement.status,
          });
          if (due === "vencido") {
            titlesOverdue += 1;
            pushSample(
              overdueReceivableExternalIds,
              title.externalId,
              sampleLimit
            );
          } else if (due === "sem_vencimento") {
            titlesWithoutDueDate += 1;
          }
        }
      }
    }

    const evidence = resolveFinancialEvidenceWithoutDoubleCount({
      receivableCents: receivableSumCents,
      documentCents: doc.documentValueCents,
      orderForecastCents: orderForecastByDoc.get(doc.externalId) ?? 0,
    });
    sourceCounts[evidence.source] += 1;
    if (evidence.wouldDoubleCountIfSummed) {
      doubleCountPrevented += 1;
      pushSample(
        financialEvidence.samples.doubleCountPreventedDocumentExternalIds,
        doc.externalId,
        sampleLimit
      );
    }
    if (evidence.source === "MIXED") {
      pushSample(
        financialEvidence.samples.mixedEvidenceDocumentExternalIds,
        doc.externalId,
        sampleLimit
      );
    }
  }

  allocations.metrics = {
    documentsTotal: documents.length,
    documentsWithItemValue,
    documentsWithoutItemValue: documents.length - documentsWithItemValue,
    unallocated: coverageCounts.nao_alocado,
    partial: coverageCounts.parcial,
    complete: coverageCounts.completo,
    overAllocated: coverageCounts.superalocado,
    roundingTolerance: coverageCounts.arredondamento,
    totalDocumentValueCents,
    totalAllocatedToOrdersCents,
    totalDifferenceCents: totalDocumentValueCents - totalAllocatedToOrdersCents,
    coverageCounts,
  };
  allocations.notes.push(
    "DS-02.6: alocação Documento × pedidos via O2C (read-only)."
  );

  accountsReceivableLinks.metrics = {
    documentsWithIdNfe,
    documentsWithReceivables,
    documentsWithoutReceivables,
    titlesOpen,
    titlesPartial,
    titlesReceived,
    titlesOverdue,
    titlesWithoutDueDate,
    nfeWithMultipleTitles,
    nfeReceivableSumDivergent,
    nfeReceivableSumRounding,
    settlementCounts,
  };
  accountsReceivableLinks.samples = {
    multiTitleNfeIds,
    divergentNfeIds,
    overdueReceivableExternalIds,
    documentsWithoutReceivableExternalIds,
  };
  accountsReceivableLinks.notes.push(
    "DS-02.6: títulos CR por NF do documento; métricas de NF deduplicadas por sourceInvoiceId."
  );

  financialEvidence.metrics = {
    documentsEvaluated: documents.length,
    evidenceByReceivable: sourceCounts.REAL_RECEIVABLE,
    evidenceByDocument: sourceCounts.OUTPUT_DOCUMENT,
    evidenceByOrderPlan: sourceCounts.ORDER_PLAN,
    evidenceMixed: sourceCounts.MIXED,
    evidenceNone: sourceCounts.NONE,
    doubleCountPrevented,
    sourceCounts,
  };
  financialEvidence.notes.push(
    "DS-02.6: evidência financeira com prevenção de dupla contagem (max CR/Documento)."
  );

  return { allocations, accountsReceivableLinks, financialEvidence };
}
