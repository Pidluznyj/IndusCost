import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateProportional,
  computeCommissionAmount,
  computeItemBaseAmount,
  computeReleasedAmountForReceivable,
  roundMoney,
} from "./commission-money.js";
import {
  buildCommissionCalculationHash,
  isPaidCommissionStatus,
} from "./commission-calculation-hash.js";
import {
  computeReleaseForSchedule,
  computeBalanceAfterRelease,
} from "./commission-release-service.js";
import {
  isRuleEffective,
  ruleMatchesContext,
  selectBestMatchingRule,
} from "./commission-rule-engine.js";
import type { CommissionActiveRule, CommissionOrderSourceBundle } from "./commission-types.js";

describe("commission-money", () => {
  it("computeItemBaseAmount aplica desconto e acréscimo", () => {
    const base = computeItemBaseAmount({
      quantity: 10,
      unitPrice: 100,
      discount: 50,
      surcharge: 20,
    });
    assert.equal(base, 970);
  });

  it("computeCommissionAmount usa percentual sobre base", () => {
    assert.equal(computeCommissionAmount(1000, 5), 50);
    assert.equal(computeCommissionAmount(333.33, 3), 10);
  });

  it("allocateProportional fecha o total sem perder centavos", () => {
    const parts = allocateProportional(100, [
      { key: "a", weight: 1 },
      { key: "b", weight: 1 },
      { key: "c", weight: 1 },
    ]);
    const sum = roundMoney(parts.reduce((s, p) => s + p.amount, 0));
    assert.equal(sum, 100);
  });

  it("computeReleasedAmountForReceivable libera proporcionalmente", () => {
    const delta = computeReleasedAmountForReceivable({
      commissionAmount: 100,
      alreadyReleased: 0,
      receivableAmount: 1000,
      receivedAmount: 250,
    });
    assert.equal(delta, 25);
  });
});

