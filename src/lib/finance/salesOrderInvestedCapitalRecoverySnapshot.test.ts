import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderInvestedCapitalRecoverySnapshot } from "./salesOrderInvestedCapitalRecoverySnapshot.js";

const TODAY = "2026-08-07";

function baseOrder() {
  return {
    salesOrderId: "so-1",
    orderCode: "PD 1000",
    customerName: "Cliente Teste",
    sellerName: "Vendedor Teste",
    saleValue: 200,
    investedCapital: 110,
    investedCapitalUnavailableReason: null,
    orderStatus: "SENT_TO_NOMUS",
    orderStatusLabel: "Enviado",
    industrialCost: null as number | null,
    totalTaxes: null as number | null,
    taxSourceLabel: null as string | null,
    realReceivables: [] as {
      externalId: number;
      dueDate: string | null;
      settlementDate: string | null;
      amountReceivable: number;
      amountReceived: number;
      balanceReceivable: number;
    }[],
  };
}

describe("buildSalesOrderInvestedCapitalRecoverySnapshot", () => {
  it("Pedido só com CR reais baixados — capital recuperado calculado corretamente (TEST-01 estilo)", () => {
    const snapshot = buildSalesOrderInvestedCapitalRecoverySnapshot(
      {
        ...baseOrder(),
        investedCapital: 100,
        realReceivables: [
          {
            externalId: 1,
            dueDate: "2026-06-01",
            settlementDate: "2026-06-05",
            amountReceivable: 40,
            amountReceived: 40,
            balanceReceivable: 0,
          },
        ],
      },
      TODAY
    );
    assert.equal(snapshot.actualReceived, 40);
    assert.equal(snapshot.capitalRecovered, 40);
    assert.equal(snapshot.moneyOnStreet, 60);
    assert.equal(snapshot.recoveryPercent, 40);
    assert.equal(snapshot.status, "EM_RECUPERACAO");
  });

  it("exemplo do enunciado (seção 10): venda=200, capital=110, recebido=50, saldo a receber=150 → dinheiro na rua=60 (nunca == saldo a receber)", () => {
    const snapshot = buildSalesOrderInvestedCapitalRecoverySnapshot(
      {
        ...baseOrder(),
        saleValue: 200,
        investedCapital: 110,
        realReceivables: [
          {
            externalId: 1,
            dueDate: "2026-06-01",
            settlementDate: "2026-06-05",
            amountReceivable: 50,
            amountReceived: 50,
            balanceReceivable: 0,
          },
          {
            externalId: 2,
            dueDate: "2026-09-01",
            settlementDate: null,
            amountReceivable: 150,
            amountReceived: 0,
            balanceReceivable: 150,
          },
        ],
      },
      TODAY
    );
    assert.equal(snapshot.actualReceived, 50);
    assert.equal(snapshot.outstandingReceivable, 150);
    assert.equal(snapshot.moneyOnStreet, 60);
    assert.notEqual(snapshot.moneyOnStreet, snapshot.outstandingReceivable);
  });

  it("TEST-06 — CR real substitui previsão: título aberto some quando é baixado, nunca soma como duas verdades", () => {
    // Título único, primeiro visto ABERTO (previsão/CR aberto), depois BAIXADO —
    // a entrada `realReceivables` já vem da camada canônica com o título no
    // estado FINAL (uma linha por CR real, nunca duas), então o snapshot
    // nunca pode contabilizar o mesmo valor duas vezes.
    const aberto = buildSalesOrderInvestedCapitalRecoverySnapshot(
      {
        ...baseOrder(),
        investedCapital: 100,
        realReceivables: [
          {
            externalId: 1,
            dueDate: "2026-06-01",
            settlementDate: null,
            amountReceivable: 25,
            amountReceived: 0,
            balanceReceivable: 25,
          },
        ],
      },
      TODAY
    );
    assert.equal(aberto.actualReceived, 0);
    assert.equal(aberto.outstandingReceivable, 25);

    const baixado = buildSalesOrderInvestedCapitalRecoverySnapshot(
      {
        ...baseOrder(),
        investedCapital: 100,
        realReceivables: [
          {
            externalId: 1,
            dueDate: "2026-06-01",
            settlementDate: "2026-06-03",
            amountReceivable: 25,
            amountReceived: 25,
            balanceReceivable: 0,
          },
        ],
      },
      TODAY
    );
    assert.equal(baixado.actualReceived, 25);
    assert.equal(baixado.outstandingReceivable, 0);
    // Nunca 50 (25 aberto + 25 baixado somados por engano).
  });

  it("custo ausente (SEM_CUSTO) → investedCapital null, status DADOS_INSUFICIENTES, motivo preservado", () => {
    const snapshot = buildSalesOrderInvestedCapitalRecoverySnapshot(
      {
        ...baseOrder(),
        investedCapital: null,
        investedCapitalUnavailableReason: "Custo publicado não localizado na data do pedido",
        realReceivables: [
          {
            externalId: 1,
            dueDate: "2026-06-01",
            settlementDate: "2026-06-03",
            amountReceivable: 25,
            amountReceived: 25,
            balanceReceivable: 0,
          },
        ],
      },
      TODAY
    );
    assert.equal(snapshot.investedCapital, null);
    assert.equal(snapshot.capitalRecovered, null);
    assert.equal(snapshot.moneyOnStreet, null);
    assert.equal(snapshot.status, "DADOS_INSUFICIENTES");
    assert.equal(
      snapshot.investedCapitalUnavailableReason,
      "Custo publicado não localizado na data do pedido"
    );
    // actualReceived/outstandingReceivable continuam corretos mesmo sem capital.
    assert.equal(snapshot.actualReceived, 25);
  });

  it("investedCapitalSource é sempre INDUSTRIAL_RESULT — nunca expõe o custo comercial como se fosse capital investido", () => {
    const snapshot = buildSalesOrderInvestedCapitalRecoverySnapshot(baseOrder(), TODAY);
    assert.equal(snapshot.investedCapitalSource, "INDUSTRIAL_RESULT");
  });

  it("reconciliação: investedCapital == capitalRecovered + moneyOnStreet quando capital é válido", () => {
    const snapshot = buildSalesOrderInvestedCapitalRecoverySnapshot(
      {
        ...baseOrder(),
        investedCapital: 100,
        realReceivables: [
          {
            externalId: 1,
            dueDate: "2026-06-01",
            settlementDate: "2026-06-03",
            amountReceivable: 37.5,
            amountReceived: 37.5,
            balanceReceivable: 0,
          },
        ],
      },
      TODAY
    );
    assert.equal(snapshot.capitalRecovered! + snapshot.moneyOnStreet!, 100);
  });

  it("nesta função PURA, totalTaxes é só ecoado — a soma com o custo já aconteceu no investedCapital recebido (ver serviço)", () => {
    const withTax = buildSalesOrderInvestedCapitalRecoverySnapshot(
      {
        ...baseOrder(),
        investedCapital: 100,
        totalTaxes: 18.5,
        taxSourceLabel: "NF vinculada",
        realReceivables: [
          {
            externalId: 1,
            dueDate: "2026-06-01",
            settlementDate: "2026-06-03",
            amountReceivable: 40,
            amountReceived: 40,
            balanceReceivable: 0,
          },
        ],
      },
      TODAY
    );
    const withoutTax = buildSalesOrderInvestedCapitalRecoverySnapshot(
      {
        ...baseOrder(),
        investedCapital: 100,
        totalTaxes: null,
        taxSourceLabel: null,
        realReceivables: [
          {
            externalId: 1,
            dueDate: "2026-06-01",
            settlementDate: "2026-06-03",
            amountReceivable: 40,
            amountReceived: 40,
            balanceReceivable: 0,
          },
        ],
      },
      TODAY
    );
    assert.equal(withTax.totalTaxes, 18.5);
    assert.equal(withTax.taxSourceLabel, "NF vinculada");
    assert.equal(withoutTax.totalTaxes, null);
    // Imposto presente ou ausente não muda NENHUM número de capital/recuperação.
    assert.equal(withTax.capitalRecovered, withoutTax.capitalRecovered);
    assert.equal(withTax.moneyOnStreet, withoutTax.moneyOnStreet);
    assert.equal(withTax.recoveryPercent, withoutTax.recoveryPercent);
    assert.equal(withTax.investedCapital, withoutTax.investedCapital);
  });
});

