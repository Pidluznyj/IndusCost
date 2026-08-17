/**
 * FASE 2C — carga leve dos pedidos para o Fluxo de Caixa.
 *
 * Substitui `getOrderFullAudit` APENAS no caminho do Fluxo de Caixa. O audit
 * 360º monta ~20 blocos (proposta, margem, comissões, fiscal, produção,
 * entrega, frete, alertas, divergências, auditoria técnica, vendedor…) e custa
 * dezenas de operações por pedido; a fronteira financeira consome só seis
 * blocos. Este loader carrega esses seis, em lote, para o portfólio inteiro.
 *
 * NÃO reimplementa nenhuma regra. Todas as transformações vêm dos mappers
 * puros já extraídos e caracterizados contra o comportamento do audit:
 *
 *   projectOrderAuditItems          (53e9a2e)
 *   projectOrderAuditReceivables    (2385463)
 *   dedupOrderAuditReceivables      (2385463)
 *   collectOrderReceivableNfeIds    (55472d8)
 *   projectOutputDocumentForSalesOrder (eb09d4f)
 *   resolveRelatedNfesForOrdersBatch   (d658700)
 *   loadOutputDocumentsForSalesOrdersBatch (c28cef5)
 *   projectEffectiveScheduleForOrderAudit (regra financeira, intocada)
 *
 * OMISSÕES DELIBERADAS, cada uma coberta por teste de inércia:
 *   - `stockDocumentItems: []` — cashFlowLightProjectionFeasibility.test.ts
 *   - `nfeNumbers: []`         — cashFlowNfeNumbersInertness.test.ts
 * Não são esquecimento: o array populado e o vazio produzem o MESMO resultado
 * financeiro. Se aqueles testes falharem, estas omissões deixam de valer.
 *
 * POPULAÇÃO DE AR: carregada sem os filtros da tela. Os `arRows` do dashboard
 * são recortados por período/status/cliente e NÃO servem como população de
 * cobertura — um CR de janeiro visto em março continua cobrindo o pedido.
 */

import type { PrismaClient } from "@prisma/client";
import type {
  OrderFullAuditItem,
  OrderFullAuditPlannedReceivable,
  OrderFullAuditReceivable,
  OrderFullAuditStockDocument,
} from "@/src/lib/finance/orderFullAuditClient.js";
import {
  decimalToNumber,
  projectOrderAuditItems,
  toIso,
} from "@/src/lib/finance/orderAuditItemProjection.js";
import {
  dedupOrderAuditReceivables,
  projectOrderAuditReceivables,
} from "@/src/lib/finance/orderAuditReceivableProjection.js";
import { collectOrderReceivableNfeIds } from "@/src/lib/finance/orderAuditReceivableNfeIds.js";
import { resolveRelatedNfesForOrdersBatch } from "@/src/lib/finance/salesOrderRelatedNfeBatch.server.js";
import { loadOutputDocumentsForSalesOrdersBatch } from "@/src/lib/output-documents/nomusOutputDocumentResolverBatch.server.js";
import { projectOutputDocumentForSalesOrder } from "@/src/lib/output-documents/salesOrderOutputDocumentAllocation.js";
import { projectEffectiveScheduleForOrderAudit } from "@/src/lib/finance/effectiveScheduleAuditProjection.js";

export type CashFlowProjectionPrismaLike = Pick<
  PrismaClient,
  | "salesOrder"
  | "orderToCashAuditFact"
  | "nomusAccountsReceivable"
  | "nomusStockDocument"
  | "nomusStockDocumentItem"
  | "nomusNfe"
  | "salesOrderNfeLink"
  | "salesOrderItem"
>;

/** Contrato mínimo — só o que a fronteira do Fluxo de Caixa consome. */
export type CashFlowOrderProjection = {
  salesOrderId: string;
  orderCode: string;
  items: OrderFullAuditItem[];
  stockDocuments: OrderFullAuditStockDocument[];
  receivables: OrderFullAuditReceivable[];
  plannedReceivables: OrderFullAuditPlannedReceivable[];
  personName: string | null;
  personCnpj: string | null;
  companyName: string | null;
};