describe("commission-calculation-hash", () => {
  it("hash é determinístico", () => {
    const a = buildCommissionCalculationHash({
      nomusOrderId: 1,
      orderCode: "PD00001",
      nomusOrderItemId: 10,
      nomusNfeId: null,
      nomusOutputDocumentId: null,
      commissionPersonId: "uuid-1",
      beneficiaryType: "SELLER",
      originStage: "SALES_ORDER",
    });
    const b = buildCommissionCalculationHash({
      nomusOrderId: 1,
      orderCode: "PD00001",
      nomusOrderItemId: 10,
      nomusNfeId: null,
      nomusOutputDocumentId: null,
      commissionPersonId: "uuid-1",
      beneficiaryType: "SELLER",
      originStage: "SALES_ORDER",
    });
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  it("isPaidCommissionStatus identifica pagos", () => {
    assert.equal(isPaidCommissionStatus("PAID_TOTAL"), true);
    assert.equal(isPaidCommissionStatus("RELEASED"), false);
  });
});

describe("commission-release-service", () => {
  it("EACH_RECEIVABLE_PAID libera parcialmente", () => {
    const result = computeReleaseForSchedule({
      releaseRule: "EACH_RECEIVABLE_PAID",
      commissionAmount: 200,
      alreadyReleased: 50,
      isFirstReceivablePaidInOrder: false,
      receivable: {
        nomusReceivableId: 1,
        nomusNfeId: 10,
        installmentNumber: 1,
        dueDate: null,
        amountReceivable: 1000,
        amountReceived: 500,
        balanceReceivable: 500,
        settlementDate: null,
      },
      schedule: {
        scheduleKey: "s1",
        source: "ACCOUNTS_RECEIVABLE",
        status: "ACTIVE",
        nomusOrderId: 1,
        nomusNfeId: 10,
        nomusReceivableId: 1,
        installmentNumber: 1,
        dueDate: null,
        expectedAmount: null,
        receivableAmount: 1000,
        receivedAmount: 500,
        openBalance: 500,
        allocationPercent: 100,
        commissionExpectedAmount: 200,
        commissionReleasedAmount: 50,
      },
    });
    assert.equal(result.releasedDelta, 50);
    assert.equal(result.newReleasedTotal, 100);
    assert.equal(result.newRecordStatus, "PARTIALLY_RELEASED");
  });

  it("computeBalanceAfterRelease", () => {
    assert.equal(computeBalanceAfterRelease(100, 60, 20), 20);
  });
});

function sampleOrder(): CommissionOrderSourceBundle {
  return {
    localOrderId: "order-1",
    nomusOrderId: 100,
    orderCode: "PD00100",
    issueDate: new Date("2026-01-15"),
    status: "SENT_TO_NOMUS",
    paymentTerms: "30/60",
    paymentMethod: null,
    companyExternalId: 1,
    customerExternalId: 50,
    customerName: "Cliente Teste",
    seller: { nomusSellerId: 10, responsibleName: "Vendedor A" },
    representative: { nomusRepresentativeId: null, name: null },
    items: [
      {
        localItemId: "item-1",
        localProductId: "prod-1",
        nomusOrderItemId: 1001,
        nomusProductId: 200,
        productCode: "SKU-1",
        productName: "Produto 1",
        quantity: 2,
        unitPrice: 100,
        discount: 0,
        surcharge: 0,
        itemNetAmount: 200,
      },
    ],
    forecastInstallments: [
      { installmentNumber: 1, dueDate: new Date("2026-02-15"), expectedAmount: 200, paymentConditionExternalId: null },
    ],
    linkedNfes: [],
    authorizedOutputNfes: [],
    outputDocumentsByNfeId: new Map(),
    receivablesByNfeId: new Map(),
  };
}

describe("commission-rule-engine", () => {
  const baseRule: CommissionActiveRule = {
    id: "rule-1",
    name: "Vendedor 5%",
    active: true,
    priority: 100,
    beneficiaryType: "SELLER",
    calculationType: "FIXED_PERCENT",
    fixedCommissionPersonId: null,
    ratePercent: 5,
    baseType: "SALES_ORDER_ITEM_NET",
    releaseRule: "EACH_RECEIVABLE_PAID",
    validFrom: null,
    validTo: null,
    conditions: [],
  };

  it("isRuleEffective respeita vigência", () => {
    assert.equal(
      isRuleEffective(
        { ...baseRule, validFrom: new Date("2026-06-01"), validTo: null },
        new Date("2026-05-01")
      ),
      false
    );
    assert.equal(
      isRuleEffective(
        { ...baseRule, validFrom: new Date("2026-01-01"), validTo: null },
        new Date("2026-05-01")
      ),
      true
    );
  });

  it("selectBestMatchingRule escolhe por prioridade", () => {
    const order = sampleOrder();
    const item = order.items[0];
    const ctx = {
      referenceDate: new Date("2026-01-15"),
      order,
      item,
      beneficiaryType: "SELLER" as const,
      nomusSellerId: 10,
      nomusRepresentativeId: null,
      commissionPersonId: "person-1",
    };
    const match = selectBestMatchingRule(
      [
        { ...baseRule, id: "r2", priority: 200, ratePercent: 3 },
        { ...baseRule, id: "r1", priority: 100, ratePercent: 5 },
      ],
      ctx
    );
    assert.ok(match);
    assert.equal(match.rule.id, "r1");
    assert.equal(match.ratePercent, 5);
  });

  it("ruleMatchesContext filtra beneficiaryType", () => {
    const order = sampleOrder();
    const ctx = {
      referenceDate: new Date("2026-01-15"),
      order,
      item: order.items[0],
      beneficiaryType: "REPRESENTATIVE" as const,
      nomusSellerId: 10,
      nomusRepresentativeId: null,
      commissionPersonId: null,
    };
    assert.equal(ruleMatchesContext(baseRule, ctx), false);
  });
});
