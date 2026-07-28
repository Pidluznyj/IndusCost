import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateSalesOrderItemCommercialMargin,
  unavailableCommercialMarginItem,
} from "./salesOrderCommercialMargin.js";

/**
 * Classificação de origem — cobre contratos do domínio (sem DB).
 * O adapter server usa EXACT_PROPOSAL_SNAPSHOT → EXACT_PRICE_TABLE_VERSION →
 * RECONSTRUCTED_AT_ORDER_DATE → UNAVAILABLE.
 */
describe("salesOrderCommercialMargin — classificação histórica", () => {
  const baseRates = {
    taxRate: 0.2875,
    commissionRate: 0.05,
    otherRate: 0.02,
    freightRate: 0.03,
    freight: 0,
  };

  it("marca EXACT_PROPOSAL_SNAPSHOT", () => {
    const item = calculateSalesOrderItemCommercialMargin({
      soldQuantity: 1,
      negotiatedUnitPrice: 250,
      frozenTotalCost: 100,
      rates: baseRates,
      calculationSource: "EXACT_PROPOSAL_SNAPSHOT",
      priceTableVersionId: "snap-v1",
      referenceDate: "2024-06-01",
    });
    assert.equal(item.calculationSource, "EXACT_PROPOSAL_SNAPSHOT");
    assert.equal(item.priceTableVersionId, "snap-v1");
    assert.equal(item.isComplete, true);
  });

  it("marca EXACT_PRICE_TABLE_VERSION", () => {
    const item = calculateSalesOrderItemCommercialMargin({
      soldQuantity: 1,
      negotiatedUnitPrice: 250,
      frozenTotalCost: 100,
      rates: baseRates,
      calculationSource: "EXACT_PRICE_TABLE_VERSION",
      priceTableVersionId: "ptv-9",
      referenceDate: "2024-06-01",
    });
    assert.equal(item.calculationSource, "EXACT_PRICE_TABLE_VERSION");
  });

  it("marca RECONSTRUCTED_AT_ORDER_DATE com aviso", () => {
    const item = calculateSalesOrderItemCommercialMargin({
      soldQuantity: 1,
      negotiatedUnitPrice: 250,
      frozenTotalCost: 100,
      rates: baseRates,
      calculationSource: "RECONSTRUCTED_AT_ORDER_DATE",
      referenceDate: "2024-01-10",
      warnings: [
        "Formação reconstruída pela versão da tabela comercial vigente na data do pedido.",
      ],
    });
    assert.equal(item.calculationSource, "RECONSTRUCTED_AT_ORDER_DATE");
    assert.match(item.warnings.join(" "), /reconstruída/i);
  });

  it("snapshot completo não depende de tabela publicada depois", () => {
    const withSnapshot = calculateSalesOrderItemCommercialMargin({
      soldQuantity: 2,
      negotiatedUnitPrice: 300,
      frozenTotalCost: 80,
      rates: baseRates,
      calculationSource: "EXACT_PROPOSAL_SNAPSHOT",
      priceTableVersionId: "old-version",
      referenceDate: "2023-12-01",
    });
    // Nova tabela publicada depois não altera o payload já calculado com snapshot.
    assert.equal(withSnapshot.priceTableVersionId, "old-version");
    assert.equal(withSnapshot.calculationSource, "EXACT_PROPOSAL_SNAPSHOT");
    assert.equal(withSnapshot.referenceDate, "2023-12-01");
  });

  it("dado incompleto → UNAVAILABLE sem fabricar zeros", () => {
    const unavailable = unavailableCommercialMarginItem({
      soldQuantity: 3,
      negotiatedUnitPrice: 120,
      soldValue: 360,
      warnings: [
        "Margem comercial indisponível. Não foi possível identificar a formação de preço utilizada nesta venda.",
      ],
    });
    assert.equal(unavailable.calculationSource, "UNAVAILABLE");
    assert.equal(unavailable.isComplete, false);
    assert.equal(unavailable.costUnit, null);
    assert.equal(unavailable.taxRate, null);
    assert.equal(unavailable.commissionRate, null);
    assert.equal(unavailable.freightRate, null);
    assert.equal(unavailable.commercialMarginPercent, null);
  });
});
