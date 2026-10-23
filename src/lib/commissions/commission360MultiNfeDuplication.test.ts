/**
 * Revisão financeira R1 — PV faturado em mais de uma NF-e.
 *
 * Reproduz, SÓ com funções oficiais do motor (nenhuma alterada), o caminho completo:
 * cálculo do pedido → snapshot por NF-e → persistência → schedule por NF-e →
 * liberação no fechamento → previsão. Documenta se a comissão do pedido é contada
 * mais de uma vez e se alguma etapa posterior neutraliza isso.
 *
 * Cenário: PV de 1.000 un × R$ 12 (faixa Varejo 1 = 2%) → comissão do pedido R$ 240.
 * NF-e A fatura 400 un (CR de R$ 4.800); NF-e B fatura 600 un (CR de R$ 7.200).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommercialPriceTierRow } from "./commission-commercial-tier.js";
import type { CommissionActiveRule, CommissionLinkedNfeSource, CommissionOrderSourceBundle } from "./commission-types.js";
import {
  calculateCommissionForSalesOrderItems,
  type CommissionOrderCalculationContext,
} from "./commissionOrderCalculation.js";
import { buildCommissionOrderSnapshotDraft } from "./commissionOrderMaterializer.js";
import { persistCommissionOrderMaterialization } from "./commissionOrderMaterializer.server.js";
import { resolveOrderCommissionSeller } from "./commissionNomusOrderSellerResolver.js";
import { buildCommissionReceivableScheduleDrafts } from "./commissionReceivableScheduler.js";
import {
  pickMaterializedScheduleForReceivable,
  releaseCommissionFromMaterializedSchedule,
  type MaterializedReceivableScheduleInput,
} from "./commissionReceiptEngine.js";
import { projectCommissionPortfolioOutlookLines, type OutlookScheduleInput } from "./commissionPortfolioOutlook.js";
import {
  buildCommission360Diagnostic,
  buildCommission360Potential,
  buildCommission360View,
  classifyCommission360Receivable,
  parseCommission360Query,
} from "./commission360View.js";

const SELLER_PERSON_ID = "550e8400-e29b-41d4-a716-446655440001";
const CUSTOMER_ID = "aa0e8400-e29b-41d4-a716-446655440010";
const PRODUCT_ID = "660e8400-e29b-41d4-a716-446655440002";
const ITEM_ID = "770e8400-e29b-41d4-a716-446655440003";
const ORDER_ID = "880e8400-e29b-41d4-a716-446655440004";
const NFE_A = 7001;
const NFE_B = 7002;

function nfe(id: number, value: number): CommissionLinkedNfeSource {
  return {
    nfeExternalId: id,
    nfeNumber: String(id),
    nfeStatus: 100,
    tipoOperacao: 1,
    dataProcessamento: new Date("2026-07-01T00:00:00.000Z"),
    nfeValue: value,
    isAuthorized: true,
    isCancelled: false,
    isOutputOperation: true,
    nomusNfeLocalId: null,
  };
}

function bundle(nfes: CommissionLinkedNfeSource[]): CommissionOrderSourceBundle {
  return {
    localOrderId: ORDER_ID,
    nomusOrderId: 1001,
    orderCode: "PV-1001",
    issueDate: new Date("2026-06-15T00:00:00.000Z"),
    status: "ACTIVE",
    paymentTerms: null,
    paymentMethod: null,
    companyExternalId: 1,
    customerExternalId: 200,
    customerName: "Cliente Teste",
    seller: { nomusSellerId: 42, responsibleName: "Vendedor Teste" },
    representative: { nomusRepresentativeId: null, name: null },
    items: [
      {
        localItemId: ITEM_ID,
        localProductId: PRODUCT_ID,
        nomusOrderItemId: 501,
        nomusProductId: 901,
        productCode: "610.01AA",
        productName: "Produto Teste",
        quantity: 1000,
        unitPrice: 12,
        discount: 0,
        surcharge: 0,
        itemNetAmount: 12000,
      },
    ],
    forecastInstallments: [],
    linkedNfes: nfes,
    authorizedOutputNfes: nfes,
    outputDocumentsByNfeId: new Map(),
    receivablesByNfeId: new Map(),
  } as CommissionOrderSourceBundle;
}

function context(): CommissionOrderCalculationContext {
  const tiers: CommercialPriceTierRow[] = [
    { code: "ATACADO", name: "Atacado", salePrice: 10, commissionPercent: 1 },
    { code: "VAREJO_1", name: "Varejo 1", salePrice: 12, commissionPercent: 2 },
    { code: "VAREJO_2", name: "Varejo 2", salePrice: 14, commissionPercent: 3 },
    { code: "VAREJO_3", name: "Varejo 3", salePrice: 16, commissionPercent: 4 },
  ];
  const rule: CommissionActiveRule = {
    id: "990e8400-e29b-41d4-a716-446655440005",
    name: "Regra vendedor padrão",
    active: true,
    priority: 1,
    beneficiaryType: "SELLER",
    calculationType: "COMMERCIAL_PRICE_TIER",
    fixedCommissionPersonId: null,
    ratePercent: 0,
    baseType: "SALES_ORDER_ITEM_NET",
    releaseRule: "EACH_RECEIVABLE_PAID",
    validFrom: null,
    validTo: null,
    conditions: [],
  } as CommissionActiveRule;
  return {
    rules: [rule],
    exclusionRules: [],
    sellerIdentity: {
      persons: [
        { id: SELLER_PERSON_ID, nomusPersonId: 42, name: "Vendedor Teste", type: "SELLER", source: "NOMUS", active: true },
      ],
      aliases: [],
    },
    commercialTiersByProductId: new Map([[PRODUCT_ID, tiers]]),
    unitProductionCostByProductId: new Map([[PRODUCT_ID, 4]]),
  } as CommissionOrderCalculationContext;
}

/** O que o orquestrador faz para cada NF-e vinculada (processSalesOrderMaterialization). */
function draftFor(order: CommissionOrderSourceBundle, nfeId: number | null) {
  const ctx = context();
  // O cálculo do pedido NÃO recebe a NF-e: o resultado é o mesmo para qualquer NF-e.
  const lines = calculateCommissionForSalesOrderItems({ orders: [order], context: ctx });
  const { identity } = resolveOrderCommissionSeller({
    externalSellerId: order.seller.nomusSellerId,
    issueDate: order.issueDate,
    nomusSellerName: order.seller.responsibleName,
    aliasSource: "NOMUS_ORDER",
    identityCtx: ctx.sellerIdentity,
  });
  return buildCommissionOrderSnapshotDraft({
    order,
    customerId: CUSTOMER_ID,
    customerNameSnapshot: order.customerName,
    lines,
    sellerResolution: identity,
    nfeId,
  });
}

