/**
 * Fixtures sintéticos de cardinalidade N:N (pedidos × NF-e × títulos × recebimentos).
 * Usados pelos testes de comissões e pela integração com PostgreSQL efêmero. Todos os
 * dados são inventados (nenhum cliente, vendedor ou título real). O incidente da
 * NF-e 7862 é só um cenário de regressão, nunca uma regra.
 */
import { NOMUS_NFE_STATUS_AUTHORIZED } from "@/src/lib/nomusNfeClassification.js";
import {
  buildCommissionReceiptPreview,
  type CommissionReceiptPreviewContext,
  type CommissionReceiptPreviewLine,
  type CommissionReceiptPreviewResult,
  type CommissionReceiptReceivableInput,
  type MaterializedReceivableScheduleInput,
} from "./commissionReceiptEngine.js";
import { buildCommissionReceivableScheduleDrafts } from "./commissionReceivableScheduler.js";
import { indexUniqueOrderBundlesByNfeId } from "./commissionSalesOrderNfeLinkResolution.js";
import type { CommissionLinkedNfeSource, CommissionOrderSourceBundle } from "./commission-types.js";
import type { CommissionSellerIdentityContext } from "./commissionSellerIdentity.js";
import { buildInduscostCoverageRows, type ReceiptEventForCoverage } from "./commissionReceiptCoverage.js";
import type { ReceiptClosingEngineDeps } from "./commissionReceiptClosing.server.js";


export type SellerSpec = { personId: string; nomusId: number; name: string };

export const SELLER_464: SellerSpec = { personId: "person-464", nomusId: 464, name: "VENDEDORA SINTÉTICA 464" };
export const SELLER_470: SellerSpec = { personId: "person-470", nomusId: 470, name: "VENDEDOR SINTÉTICO 470" };

export const IDENTITY: CommissionSellerIdentityContext = {
  persons: [SELLER_464, SELLER_470].map((seller) => ({
    id: seller.personId,
    nomusPersonId: seller.nomusId,
    name: seller.name,
    type: "SELLER",
    source: "NOMUS",
    active: true,
    linkedRecordCount: 1,
  })),
  aliases: [SELLER_464, SELLER_470].map((seller) => ({
    id: `alias-${seller.nomusId}`,
    commissionedPersonId: seller.personId,
    source: "NOMUS_ORDER",
    rawSellerId: seller.nomusId,
    rawSellerName: seller.name,
    normalizedSellerName: seller.name,
    status: "ACTIVE",
    confidence: 1,
  })),
} as unknown as CommissionSellerIdentityContext;

export const CUSTOMER_EXTERNAL_ID = 500;
export const CUSTOMER_NAME = "CLIENTE DO INCIDENTE";

export type OrderSpec = {
  id: string;
  code: string;
  nomusOrderId: number;
  seller: SellerSpec;
  /** Comissão final do snapshot (pedido inteiro, como o materializador grava hoje). */
  commission: number;
  /** Valor vendido do pedido (Σ itemNetAmount). */
  sold: number;
  /** Status dos itens do snapshot (default COMMISSIONABLE). */
  itemStatuses?: string[];
};

export type TitleSpec = { id: number; nominal: number; due: string };
export type NfeSpec = { id: number; number: string; titles: TitleSpec[]; cancelled?: boolean };

export type ScenarioSpec = {
  orders: OrderSpec[];
  nfes: NfeSpec[];
  /** (pedido, NF) faturados — gera snapshot + schedules. */
  links: Array<{ orderId: string; nfeId: number; withSchedule?: boolean }>;
};

export type VigentSnapshotFact = {
  snapshotId: string;
  nfeId: number | null;
  totalSoldAmount: number;
  totalFinalCommissionAmount: number;
  itemStatuses: string[];
  items: Array<{ salesOrderItemId: string; soldAmount: number }>;
};