const AR_SELECT = {
  id: true,
  externalId: true,
  companyName: true,
  personName: true,
  personCnpj: true,
  description: true,
  comments: true,
  sourceInvoiceId: true,
  sourceInvoiceNumber: true,
  createdAtNomus: true,
  dueDate: true,
  competenceDate: true,
  scheduleDate: true,
  settlementDate: true,
  amountReceivable: true,
  amountScheduled: true,
  amountReceived: true,
  balanceReceivable: true,
  paymentMethodName: true,
  bankAccountName: true,
  rawPayload: true,
} as const;

const FACT_SELECT = {
  id: true,
  salesOrderId: true,
  runId: true,
  createdAt: true,
  orderItemSequence: true,
  salesOrderItemId: true,
  nfeExternalId: true,
  nfeNumber: true,
  nfeKey: true,
  nfeHeaderValue: true,
  nfeItemMatchedOrderItem: true,
  stockDocumentExternalId: true,
  stockDocumentDate: true,
  stockDocumentIdNfe: true,
  stockDocumentItemId: true,
  stockDocumentItemExternalProductId: true,
  allocatedValueByDocumentPrice: true,
  quantityUsedForOrder: true,
} as const;

export async function loadCashFlowOrderProjections(
  prisma: CashFlowProjectionPrismaLike,
  input: { salesOrderIds: string[]; referenceDate?: Date }
): Promise<Map<string, CashFlowOrderProjection>> {
  const referenceDate = input.referenceDate ?? new Date();
  const orderIds = [...new Set(input.salesOrderIds.filter(Boolean))];
  const result = new Map<string, CashFlowOrderProjection>();
  if (orderIds.length === 0) return result;

  /* -- 1. pedidos + itens + links (uma consulta) ------------------------- */
  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      orderCode: true,
      issueDate: true,
      expectedDeliveryDate: true,
      paymentTerms: true,
      paymentMethod: true,
      nomusRawResponse: true,
      totalNetValue: true,
      totalGrossValue: true,
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          nomusItemExternalId: true,
          nomusItemSequence: true,
          skuSnapshot: true,
          productNameSnapshot: true,
          externalProductId: true,
          unit: true,
          quantity: true,
          negotiatedPrice: true,
          totalNetValue: true,
          nomusQuantityFulfilled: true,
          nomusQuantityPending: true,
          nomusIsCanceled: true,
          nomusIsCut: true,
          nomusIsStale: true,
          nomusItemStatusRaw: true,
          nomusItemStatusNormalized: true,
          nomusMatchConfidence: true,
          proposalItemId: true,
          nomusRawItem: true,
        },
      },
      nfeLinks: {
        select: {
          id: true,
          nfeExternalId: true,
          nfeNumber: true,
          nfeKey: true,
          nfeStatus: true,
          presentInLastPayload: true,
        },
      },
    },
  });

  /* -- 2. facts O2C do conjunto (uma consulta) --------------------------- */
  const allFacts = await prisma.orderToCashAuditFact.findMany({
    where: { salesOrderId: { in: orderIds } },
    select: FACT_SELECT,
    orderBy: [{ orderItemSequence: "asc" }, { id: "asc" }],
  });

  type FactRow = (typeof allFacts)[number];
  const factsByOrder = new Map<string, FactRow[]>();
  const latestRunByOrder = new Map<string, { runId: string; at: number }>();
  for (const row of allFacts) {
    if (!row.salesOrderId) continue;
    const list = factsByOrder.get(row.salesOrderId);
    if (list) list.push(row);
    else factsByOrder.set(row.salesOrderId, [row]);
    // Mesma resolução do audit: run do fact mais recente.
    const at = row.createdAt instanceof Date ? row.createdAt.getTime() : 0;
    const cur = latestRunByOrder.get(row.salesOrderId);
    if (!cur || at > cur.at) {
      latestRunByOrder.set(row.salesOrderId, { runId: row.runId, at });
    }
  }
  /** Facts do run vigente, na ordem do audit. */
  const runFactsByOrder = new Map<string, FactRow[]>();
  for (const id of orderIds) {
    const runId = latestRunByOrder.get(id)?.runId ?? null;
    const rows = factsByOrder.get(id) ?? [];
    runFactsByOrder.set(
      id,
      runId ? rows.filter((r) => r.runId === runId) : rows
    );
  }

  /* -- 3. NFes relacionadas (três consultas para o conjunto) ------------- */
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const relatedByOrder = await resolveRelatedNfesForOrdersBatch(prisma, [
    ...orderIds.map((id) => {
      const order = orderById.get(id);
      const facts = runFactsByOrder.get(id) ?? [];
      return {
        salesOrderId: id,
        links: (order?.nfeLinks ?? []).map((l) => ({
          id: l.id,
          nfeExternalId: l.nfeExternalId,
          nfeNumber: l.nfeNumber,
          nfeKey: l.nfeKey,
          nfeStatus: l.nfeStatus as number | null,
          presentInLastPayload: l.presentInLastPayload,
        })),
        items: (order?.items ?? []).map((it) => ({
          id: it.id,
          nomusRawItem: it.nomusRawItem,
        })),
        o2cFacts: facts.map((f) => ({
          nfeExternalId: f.nfeExternalId,
          nfeNumber: f.nfeNumber,
          nfeKey: f.nfeKey,
          stockDocumentExternalId: f.stockDocumentExternalId,
          stockDocumentIdNfe: f.stockDocumentIdNfe,
          salesOrderItemId: f.salesOrderItemId,
          nfeItemMatchedOrderItem: f.nfeItemMatchedOrderItem,
        })),
      };
    }),
  ]);

  /* -- 4. IDs de NFe que definem a população de AR ----------------------- */
  const receivableNfeIdsByOrder = new Map<string, number[]>();
  const allReceivableNfeIds = new Set<number>();
  for (const id of orderIds) {
    const related = relatedByOrder.get(id);
    const order = orderById.get(id);
    const ids = collectOrderReceivableNfeIds({
      relatedNfes: (related?.nfes ?? []).map((n) => {
        const link = order?.nfeLinks.find(
          (l) => l.nfeExternalId === n.nfeExternalId
        );
        return {
          nfeExternalId: n.nfeExternalId,
          numero: n.nfeNumber ?? link?.nfeNumber ?? null,
        };
      }),
      facts: (runFactsByOrder.get(id) ?? []).map((f) => ({
        nfeNumber: f.nfeNumber,
        nfeHeaderValue: decimalToNumber(f.nfeHeaderValue),
        nfeExternalId: f.nfeExternalId,
        stockDocumentIdNfe: f.stockDocumentIdNfe,
      })),
    });
    receivableNfeIdsByOrder.set(id, ids);
    for (const nfeId of ids) allReceivableNfeIds.add(nfeId);
  }

  /* -- 5. AR GLOBAL — uma consulta, SEM os filtros da tela --------------- */
  const arRows =
    allReceivableNfeIds.size > 0
      ? await prisma.nomusAccountsReceivable.findMany({
          where: { sourceInvoiceId: { in: [...allReceivableNfeIds] } },
          select: AR_SELECT,
        })
      : [];


  /* -- 6. documentos de saída em lote ------------------------------------ */
  const runIdBySalesOrderId = new Map<string, string | null>(
    orderIds.map((id) => [id, latestRunByOrder.get(id)?.runId ?? null])
  );
  const documentsByOrder = await loadOutputDocumentsForSalesOrdersBatch(
    prisma,
    orderIds,
    { runIdBySalesOrderId }
  );

  /* -- 7. composição por pedido (sem I/O daqui para baixo) --------------- */
  for (const salesOrderId of orderIds) {
    const order = orderById.get(salesOrderId);
    if (!order) continue;

    const orderCode = order.orderCode ?? "SO";
    const items = projectOrderAuditItems({
      items: order.items,
      expectedDeliveryDate: order.expectedDeliveryDate,
    });

    // Recebíveis: mesma projeção e mesmo dedup do audit.
    //
    // ORDEM: o filtro roda sobre `arRows`, preservando a ordem em que a
    // consulta devolveu as linhas — como o caminho legado faz. Agrupar por
    // NF-e (`nfeIds.flatMap(...)`) reordenava os CRs por nota, o que não
    // acontece no audit e apareceu como divergência no shadow real.
    // O Set serve SÓ para pertencimento; iterá-lo reintroduziria o defeito.
    const nfeIds = receivableNfeIdsByOrder.get(salesOrderId) ?? [];
    const nfeIdSet = new Set(nfeIds);
    const rowsForOrder = arRows.filter(
      (row) => row.sourceInvoiceId != null && nfeIdSet.has(row.sourceInvoiceId)
    );
    const receivables = dedupOrderAuditReceivables(
      projectOrderAuditReceivables({
        rows: rowsForOrder,
        referenceDate: new Date(),
      })
    );

    // Documentos: alocação pela cadeia canônica (O2C autorizado só aqui).
    const facts = runFactsByOrder.get(salesOrderId) ?? [];
    const factsByDoc = new Map<number, typeof facts>();
    for (const f of facts) {
      if (f.stockDocumentExternalId == null) continue;
      const list = factsByDoc.get(f.stockDocumentExternalId);
      if (list) list.push(f);
      else factsByDoc.set(f.stockDocumentExternalId, [f]);
    }
    const orderItemHints = items.map((it) => ({
      salesOrderItemId: it.salesOrderItemId,
      salesOrderId,
      orderCode: order.orderCode ?? null,
      externalProductId: it.productExternalId,
    }));
    const productExternalIdByOrderItemId = new Map(
      items.map((it) => [it.salesOrderItemId, it.productExternalId] as const)
    );

    const stockDocuments: OrderFullAuditStockDocument[] = [];
    for (const resolved of documentsByOrder.get(salesOrderId) ?? []) {
      const doc = resolved.document;
      const allocated = projectOutputDocumentForSalesOrder({
        document: {
          id: doc.id,
          externalId: doc.externalId,
          idNfe: doc.idNfe,
          totalValue: doc.totalValue,
          items: resolved.items.map((item) => ({
            id: item.id,
            externalItemId: item.externalItemId,
            externalProductId: item.externalProductId,
            quantity: item.quantity,
            unitValue: item.unitValue,
            estimatedTotalValue: item.estimatedTotalValue,
          })),
        },
        resolvedAllocationLines: resolved.o2c.allocationLines,
        fallbackFacts: factsByDoc.get(doc.externalId) ?? [],
        orderItemHints,
        salesOrderId,
        orderCode: order.orderCode ?? null,
        productExternalIdBySalesOrderItemId: productExternalIdByOrderItemId,
      });

      // DATAS — precedência do audit, que NÃO é a linha do stage:
      // o laço de facts cria a entrada do documento primeiro e grava
      // `dataDocumento` E `dataMovimentacao` a partir de
      // `fact.stockDocumentDate`; os laços posteriores (resolver e stage) só
      // complementam, nunca sobrescrevem essas duas. Só quando não há fact é
      // que valem `doc.dataDocumento` / `doc.movementDate`.
      // Usar o stage direto zerava `dataMovimentacao` em 27 dos 80 pedidos do
      // shadow real, porque o stage tem `movementDate` nulo nesses casos.
      const firstFact = factsByDoc.get(doc.externalId)?.[0];
      const factDate = firstFact ? toIso(firstFact.stockDocumentDate) : null;

      stockDocuments.push({
        stockDocumentExternalId: doc.externalId,
        stockDocumentId: doc.id,
        documentNumber: doc.documentNumber?.trim() || null,
        tipoDocumentoEstoque: doc.tipoDocumentoEstoque ?? null,
        dataDocumento: firstFact ? factDate : toIso(doc.dataDocumento),
        dataMovimentacao: firstFact ? factDate : toIso(doc.movementDate),
        customerName: doc.personName ?? null,
        companyName: doc.companyName ?? null,
        idNfe: doc.idNfe ?? null,
        status: doc.statusRaw ?? null,
        isCancelled: doc.isCancelled === true,
        totalValue: allocated.projection.document.totalValue,
        allocatedValue: allocated.allocatedValue,
      } as unknown as OrderFullAuditStockDocument);
    }

    // Primeira projeção — mesma função do audit, sem originalInstallments.
    const projection = projectEffectiveScheduleForOrderAudit({
      salesOrderId,
      orderCode,
      issueDate: order.issueDate,
      paymentTerms: order.paymentTerms,
      paymentMethod: order.paymentMethod,
      nomusRawResponse: order.nomusRawResponse,
      totalActiveValue:
        decimalToNumber(order.totalNetValue) ??
        decimalToNumber(order.totalGrossValue) ??
        0,
      items,
      receivables,
      stockDocuments,
      // Inércia provada — ver cabeçalho.
      nfeNumbers: [],
      referenceDate,
    });

    const person = receivables[0];
    result.set(salesOrderId, {
      salesOrderId,
      orderCode,
      items,
      stockDocuments,
      receivables,
      plannedReceivables: projection.plannedReceivables,
      personName: person?.personName ?? null,
      personCnpj: person?.personCnpj ?? null,
      companyName: person?.companyName ?? null,
    });
  }

  return result;
}