/** Banco simulado do materializador: identidade do snapshot vigente = (pedido, NF-e). */
function materializerDb() {
  const rows: Array<{ id: string; salesOrderId: string; nfeId: number | null; status: string; total: unknown }> = [];
  const tx = {
    commissionOrderSnapshot: {
      updateMany: async ({ where, data }: { where: { salesOrderId: string; nfeId: number | null; status: string }; data: { status: string } }) => {
        for (const row of rows) {
          if (row.salesOrderId === where.salesOrderId && row.nfeId === where.nfeId && row.status === where.status) row.status = data.status;
        }
        return { count: 0 };
      },
      findUnique: async () => null,
      create: async ({ data }: { data: { salesOrder: { connect: { id: string } }; nfeId: number | null; totalFinalCommissionAmount: unknown } }) => {
        const id = `snap-${rows.length + 1}`;
        rows.push({ id, salesOrderId: data.salesOrder.connect.id, nfeId: data.nfeId, status: "ACTIVE", total: data.totalFinalCommissionAmount });
        return { id };
      },
    },
  };
  const db = { $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx) };
  const activeFor = (nfeId: number | null) => rows.find((row) => row.nfeId === nfeId && row.status === "ACTIVE") ?? null;
  return { db, rows, activeFor };
}

function schedulesFor(draft: ReturnType<typeof draftFor>, snapshotId: string, receivable: { id: number; nominal: number }) {
  return buildCommissionReceivableScheduleDrafts({
    snapshot: {
      id: snapshotId,
      sourceHash: draft.sourceHash,
      salesOrderId: draft.salesOrderId,
      nfeId: draft.nfeId,
      customerId: CUSTOMER_ID,
      canonicalSellerId: SELLER_PERSON_ID,
      totalFinalCommissionAmount: draft.totalFinalCommissionAmount,
      itemStatuses: draft.items.map((item) => item.status),
    },
    receivables: [{ receivableId: receivable.id, receivableCode: String(draft.nfeId), installmentNumber: 1, receivableNominalAmount: receivable.nominal }],
  });
}