export type World = {
  bundles: CommissionOrderSourceBundle[];
  bundlesByNfe: Map<number, CommissionOrderSourceBundle[]>;
  schedulesByReceivable: Map<number, MaterializedReceivableScheduleInput[]>;
  vigentSnapshotsByOrder: Map<string, VigentSnapshotFact[]>;
  titles: Map<number, { title: TitleSpec; nfe: NfeSpec; installment: number }>;
  orders: Map<string, OrderSpec>;
};

export function linkedNfe(spec: NfeSpec): CommissionLinkedNfeSource {
  const value = spec.titles.reduce((sum, title) => sum + title.nominal, 0);
  return {
    nfeExternalId: spec.id,
    nfeNumber: spec.number,
    nfeStatus: spec.cancelled ? 7 : NOMUS_NFE_STATUS_AUTHORIZED,
    tipoOperacao: 1,
    dataProcessamento: new Date("2026-10-01T12:00:00.000Z"),
    nfeValue: Math.round(value * 100) / 100,
    isAuthorized: !spec.cancelled,
    isCancelled: spec.cancelled === true,
    isOutputOperation: true,
    nomusNfeLocalId: `nfe-local-${spec.id}`,
  };
}

export function itemIdOf(order: OrderSpec): string {
  return `${order.id}-item-1`;
}

export function orderBundle(order: OrderSpec, nfes: NfeSpec[]): CommissionOrderSourceBundle {
  const linked = nfes.map(linkedNfe);
  return {
    localOrderId: order.id,
    nomusOrderId: order.nomusOrderId,
    orderCode: order.code,
    issueDate: new Date("2026-09-15T12:00:00.000Z"),
    status: "CONFIRMED",
    paymentTerms: null,
    paymentMethod: null,
    companyExternalId: 1,
    customerExternalId: CUSTOMER_EXTERNAL_ID,
    customerName: CUSTOMER_NAME,
    seller: { nomusSellerId: order.seller.nomusId, responsibleName: order.seller.name },
    representative: { nomusRepresentativeId: null, name: null },
    items: [
      {
        localItemId: itemIdOf(order),
        localProductId: `prod-${order.id}`,
        nomusOrderItemId: null,
        nomusProductId: null,
        productCode: `P-${order.code}`,
        productName: `Produto ${order.code}`,
        quantity: 1,
        unitPrice: order.sold,
        discount: 0,
        surcharge: 0,
        itemNetAmount: order.sold,
      },
    ],
    forecastInstallments: [],
    linkedNfes: linked,
    authorizedOutputNfes: linked.filter((nfe) => nfe.isAuthorized && !nfe.isCancelled),
    outputDocumentsByNfeId: new Map(),
    receivablesByNfeId: new Map(),
  } as CommissionOrderSourceBundle;
}

