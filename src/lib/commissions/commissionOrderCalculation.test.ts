import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommercialPriceTierRow } from "./commission-commercial-tier.js";
import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";
import {
  calculateCommissionForSalesOrderItems,
  type CommissionOrderCalculationContext,
} from "./commissionOrderCalculation.js";
import type {
  CommissionActiveRule,
  CommissionOrderSourceBundle,
} from "./commission-types.js";

const SELLER_PERSON_ID = "550e8400-e29b-41d4-a716-446655440001";
const PRODUCT_ID = "660e8400-e29b-41d4-a716-446655440002";
const ITEM_ID = "770e8400-e29b-41d4-a716-446655440003";
const ORDER_ID = "880e8400-e29b-41d4-a716-446655440004";
const RULE_ID = "990e8400-e29b-41d4-a716-446655440005";

function sampleTiers(): CommercialPriceTierRow[] {
  return [
    { code: "ATACADO", name: "Atacado", salePrice: 10, commissionPercent: 1 },
    { code: "VAREJO_1", name: "Varejo 1", salePrice: 12, commissionPercent: 2 },
    { code: "VAREJO_2", name: "Varejo 2", salePrice: 14, commissionPercent: 3 },
    { code: "VAREJO_3", name: "Varejo 3", salePrice: 16, commissionPercent: 4 },
  ];
}

function fivePercentTiers(): CommercialPriceTierRow[] {
  return [
    { code: "ATACADO", name: "Atacado", salePrice: 10, commissionPercent: 1 },
    { code: "VAREJO_1", name: "Varejo 1", salePrice: 12, commissionPercent: 2 },
    { code: "VAREJO_2", name: "Varejo 2", salePrice: 14, commissionPercent: 5 },
    { code: "VAREJO_3", name: "Varejo 3", salePrice: 16, commissionPercent: 5 },
  ];
}

function baseRule(overrides: Partial<CommissionActiveRule> = {}): CommissionActiveRule {
  return {
    id: RULE_ID,
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
    ...overrides,
  };
}

function orderBundle(overrides: {
  itemNetAmount?: number;
  quantity?: number;
  unitPrice?: number;
  customerExternalId?: number | null;
  sellerId?: number | null;
  sellerName?: string | null;
  nfe?: { nfeExternalId: number; dataProcessamento: Date } | null;
}): CommissionOrderSourceBundle {
  const quantity = overrides.quantity ?? 10;
  const unitPrice = overrides.unitPrice ?? 1.2;
  const itemNetAmount = overrides.itemNetAmount ?? quantity * unitPrice;
  const nfe = overrides.nfe ?? null;

  return {
    localOrderId: ORDER_ID,
    nomusOrderId: 1001,
    orderCode: "PV-1001",
    issueDate: new Date("2026-06-15T00:00:00.000Z"),
    status: "ACTIVE",
    paymentTerms: null,
    paymentMethod: null,
    companyExternalId: 1,
    customerExternalId: overrides.customerExternalId ?? 200,
    customerName: "Cliente Teste",
    seller: {
      nomusSellerId: overrides.sellerId ?? 42,
      responsibleName: overrides.sellerName ?? "Vendedor Teste",
    },
    representative: { nomusRepresentativeId: null, name: null },
    items: [
      {
        localItemId: ITEM_ID,
        localProductId: PRODUCT_ID,
        nomusOrderItemId: 501,
        nomusProductId: 901,
        productCode: "610.01AA",
        productName: "Produto Teste",
        quantity,
        unitPrice,
        discount: 0,
        surcharge: 0,
        itemNetAmount,
      },
    ],
    forecastInstallments: [],
    linkedNfes: nfe
      ? [
          {
            nfeExternalId: nfe.nfeExternalId,
            nfeNumber: "12345",
            nfeStatus: 100,
            tipoOperacao: 1,
            dataProcessamento: nfe.dataProcessamento,
            nfeValue: itemNetAmount,
            isAuthorized: true,
            isCancelled: false,
            isOutputOperation: true,
            nomusNfeLocalId: null,
          },
        ]
      : [],
    authorizedOutputNfes: nfe
      ? [
          {
            nfeExternalId: nfe.nfeExternalId,
            nfeNumber: "12345",
            nfeStatus: 100,
            tipoOperacao: 1,
            dataProcessamento: nfe.dataProcessamento,
            nfeValue: itemNetAmount,
            isAuthorized: true,
            isCancelled: false,
            isOutputOperation: true,
            nomusNfeLocalId: null,
          },
        ]
      : [],
    outputDocumentsByNfeId: new Map(),
    receivablesByNfeId: new Map(),
  };
}