function materialized(scheduleDraft: ReturnType<typeof schedulesFor>[number], snapshotStatus = "ACTIVE"): MaterializedReceivableScheduleInput {
  return {
    id: `sch-${scheduleDraft.receivableId}`,
    orderSnapshotId: scheduleDraft.orderSnapshotId,
    receivableId: scheduleDraft.receivableId,
    receivableCode: scheduleDraft.receivableCode,
    installmentNumber: scheduleDraft.installmentNumber,
    nfeId: scheduleDraft.nfeId,
    salesOrderId: scheduleDraft.salesOrderId,
    customerId: scheduleDraft.customerId,
    canonicalSellerId: scheduleDraft.canonicalSellerId,
    canonicalSellerName: "Vendedor Teste",
    rawSellerId: 42,
    rawSellerName: "Vendedor Teste",
    orderCode: "PV-1001",
    receivableNominalAmount: scheduleDraft.receivableNominalAmount,
    receivableSharePercent: scheduleDraft.receivableSharePercent,
    scheduledCommissionAmount: scheduleDraft.scheduledCommissionAmount,
    scheduleStatus: scheduleDraft.status,
    sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
    exclusionRuleId: null,
    exclusionReason: null,
    orderSnapshotStatus: snapshotStatus,
  };
}

function releaseInMonth(schedule: MaterializedReceivableScheduleInput, received: number) {
  return releaseCommissionFromMaterializedSchedule({
    schedule,
    receivable: {
      nomusReceivableId: schedule.receivableId,
      settlementDate: null,
      amountReceivable: schedule.receivableNominalAmount,
      amountReceived: received,
      receiptCompetence: {
        receivableExternalId: schedule.receivableId,
        receiptDate: new Date("2026-10-10T00:00:00.000Z"),
        firstReceiptDate: new Date("2026-10-10T00:00:00.000Z"),
        receiptIds: [schedule.receivableId * 10],
        periodReceivedAmount: received,
        priorReceivedAmount: 0,
        cumulativeReceivedAmount: received,
      },
    },
  }).expectedCommissionAmount;
}

function outlookFact(scheduleDraft: ReturnType<typeof schedulesFor>[number], balance: number): OutlookScheduleInput {
  return {
    scheduleId: `sch-${scheduleDraft.receivableId}`,
    scheduleStatus: "ACTIVE",
    orderSnapshotStatus: "ACTIVE",
    scheduleCreatedAt: "2026-07-01T00:00:00.000Z",
    salesOrderId: scheduleDraft.salesOrderId,
    orderCode: "PV-1001",
    customerId: CUSTOMER_ID,
    customerName: "Cliente Teste",
    canonicalSellerId: SELLER_PERSON_ID,
    canonicalSellerName: "Vendedor Teste",
    rawSellerId: 42,
    sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
    nfeNumber: String(scheduleDraft.nfeId),
    receivableId: scheduleDraft.receivableId,
    receivableCode: scheduleDraft.receivableCode,
    installmentNumber: 1,
    dueDate: "2026-11-20",
    nominalAmount: scheduleDraft.receivableNominalAmount,
    allocatedCommission: scheduleDraft.scheduledCommissionAmount,
    sharePercent: scheduleDraft.receivableSharePercent,
    balanceReceivable: balance,
    amountReceivedOnTitle: 0,
    paidToSellerAmount: 0,
    receipts: [],
  };
}

