import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeComparableCost,
  computeNegotiationSavings,
  NegotiationSavingsError,
} from "./negotiationSavingsEngine.js";

describe("negotiationSavingsEngine (OP-16)", () => {
  it("calcula custo comparável básico (itens + frete + impostos + despesas − descontos)", () => {
    const r = computeComparableCost({
      currency: "BRL",
      freightIncoterm: "FOB",
      lines: [
        {
          unitPrice: 10,
          quantity: 5,
          freightValue: 2,
          nonRecoverableTaxes: 1,
          expenses: 0.5,
          discounts: 0.5,
        },
      ],
      headerFreight: 3,
      headerNonRecoverableTaxes: 1,
      headerExpenses: 2,
      headerDiscounts: 1,
    });
    // items 50 + freight 2+3 + taxes 1+1 + expenses 0.5+2 − discounts 0.5+1 = 58
    assert.equal(r.itemsSubtotal, 50);
    assert.equal(r.comparableCost, 58);
  });

  it("CIF não soma frete no custo do comprador; FOB soma", () => {
    const base = {
      currency: "BRL",
      lines: [{ unitPrice: 100, quantity: 1, freightValue: 20 }],
      headerFreight: 5,
    };
    const cif = computeComparableCost({ ...base, freightIncoterm: "CIF" });
    const fob = computeComparableCost({ ...base, freightIncoterm: "FOB" });
    assert.equal(cif.comparableCost, 100);
    assert.equal(cif.freightTotal, 0);
    assert.equal(fob.comparableCost, 125);
    assert.equal(fob.freightTotal, 25);
  });

  it("múltiplos itens agrega quantidade e ganho unitário", () => {
    const savings = computeNegotiationSavings({
      initial: {
        currency: "BRL",
        freightIncoterm: "FOB",
        lines: [
          { unitPrice: 10, quantity: 10 },
          { unitPrice: 20, quantity: 5 },
        ],
      },
      negotiated: {
        currency: "BRL",
        freightIncoterm: "FOB",
        lines: [
          { unitPrice: 8, quantity: 10 },
          { unitPrice: 18, quantity: 5 },
        ],
      },
    });
    // initial 100+100=200; negotiated 80+90=170; gain 30; qty 15; unit 2
    assert.equal(savings.initialComparableCost, 200);
    assert.equal(savings.negotiatedComparableCost, 170);
    assert.equal(savings.totalGain, 30);
    assert.equal(savings.unitGain, 2);
    assert.equal(savings.percentGain, 15);
    assert.equal(savings.totalQuantity, 15);
  });

  it("preços iguais → ganho zero", () => {
    const savings = computeNegotiationSavings({
      initial: { currency: "usd", lines: [{ unitPrice: 5, quantity: 2 }] },
      negotiated: { currency: "USD", lines: [{ unitPrice: 5, quantity: 2 }] },
    });
    assert.equal(savings.totalGain, 0);
    assert.equal(savings.pricesEqual, true);
    assert.equal(savings.percentGain, 0);
  });

  it("aumento de custo → ganho negativo e costIncreased", () => {
    const savings = computeNegotiationSavings({
      initial: { currency: "BRL", lines: [{ unitPrice: 10, quantity: 1 }] },
      negotiated: { currency: "BRL", lines: [{ unitPrice: 12, quantity: 1 }] },
    });
    assert.equal(savings.totalGain, -2);
    assert.equal(savings.costIncreased, true);
    assert.equal(savings.percentGain, -20);
  });

  it("divisão por zero: custo inicial 0 → percentGain null; qty 0 → unitGain null", () => {
    const zeroInitial = computeNegotiationSavings({
      initial: { currency: "BRL", lines: [{ unitPrice: 0, quantity: 10 }] },
      negotiated: { currency: "BRL", lines: [{ unitPrice: 0, quantity: 10 }] },
    });
    assert.equal(zeroInitial.percentGain, null);

    const zeroQty = computeNegotiationSavings({
      initial: { currency: "BRL", lines: [{ unitPrice: 10, quantity: 0 }] },
      negotiated: { currency: "BRL", lines: [{ unitPrice: 8, quantity: 0 }] },
    });
    assert.equal(zeroQty.unitGain, null);
    assert.equal(zeroQty.totalGain, 0);
  });

  it("moedas incompatíveis lançam CURRENCY_MISMATCH", () => {
    assert.throws(
      () =>
        computeNegotiationSavings({
          initial: { currency: "BRL", lines: [{ unitPrice: 1, quantity: 1 }] },
          negotiated: { currency: "USD", lines: [{ unitPrice: 1, quantity: 1 }] },
        }),
      (e: unknown) => e instanceof NegotiationSavingsError && e.code === "CURRENCY_MISMATCH"
    );
  });

  it("quantidade inválida (negativa) é rejeitada", () => {
    assert.throws(
      () =>
        computeComparableCost({
          currency: "BRL",
          lines: [{ unitPrice: 1, quantity: -1 }],
        }),
      NegotiationSavingsError
    );
  });

  it("não monetiza prazo/pagamento/lote — registra como ganho de condição", () => {
    const savings = computeNegotiationSavings({
      initial: { currency: "BRL", lines: [{ unitPrice: 100, quantity: 1 }] },
      negotiated: { currency: "BRL", lines: [{ unitPrice: 100, quantity: 1 }] },
      condition: {
        previousLeadTimeDays: 30,
        newLeadTimeDays: 15,
        previousPaymentTerms: "30 DDL",
        newPaymentTerms: "60 DDL",
        previousMinOrderQty: 100,
        newMinOrderQty: 50,
        previousWarranty: "6 meses",
        newWarranty: "12 meses",
      },
    });
    assert.equal(savings.totalGain, 0);
    assert.ok(savings.conditionGains.some((c) => c.field === "leadTimeDays" && c.improved === true));
    assert.ok(savings.conditionGains.some((c) => c.field === "paymentTerms"));
    assert.ok(savings.conditionGains.some((c) => c.field === "minOrderQty" && c.improved === true));
    assert.ok(savings.conditionGains.some((c) => c.field === "warranty"));
    // Nenhuma condição entra no custo monetário
    assert.equal(savings.initialComparableCost, 100);
  });

  it("frete CIF vs FOB no ganho total", () => {
    const savings = computeNegotiationSavings({
      initial: {
        currency: "BRL",
        freightIncoterm: "FOB",
        lines: [{ unitPrice: 100, quantity: 1, freightValue: 20 }],
      },
      negotiated: {
        currency: "BRL",
        freightIncoterm: "CIF",
        lines: [{ unitPrice: 110, quantity: 1, freightValue: 20 }],
      },
    });
    // initial 120; negotiated CIF 110 (frete ignorado); gain 10
    assert.equal(savings.initialComparableCost, 120);
    assert.equal(savings.negotiatedComparableCost, 110);
    assert.equal(savings.totalGain, 10);
  });
});
