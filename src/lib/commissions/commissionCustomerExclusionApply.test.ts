import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCustomerExclusionToCommission,
  parseCustomerExclusionFromMetadata,
  resolveCustomerExclusionForSale,
  resolveVisualAuditCustomerExclusion,
} from "./commissionCustomerExclusionApply.js";
import {
  CUSTOMER_COMMISSION_EXCLUSION_MESSAGE,
  isCustomerExclusionEffectiveOn,
  type CustomerExclusionRuleSnapshot,
} from "./commissionCustomerExclusion.js";

function rule(
  partial: Partial<CustomerExclusionRuleSnapshot> & Pick<CustomerExclusionRuleSnapshot, "id">
): CustomerExclusionRuleSnapshot {
  return {
    customerId: null,
    customerExternalId: 100,
    customerNameSnapshot: "ESMALTEC",
    normalizedCustomerName: "esmaltec",
    reason: "Política comercial",
    effectiveFrom: new Date("2026-07-01"),
    effectiveTo: null,
    status: "ACTIVE",
    notes: null,
    ...partial,
  };
}

describe("commissionCustomerExclusionApply", () => {
  it("cliente sem regra calcula comissão normal", () => {
    const applied = applyCustomerExclusionToCommission({
      exclusion: null,
      ratePercent: 2.5,
      commissionAmount: 25,
    });
    assert.equal(applied.excluded, false);
    assert.equal(applied.ratePercent, 2.5);
    assert.equal(applied.commissionAmount, 25);
    assert.equal(applied.shouldPersist, true);
  });

  it("cliente com regra ativa gera comissão zero", () => {
    const exclusion = {
      rule: rule({ id: "ex-1" }),
      reason: "Política comercial",
      exclusionMessage: CUSTOMER_COMMISSION_EXCLUSION_MESSAGE,
    };
    const applied = applyCustomerExclusionToCommission({
      exclusion,
      ratePercent: 2.5,
      commissionAmount: 25,
    });
    assert.equal(applied.excluded, true);
    assert.equal(applied.ratePercent, 0);
    assert.equal(applied.commissionAmount, 0);
    assert.equal(applied.shouldPersist, true);
    assert.equal(applied.metadataPatch.customerExcluded, true);
    assert.equal(applied.metadataPatch.isCommissionable, false);
    assert.equal(applied.metadataPatch.exclusionRuleId, "ex-1");
    assert.equal(applied.metadataPatch.originalRatePercent, 2.5);
    assert.equal(applied.metadataPatch.originalCommissionAmount, 25);
  });

  it("cliente com regra fora da vigência calcula normal", () => {
    const rules = [
      rule({
        id: "jul",
        effectiveFrom: new Date("2026-07-01"),
        effectiveTo: new Date("2026-12-31"),
      }),
    ];
    const exclusion = resolveCustomerExclusionForSale({
      customerExternalId: 100,
      customerName: "ESMALTEC",
      referenceDate: new Date("2026-06-15"),
      rules,
    });
    assert.equal(exclusion, null);
  });

  it("cliente com regra inativa calcula normal", () => {
    const rules = [rule({ id: "inactive", status: "INACTIVE" })];
    const exclusion = resolveCustomerExclusionForSale({
      customerExternalId: 100,
      referenceDate: new Date("2026-08-01"),
      rules,
    });
    assert.equal(exclusion, null);
    assert.equal(
      isCustomerExclusionEffectiveOn(
        { status: "INACTIVE", effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
        new Date("2026-08-01")
      ),
      false
    );
  });

  it("matching por externalId funciona na elegibilidade", () => {
    const exclusion = resolveCustomerExclusionForSale({
      customerExternalId: 100,
      customerName: "OUTRO NOME",
      referenceDate: new Date("2026-08-01"),
      rules: [rule({ id: "by-ext", customerExternalId: 100 })],
    });
    assert.ok(exclusion);
    assert.equal(exclusion.rule.id, "by-ext");
  });

  it("fallback por nome normalizado funciona", () => {
    const exclusion = resolveCustomerExclusionForSale({
      customerName: "Esmaltec S/A",
      referenceDate: new Date("2026-08-01"),
      rules: [
        rule({
          id: "by-name",
          customerExternalId: null,
          normalizedCustomerName: "esmaltec s a",
        }),
      ],
    });
    assert.ok(exclusion);
    assert.equal(exclusion.rule.id, "by-name");
  });

  it("auditoria visual zera comissão prevista/liberada para cliente excluído", () => {
    const view = resolveVisualAuditCustomerExclusion({
      metadataJson: {
        customerExcluded: true,
        isCommissionable: false,
        exclusionRuleId: "ex-1",
        exclusionReason: "Política comercial",
        exclusionMessage: CUSTOMER_COMMISSION_EXCLUSION_MESSAGE,
      },
      customerExternalId: 100,
      legacyExceptionCustomerIds: new Set<number>(),
      commissionExpected: 50,
      commissionReleased: 10,
      itemRatePercent: 2.5,
    });
    assert.equal(view.customerNoCommission, true);
    assert.equal(view.isCommissionable, false);
    assert.equal(view.commissionExpected, 0);
    assert.equal(view.commissionReleased, 0);
    assert.equal(view.itemRatePercent, 0);
    assert.equal(view.exclusionRuleId, "ex-1");
  });

  it("parse metadata expõe campos de export", () => {
    const meta = parseCustomerExclusionFromMetadata({
      customerExcluded: true,
      isCommissionable: false,
      exclusionRuleId: "ex-99",
      exclusionReason: "Teste",
    });
    assert.equal(meta.customerExcluded, true);
    assert.equal(meta.isCommissionable, false);
    assert.equal(meta.exclusionRuleId, "ex-99");
  });
});