describe("R1 — PV com duas NF-e: a comissão do pedido é contada duas vezes", () => {
  const order = bundle([nfe(NFE_A, 4800), nfe(NFE_B, 7200)]);
  const draftA = draftFor(order, NFE_A);
  const draftB = draftFor(order, NFE_B);

  it("1. cada snapshot por NF-e carrega a comissão INTEIRA do pedido (valor integral do item)", () => {
    assert.equal(draftA.nfeId, NFE_A);
    assert.equal(draftB.nfeId, NFE_B);
    assert.equal(draftA.totalSoldAmount, 12000);
    assert.equal(draftB.totalSoldAmount, 12000);
    assert.equal(draftA.totalFinalCommissionAmount, 240);
    assert.equal(draftB.totalFinalCommissionAmount, 240);
    assert.equal(draftA.items[0]!.soldAmount, 12000, "soldAmount = valor do item no PV, não a quantidade da NF-e");
    assert.notEqual(draftA.sourceHash, draftB.sourceHash);
  });

  it("2. a persistência mantém os dois snapshots ACTIVE (identidade = pedido + NF-e)", async () => {
    const store = materializerDb();
    await persistCommissionOrderMaterialization(store.db as never, { draft: draftA, existingActive: null, dryRun: false });
    await persistCommissionOrderMaterialization(store.db as never, {
      draft: draftB,
      existingActive: store.activeFor(NFE_B) ? { id: store.activeFor(NFE_B)!.id, sourceHash: "x" } : null,
      dryRun: false,
    });
    assert.deepEqual(
      store.rows.map((row) => [row.nfeId, row.status]),
      [
        [NFE_A, "ACTIVE"],
        [NFE_B, "ACTIVE"],
      ]
    );
  });

  it("3. o scheduler rateia cada snapshot só entre os CRs da sua NF-e: R$ 480 alocados para R$ 240 de comissão", () => {
    const [scheduleA] = schedulesFor(draftA, "snap-1", { id: 9001, nominal: 4800 });
    const [scheduleB] = schedulesFor(draftB, "snap-2", { id: 9002, nominal: 7200 });
    assert.equal(scheduleA!.scheduledCommissionAmount, 240);
    assert.equal(scheduleB!.scheduledCommissionAmount, 240);
    assert.equal(scheduleA!.scheduledCommissionAmount + scheduleB!.scheduledCommissionAmount, 480);
  });

  it("4. NÃO é neutralizada no fechamento: a liberação usa o schedule de cada título (R$ 480 liberados)", () => {
    const [scheduleA] = schedulesFor(draftA, "snap-1", { id: 9001, nominal: 4800 });
    const [scheduleB] = schedulesFor(draftB, "snap-2", { id: 9002, nominal: 7200 });
    const a = materialized(scheduleA!);
    const b = materialized(scheduleB!);
    // Cada título tem um único schedule vigente: a escolha por título não deduplica entre NF-e.
    assert.equal(pickMaterializedScheduleForReceivable([a]), a);
    assert.equal(pickMaterializedScheduleForReceivable([b]), b);
    const released = releaseInMonth(a, 4800) + releaseInMonth(b, 7200);
    assert.equal(released, 480, "fechamento libera o dobro da comissão do pedido");
  });

  it("5. NÃO é neutralizada na Previsão: as duas parcelas aparecem como comissão futura (R$ 480)", () => {
    const [scheduleA] = schedulesFor(draftA, "snap-1", { id: 9001, nominal: 4800 });
    const [scheduleB] = schedulesFor(draftB, "snap-2", { id: 9002, nominal: 7200 });
    const lines = projectCommissionPortfolioOutlookLines([outlookFact(scheduleA!, 4800), outlookFact(scheduleB!, 7200)], "2026-10-22");
    assert.equal(lines.reduce((sum, line) => sum + line.forecastCommission, 0), 480);
  });

  it("6. faturamento parcial (só a NF-e A): 100% da comissão vai para o CR de 40% das mercadorias", () => {
    const partial = draftFor(bundle([nfe(NFE_A, 4800)]), NFE_A);
    const [schedule] = schedulesFor(partial, "snap-1", { id: 9001, nominal: 4800 });
    assert.equal(schedule!.scheduledCommissionAmount, 240);
    assert.equal(releaseInMonth(materialized(schedule!), 4800), 240, "a comissão inteira é liberada ao receber 40% do pedido");
  });

  it("7. a Visão 360° não soma a comissão do pedido duas vezes e expõe o excesso do motor", () => {
    const [scheduleA] = schedulesFor(draftA, "snap-1", { id: 9001, nominal: 4800 });
    // Pedido 40% faturado: só a NF-e A existe; o CR carrega 100% da comissão.
    const [row] = buildCommission360Potential([
      {
        salesOrderId: ORDER_ID,
        orderCode: "PV-1001",
        orderStatus: "SENT_TO_NOMUS",
        saleDate: "2026-06-15",
        customerName: "Cliente Teste",
        canonicalSellerId: SELLER_PERSON_ID,
        sellerName: "Vendedor Teste",
        rawSellerId: 42,
        sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
        customerExcludedByActiveRule: false,
        hasActiveSnapshot: true,
        scheduledCommissionAmount: scheduleA!.scheduledCommissionAmount,
        items: [
          {
            salesOrderItemId: ITEM_ID,
            productName: "Produto Teste",
            snapshotFinalCommissions: [240],
            snapshotItemStatuses: ["COMMISSIONABLE"],
            flow: { orderedQuantity: 1000, shipTargetQuantity: 1000, invoicedQuantity: 400 },
          },
        ],
      },
    ]);
    // Pela quantidade, 144 estariam pendentes; mas os schedules já alocaram os 240 inteiros.
    assert.equal(row!.items[0]!.pendingCommission, 144);
    assert.equal(row!.pendingCommission, 0, "potencial limitado ao que ainda não foi alocado em schedules");
    assert.equal(row!.alreadyScheduledCommission, 240);
    assert.equal(row!.overAllocatedCommission, 0);
    const view = buildCommission360View(
      {
        outlookLines: projectCommissionPortfolioOutlookLines([outlookFact(scheduleA!, 4800)], "2026-10-22"),
        batches: [],
        legacyCoverages: [],
        ledgerLines: [],
        potentialOrders: [
          {
            salesOrderId: ORDER_ID,
            orderCode: "PV-1001",
            orderStatus: "SENT_TO_NOMUS",
            saleDate: "2026-06-15",
            customerName: "Cliente Teste",
            canonicalSellerId: SELLER_PERSON_ID,
            sellerName: "Vendedor Teste",
            rawSellerId: 42,
            sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
            customerExcludedByActiveRule: false,
            hasActiveSnapshot: true,
            scheduledCommissionAmount: 240,
            items: [
              {
                salesOrderItemId: ITEM_ID,
                productName: "Produto Teste",
                snapshotFinalCommissions: [240],
                snapshotItemStatuses: ["COMMISSIONABLE"],
                flow: { orderedQuantity: 1000, shipTargetQuantity: 1000, invoicedQuantity: 400 },
              },
            ],
          },
        ],
        receivables: [],
      },
      parseCommission360Query({ from: "2026-01", to: "2026-12" }, { dataScope: "global", nomusSellerId: null }, "2026-10-22"),
      "2026-10-22"
    );
    assert.equal(view.cards.forecastOnReceivables + view.cards.potentialOnOrders, 240, "previsão + potencial = comissão do pedido, nunca 384");
  });

  it("8. com duas NF-e a Visão 360° marca o excesso alocado pelo motor como não conciliado", () => {
    const [row] = buildCommission360Potential([
      {
        salesOrderId: ORDER_ID,
        orderCode: "PV-1001",
        orderStatus: "SENT_TO_NOMUS",
        saleDate: "2026-06-15",
        customerName: "Cliente Teste",
        canonicalSellerId: SELLER_PERSON_ID,
        sellerName: "Vendedor Teste",
        rawSellerId: 42,
        sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
        customerExcludedByActiveRule: false,
        hasActiveSnapshot: true,
        scheduledCommissionAmount: 480,
        items: [
          {
            salesOrderItemId: ITEM_ID,
            productName: "Produto Teste",
            snapshotFinalCommissions: [240, 240],
            snapshotItemStatuses: ["COMMISSIONABLE", "COMMISSIONABLE"],
            flow: { orderedQuantity: 1000, shipTargetQuantity: 1000, invoicedQuantity: 1000 },
          },
        ],
      },
    ]);
    assert.equal(row!.totalCommission, 240);
    assert.equal(row!.alreadyScheduledCommission, 480);
    assert.equal(row!.overAllocatedCommission, 240);
    assert.equal(row!.pendingCommission, 0);
  });
});

