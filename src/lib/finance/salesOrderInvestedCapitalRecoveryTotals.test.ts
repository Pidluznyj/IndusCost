import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInvestedCapitalRecoveryComparableTotals } from "./salesOrderInvestedCapitalRecoveryTotals.js";
import {
  buildSalesOrderInvestedCapitalRecoverySnapshot,
  type SalesOrderInvestedCapitalRecoveryOrderInput,
  type SalesOrderInvestedCapitalRecoverySnapshot,
} from "./salesOrderInvestedCapitalRecoverySnapshot.js";

const TODAY = "2026-09-01";

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** PV com um CR baixado (`received`) e um CR aberto (`outstanding`). */
function order(input: {
  id: string;
  sale: number;
  capital: number | null;
  received: number;
  outstanding: number;
  customerId?: string | null;
}): SalesOrderInvestedCapitalRecoverySnapshot {
  const base: SalesOrderInvestedCapitalRecoveryOrderInput = {
    salesOrderId: input.id,
    orderCode: input.id,
    customerId: input.customerId ?? "customer-a",
    customerName: "Cliente A",
    sellerName: null,
    saleValue: input.sale,
    invoicedValue: input.sale,
    investedCapital: input.capital,
    investedCapitalUnavailableReason: input.capital == null ? "Custo industrial indisponível para este pedido" : null,
    orderStatus: "SENT_TO_NOMUS",
    orderStatusLabel: "Enviado",
    industrialCost: input.capital == null ? null : cents(input.capital * 0.8),
    totalTaxes: input.capital == null ? null : cents(input.capital * 0.2),
    taxSourceLabel: null,
    realReceivables: [
      {
        externalId: 1,
        dueDate: "2026-06-01",
        settlementDate: "2026-06-05",
        amountReceivable: input.received,
        amountReceived: input.received,
        balanceReceivable: 0,
      },
      {
        externalId: 2,
        dueDate: "2026-10-01",
        settlementDate: null,
        amountReceivable: input.outstanding,
        amountReceived: 0,
        balanceReceivable: input.outstanding,
      },
    ],
  };
  return buildSalesOrderInvestedCapitalRecoverySnapshot(base, TODAY);
}

const POPULATION = [
  order({ id: "A", sale: 100, capital: 60, received: 75, outstanding: 25 }),
  order({ id: "B", sale: 100, capital: 60, received: 30, outstanding: 70 }),
  order({ id: "C", sale: 100, capital: 60, received: 10, outstanding: 20 }),
  order({ id: "D", sale: 100, capital: null, received: 50, outstanding: 50 }),
  order({ id: "E", sale: 100, capital: 110, received: 60, outstanding: 40 }),
  // Capital 0 (não null): inválido — mesma regra de DADOS_INSUFICIENTES.
  order({ id: "Z", sale: 80, capital: 0, received: 12.34, outstanding: 5.55 }),
  order({ id: "F", sale: 1234.56, capital: 987.65, received: 333.33, outstanding: 901.23 }),
];