export function buildWorld(spec: ScenarioSpec): World {
  const orders = new Map(spec.orders.map((order) => [order.id, order]));
  const nfes = new Map(spec.nfes.map((nfe) => [nfe.id, nfe]));
  const titles = new Map<number, { title: TitleSpec; nfe: NfeSpec; installment: number }>();
  for (const nfe of spec.nfes) {
    nfe.titles.forEach((title, index) => titles.set(title.id, { title, nfe, installment: index + 1 }));
  }

  const nfesByOrder = new Map<string, NfeSpec[]>();
  for (const link of spec.links) {
    const list = nfesByOrder.get(link.orderId) ?? [];
    list.push(nfes.get(link.nfeId)!);
    nfesByOrder.set(link.orderId, list);
  }
  const bundles = spec.orders.map((order) => orderBundle(order, nfesByOrder.get(order.id) ?? []));
  const bundleById = new Map(bundles.map((bundle) => [bundle.localOrderId, bundle]));
  const bundlesByNfe = new Map<number, CommissionOrderSourceBundle[]>();
  for (const nfe of spec.nfes) bundlesByNfe.set(nfe.id, []);
  for (const link of spec.links) bundlesByNfe.get(link.nfeId)!.push(bundleById.get(link.orderId)!);

  const schedulesByReceivable = new Map<number, MaterializedReceivableScheduleInput[]>();
  const vigentSnapshotsByOrder = new Map<string, VigentSnapshotFact[]>();
  for (const link of spec.links) {
    if (link.withSchedule === false) continue;
    const order = orders.get(link.orderId)!;
    const nfe = nfes.get(link.nfeId)!;
    const snapshotId = `snap-${order.id}-${nfe.id}`;
    const itemStatuses = order.itemStatuses ?? ["COMMISSIONABLE"];
    const facts = vigentSnapshotsByOrder.get(order.id) ?? [];
    facts.push({
      snapshotId,
      nfeId: nfe.id,
      totalSoldAmount: order.sold,
      totalFinalCommissionAmount: order.commission,
      itemStatuses,
      items: [{ salesOrderItemId: itemIdOf(order), soldAmount: order.sold }],
    });
    vigentSnapshotsByOrder.set(order.id, facts);
    const drafts = buildCommissionReceivableScheduleDrafts({
      snapshot: {
        id: snapshotId,
        sourceHash: `hash-${snapshotId}`,
        salesOrderId: order.id,
        nfeId: nfe.id,
        customerId: "cust-1",
        canonicalSellerId: order.seller.personId,
        totalFinalCommissionAmount: order.commission,
        itemStatuses,
      },
      receivables: nfe.titles.map((title, index) => ({
        receivableId: title.id,
        receivableCode: nfe.number,
        installmentNumber: index + 1,
        receivableNominalAmount: title.nominal,
      })),
    });
    for (const draft of drafts) {
      const list = schedulesByReceivable.get(draft.receivableId) ?? [];
      // O loader entrega o mais recente primeiro.
      list.unshift({
        id: `sch-${order.code}-${draft.receivableId}`,
        orderSnapshotId: snapshotId,
        receivableId: draft.receivableId,
        receivableCode: draft.receivableCode,
        installmentNumber: draft.installmentNumber,
        nfeId: draft.nfeId,
        salesOrderId: order.id,
        customerId: "cust-1",
        canonicalSellerId: order.seller.personId,
        canonicalSellerName: order.seller.name,
        rawSellerId: order.seller.nomusId,
        rawSellerName: order.seller.name,
        orderCode: order.code,
        receivableNominalAmount: draft.receivableNominalAmount,
        receivableSharePercent: draft.receivableSharePercent,
        scheduledCommissionAmount: draft.scheduledCommissionAmount,
        scheduleStatus: draft.status,
        sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
        exclusionRuleId: null,
        exclusionReason: null,
        itemSnapshotStatuses: itemStatuses,
        orderSnapshotFinalCommissionAmount: order.commission,
        orderSnapshotStatus: "ACTIVE",
        orderSnapshotSoldAmount: order.sold,
        nomusOrderId: order.nomusOrderId,
      } as MaterializedReceivableScheduleInput);
      schedulesByReceivable.set(draft.receivableId, list);
    }
  }

  return { bundles, bundlesByNfe, schedulesByReceivable, vigentSnapshotsByOrder, titles, orders };
}

export type ReceiptSpec = { id: number; date: string; amount: number };

