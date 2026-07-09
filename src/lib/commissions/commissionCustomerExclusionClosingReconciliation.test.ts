import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommissionReceiptPreviewLine } from "./commissionReceiptEngine.js";
import {
  buildReceiptClosingPageFromPreview,
  mapPreviewLineToApiLine,
} from "./commissionReceiptClosingApi.js";
import { mapCustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";
import {
  buildCustomerExclusionClosingReconciliation,
  countManualExcludedCustomersInClosing,
} from "./commissionCustomerExclusionClosingReconciliation.js";
import { buildCommissionReceivableForecastPreview } from "./commissionReceiptEngine.js";
import { COMMISSION_GROUP_COMPANY_EXCLUSION_REASON } from "./commissionInternalGroupExclusion.js";
import type { CommissionSellerIdentityContext } from "./commissionSellerIdentity.js";

const identityCtx: CommissionSellerIdentityContext = {
  personsByNomusId: new Map(),
  personsById: new Map(),
  aliasesByNomusSellerId: new Map(),
  aliasesByNormalizedName: new Map(),
};

function previewLine(
  partial: Partial<CommissionReceiptPreviewLine> & Pick<CommissionReceiptPreviewLine, "ledgerLineKey">
): CommissionReceiptPreviewLine {
  return {
    year: 2026,
    month: 6,
    nomusReceivableId: 100,
    receivableNumber: "CR-100",
    installmentNumber: 1,
    settlementDate: "2026-06-15T00:00:00.000Z",
    dueDate: "2026-06-10T00:00:00.000Z",
    receivableAmount: 1000,
    receivedAmount: 1000,
    receivedSharePercent: 100,
    customerExternalId: 10,
    customerId: "cust-1",
    customerName: "ESMALTEC",
    nomusNfeId: 200,
    nfeNumber: "123",
    orderCode: "PED-1",
    localOrderId: "order-1",
    nomusOrderItemId: 1,
    localItemId: "item-1",
    productCode: "A",
    productName: "Produto A",
    rawSellerId: 464,
    rawSellerName: "GISLENE",
    canonicalSellerId: "seller-1",
    canonicalSellerName: "GISLENE LIMA",
    sellerResolutionStatus: "OK_CANONICAL",
    commissionRecordId: null,
    commissionPaymentScheduleId: null,
    commissionReceivableScheduleId: "sched-1",
    ruleId: "rule-ex-1",
    ruleName: "ESMALTEC",
    ratePercent: 2,
    commissionableBaseAmount: 1000,
    expectedCommissionAmount: 0,
    releasedCommissionAmount: 0,
    grossCommissionAmount: 0,
    status: "CUSTOMER_EXCLUDED",
    statusReason: "Cliente excluído de comissionamento",
    exclusionRuleId: "rule-ex-1",
    exclusionReason: "Política comercial",
    source: "MATERIALIZED_SCHEDULE",
    ...partial,
  };
}

describe("commissionCustomerExclusionClosingReconciliation", () => {
  it("reconciliação conta clientes excluídos iguais ao fechamento", () => {
    const closingPage = buildReceiptClosingPageFromPreview({
      preview: {
        year: 2026,
        month: 6,
        totalReceivables: 2,
        totalReceivedAmount: 2000,
        totalCommissionableBase: 1000,
        totalExpectedCommission: 20,
        totalReleasedCommission: 20,
        lines: [
          previewLine({ ledgerLineKey: "ex-1", nomusReceivableId: 100, ruleId: "rule-ex-1" }),
          previewLine({
            ledgerLineKey: "ok-1",
            nomusReceivableId: 101,
            status: "COMMISSIONABLE",
            customerName: "Cliente Mercado",
            expectedCommissionAmount: 20,
            releasedCommissionAmount: 20,
            grossCommissionAmount: 20,
            ruleId: "rule-1",
          }),
        ],
      },
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });

    const registeredRules = [
      mapCustomerExclusionRuleSnapshot({
        id: "rule-ex-1",
        customerId: "cust-1",
        customerExternalId: 10,
        customerNameSnapshot: "ESMALTEC",
        normalizedCustomerName: "esmaltec",
        reason: "Política comercial",
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: null,
        status: "ACTIVE",
        notes: null,
        customerTaxId: null,
      }),
    ];

    const payload = buildCustomerExclusionClosingReconciliation(closingPage, registeredRules);
    assert.equal(
      countManualExcludedCustomersInClosing(payload),
      closingPage.materializationSummary.excludedCustomerCount
    );
    assert.equal(payload.registeredRulesImpact[0]!.usedInClosing, true);
    assert.equal(payload.registeredRulesImpact[0]!.receivableCount, 1);
  });

  it("empresa do grupo aparece separada e não exige cadastro manual", () => {
    const closingPage = buildReceiptClosingPageFromPreview({
      preview: {
        year: 2026,
        month: 6,
        totalReceivables: 1,
        totalReceivedAmount: 1000,
        totalCommissionableBase: 0,
        totalExpectedCommission: 0,
        totalReleasedCommission: 0,
        lines: [
          previewLine({
            ledgerLineKey: "group-1",
            nomusReceivableId: 200,
            status: "GROUP_COMPANY_EXCLUDED",
            customerName: "Lazarios Comercio de Plasticos LTDA",
            customerExternalId: 99,
            ruleId: null,
            exclusionReason: COMMISSION_GROUP_COMPANY_EXCLUSION_REASON,
          }),
        ],
      },
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });

    const payload = buildCustomerExclusionClosingReconciliation(closingPage, []);
    assert.equal(payload.groupCompanyExcluded.length, 1);
    assert.equal(payload.fixedGroupCompanies.length, 3);
    assert.equal(payload.fixedGroupCompanies.every((c) => !c.requiresManualRegistration), true);
  });

  it("previsão exclui cliente com mesma regra do fechamento", () => {
    const rules = [
      mapCustomerExclusionRuleSnapshot({
        id: "rule-brit",
        customerId: null,
        customerExternalId: 500,
        customerNameSnapshot: "BRITANIA",
        normalizedCustomerName: "britania",
        reason: "Sem comissão",
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: null,
        status: "ACTIVE",
        notes: null,
        customerTaxId: null,
      }),
    ];
    const preview = buildCommissionReceivableForecastPreview({
      year: 2026,
      month: 6,
      receivables: [
        {
          nomusReceivableId: 300,
          receivableNumber: "CR-300",
          installmentNumber: 1,
          settlementDate: null,
          dueDate: new Date("2026-06-20"),
          amountReceivable: 1000,
          amountReceived: 0,
          balanceReceivable: 1000,
          nomusNfeId: 400,
          nfeNumber: "NF-400",
          customerExternalId: 500,
          customerId: null,
          customerName: "BRITANIA",
          customerCnpj: null,
        },
      ],
      ordersByNfeId: new Map(),
      materializedSchedulesByReceivableId: new Map(),
      rules: [],
      exclusionRules: rules,
      identityCtx,
    });
    assert.equal(preview.lines[0]!.status, "CUSTOMER_EXCLUDED");
  });

  it("linha CUSTOMER_EXCLUDED expõe ruleId para reconciliação", () => {
    const apiLine = mapPreviewLineToApiLine(
      previewLine({ ledgerLineKey: "ex", ruleId: "rule-xyz" })
    );
    assert.equal(apiLine.status, "CUSTOMER_EXCLUDED");
    assert.equal(apiLine.ruleId, "rule-xyz");
  });
});
