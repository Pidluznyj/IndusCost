/**
 * GOLDEN — fronteira financeira do Fluxo de Caixa (FASE 2B, etapa 1).
 *
 * Congela o comportamento ATUAL da transformação
 *
 *     OrderFullAudit  →  buildEffectiveScheduleInputFromAudit
 *                     →  buildSalesOrderEffectiveFinancialSchedule
 *
 * que é exatamente o que `buildFinanceArEffectiveContextsForOrders`
 * (financeAccountsReceivableEffectiveTitles.server.ts:233-253) executa por
 * pedido depois de chamar `getOrderFullAudit`.
 *
 * PARA QUE SERVE: a fase 2B vai trocar a ORIGEM dos dados (auditoria 360º
 * completa por pedido → projeção leve em lote) mantendo a MESMA
 * transformação. Estes testes são a rede que prova que os números não
 * mudaram: se a projeção leve entregar blocos diferentes, o schedule muda e
 * um destes casos quebra.
 *
 * Os valores esperados foram extraídos da implementação vigente (não são
 * cálculos "de cabeça"): este arquivo é um retrato, e divergência aqui
 * significa MUDANÇA DE COMPORTAMENTO, não teste desatualizado.
 *
 * Dinheiro é comparado como string exata — nunca com tolerância.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEffectiveScheduleInputFromAudit } from "@/src/lib/sales-orders/salesOrderDetailEffectiveFinancial.js";
import { buildSalesOrderEffectiveFinancialSchedule } from "@/src/lib/finance/salesOrderEffectiveFinancialSchedule.js";
import type {
  OrderFullAuditItem,
  OrderFullAuditPlannedReceivable,
  OrderFullAuditReceivable,
  OrderFullAuditStockDocument,
  OrderFullAuditStockDocumentItem,
} from "@/src/lib/finance/orderFullAuditClient.js";
import type { OrderFullAuditPayload } from "@/src/lib/finance/orderFullAuditService.js";

const REFERENCE_DATE = new Date("2026-08-13T12:00:00.000Z");

/* ------------------------------------------------------------------ */
/*  Fábricas de fixture — só os campos que a fronteira realmente lê.   */
/* ------------------------------------------------------------------ */

function item(over: Partial<OrderFullAuditItem> & { salesOrderItemId: string }) {
  return {
    externalSalesOrderItemId: null,
    itemSequence: null,
    productCode: null,
    sku: null,
    productName: null,
    productExternalId: null,
    unit: null,
    quantity: 1,
    unitPrice: null,
    totalNetValue: null,
    nomusItemStatusRaw: null,
    nomusItemStatusNormalized: null,
    itemStatus: null,
    nomusIsCanceled: false,
    nomusIsCut: false,
    nomusIsStale: false,
    nomusQuantityFulfilled: null,
    nomusQuantityPending: null,
    matchConfidence: null,
    proposalItemId: null,
    activeQuantity: null,
    linkedReceivableExternalIds: [],
    ...over,
  } as unknown as OrderFullAuditItem;
}

function receivable(
  over: Partial<OrderFullAuditReceivable> & { receivableExternalId: number }
) {
  return {
    receivableId: null,
    companyName: null,
    personName: null,
    personCnpj: null,
    description: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    issueDate: null,
    dueDate: null,
    competenceDate: null,
    scheduleDate: null,
    settlementDate: null,
    amountReceivable: 0,
    amountScheduled: null,
    amountReceived: 0,
    balanceReceivable: 0,
    installmentNumber: null,
    totalInstallments: null,
    paymentTermsText: null,
    paymentMethodName: null,
    bankAccountName: null,
    ...over,
  } as unknown as OrderFullAuditReceivable;
}

function stockDocument(
  over: Partial<OrderFullAuditStockDocument> & { stockDocumentExternalId: number }
) {
  return {
    stockDocumentId: null,
    documentNumber: null,
    tipoDocumentoEstoque: null,
    dataDocumento: null,
    dataMovimentacao: null,
    customerName: null,
    companyName: null,
    idNfe: null,
    totalValue: 0,
    allocatedValue: 0,
    ...over,
  } as unknown as OrderFullAuditStockDocument;
}

