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
