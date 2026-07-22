import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildShadowMaterialPlan,
  classifyInboundPurchase,
  computeShadowNetNeed,
  explodeMaterialDemand,
  isExpectedDeliveryOnTime,
  isPurchaseStatusConfirmedForInbound,
} from "./shadowPurchasePlanningEngine.js";

const horizon = { from: "2026-07-17", to: "2026-10-15" };

describe("shadowPurchasePlanningEngine (OP-25)", () => {
  it("calcula necessidade líquida com a fórmula oficial", () => {
    const { netNeed, expression } = computeShadowNetNeed({
      futureDemand: 100,
      safetyStock: 20,
      availableStock: 40,
      onTimeConfirmedQty: 30,
    });
    assert.equal(netNeed, 50);
    assert.match(expression, /demandaFutura \+ estoqueSeguranca/);
  });

  it("não deixa necessidade negativa", () => {
    const { netNeed } = computeShadowNetNeed({
      futureDemand: 10,
      safetyStock: 0,
      availableStock: 100,
      onTimeConfirmedQty: 0,
    });
    assert.equal(netNeed, 0);
  });

  it("exclui compras atrasadas e não confirmadas da disponibilidade segura", () => {
    assert.equal(isPurchaseStatusConfirmedForInbound("CONFIRMADO"), true);
    assert.equal(isPurchaseStatusConfirmedForInbound("ENVIADO"), false);

    const late = classifyInboundPurchase({
      status: "CONFIRMADO",
      expectedDeliveryDate: "2026-07-01",
      quantityRemaining: 10,
      horizon,
    });
    assert.equal(late.safe, false);
    assert.match(late.exclusionReason ?? "", /atrasada/i);

    const unconfirmed = classifyInboundPurchase({
      status: "APROVADO",
      expectedDeliveryDate: "2026-08-01",
      quantityRemaining: 10,
      horizon,
    });
    assert.equal(unconfirmed.safe, false);
    assert.match(unconfirmed.exclusionReason ?? "", /não confirmado/i);

    const noDate = classifyInboundPurchase({
      status: "CONFIRMADO",
      expectedDeliveryDate: null,
      quantityRemaining: 10,
      horizon,
    });
    assert.equal(noDate.safe, false);
    assert.match(noDate.exclusionReason ?? "", /Sem data/i);

    const onTime = classifyInboundPurchase({
      status: "PARCIALMENTE_RECEBIDO",
      expectedDeliveryDate: "2026-08-01",
      quantityRemaining: 5,
      horizon,
    });
    assert.equal(onTime.safe, true);
    assert.equal(isExpectedDeliveryOnTime("2026-08-01", horizon), true);
  });

  it("explode demanda material e monta explicabilidade", () => {
    assert.equal(explodeMaterialDemand({ productQty: 10, bomQuantityPerProduct: 2.5 }), 25);

    const plan = buildShadowMaterialPlan({
      materialId: "m1",
      materialCode: "MP-01",
      materialDescription: "Aço",
      unit: "KG",
      futureDemand: 100,
      safetyStock: 10,
      availableStock: 20,
      onTimeConfirmedPurchases: [
        {
          purchaseOrderId: "po1",
          purchaseOrderCode: "PC-1",
          purchaseOrderItemId: "poi1",
          status: "CONFIRMADO",
          expectedDeliveryDate: "2026-08-01",
          quantityRemaining: 15,
        },
      ],
      excludedInbound: [
        {
          purchaseOrderId: "po2",
          purchaseOrderCode: "PC-2",
          purchaseOrderItemId: "poi2",
          status: "CONFIRMADO",
          expectedDeliveryDate: "2026-07-01",
          quantityRemaining: 50,
          exclusionReason: "Compra atrasada (data prevista anterior ao início do horizonte).",
        },
      ],
      demandSources: [
        {
          productionOrderId: "op1",
          productionOrderExternalId: 99,
          productSku: "SKU-1",
          productQty: 10,
          bomQtyPerProduct: 10,
          materialDemand: 100,
        },
      ],
    });

    // 100 + 10 - 20 - 15 = 75; atraso de 50 NÃO reduz
    assert.equal(plan.netNeed, 75);
    assert.equal(plan.suggestedOrderQty, 75);
    assert.equal(plan.onTimeConfirmedQty, 15);
    assert.equal(plan.explainability.excludedInbound.length, 1);
    assert.ok(plan.explainability.notes.some((n) => /Modo sombra/i.test(n)));
  });
});