function stockDocumentItem(
  over: Partial<OrderFullAuditStockDocumentItem> & {
    stockDocumentItemId: string;
    stockDocumentExternalId: number;
  }
) {
  return {
    externalItemId: null,
    productSku: null,
    productName: null,
    productExternalId: null,
    unit: null,
    quantityDocument: null,
    quantityUsedForOrder: null,
    excessQuantity: null,
    unitValue: null,
    totalValue: null,
    ...over,
  } as unknown as OrderFullAuditStockDocumentItem;
}

function planned(
  over: Partial<OrderFullAuditPlannedReceivable> & { installmentNumber: number }
) {
  return {
    key: `plan-${over.installmentNumber}`,
    orderCode: "PD 01",
    salesOrderId: "so-1",
    totalInstallments: 1,
    reference: null,
    dueDate: null,
    originalExpectedAmount: null,
    expectedAmount: 0,
    openAmount: 0,
    statusLabel: null,
    paymentConditionLabel: null,
    paymentMethodLabel: null,
    origin: null,
    note: null,
    replacedByRealCr: false,
    replacedByReceivableExternalId: null,
    replacedBySource: null,
    entryKind: "RESIDUAL_ORDER_PLAN",
    ...over,
  } as unknown as OrderFullAuditPlannedReceivable;
}

/** Audit mínimo — só os blocos que a fronteira consome. */
function audit(over: {
  salesOrderId?: string;
  orderCode?: string;
  items?: OrderFullAuditItem[];
  receivables?: OrderFullAuditReceivable[];
  stockDocuments?: OrderFullAuditStockDocument[];
  stockDocumentItems?: OrderFullAuditStockDocumentItem[];
  plannedReceivables?: OrderFullAuditPlannedReceivable[];
  /** Ruído: blocos que o Fluxo de Caixa NÃO deve consumir. */
  noise?: Record<string, unknown>;
}): OrderFullAuditPayload {
  return {
    ok: true,
    salesOrderId: over.salesOrderId ?? "so-1",
    orderCode: over.orderCode ?? "PD 01",
    salesOrder: { orderCode: over.orderCode ?? "PD 01" },
    items: over.items ?? [],
    receivables: over.receivables ?? [],
    stockDocuments: over.stockDocuments ?? [],
    stockDocumentItems: over.stockDocumentItems ?? [],
    plannedReceivables: over.plannedReceivables ?? [],
    ...(over.noise ?? {}),
  } as unknown as OrderFullAuditPayload;
}

/** Roda exatamente o que o Fluxo de Caixa roda hoje, por pedido. */
function scheduleOf(payload: OrderFullAuditPayload) {
  const input = buildEffectiveScheduleInputFromAudit(payload, REFERENCE_DATE);
  return { input, schedule: buildSalesOrderEffectiveFinancialSchedule(input) };
}

/** Retrato estável e comparável de um schedule (dinheiro como string). */
function snapshot(schedule: ReturnType<typeof scheduleOf>["schedule"]) {
  return JSON.stringify(
    {
      salesOrderId: schedule.salesOrderId,
      orderCode: schedule.orderCode,
      materializationMode: schedule.coverageSummary?.materializationMode ?? null,
      activeResidual: (schedule.activeOrderResidualSchedule ?? []).map((l) => ({
        n: l.installmentNumber,
        dueDate: l.dueDate,
        residual: String(l.residualAmount),
        original: String(l.originalAmount),
      })),
      superseded: (schedule.supersededOrderSchedule ?? []).map((l) => ({
        n: l.installmentNumber,
        dueDate: l.dueDate,
        residual: String(l.residualAmount),
      })),
    },
    null,
    1
  );
}