function baseContext(overrides: {
  tiers?: CommercialPriceTierRow[];
  rules?: CommissionActiveRule[];
  exclusionRules?: CustomerExclusionRuleSnapshot[];
  unitCost?: number;
  sellerPersonId?: string;
  sellerNomusId?: number;
}): CommissionOrderCalculationContext {
  const tiers = overrides.tiers ?? sampleTiers();
  const unitCost = overrides.unitCost ?? 4;
  return {
    rules: overrides.rules ?? [baseRule()],
    exclusionRules: overrides.exclusionRules ?? [],
    sellerIdentity: {
      persons: [
        {
          id: overrides.sellerPersonId ?? SELLER_PERSON_ID,
          nomusPersonId: overrides.sellerNomusId ?? 42,
          name: "Vendedor Teste",
          type: "SELLER",
          source: "NOMUS",
          active: true,
        },
      ],
      aliases: [],
    },
    commercialTiersByProductId: new Map([[PRODUCT_ID, tiers]]),
    unitProductionCostByProductId: new Map([[PRODUCT_ID, unitCost]]),
  };
}

describe("commissionOrderCalculation", () => {
  it("item com preço no Varejo 1 enquadra comissão em 2%", () => {
    const order = orderBundle({ quantity: 1, unitPrice: 12, itemNetAmount: 12 });
    const [line] = calculateCommissionForSalesOrderItems({
      orders: [order],
      context: baseContext({}),
    });

    assert.equal(line.status, "COMMISSIONABLE");
    assert.equal(line.commissionRatePercent, 2);
    assert.equal(line.grossCommissionAmount, 0.24);
    assert.equal(line.netCommissionAmount, 0.24);
    assert.equal(line.soldAmount, 12);
    assert.equal(line.ruleId, RULE_ID);
    assert.ok(line.marginPercent != null && line.marginPercent > 0);
  });

  it("item com preço no Varejo 2 enquadra comissão em 5%", () => {
    const order = orderBundle({ quantity: 1, unitPrice: 14, itemNetAmount: 14 });
    const [line] = calculateCommissionForSalesOrderItems({
      orders: [order],
      context: baseContext({ tiers: fivePercentTiers() }),
    });

    assert.equal(line.status, "COMMISSIONABLE");
    assert.equal(line.commissionRatePercent, 5);
    assert.equal(line.grossCommissionAmount, 0.7);
    assert.equal(line.netCommissionAmount, 0.7);
  });

  it("cliente excluído zera comissão final mas preserva bruta auditável", () => {
    const exclusionRules: CustomerExclusionRuleSnapshot[] = [
      {
        id: "excl-1",
        customerExternalId: 999,
        customerId: null,
        customerNameSnapshot: "Cliente Estratégico",
        normalizedCustomerName: "cliente estrategico",
        reason: "Cliente estratégico sem comissão",
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: null,
        status: "ACTIVE",
        notes: null,
      },
    ];
    const order = orderBundle({
      quantity: 1,
      unitPrice: 12,
      itemNetAmount: 12,
      customerExternalId: 999,
    });
    const [line] = calculateCommissionForSalesOrderItems({
      orders: [order],
      context: baseContext({ exclusionRules }),
    });

    assert.equal(line.status, "CUSTOMER_EXCLUDED");
    assert.equal(line.exclusionStatus, "EXCLUDED");
    assert.equal(line.commissionRatePercent, 0);
    assert.equal(line.grossCommissionAmount, 0.24);
    assert.equal(line.netCommissionAmount, 0);
    assert.ok(line.exclusionReason?.includes("estratégico"));
  });

  it("sem regra vigente retorna NO_RULE", () => {
    const order = orderBundle({});
    const [line] = calculateCommissionForSalesOrderItems({
      orders: [order],
      context: baseContext({ rules: [] }),
    });

    assert.equal(line.status, "NO_RULE");
    assert.equal(line.grossCommissionAmount, 0);
    assert.equal(line.ruleId, null);
  });

  it("vendedor não resolvido retorna SELLER_UNRESOLVED", () => {
    const order = orderBundle({ sellerId: 777, sellerName: "Desconhecido" });
    const [line] = calculateCommissionForSalesOrderItems({
      orders: [order],
      context: baseContext({
        sellerIdentity: {
          persons: [],
          aliases: [],
        },
      }),
    });

    assert.equal(line.status, "SELLER_UNRESOLVED");
    assert.equal(line.canonicalSellerId, null);
    assert.equal(line.grossCommissionAmount, 0);
    assert.equal(line.ruleId, null);
  });

  it("usa data da NF como referência quando autorizada", () => {
    const nfeDate = new Date("2026-06-20T00:00:00.000Z");
    const order = orderBundle({
      nfe: { nfeExternalId: 555, dataProcessamento: nfeDate },
    });
    const [line] = calculateCommissionForSalesOrderItems({
      orders: [order],
      context: baseContext({}),
    });

    assert.equal(line.nfeId, 555);
    assert.equal(line.referenceDate, nfeDate.toISOString());
  });
});