describe("R1 na conciliação de CRs e no diagnóstico de novembro/dezembro", () => {
  it("títulos do PV com alocação acima da comissão do pedido são marcados; o excesso conta uma vez por PV", () => {
    const order = bundle([nfe(NFE_A, 4800), nfe(NFE_B, 7200)]);
    const [scheduleA] = schedulesFor(draftFor(order, NFE_A), "snap-1", { id: 9001, nominal: 4800 });
    const [scheduleB] = schedulesFor(draftFor(order, NFE_B), "snap-2", { id: 9002, nominal: 7200 });
    const lines = projectCommissionPortfolioOutlookLines([outlookFact(scheduleA!, 4800), outlookFact(scheduleB!, 7200)], "2026-10-22");
    const orderAllocations = new Map([[ORDER_ID, { orderCommission: 240, scheduledTotal: 480, activeSnapshotCount: 2 }]]);
    const rows = [9001, 9002].map((id, index) =>
      classifyCommission360Receivable({
        receivableId: id,
        invoiceNumber: String(index ? NFE_B : NFE_A),
        sourceInvoiceId: index ? NFE_B : NFE_A,
        dueDate: "2026-11-20",
        customerName: "Cliente Teste",
        nominalAmount: index ? 7200 : 4800,
        openBalance: index ? 7200 : 4800,
        suspended: false,
        groupCompany: false,
        orderLinks: [{ salesOrderId: ORDER_ID, orderCode: "PV-1001", status: "SENT_TO_NOMUS", externalSellerId: 42 }],
        snapshots: [],
        nfeReceivables: [],
        outlookLines: lines.filter((line) => line.receivableId === id),
        orderAllocations,
      })
    );
    assert.deepEqual(rows.map((row) => [row.status, row.forecastCommission, row.orderOverAllocatedCommission]), [
      ["COBERTO_FUTURA", 240, 240],
      ["COBERTO_FUTURA", 240, 240],
    ]);
    const [nov] = buildCommission360Diagnostic(rows);
    assert.equal(nov!.forecastCommission, 480, "a previsão oficial continua com o valor do motor (não é corrigida)");
    assert.equal(nov!.forecastOnOverAllocatedOrders, 480);
    assert.equal(nov!.orderOverAllocationExcess, 240, "excesso do PV contado uma vez");
  });
});
