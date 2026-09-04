/**
 * PURCH-MIRROR-01 — Orquestração do mirror de Pedidos de Compra Nomus.
 *
 * Responsabilidades desta camada (I/O; a lógica pura vive em arquivos
 * separados e é testada sem Prisma/HTTP):
 *  - paginar list, buscar detail com bounded concurrency;
 *  - montar snapshots locais e chamar `planNomusSourceReconciliation`
 *    (motor genérico já usado por Pedidos de Venda/CR/CP — reaproveitado
 *    aqui, não duplicado) para CREATE/UPDATE/UNCHANGED/MISSING_*;
 *  - resolver matching de fornecedor/produto em lote (sem N+1);
 *  - persistir em `mode: "apply"` — cada pedido em uma transação própria
 *    (nunca uma transação global dos 12 meses);
 *  - registrar `NomusSourceSyncRun`.
 *
 * MIRROR ESTRITO (item 4 da missão): esta função NUNCA cria/atualiza
 * PurchaseOrder interno, PurchaseReceipt, InventoryMovement ou
 * AccountsPayable, e NUNCA chama POST/PUT/PATCH/DELETE no Nomus — o cliente
 * HTTP subjacente (`nomusRestClient.fetchNomusJson`) só expõe GET.
 */

import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { fetchNomusJson } from "../nomusRestClient.js";
import {
  fetchAllNomusPurchaseOrders,
  fetchNomusPurchaseOrderDetail,
  type NomusPurchaseOrdersFetchStopReason,
} from "./nomusPurchaseOrdersClient.js";
import {
  mapNomusPurchaseOrderPayload,
  resolveNomusPurchaseOrderItemLineNumber,
  stableNomusPurchaseOrderPayloadHash,
  type NomusPurchaseOrderMapped,
} from "./nomusPurchaseOrderPayload.js";
import {
  classifyNomusPurchaseOrderStage,
  type NomusPurchaseOrderDerivedStage,
} from "./nomusPurchaseOrderStageEngine.js";
import {
  buildNomusSupplierAliasIndex,
  matchNomusPurchaseOrderSupplier,
  type NomusSupplierAliasRecord,
} from "./nomusPurchaseOrderSupplierMatch.js";
import {
  buildNomusProductMatchIndex,
  matchNomusPurchaseOrderProduct,
  type NomusProductBridgeRecord,
} from "./nomusPurchaseOrderProductMatch.js";
import { normalizeNomusExternalId } from "./nomusExternalId.js";
import {
  planNomusSourceReconciliation,
  type NomusSourceFoundRecord,
  type NomusSourceLocalRecord,
} from "./nomusSourceReconciliationEngine.js";
import { resolveNomusPurchaseOrdersBackfillWindow } from "./nomusPurchaseOrdersBackfillWindow.js";

export type NomusPurchaseOrdersSyncMode = "preview" | "apply";
export type NomusPurchaseOrdersSyncStrategy = "backfill" | "recent-window";

export type NomusPurchaseOrdersSyncArgs = {
  prisma: PrismaClient;
  mode: NomusPurchaseOrdersSyncMode;
  strategy: NomusPurchaseOrdersSyncStrategy;
  /** Meses retroativos (backfill). Ignorado se from/to explícitos. */
  months?: number;
  from?: Date;
  to?: Date;
  referenceDate?: Date;
  baseUrl?: string;
  maxPages?: number;
  pageSize?: number;
  /** Concorrência limitada para GET de detail (nunca dispara N ilimitado). */
  detailConcurrency?: number;
  fetchJson?: typeof fetchNomusJson;
  now?: () => Date;
};