describe("buildSalesOrderInvestedCapitalRecoverySnapshot — decomposição econômica por pedido", () => {
  /** PV com um CR baixado (`received`) e um CR aberto (`outstanding`). */
  function decomposed(input: { sale: number; capital: number | null; received: number; outstanding: number }) {
    return buildSalesOrderInvestedCapitalRecoverySnapshot(
      {
        ...baseOrder(),
        saleValue: input.sale,
        investedCapital: input.capital,
        investedCapitalUnavailableReason: input.capital == null ? "Custo publicado não localizado na data do pedido" : null,
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
      },
      TODAY
    );
  }

  function cents(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  it("CASOS A, B, C e E chegam ao snapshot com os mesmos números da matemática pura", () => {
    const a = decomposed({ sale: 100, capital: 60, received: 75, outstanding: 25 });
    assert.equal(a.economicMargin, 40);
    assert.equal(a.capitalRecovered, 60);
    assert.equal(a.realizedGain, 15);
    assert.equal(a.moneyOnStreet, 0);
    assert.equal(a.capitalReceivableCovered, 0);
    assert.equal(a.gainReceivable, 25);
    assert.equal(a.capitalWithoutOpenReceivable, 0);
    assert.equal(a.status, "CAPITAL_RECUPERADO");

    const b = decomposed({ sale: 100, capital: 60, received: 30, outstanding: 70 });
    assert.equal(b.capitalReceivableCovered, 30);
    assert.equal(b.gainReceivable, 40);
    assert.equal(b.capitalWithoutOpenReceivable, 0);

    const c = decomposed({ sale: 100, capital: 60, received: 10, outstanding: 20 });
    assert.equal(c.moneyOnStreet, 50);
    assert.equal(c.capitalReceivableCovered, 20);
    assert.equal(c.gainReceivable, 0);
    assert.equal(c.capitalWithoutOpenReceivable, 30);

    const e = decomposed({ sale: 100, capital: 110, received: 60, outstanding: 40 });
    assert.equal(e.economicMargin, -10);
    assert.equal(e.capitalReceivableCovered, 40);
    assert.equal(e.gainReceivable, 0);
    assert.equal(e.capitalWithoutOpenReceivable, 10);
  });

  it("CASO D — sem capital: recebido e CR aberto continuam corretos, mas nada é classificado", () => {
    const d = decomposed({ sale: 100, capital: null, received: 50, outstanding: 50 });
    assert.equal(d.actualReceived, 50);
    assert.equal(d.outstandingReceivable, 50);
    assert.equal(d.economicMargin, null);
    assert.equal(d.capitalRecovered, null);
    assert.equal(d.moneyOnStreet, null);
    assert.equal(d.realizedGain, null);
    assert.equal(d.capitalReceivableCovered, null);
    assert.equal(d.gainReceivable, null);
    assert.equal(d.capitalWithoutOpenReceivable, null);
    assert.equal(d.status, "DADOS_INSUFICIENTES");
  });

  it("todas as identidades fecham centavo a centavo com os valores ecoados no próprio snapshot", () => {
    const scenarios = [
      { sale: 100, capital: 60, received: 75, outstanding: 25 },
      { sale: 100, capital: 60, received: 30, outstanding: 70 },
      { sale: 100, capital: 110, received: 60, outstanding: 40 },
      { sale: 1234.56, capital: 987.65, received: 333.33, outstanding: 901.23 },
      // Entrada com mais de 2 casas: o snapshot arredonda ANTES de qualquer conta.
      { sale: 1000.005, capital: 700.004, received: 199.999, outstanding: 800.006 },
    ];
    for (const s of scenarios) {
      const r = decomposed(s);
      const label = JSON.stringify(s);
      assert.equal(cents(r.capitalRecovered! + r.moneyOnStreet!), r.investedCapital, `capital ${label}`);
      assert.equal(cents(r.capitalRecovered! + r.realizedGain!), r.actualReceived, `recebido ${label}`);
      assert.equal(cents(r.capitalReceivableCovered! + r.gainReceivable!), r.outstandingReceivable, `CR ${label}`);
      assert.equal(cents(r.capitalReceivableCovered! + r.capitalWithoutOpenReceivable!), r.moneyOnStreet, `rua ${label}`);
      assert.equal(cents(r.investedCapital! + r.economicMargin!), r.saleValue, `venda ${label}`);
    }
  });
});