export function receivedTitle(
  world: World,
  titleId: number,
  receipts: ReceiptSpec[],
  priorReceivedAmount = 0
): CommissionReceiptReceivableInput {
  const entry = world.titles.get(titleId)!;
  const period = Math.round(receipts.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
  const dates = receipts.map((row) => row.date).sort();
  const last = new Date(`${dates.at(-1)}T00:00:00.000Z`);
  const first = new Date(`${dates[0]}T00:00:00.000Z`);
  const cumulative = Math.round((priorReceivedAmount + period) * 100) / 100;
  return {
    nomusReceivableId: titleId,
    receivableNumber: entry.nfe.number,
    installmentNumber: entry.installment,
    settlementDate: last,
    receiptCompetence: {
      receivableExternalId: titleId,
      receiptDate: last,
      firstReceiptDate: first,
      receiptIds: receipts.map((row) => row.id).sort((a, b) => a - b),
      periodReceivedAmount: period,
      priorReceivedAmount,
      cumulativeReceivedAmount: cumulative,
    },
    dueDate: new Date(`${entry.title.due}T00:00:00.000Z`),
    amountReceivable: entry.title.nominal,
    amountReceived: cumulative,
    balanceReceivable: Math.max(0, Math.round((entry.title.nominal - cumulative) * 100) / 100),
    nomusNfeId: entry.nfe.id,
    nfeNumber: entry.nfe.number,
    customerExternalId: CUSTOMER_EXTERNAL_ID,
    customerId: null,
    customerName: CUSTOMER_NAME,
    customerCnpj: "00000000000100",
  };
}

export function previewContext(
  world: World,
  receivables: CommissionReceiptReceivableInput[],
  period: { year: number; month: number },
  overrides: Partial<CommissionReceiptPreviewContext> & Record<string, unknown> = {}
): CommissionReceiptPreviewContext {
  const nfeIds = [...new Set(receivables.map((row) => row.nomusNfeId).filter((id): id is number => id != null))];
  const inScope = world.bundles.filter((bundle) =>
    bundle.linkedNfes.some((nfe) => nfeIds.includes(nfe.nfeExternalId))
  );
  const { byNfeId, ambiguousNfeIds } = indexUniqueOrderBundlesByNfeId(inScope);
  return {
    year: period.year,
    month: period.month,
    includeExcluded: true,
    includeExceptions: true,
    receivables,
    ordersByNfeId: byNfeId,
    ambiguousNfeIds,
    orderBundlesByNfeId: new Map(nfeIds.map((id) => [id, world.bundlesByNfe.get(id) ?? []])),
    vigentOrderSnapshotsBySalesOrderId: world.vigentSnapshotsByOrder,
    materializedSchedulesByReceivableId: new Map(
      receivables.map((row) => [row.nomusReceivableId, world.schedulesByReceivable.get(row.nomusReceivableId) ?? []])
    ),
    rules: [],
    exclusionRules: [],
    identityCtx: IDENTITY,
    ...overrides,
  } as CommissionReceiptPreviewContext;
}

export const round2 = (value: number) => Math.round(value * 100) / 100;
export const sum = (values: number[]) => round2(values.reduce((acc, value) => acc + value, 0));

export function linesOf(preview: CommissionReceiptPreviewResult, receivableId: number): CommissionReceiptPreviewLine[] {
  return preview.lines.filter((line) => line.nomusReceivableId === receivableId);
}

export function attributedReceived(line: CommissionReceiptPreviewLine): number {
  const value = (line as { attributedReceivedAmount?: number }).attributedReceivedAmount;
  return value ?? line.receivedAmount;
}

export function coverageFor(preview: CommissionReceiptPreviewResult, events: Map<number, ReceiptEventForCoverage>) {
  return buildInduscostCoverageRows({
    closingId: "closing-test",
    closing: { year: preview.year, month: preview.month },
    userId: "tester",
    ledgerRows: preview.lines.map((line, index) => ({
      id: `ledger-${index}`,
      nomusReceivableId: line.nomusReceivableId,
      receiptExternalIds: line.receiptIds ?? [],
      status: line.status,
      releasedCommissionAmount: line.releasedCommissionAmount,
      inclusionType: "NORMAL" as const,
      // Mesmo mapeamento do ledger: pedido do direito e parcela atribuída.
      salesOrderId: line.localOrderId ?? null,
      commissionReceivableScheduleId: line.commissionReceivableScheduleId ?? null,
      allocatedReceivedAmount: line.financialAnchorShared ? attributedReceived(line) : line.receivedAmount,
      receivedAmount: line.receivedAmount,
    })),
    receiptEvents: events,
  });
}

export function eventsFrom(receivables: CommissionReceiptReceivableInput[], receipts: Map<number, ReceiptSpec[]>) {
  const map = new Map<number, ReceiptEventForCoverage>();
  for (const receivable of receivables) {
    for (const receipt of receipts.get(receivable.nomusReceivableId) ?? []) {
      map.set(receipt.id, {
        receivableExternalId: receivable.nomusReceivableId,
        receiptDate: receipt.date,
        receivedAmount: receipt.amount,
      });
    }
  }
  return map;
}

/** Gerador determinístico (mulberry32) — sem dependência nova. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [out[index], out[swap]] = [out[swap]!, out[index]!];
  }
  return out;
}

/*  Incidente NF-e 7862                                                */

export const INCIDENT: ScenarioSpec = {
  orders: [
    { id: "so-2934", code: "02933", nomusOrderId: 2934, seller: SELLER_464, commission: 91.24, sold: 3045.9 },
    { id: "so-2998", code: "02997", nomusOrderId: 2998, seller: SELLER_464, commission: 323.57, sold: 10395 },
  ],
  nfes: [
    {
      id: 8204,
      number: "7862",
      titles: [
        { id: 19809, nominal: 4435.5, due: "2026-10-18" },
        { id: 19810, nominal: 4435.5, due: "2026-11-02" },
        { id: 19811, nominal: 4569.9, due: "2026-11-17" },
      ],
    },
  ],
  links: [
    { orderId: "so-2934", nfeId: 8204 },
    { orderId: "so-2998", nfeId: 8204 },
  ],
};

export const INCIDENT_RECEIPT: ReceiptSpec = { id: 12130, date: "2026-10-20", amount: 4435.5 };

export function incidentPreview(overrides: Record<string, unknown> = {}) {
  const world = buildWorld(INCIDENT);
  const receivable = receivedTitle(world, 19809, [INCIDENT_RECEIPT]);
  const preview = buildCommissionReceiptPreview(
    previewContext(world, [receivable], { year: 2026, month: 10 }, overrides)
  );
  return { world, receivable, preview };
}

export function multiOrderScenario(count: number, seed: number): ScenarioSpec {
  const random = seededRandom(seed);
  const orders: OrderSpec[] = Array.from({ length: count }, (_, index) => ({
    id: `so-${seed}-${index}`,
    code: `PD${String(index).padStart(4, "0")}`,
    nomusOrderId: 10000 + index,
    seller: index % 3 === 0 ? SELLER_470 : SELLER_464,
    commission: round2(1 + random() * 499),
    sold: round2(100 + random() * 19900),
  }));
  const total = sum(orders.map((order) => order.sold));
  const first = round2(total * 0.4);
  const second = round2(total * 0.3);
  return {
    orders,
    nfes: [
      {
        id: 70000 + seed,
        number: String(70000 + seed),
        titles: [
          { id: 800000 + seed * 10 + 1, nominal: first, due: "2026-10-10" },
          { id: 800000 + seed * 10 + 2, nominal: second, due: "2026-11-10" },
          { id: 800000 + seed * 10 + 3, nominal: round2(total - first - second), due: "2026-12-10" },
        ],
      },
    ],
    links: orders.map((order) => ({ orderId: order.id, nfeId: 70000 + seed })),
  };
}

export const TWO_SELLERS: ScenarioSpec = {
  orders: [
    { id: "so-g", code: "03001", nomusOrderId: 3001, seller: SELLER_464, commission: 90, sold: 3000 },
    { id: "so-r", code: "03002", nomusOrderId: 3002, seller: SELLER_470, commission: 50, sold: 1000 },
  ],
  nfes: [{ id: 9300, number: "9300", titles: [{ id: 93001, nominal: 4000, due: "2026-10-10" }] }],
  links: [
    { orderId: "so-g", nfeId: 9300 },
    { orderId: "so-r", nfeId: 9300 },
  ],
};

export function splitOrderScenario(nfeCount: number): ScenarioSpec {
  const order: OrderSpec = { id: "so-split", code: "04001", nomusOrderId: 4001, seller: SELLER_464, commission: 100, sold: 1000 };
  const nfes: NfeSpec[] = Array.from({ length: nfeCount }, (_, index) => ({
    id: 9200 + index,
    number: String(9200 + index),
    titles: [{ id: 92000 + index, nominal: round2(1000 / nfeCount), due: "2026-10-10" }],
  }));
  return { orders: [order], nfes, links: nfes.map((nfe) => ({ orderId: order.id, nfeId: nfe.id })) };
}

export type Row = Record<string, unknown>;

export function createClosingDb() {
  let closings: Row[] = [];
  let ledger: Row[] = [];
  let coverage: Row[] = [];
  const unique = (target: string) => Object.assign(new Error(`Unique constraint ${target}`), { code: "P2002", meta: { target: [target] } });
  const db = {
    commissionMonthlyClosing: {
      findFirst: async ({ where }: { where: Row }) =>
        closings.find(
          (row) =>
            row.year === where.year &&
            row.month === where.month &&
            (where.status == null || row.status === where.status) &&
            (where.source == null || row.source === where.source)
        ) ?? null,
      create: async ({ data }: { data: Row }) => {
        const row = { id: `closing-${closings.length + 1}`, ...data };
        closings.push(row);
        return row;
      },
    },
    commissionReceiptLedgerLine: {
      createMany: async ({ data }: { data: Row[] }) => {
        for (const row of data) {
          if (ledger.some((line) => line.ledgerLineKey === row.ledgerLineKey)) throw unique("ledgerLineKey");
          ledger.push({ ...row });
        }
        return { count: data.length };
      },
      findMany: async ({ where }: { where?: { receiptExternalIds?: { hasSome?: number[] } } } = {}) => {
        const wanted = where?.receiptExternalIds?.hasSome ?? [];
        return ledger.filter(
          (line) =>
            (line.receiptExternalIds as number[]).some((id) => wanted.includes(id)) &&
            closings.find((row) => row.id === line.closingId)?.status === "CLOSED"
        );
      },
    },
    commissionReceiptCoverage: {
      findMany: async ({ where }: { where?: { receiptExternalId?: { in?: number[] } } } = {}) =>
        coverage.filter(
          (row) => row.coverageStatus === "COVERED" && (where?.receiptExternalId?.in ?? []).includes(row.receiptExternalId as number)
        ),
      // Mesma regra das migrations 20261030120000: um COVERED por evento (pedido nulo)
      // OU um por (evento, pedido), nunca evento e direito juntos.
      createMany: async ({ data }: { data: Row[] }) => {
        for (const row of data) {
          const clash = coverage.some(
            (other) =>
              other.coverageStatus === "COVERED" &&
              other.receiptExternalId === row.receiptExternalId &&
              ((other.salesOrderId ?? null) === null ||
                (row.salesOrderId ?? null) === null ||
                other.salesOrderId === row.salesOrderId)
          );
          if (clash) throw unique("receiptExternalId");
          coverage.push({ ...row });
        }
        return { count: data.length };
      },
    },
    commissionRule: { findMany: async () => [] },
    commissionCustomerExclusionRule: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id })),
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const snapshot = { closings: closings.map((row) => ({ ...row })), ledger: ledger.map((row) => ({ ...row })), coverage: coverage.map((row) => ({ ...row })) };
      try {
        return await fn(db);
      } catch (error) {
        closings = snapshot.closings;
        ledger = snapshot.ledger;
        coverage = snapshot.coverage;
        throw error;
      }
    },
  };
  return {
    db,
    get closings() {
      return closings;
    },
    get ledger() {
      return ledger;
    },
    get coverage() {
      return coverage;
    },
  };
}

export function closingDeps(context: CommissionReceiptPreviewContext, events: Map<number, ReceiptEventForCoverage>): ReceiptClosingEngineDeps {
  return {
    loadPreview: async () => buildCommissionReceiptPreview(context),
    loadCarryovers: async () => null,
    loadCoveredReceiptIds: async () => [],
    loadReceiptEvents: async (_db, ids) => new Map(ids.filter((id) => events.has(id)).map((id) => [id, events.get(id)!])),
  };
}