export type NomusPurchaseOrdersSyncSummary = {
  mode: NomusPurchaseOrdersSyncMode;
  strategy: NomusPurchaseOrdersSyncStrategy;
  periodFromSp: string | null;
  periodToSp: string | null;
  endpoint: string;
  pagesRead: number;
  ordersReadFromList: number;
  ordersInPeriod: number;
  detailRequests: number;
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  itemsWritten: number;
  suppliersMatched: number;
  suppliersUnmatched: number;
  suppliersAmbiguous: number;
  productsMatched: number;
  productsUnmatched: number;
  minIssueDate: string | null;
  maxIssueDate: string | null;
  http429Count: number;
  retries: number;
  errors: string[];
  stopReason: NomusPurchaseOrdersFetchStopReason;
  durationMs: number;
  runId: string | null;
};

const DEFAULT_MAX_PAGES = 500;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_DETAIL_CONCURRENCY = 4;

function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const baseUrl = (env.NOMUS_BASE_URL ?? "").trim();
  if (!baseUrl) {
    throw new Error("NOMUS_BASE_URL não configurada — sync abortado (fail-closed).");
  }
  return baseUrl;
}

async function mapWithBoundedConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

type PreparedOrder = {
  externalId: number;
  mapped: NomusPurchaseOrderMapped;
  payloadHash: string;
  stage: ReturnType<typeof classifyNomusPurchaseOrderStage>;
};

/**
 * Executa o sync (backfill ou janela recente). Função de I/O — orquestra os
 * módulos puros. Lança erro se o lock não puder ser adquirido pelo
 * chamador (ver `nomusPurchaseOrdersSyncLock.ts` — chamado pelo runner, não
 * aqui, para manter esta função testável sem side effect de filesystem).
 */