describe("Recuperação do Dinheiro Investido — totais comparáveis", () => {
  const totals = buildInvestedCapitalRecoveryComparableTotals(POPULATION);
  const comparable = POPULATION.filter((r) => r.capitalRecovered != null);
  const sum = (rows: readonly SalesOrderInvestedCapitalRecoverySnapshot[], pick: (r: SalesOrderInvestedCapitalRecoverySnapshot) => number | null) =>
    cents(rows.reduce((acc, r) => acc + (pick(r) ?? 0), 0));

  it("população comparável = pedidos com capital válido (null e 0 ficam fora)", () => {
    assert.equal(totals.ordersComparableCount, 5);
    assert.deepEqual(
      comparable.map((r) => r.salesOrderId),
      ["A", "B", "C", "E", "F"]
    );
  });

  it("(5) venda comparável = capital investido + margem econômica", () => {
    assert.equal(totals.comparableSaleValueTotal, sum(comparable, (r) => r.saleValue));
    assert.equal(totals.economicMarginTotal, sum(comparable, (r) => r.economicMargin));
    assert.equal(
      cents(sum(comparable, (r) => r.investedCapital) + totals.economicMarginTotal),
      totals.comparableSaleValueTotal
    );
    // A venda de D e Z (sem capital válido) NÃO entra na comparável.
    assert.equal(cents(totals.comparableSaleValueTotal + 100 + 80), sum(POPULATION, (r) => r.saleValue));
  });

  it("(2) recebido comparável = capital recuperado + ganho realizado; recebido total inclui D e Z", () => {
    assert.equal(totals.actualReceivedComparableTotal, sum(comparable, (r) => r.actualReceived));
    assert.equal(
      cents(sum(comparable, (r) => r.capitalRecovered) + totals.realizedGainTotal),
      totals.actualReceivedComparableTotal
    );
    assert.equal(totals.actualReceivedTotal, sum(POPULATION, (r) => r.actualReceived));
    assert.equal(cents(totals.actualReceivedTotal - totals.actualReceivedComparableTotal), cents(50 + 12.34));
  });

  it("(7) reconciliação total × comparável: venda, recebido e CR fecham por centavo e o PV sem custo nunca vira capital/ganho", () => {
    // Venda total = comparável + sem custo resolvido (D 100 + Z 80).
    assert.equal(totals.ordersUnresolvedCostCount, 2);
    assert.equal(totals.saleValueUnresolvedCostTotal, 180);
    assert.equal(
      cents(totals.comparableSaleValueTotal + totals.saleValueUnresolvedCostTotal),
      sum(POPULATION, (r) => r.saleValue)
    );
    // Recebido total = comparável + não classificável (D 50 + Z 12,34).
    assert.equal(totals.actualReceivedUnclassifiedTotal, cents(50 + 12.34));
    assert.equal(
      cents(totals.actualReceivedComparableTotal + totals.actualReceivedUnclassifiedTotal),
      totals.actualReceivedTotal
    );
    // O recebido não classificável não aparece em capital recuperado nem em ganho realizado.
    const unresolved = POPULATION.filter((r) => r.capitalRecovered == null);
    assert.equal(unresolved.length, 2);
    for (const row of unresolved) {
      assert.equal(row.capitalRecovered, null);
      assert.equal(row.realizedGain, null);
      assert.equal(row.capitalReceivableCovered, null);
      assert.equal(row.gainReceivable, null);
    }
    assert.equal(
      cents(totals.actualReceivedComparableTotal),
      cents(sum(comparable, (r) => r.capitalRecovered) + sum(comparable, (r) => r.realizedGain))
    );
    // CR aberto: total = comparável + não classificável (já coberto em (3)); comparável = capital + ganho.
    assert.equal(
      cents(totals.outstandingReceivableComparableTotal + totals.outstandingReceivableUnclassifiedTotal),
      sum(POPULATION, (r) => r.outstandingReceivable)
    );
  });

  it("(8) auditoria dos CR por PV: aberto, parcial, sem CR e múltiplos documentos reconciliam com a regra canônica do snapshot", () => {
    // PV com CR real em aberto integral, CR parcialmente baixado, sem nenhum CR e vários documentos (inclusive meio centavo).
    const base = (id: string, capital: number | null, realReceivables: SalesOrderInvestedCapitalRecoveryOrderInput["realReceivables"]) =>
      buildSalesOrderInvestedCapitalRecoverySnapshot(
        {
          salesOrderId: id,
          orderCode: id,
          customerId: "c",
          customerName: "Cliente",
          sellerName: null,
          saleValue: 200.05,
          invoicedValue: 200.05,
          investedCapital: capital,
          investedCapitalUnavailableReason: capital == null ? "Custo industrial indisponível para este pedido" : null,
          orderStatus: "SENT_TO_NOMUS",
          orderStatusLabel: "Enviado",
          industrialCost: capital == null ? null : cents(capital * 0.8),
          totalTaxes: capital == null ? null : cents(capital - cents(capital * 0.8)),
          taxSourceLabel: null,
          realReceivables,
        },
        TODAY
      );
    const open = base("ABERTO", 120.5, [
      { externalId: 1, dueDate: "2026-10-01", settlementDate: null, amountReceivable: 200.05, amountReceived: 0, balanceReceivable: 200.05 },
    ]);
    const partial = base("PARCIAL", 120.5, [
      { externalId: 1, dueDate: "2026-06-01", settlementDate: "2026-06-05", amountReceivable: 100.03, amountReceived: 60.01, balanceReceivable: 40.02 },
      { externalId: 2, dueDate: "2026-11-01", settlementDate: null, amountReceivable: 100.02, amountReceived: 0, balanceReceivable: 100.02 },
    ]);
    const noReceivable = base("SEM_CR", 120.5, []);
    const multi = base("MULTI", 120.5, [
      { externalId: 1, dueDate: "2026-05-01", settlementDate: "2026-05-02", amountReceivable: 66.68, amountReceived: 66.68, balanceReceivable: 0 },
      { externalId: 2, dueDate: "2026-06-01", settlementDate: "2026-06-02", amountReceivable: 66.68, amountReceived: 66.68, balanceReceivable: 0 },
      { externalId: 3, dueDate: "2026-07-01", settlementDate: "2026-07-02", amountReceivable: 66.69, amountReceived: 66.69, balanceReceivable: 0 },
    ]);
    const unresolvedPartial = base("SEM_CUSTO", null, [
      { externalId: 1, dueDate: "2026-06-01", settlementDate: "2026-06-05", amountReceivable: 100.03, amountReceived: 33.34, balanceReceivable: 66.69 },
    ]);
    const rows = [open, partial, noReceivable, multi, unresolvedPartial];
    // Regra canônica por PV (Math): recebido = Σ amountReceived; CR aberto = Σ balanceReceivable; sem CR → tudo na rua sem CR.
    assert.equal(open.actualReceived, 0);
    assert.equal(open.outstandingReceivable, 200.05);
    assert.equal(open.capitalReceivableCovered, 120.5);
    assert.equal(open.gainReceivable, cents(200.05 - 120.5));
    assert.equal(partial.actualReceived, 60.01);
    assert.equal(partial.outstandingReceivable, cents(40.02 + 100.02));
    assert.equal(partial.capitalRecovered, 60.01);
    assert.equal(partial.moneyOnStreet, cents(120.5 - 60.01));
    assert.equal(noReceivable.actualReceived, 0);
    assert.equal(noReceivable.outstandingReceivable, 0);
    assert.equal(noReceivable.capitalWithoutOpenReceivable, 120.5);
    assert.equal(multi.actualReceived, 200.05);
    assert.equal(multi.capitalRecovered, 120.5);
    assert.equal(multi.realizedGain, cents(200.05 - 120.5));
    assert.equal(unresolvedPartial.capitalRecovered, null);

    const t = buildInvestedCapitalRecoveryComparableTotals(rows);
    assert.equal(t.ordersComparableCount, 4);
    assert.equal(t.ordersUnresolvedCostCount, 1);
    assert.equal(cents(t.comparableSaleValueTotal + t.saleValueUnresolvedCostTotal), sum(rows, (r) => r.saleValue));
    assert.equal(cents(t.actualReceivedComparableTotal + t.actualReceivedUnclassifiedTotal), sum(rows, (r) => r.actualReceived));
    assert.equal(t.actualReceivedUnclassifiedTotal, 33.34);
    assert.equal(cents(sum(rows.slice(0, 4), (r) => r.capitalRecovered) + t.realizedGainTotal), t.actualReceivedComparableTotal);
    assert.equal(cents(t.outstandingReceivableComparableTotal + t.outstandingReceivableUnclassifiedTotal), sum(rows, (r) => r.outstandingReceivable));
    assert.equal(t.outstandingReceivableUnclassifiedTotal, 66.69);
    assert.equal(cents(t.capitalReceivableCoveredTotal + t.gainReceivableTotal), t.outstandingReceivableComparableTotal);
    assert.equal(cents(sum(rows.slice(0, 4), (r) => r.investedCapital) + t.economicMarginTotal), t.comparableSaleValueTotal);
  });

  it("(3) CR comparável = capital a recuperar + ganho a receber; CR total = comparável + não classificado", () => {
    assert.equal(
      cents(totals.capitalReceivableCoveredTotal + totals.gainReceivableTotal),
      totals.outstandingReceivableComparableTotal
    );
    assert.equal(totals.outstandingReceivableUnclassifiedTotal, cents(50 + 5.55));
    assert.equal(
      cents(totals.outstandingReceivableComparableTotal + totals.outstandingReceivableUnclassifiedTotal),
      sum(POPULATION, (r) => r.outstandingReceivable)
    );
  });

  it("(4) capital na rua = capital no CR + capital sem CR", () => {
    assert.equal(
      cents(totals.capitalReceivableCoveredTotal + totals.capitalWithoutOpenReceivableTotal),
      sum(comparable, (r) => r.moneyOnStreet)
    );
    // Valores do enunciado: A 0/25/0, B 30/40/0, C 20/0/30, E 40/0/10.
    assert.equal(totals.capitalWithoutOpenReceivableTotal, cents(30 + 10 + (comparable[4]!.capitalWithoutOpenReceivable ?? 0)));
  });

  it("percentuais recuperado/na rua saem da população comparável e somam 100", () => {
    const invested = sum(comparable, (r) => r.investedCapital);
    const recovered = sum(comparable, (r) => r.capitalRecovered);
    assert.equal(totals.capitalRecoveredPercent, Math.round((recovered / invested) * 10000) / 100);
    assert.equal(
      cents((totals.capitalRecoveredPercent ?? 0) + (totals.moneyOnStreetPercent ?? 0)),
      100
    );
  });

  it("população sem nenhum capital válido → totais comparáveis zerados, percentuais null, nada inventado", () => {
    const empty = buildInvestedCapitalRecoveryComparableTotals([
      order({ id: "D", sale: 100, capital: null, received: 50, outstanding: 50 }),
    ]);
    assert.equal(empty.ordersComparableCount, 0);
    assert.equal(empty.comparableSaleValueTotal, 0);
    assert.equal(empty.economicMarginTotal, 0);
    assert.equal(empty.actualReceivedComparableTotal, 0);
    assert.equal(empty.actualReceivedTotal, 50);
    assert.equal(empty.gainReceivableTotal, 0);
    assert.equal(empty.outstandingReceivableUnclassifiedTotal, 50);
    assert.equal(empty.capitalRecoveredPercent, null);
    assert.equal(empty.moneyOnStreetPercent, null);
    assert.deepEqual(buildInvestedCapitalRecoveryComparableTotals([]).ordersComparableCount, 0);
  });

  it("acumula em centavos inteiros: 3.000 pedidos de R$ 0,10 fecham exatos", () => {
    const rows = Array.from({ length: 3000 }, (_, i) =>
      order({ id: `p${i}`, sale: 0.3, capital: 0.1, received: 0.1, outstanding: 0.2 })
    );
    const t = buildInvestedCapitalRecoveryComparableTotals(rows);
    assert.equal(t.comparableSaleValueTotal, 900);
    assert.equal(t.economicMarginTotal, 600);
    assert.equal(t.actualReceivedComparableTotal, 300);
    assert.equal(t.gainReceivableTotal, 600);
    assert.equal(t.capitalReceivableCoveredTotal, 0);
  });
});