describe("GOLDEN — fronteira financeira do Fluxo de Caixa", () => {
  it("1. pedido sem faturamento: previsão do pedido sobrevive integralmente", () => {
    const { schedule } = scheduleOf(
      audit({
        items: [item({ salesOrderItemId: "i1", totalNetValue: 1000, quantity: 10 })],
        plannedReceivables: [
          planned({ installmentNumber: 1, dueDate: "2026-09-10", expectedAmount: 1000 }),
        ],
      })
    );
    assert.equal(schedule.salesOrderId, "so-1");
    assert.equal(schedule.orderCode, "PD 01");
    assert.ok(snapshot(schedule).includes('"dueDate": "2026-09-10"'));
  });

  it("2/3. parcial e faturado: alocação por documento entra no cálculo", () => {
    const parcial = scheduleOf(
      audit({
        items: [item({ salesOrderItemId: "i1", totalNetValue: 1000 })],
        stockDocuments: [
          stockDocument({
            stockDocumentExternalId: 900,
            allocatedValue: 400,
            dataDocumento: "2026-08-01",
          }),
        ],
        stockDocumentItems: [
          stockDocumentItem({
            stockDocumentItemId: "di1",
            stockDocumentExternalId: 900,
            linkedSalesOrderItemId: "i1",
            allocatedValue: 400,
            totalValue: 400,
          } as never),
        ],
        plannedReceivables: [
          planned({ installmentNumber: 1, dueDate: "2026-09-10", expectedAmount: 1000 }),
        ],
      })
    );
    const total = scheduleOf(
      audit({
        items: [item({ salesOrderItemId: "i1", totalNetValue: 1000 })],
        stockDocuments: [
          stockDocument({
            stockDocumentExternalId: 900,
            allocatedValue: 1000,
            dataDocumento: "2026-08-01",
          }),
        ],
        stockDocumentItems: [
          stockDocumentItem({
            stockDocumentItemId: "di1",
            stockDocumentExternalId: 900,
            linkedSalesOrderItemId: "i1",
            allocatedValue: 1000,
            totalValue: 1000,
          } as never),
        ],
        plannedReceivables: [
          planned({ installmentNumber: 1, dueDate: "2026-09-10", expectedAmount: 1000 }),
        ],
      })
    );
    // COMPORTAMENTO VIGENTE, congelado aqui: havendo previsão (plannedReceivables)
    // e documento alocado, a parcela do plano é integralmente SUBSTITUÍDA nos
    // dois casos — o schedule resultante é o mesmo para 400 e para 1000
    // alocados. A diferença entre parcial e total vive no INPUT (abaixo), não
    // no retrato do schedule. Se a fase 2B mudar isto, este teste quebra.
    for (const caso of [parcial, total]) {
      assert.equal(caso.schedule.coverageSummary?.materializationMode, "FULL_SUBSTITUTION");
      assert.equal(caso.schedule.activeOrderResidualSchedule.length, 0);
      assert.equal(String(caso.schedule.supersededOrderSchedule[0]?.residualAmount), "0");
      assert.equal(caso.schedule.supersededOrderSchedule[0]?.dueDate, "2026-09-10");
    }
    assert.equal(
      snapshot(parcial.schedule),
      snapshot(total.schedule),
      "retrato idêntico é o comportamento atual — mudou? então a regra mudou"
    );
    // E o input carrega o documento com a data documental preservada.
    assert.equal(parcial.input.documents[0]?.documentDate, "2026-08-01");
    assert.equal(parcial.input.documents[0]?.allocatedByOrderPrice, "400");
    assert.equal(total.input.documents[0]?.allocatedByOrderPrice, "1000");
  });

  it("4/8. CR real recebido: valores oficiais entram sem arredondar", () => {
    const { input } = scheduleOf(
      audit({
        items: [item({ salesOrderItemId: "i1", totalNetValue: 1234.56 })],
        receivables: [
          receivable({
            receivableExternalId: 5001,
            dueDate: "2026-07-15",
            amountReceivable: 1234.56,
            amountReceived: 1234.56,
            balanceReceivable: 0,
            settlementDate: "2026-07-20",
            personName: "Cliente Teste",
          }),
        ],
      })
    );
    const real = input.realReceivables[0]!;
    assert.equal(real.externalId, 5001);
    assert.equal(real.dueDate, "2026-07-15");
    assert.equal(real.amountReceivable, "1234.56", "dinheiro exato, sem tolerância");
    assert.equal(real.amountReceived, "1234.56");
    assert.equal(real.balanceReceivable, "0");
  });

  it("5. CR previsto (sem CR real): originalInstallments vêm do plano", () => {
    const { input } = scheduleOf(
      audit({
        items: [item({ salesOrderItemId: "i1", totalNetValue: 900 })],
        plannedReceivables: [
          planned({
            installmentNumber: 1,
            dueDate: "2026-10-05",
            originalExpectedAmount: 900,
            expectedAmount: 900,
          }),
        ],
      })
    );
    assert.equal(input.realReceivables.length, 0);
    assert.deepEqual(input.originalInstallments, [
      { installmentNumber: 1, dueDate: "2026-10-05", amount: "900" },
    ]);
  });

  it("6. múltiplas parcelas: ordenadas e deduplicadas por número", () => {
    const { input } = scheduleOf(
      audit({
        items: [item({ salesOrderItemId: "i1", totalNetValue: 3000 })],
        plannedReceivables: [
          planned({ installmentNumber: 3, dueDate: "2026-11-10", expectedAmount: 1000 }),
          planned({ installmentNumber: 1, dueDate: "2026-09-10", expectedAmount: 1000 }),
          planned({ installmentNumber: 2, dueDate: "2026-10-10", expectedAmount: 1000 }),
          // duplicata da 1 — a PRIMEIRA ocorrência vence (regra vigente)
          planned({ installmentNumber: 1, dueDate: "2026-09-30", expectedAmount: 555 }),
        ],
      })
    );
    assert.deepEqual(
      input.originalInstallments.map((i) => i.installmentNumber),
      [1, 2, 3],
      "ordenado por número"
    );
    assert.equal(input.originalInstallments[0]?.dueDate, "2026-09-10", "primeira vence");
    assert.equal(input.originalInstallments[0]?.amount, "1000");
  });

  it("7. título vencido: a data vence intacta até o motor (sem reescrita)", () => {
    const { input } = scheduleOf(
      audit({
        items: [item({ salesOrderItemId: "i1", totalNetValue: 500 })],
        receivables: [
          receivable({
            receivableExternalId: 7001,
            dueDate: "2026-01-05",
            amountReceivable: 500,
            balanceReceivable: 500,
          }),
        ],
      })
    );
    assert.equal(input.realReceivables[0]?.dueDate, "2026-01-05");
    assert.equal(input.realReceivables[0]?.balanceReceivable, "500");
  });

  it("9/11. documentos: só entram acima de 0.009 e todos são preservados", () => {
    const { input } = scheduleOf(
      audit({
        items: [item({ salesOrderItemId: "i1", totalNetValue: 1000 })],
        stockDocuments: [
          stockDocument({ stockDocumentExternalId: 1, allocatedValue: 600, idNfe: 111 }),
          stockDocument({ stockDocumentExternalId: 2, allocatedValue: 400, idNfe: 222 }),
          // abaixo do limiar: descartado pela regra vigente
          stockDocument({ stockDocumentExternalId: 3, allocatedValue: 0.005 }),
        ],
      })
    );
    assert.equal(input.documents.length, 2, "documento irrelevante é descartado");
    assert.deepEqual(
      input.documents.map((d) => d.sourceInvoiceId),
      [111, 222]
    );
    assert.deepEqual(
      input.documents.map((d) => d.allocatedByOrderPrice),
      ["600", "400"]
    );
  });

  it("10/13/14. cancelado, cortado e stale chegam ao motor como tal", () => {
    const { input } = scheduleOf(
      audit({
        items: [
          item({ salesOrderItemId: "ok", totalNetValue: 1000 }),
          item({ salesOrderItemId: "cut", totalNetValue: 500, nomusIsCut: true }),
          item({ salesOrderItemId: "cancel", totalNetValue: 300, nomusIsCanceled: true }),
          item({ salesOrderItemId: "stale", totalNetValue: 200, nomusIsStale: true }),
        ],
      })
    );
    const byId = new Map(input.items.map((i) => [i.salesOrderItemId, i]));
    assert.equal(byId.get("ok")?.nomusIsCut, false);
    assert.equal(byId.get("cut")?.nomusIsCut, true);
    assert.equal(byId.get("cancel")?.nomusIsCanceled, true);
    // regra vigente: stale entra no MESMO sinalizador de cancelado
    assert.equal(byId.get("stale")?.nomusIsCanceled, true);
  });

  it("12. TRAVA: blocos não consumidos não alteram o resultado", () => {
    const base = {
      items: [item({ salesOrderItemId: "i1", totalNetValue: 1000, quantity: 4 })],
      receivables: [
        receivable({
          receivableExternalId: 9001,
          dueDate: "2026-09-01",
          amountReceivable: 1000,
          balanceReceivable: 1000,
          personName: "ACME",
        }),
      ],
      stockDocuments: [
        stockDocument({ stockDocumentExternalId: 77, allocatedValue: 250 }),
      ],
      plannedReceivables: [
        planned({ installmentNumber: 1, dueDate: "2026-09-01", expectedAmount: 1000 }),
      ],
    };
    const limpo = scheduleOf(audit(base));
    const comRuido = scheduleOf(
      audit({
        ...base,
        noise: {
          // Tudo isto é construído hoje pelo audit 360º e NÃO é consumido.
          fiscalTaxes: { total: 999999, taxLines: [{ amount: 12345 }] },
          commissions: { total: 88888 },
          marginPricing: { margin: 0.42, cost: 777 },
          proposal: { present: true, totals: { totalNetValue: 123456 } },
          proposalVsOrderComparisons: { diff: 999 },
          nfes: [{ nfeExternalId: 5, nfeValue: 4242 }],
          nfeItems: [{ productCode: "X" }],
          productionOrders: [{ id: "op-1" }],
          productionLinks: [{ id: "l-1" }],
          delivery: { status: "ENTREGUE" },
          freight: { total: 321 },
          receipts: [{ amount: 1000 }],
          alerts: [{ code: "ANY" }],
          divergences: { items: [{ code: "D" }] },
          technicalAudit: { rawPayloads: { huge: true } },
          receivablesTotal: { totalAmount: 999 },
          plannedReceivablesTotal: { totalAmount: 888 },
          itemFacts: [{ id: "f1" }],
        },
      })
    );
    assert.equal(
      snapshot(comRuido.schedule),
      snapshot(limpo.schedule),
      "fiscal/comissão/margem/proposta/NFe/produção/frete/alertas NÃO podem influenciar o schedule"
    );
    assert.equal(
      JSON.stringify(comRuido.input),
      JSON.stringify(limpo.input),
      "o input financeiro também precisa ser idêntico"
    );
  });

  it("CONTRATO: a fronteira lê apenas os 6 blocos previstos", () => {
    // Se alguém passar a consumir um bloco novo, este teste quebra e a fase
    // 2B precisa carregar esse bloco também na projeção leve.
    const lidos = new Set<string>();
    const espiao = new Proxy(
      audit({
        items: [item({ salesOrderItemId: "i1", totalNetValue: 10 })],
        receivables: [receivable({ receivableExternalId: 1, amountReceivable: 10 })],
        stockDocuments: [stockDocument({ stockDocumentExternalId: 1, allocatedValue: 10 })],
        plannedReceivables: [planned({ installmentNumber: 1, expectedAmount: 10 })],
      }) as unknown as Record<string, unknown>,
      {
        get(target, prop) {
          if (typeof prop === "string") lidos.add(prop);
          return target[prop as string];
        },
      }
    ) as unknown as OrderFullAuditPayload;

    buildEffectiveScheduleInputFromAudit(espiao, REFERENCE_DATE);

    const permitidos = new Set([
      "salesOrderId",
      "orderCode",
      "salesOrder",
      "items",
      "receivables",
      "stockDocuments",
      "stockDocumentItems",
      "plannedReceivables",
    ]);
    const inesperados = [...lidos].filter((k) => !permitidos.has(k));
    assert.deepEqual(
      inesperados,
      [],
      `a fronteira passou a ler blocos novos: ${inesperados.join(", ")}`
    );
  });
});