export async function runNomusPurchaseOrdersSync(
  args: NomusPurchaseOrdersSyncArgs
): Promise<NomusPurchaseOrdersSyncSummary> {
  const startedAt = Date.now();
  const now = args.now ?? (() => new Date());
  const baseUrl = args.baseUrl ?? resolveBaseUrl();
  const fetchJson = args.fetchJson ?? fetchNomusJson;
  const maxPages = args.maxPages ?? DEFAULT_MAX_PAGES;
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const detailConcurrency = args.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY;

  let periodFromSp: string | null = null;
  let periodToSp: string | null = null;
  let windowFrom: Date | null = null;
  let windowTo: Date | null = null;
  if (args.from && args.to) {
    windowFrom = args.from;
    windowTo = args.to;
  } else if (args.strategy === "backfill") {
    const window = resolveNomusPurchaseOrdersBackfillWindow(
      args.referenceDate ?? now(),
      args.months ?? 12
    );
    windowFrom = window.from;
    windowTo = window.to;
    periodFromSp = window.fromDateSp;
    periodToSp = window.toDateSp;
  }

  const errors: string[] = [];

  // --- 1. Listagem paginada -------------------------------------------------
  const listResult = await fetchAllNomusPurchaseOrders({
    baseUrl,
    maxPages,
    pageSize,
    fetchJson,
  });
  errors.push(...listResult.errors);

  if (listResult.stopReason === "max_pages") {
    errors.push(
      `MAX_PAGES_REACHED_WITHOUT_PROOF_OF_END (maxPages=${maxPages}) — aumente --max-pages ou investigue paginação.`
    );
  }

  // --- 2. Filtra por período (data de emissão) e monta pedidos preparados --
  const listMapped = listResult.rows.map((row) => mapNomusPurchaseOrderPayload(row));
  const inPeriod = listMapped.filter((m) => {
    if (!windowFrom || !windowTo) return true;
    if (!m.header.issueDate) return false;
    const t = m.header.issueDate.getTime();
    return t >= windowFrom.getTime() && t <= windowTo.getTime();
  });

  // Dedup por externalId (id repetido entre páginas → última ocorrência).
  const byExternalId = new Map<number, NomusPurchaseOrderMapped>();
  for (const m of inPeriod) {
    if (m.header.externalId == null) continue;
    byExternalId.set(m.header.externalId, m);
  }

  // --- 3. Detail (bounded concurrency) para completar itens ----------------
  let detailRequests = 0;
  const prepared: PreparedOrder[] = await mapWithBoundedConcurrency(
    [...byExternalId.values()],
    detailConcurrency,
    async (m) => {
      let full = m;
      if (m.header.externalId != null) {
        try {
          detailRequests += 1;
          const detailRaw = await fetchNomusPurchaseOrderDetail({
            baseUrl,
            externalId: m.header.externalId,
            fetchJson,
          });
          full = mapNomusPurchaseOrderPayload(detailRaw);
        } catch (error) {
          errors.push(
            `DETAIL_FETCH_FAILED externalId=${m.header.externalId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          // Mantém o header/list como fallback — nunca corrompe outros pedidos.
        }
      }
      const stage = classifyNomusPurchaseOrderStage(
        full.items.map((item) => ({ rawStatusCode: item.nomusStatusCode }))
      );
      return {
        externalId: full.header.externalId as number,
        mapped: full,
        payloadHash: stableNomusPurchaseOrderPayloadHash(full.raw),
        stage,
      };
    }
  );

  const minIssueDate = prepared.reduce<string | null>((min, p) => {
    const iso = p.mapped.header.issueDate?.toISOString().slice(0, 10) ?? null;
    if (!iso) return min;
    return min === null || iso < min ? iso : min;
  }, null);
  const maxIssueDate = prepared.reduce<string | null>((max, p) => {
    const iso = p.mapped.header.issueDate?.toISOString().slice(0, 10) ?? null;
    if (!iso) return max;
    return max === null || iso > max ? iso : max;
  }, null);

  // --- 4. Matching em lote (fornecedor/produto) — sem N+1 -------------------
  const supplierExternalIds = [
    ...new Set(
      prepared
        .map((p) => normalizeNomusExternalId(p.mapped.header.externalSupplierId))
        .filter((n) => n.valid)
        .map((n) => n.numeric)
    ),
  ].filter((n): n is number => n !== null);

  const aliasRows = supplierExternalIds.length
    ? await args.prisma.financialSupplierAlias.findMany({
        where: { externalSupplierId: { in: supplierExternalIds } },
        select: { externalSupplierId: true, supplierId: true },
      })
    : [];
  const supplierIndex = buildNomusSupplierAliasIndex(
    aliasRows as NomusSupplierAliasRecord[]
  );

  const productExternalIds = [
    ...new Set(
      prepared.flatMap((p) =>
        p.mapped.items
          .map((item) => normalizeNomusExternalId(item.externalProductId))
          .filter((n) => n.valid)
          .map((n) => n.key)
      )
    ),
  ];

  let productBridgeRecords: NomusProductBridgeRecord[] = [];
  if (productExternalIds.length) {
    const catalogRows = await args.prisma.nomusProductCatalog.findMany({
      where: { externalProductId: { in: productExternalIds } },
      select: { externalProductId: true, code: true },
    });
    const codes = [...new Set(catalogRows.map((c) => c.code).filter(Boolean))];
    const materials = codes.length
      ? await args.prisma.material.findMany({
          where: { code: { in: codes } },
          select: { id: true, code: true },
        })
      : [];
    const materialByCode = new Map(materials.map((m) => [m.code, m.id]));
    const inventoryItems = await args.prisma.inventoryItem.findMany({
      where: { nomusProductId: { in: productExternalIds } },
      select: { id: true, nomusProductId: true },
    });
    const inventoryByExternalId = new Map(
      inventoryItems.map((i) => [i.nomusProductId as string, i.id])
    );
    productBridgeRecords = catalogRows.map((c) => ({
      externalProductId: c.externalProductId,
      materialId: c.code ? materialByCode.get(c.code) ?? null : null,
      inventoryItemId: c.externalProductId
        ? inventoryByExternalId.get(c.externalProductId) ?? null
        : null,
    }));
    // Itens com bridge só via InventoryItem (sem catálogo correspondente).
    for (const [externalProductId, inventoryItemId] of inventoryByExternalId) {
      if (!productBridgeRecords.some((r) => r.externalProductId === externalProductId)) {
        productBridgeRecords.push({ externalProductId, materialId: null, inventoryItemId });
      }
    }
  }
  const productIndex = buildNomusProductMatchIndex(productBridgeRecords);

  let suppliersMatched = 0;
  let suppliersUnmatched = 0;
  let suppliersAmbiguous = 0;
  let productsMatched = 0;
  let productsUnmatched = 0;

  const executedAt = now();
  const runId = args.mode === "apply" ? randomUUID() : null;

  // --- 5. Snapshots locais + plano (motor genérico reaproveitado) ----------
  const existing = prepared.length
    ? await args.prisma.nomusPurchaseOrder.findMany({
        where: { externalId: { in: prepared.map((p) => p.externalId) } },
        select: {
          id: true,
          externalId: true,
          payloadHash: true,
          sourcePresenceStatus: true,
          presentInLastPayload: true,
          missingConsecutiveRuns: true,
          missingSince: true,
          sourceRemovedAt: true,
          firstSeenAt: true,
          lastSeenAt: true,
          lastSyncRunId: true,
        },
      })
    : [];
  const existingByExternalId = new Map(existing.map((e) => [e.externalId, e]));

  const localRecords: NomusSourceLocalRecord[] = existing.map((e) => ({
    localId: e.id,
    externalId: String(e.externalId),
    entityType: "PURCHASE_ORDER",
    payloadHash: e.payloadHash,
    sourcePresenceStatus: e.sourcePresenceStatus,
    presentInLastPayload: e.presentInLastPayload,
    missingConsecutiveRuns: e.missingConsecutiveRuns,
    missingSince: e.missingSince,
    sourceRemovedAt: e.sourceRemovedAt,
    scope: { kind: args.strategy === "backfill" ? "FULL_RECONCILIATION" : "RECENT_WINDOW" },
    firstSeenAt: e.firstSeenAt,
    lastSeenAt: e.lastSeenAt,
    lastSyncRunId: e.lastSyncRunId,
  }));

  const foundRecords: NomusSourceFoundRecord[] = prepared.map((p) => ({
    externalId: String(p.externalId),
    payloadHash: p.payloadHash,
  }));

  const plan = planNomusSourceReconciliation({
    entityType: "PURCHASE_ORDER",
    scope: { kind: args.strategy === "backfill" ? "FULL_RECONCILIATION" : "RECENT_WINDOW" },
    run: {
      id: runId,
      status: "RUNNING",
      entityType: "PURCHASE_ORDER",
      scope: { kind: args.strategy === "backfill" ? "FULL_RECONCILIATION" : "RECENT_WINDOW" },
      payloadComplete: false,
    },
    found: foundRecords,
    localRecords,
    executedAt,
    // Ausência (MISSING_*) desligada nesta primeira versão — mirror ainda
    // não valida completude do payload Nomus o suficiente para confirmar
    // ausência com segurança (ver docs, seção "Source presence").
    reconciliationEnabled: false,
    mode: args.mode,
  });

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let itemsWritten = 0;

  if (args.mode === "apply") {
    const actionable = [...plan.creates, ...plan.updates, ...plan.unchanged, ...plan.reactivated];
    for (const action of actionable) {
      const prep = prepared.find((p) => String(p.externalId) === action.externalId);
      if (!prep) continue;

      const supplierMatch = matchNomusPurchaseOrderSupplier(
        prep.mapped.header.externalSupplierId,
        supplierIndex
      );
      if (supplierMatch.status === "MATCHED") suppliersMatched += 1;
      else if (supplierMatch.status === "AMBIGUOUS") suppliersAmbiguous += 1;
      else suppliersUnmatched += 1;

      try {
        await args.prisma.$transaction(async (tx) => {
          const header = prep.mapped.header;
          const existingRow = existingByExternalId.get(prep.externalId);
          const purchaseOrder = await tx.nomusPurchaseOrder.upsert({
            where: { externalId: prep.externalId },
            create: {
              externalId: prep.externalId,
              code: header.code,
              externalCompanyId: header.externalCompanyId,
              companyCode: header.companyCode,
              companyName: header.companyName,
              externalSupplierId: header.externalSupplierId,
              supplierNameSnapshot: header.supplierNameSnapshot,
              supplierDocumentSnapshot: header.supplierDocumentSnapshot,
              financialSupplierId: supplierMatch.financialSupplierId,
              supplierMatchStatus: supplierMatch.status,
              externalBuyerId: header.externalBuyerId,
              buyerNameSnapshot: header.buyerNameSnapshot,
              issueDate: header.issueDate,
              expectedDeliveryDate: header.expectedDeliveryDate,
              paymentConditionId: header.paymentConditionId,
              paymentConditionText: header.paymentConditionText,
              paymentMethodId: header.paymentMethodId,
              paymentMethodText: header.paymentMethodText,
              freightValue: header.freightValue,
              insuranceValue: header.insuranceValue,
              otherExpensesValue: header.otherExpensesValue,
              discountValue: header.discountValue,
              subtotalValue: header.subtotalValue,
              totalValue: header.totalValue,
              nomusStatusCode: header.nomusStatusCode,
              derivedStage: prep.stage.stage as NomusPurchaseOrderDerivedStage,
              rawPayload: prep.mapped.raw as Prisma.InputJsonValue,
              payloadHash: prep.payloadHash,
              sourcePresenceStatus: "PRESENT",
              presentInLastPayload: true,
              firstSeenAt: executedAt,
              lastSeenAt: executedAt,
              lastSyncRunId: runId,
              syncedAt: executedAt,
            },
            update: {
              code: header.code,
              externalCompanyId: header.externalCompanyId,
              companyCode: header.companyCode,
              companyName: header.companyName,
              externalSupplierId: header.externalSupplierId,
              supplierNameSnapshot: header.supplierNameSnapshot,
              supplierDocumentSnapshot: header.supplierDocumentSnapshot,
              financialSupplierId: supplierMatch.financialSupplierId,
              supplierMatchStatus: supplierMatch.status,
              externalBuyerId: header.externalBuyerId,
              buyerNameSnapshot: header.buyerNameSnapshot,
              issueDate: header.issueDate,
              expectedDeliveryDate: header.expectedDeliveryDate,
              paymentConditionId: header.paymentConditionId,
              paymentConditionText: header.paymentConditionText,
              paymentMethodId: header.paymentMethodId,
              paymentMethodText: header.paymentMethodText,
              freightValue: header.freightValue,
              insuranceValue: header.insuranceValue,
              otherExpensesValue: header.otherExpensesValue,
              discountValue: header.discountValue,
              subtotalValue: header.subtotalValue,
              totalValue: header.totalValue,
              nomusStatusCode: header.nomusStatusCode,
              derivedStage: prep.stage.stage as NomusPurchaseOrderDerivedStage,
              rawPayload: prep.mapped.raw as Prisma.InputJsonValue,
              payloadHash: prep.payloadHash,
              sourcePresenceStatus: "PRESENT",
              presentInLastPayload: true,
              lastSeenAt: executedAt,
              lastSyncRunId: runId,
              syncedAt: executedAt,
            },
          });

          for (const [index, item] of prep.mapped.items.entries()) {
            const lineNumber = resolveNomusPurchaseOrderItemLineNumber(item, index);
            const productMatch = matchNomusPurchaseOrderProduct(
              item.externalProductId,
              productIndex
            );
            if (productMatch.status === "MATCHED") productsMatched += 1;
            else productsUnmatched += 1;

            await tx.nomusPurchaseOrderItem.upsert({
              where: {
                purchaseOrderId_lineNumber: {
                  purchaseOrderId: purchaseOrder.id,
                  lineNumber,
                },
              },
              create: {
                purchaseOrderId: purchaseOrder.id,
                externalItemId: item.externalItemId,
                lineNumber,
                externalProductId: item.externalProductId,
                productCodeSnapshot: item.productCodeSnapshot,
                productDescriptionSnapshot: item.productDescriptionSnapshot,
                unitSnapshot: item.unitSnapshot,
                quantityOrdered: item.quantityOrdered,
                quantityAttended: item.quantityAttended,
                quantityPending: item.quantityPending,
                unitPrice: item.unitPrice,
                discountPercent: item.discountPercent,
                discountValue: item.discountValue,
                lineTotal: item.lineTotal,
                expectedDeliveryDate: item.expectedDeliveryDate,
                nomusStatusCode: item.nomusStatusCode,
                nomusStatusName: item.nomusStatusName,
                materialId: productMatch.materialId,
                inventoryItemId: productMatch.inventoryItemId,
                productMatchStatus: productMatch.status,
                rawPayload: item.rawItem as Prisma.InputJsonValue,
                payloadHash: stableNomusPurchaseOrderPayloadHash(item.rawItem),
                syncedAt: executedAt,
              },
              update: {
                externalItemId: item.externalItemId,
                externalProductId: item.externalProductId,
                productCodeSnapshot: item.productCodeSnapshot,
                productDescriptionSnapshot: item.productDescriptionSnapshot,
                unitSnapshot: item.unitSnapshot,
                quantityOrdered: item.quantityOrdered,
                quantityAttended: item.quantityAttended,
                quantityPending: item.quantityPending,
                unitPrice: item.unitPrice,
                discountPercent: item.discountPercent,
                discountValue: item.discountValue,
                lineTotal: item.lineTotal,
                expectedDeliveryDate: item.expectedDeliveryDate,
                nomusStatusCode: item.nomusStatusCode,
                nomusStatusName: item.nomusStatusName,
                materialId: productMatch.materialId,
                inventoryItemId: productMatch.inventoryItemId,
                productMatchStatus: productMatch.status,
                rawPayload: item.rawItem as Prisma.InputJsonValue,
                payloadHash: stableNomusPurchaseOrderPayloadHash(item.rawItem),
                syncedAt: executedAt,
              },
            });
            itemsWritten += 1;
          }
        });

        if (action.action === "CREATE") created += 1;
        else if (action.action === "UPDATE") updated += 1;
        else unchanged += 1;
      } catch (error) {
        errors.push(
          `WRITE_FAILED externalId=${prep.externalId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        // Não interrompe o lote — cada pedido é sua própria unidade atômica.
      }
    }
  } else {
    // preview: métricas via matching em memória, zero writes.
    for (const prep of prepared) {
      const supplierMatch = matchNomusPurchaseOrderSupplier(
        prep.mapped.header.externalSupplierId,
        supplierIndex
      );
      if (supplierMatch.status === "MATCHED") suppliersMatched += 1;
      else if (supplierMatch.status === "AMBIGUOUS") suppliersAmbiguous += 1;
      else suppliersUnmatched += 1;
      for (const item of prep.mapped.items) {
        const productMatch = matchNomusPurchaseOrderProduct(
          item.externalProductId,
          productIndex
        );
        if (productMatch.status === "MATCHED") productsMatched += 1;
        else productsUnmatched += 1;
      }
    }
    created = plan.counters.creates;
    updated = plan.counters.updates;
    unchanged = plan.counters.unchanged;
  }

  return {
    mode: args.mode,
    strategy: args.strategy,
    periodFromSp,
    periodToSp,
    endpoint: "rest/pedidoscompra",
    pagesRead: listResult.pagesRead,
    ordersReadFromList: listResult.rows.length,
    ordersInPeriod: byExternalId.size,
    detailRequests,
    created,
    updated,
    unchanged,
    rejected: 0,
    itemsWritten,
    suppliersMatched,
    suppliersUnmatched,
    suppliersAmbiguous,
    productsMatched,
    productsUnmatched,
    minIssueDate,
    maxIssueDate,
    http429Count: listResult.http429Count,
    retries: 0,
    errors,
    stopReason: listResult.stopReason,
    durationMs: Date.now() - startedAt,
    runId,
  };
}
