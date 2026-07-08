import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyArOrderFinancialResolution,
  auditArOrderFinancialDivergence,
  buildSalesOrderFinancialContext,
  parseSalesOrderParcelFromArDescription,
  resolveArOrderFinancialAmounts,
} from "./nomusArOrderFinancialResolution.js";
import { extractNomusSalesOrderFinancialSummary } from "./nomusSalesOrderFinancialParcels.js";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";

function baseArRow(overrides: Partial<FinanceArDashboardRow> = {}): FinanceArDashboardRow {
  return {
    externalId: 1,
    companyName: "KOPPETEL",
    personId: 100,
    personName: "Britania Eletrodomesticos SA",
    personCnpj: null,
    description: "Pedido PD 02607 - Parcela 1",
    comments: null,
    dueDate: new Date(2026, 8, 10),
    competenceDate: new Date(2026, 5, 3),
    settlementDate: null,
    amountReceivable: 311_580,
    amountReceived: 0,
    balanceReceivable: 311_580,
    paymentMethodName: "Depósito Bancário",
    bankAccountName: null,
    sourceInvoiceId: 999,
    sourceInvoiceNumber: "12345",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(),
    ...overrides,
  };
}

describe("nomusArOrderFinancialResolution", () => {
  it("parseSalesOrderParcelFromArDescription lê PD 02607 parcela 1", () => {
    const parsed = parseSalesOrderParcelFromArDescription("Pedido PD 02607 - Parcela 1");
    assert.equal(parsed?.orderCode, "PD 02607");
    assert.equal(parsed?.installmentNumber, 1);
  });

  it("PD 02607: parcela única R$ 202.860 corrige valor Nomus R$ 311.580", () => {
    const raw = {
      condicaoPagamento: {
        valorTotalFinanceiro: 202_860,
        condicaoPagamentoParcelas: [
          {
            numeroParcela: 1,
            dataVencimento: "10/09/2026",
            valorParcela: 202_860,
          },
        ],
      },
    };
    const context = buildSalesOrderFinancialContext("PD 02607", "so-1", raw);
    const parsed = parseSalesOrderParcelFromArDescription("Pedido PD 02607 - Parcela 1")!;
    const resolved = applyArOrderFinancialResolution(baseArRow(), context, parsed);

    assert.equal(resolved.amountReceivable, 202_860);
    assert.equal(resolved.balanceReceivable, 202_860);
    assert.equal(resolved.nomusAmountReceivable, 311_580);
    assert.equal(resolved.financialAmountSource, "sales_order_parcel");
    assert.equal(resolved.orderFinancialDivergence, true);
    assert.equal(resolved.orderFinancialDivergenceDelta, 108_720);
  });

  it("título AR real sem divergência permanece com valor Nomus", () => {
    const resolution = resolveArOrderFinancialAmounts({
      amountReceivable: 50_000,
      amountReceived: 0,
      balanceReceivable: 50_000,
      description: "NF 12345 — parcela única",
      dueDate: new Date(2026, 7, 1),
      parcel: { installmentNumber: 1, dueDate: new Date(2026, 7, 1), amount: 50_000 },
      linkedOrderCode: "PD 01000",
    });
    assert.equal(resolution.financialAmountSource, "nomus_cr");
    assert.equal(resolution.amountReceivable, 50_000);
    assert.equal(resolution.orderFinancialDivergence, false);
  });

  it("pedido parcelado usa valor de cada parcela", () => {
    const summary = extractNomusSalesOrderFinancialSummary({
      parcelas: [
        { numeroParcela: 1, dataVencimento: "10/08/2026", valorParcela: 100_000 },
        { numeroParcela: 2, dataVencimento: "10/09/2026", valorParcela: 102_860 },
      ],
    });
    assert.equal(summary.parcels.length, 2);
    assert.equal(summary.financialTotal, 202_860);

    const p2 = resolveArOrderFinancialAmounts({
      amountReceivable: 150_000,
      amountReceived: 0,
      balanceReceivable: 150_000,
      description: "Pedido PD 02607 - Parcela 2",
      dueDate: new Date(2026, 8, 10),
      parcel: summary.parcels[1]!,
      linkedOrderCode: "PD 02607",
    });
    assert.equal(p2.amountReceivable, 102_860);
    assert.equal(p2.financialAmountSource, "sales_order_parcel");
  });

  it("valor de itens diferente do financeiro não entra na resolução sem parcela", () => {
    const resolution = resolveArOrderFinancialAmounts({
      amountReceivable: 311_580,
      amountReceived: 0,
      balanceReceivable: 311_580,
      description: "Serviço diverso",
      dueDate: new Date(2026, 8, 10),
      parcel: null,
      linkedOrderCode: null,
    });
    assert.equal(resolution.amountReceivable, 311_580);
    assert.equal(resolution.financialAmountSource, "nomus_cr");
  });

  it("auditoria detecta divergência PD 02607", () => {
    const raw = {
      condicaoPagamentoParcelas: [
        { numeroParcela: 1, dataVencimento: "10/09/2026", valorParcela: 202_860 },
      ],
    };
    const context = buildSalesOrderFinancialContext("PD 02607", "so-1", raw);
    const parsed = parseSalesOrderParcelFromArDescription("Pedido PD 02607 - Parcela 1")!;
    const audit = auditArOrderFinancialDivergence({
      externalId: 42,
      description: "Pedido PD 02607 - Parcela 1",
      dueDate: new Date(2026, 8, 10),
      amountReceivable: 311_580,
      context,
      parsed,
    });
    assert.ok(audit);
    assert.equal(audit?.parcelAmount, 202_860);
    assert.equal(audit?.delta, 108_720);
  });

  it("recebimento parcial escala proporcionalmente para parcela oficial", () => {
    const resolution = resolveArOrderFinancialAmounts({
      amountReceivable: 311_580,
      amountReceived: 155_790,
      balanceReceivable: 155_790,
      description: "Pedido PD 02607 - Parcela 1",
      dueDate: new Date(2026, 8, 10),
      parcel: { installmentNumber: 1, dueDate: new Date(2026, 8, 10), amount: 202_860 },
      linkedOrderCode: "PD 02607",
    });
    assert.equal(resolution.amountReceivable, 202_860);
    assert.equal(resolution.amountReceived, 101_430);
    assert.equal(resolution.balanceReceivable, 101_430);
  });
});
