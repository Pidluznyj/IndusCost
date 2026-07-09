import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseCustomerExclusionCreateBody,
  parseCustomerExclusionUpdateBody,
  CommissionValidationError,
} from "./commissionApiValidation.js";
import { parseCustomerExclusionRulesQuery } from "./commissionQuery.js";
import {
  CUSTOMER_COMMISSION_EXCLUSION_MESSAGE,
  exclusionDateRangesOverlap,
  exclusionRulesTargetSameCustomer,
  findConflictingActiveExclusionRule,
  isCustomerExclusionEffectiveOn,
  normalizeCustomerNameForExclusion,
  resolveApplicableCustomerExclusionRule,
  type CustomerExclusionRuleSnapshot,
} from "./commissionCustomerExclusion.js";

function rule(
  partial: Partial<CustomerExclusionRuleSnapshot> & Pick<CustomerExclusionRuleSnapshot, "id">
): CustomerExclusionRuleSnapshot {
  return {
    customerId: null,
    customerExternalId: null,
    customerTaxId: null,
    normalizedCustomerTaxId: null,
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

describe("commissionCustomerExclusion", () => {
  it("normaliza variações de nome do cliente", () => {
    assert.equal(normalizeCustomerNameForExclusion("  ESMALTEC S/A  "), "esmaltec s a");
    assert.equal(normalizeCustomerNameForExclusion("Esmaltec Indústria"), "esmaltec industria");
  });

  it("encontra regra por customerId", () => {
    const rules = [
      rule({
        id: "r1",
        customerId: "cust-1",
        customerExternalId: 999,
        normalizedCustomerName: "outro",
      }),
    ];
    const found = resolveApplicableCustomerExclusionRule(
      {
        customerId: "cust-1",
        customerExternalId: 123,
        customerName: "ESMALTEC",
        referenceDate: new Date("2026-08-15"),
      },
      rules
    );
    assert.ok(found);
    assert.equal(found.rule.id, "r1");
    assert.equal(found.exclusionMessage, CUSTOMER_COMMISSION_EXCLUSION_MESSAGE);
  });

  it("encontra regra por customerExternalId", () => {
    const rules = [rule({ id: "r2", customerExternalId: 12345 })];
    const found = resolveApplicableCustomerExclusionRule(
      {
        customerExternalId: 12345,
        customerName: "ESMALTEC",
        referenceDate: new Date("2026-08-01"),
      },
      rules
    );
    assert.ok(found);
    assert.equal(found.rule.id, "r2");
  });

  it("fallback por nome normalizado quando sem ID externo", () => {
    const rules = [
      rule({
        id: "r3",
        normalizedCustomerName: normalizeCustomerNameForExclusion("ESMALTEC S/A"),
        customerNameSnapshot: "ESMALTEC S/A",
      }),
    ];
    const found = resolveApplicableCustomerExclusionRule(
      {
        customerName: "Esmaltec S.A.",
        referenceDate: new Date("2026-07-10"),
      },
      rules
    );
    assert.ok(found);
    assert.equal(found.rule.id, "r3");
  });

  it("encontra regra por CNPJ normalizado", () => {
    const rules = [
      rule({
        id: "by-cnpj",
        customerTaxId: "12.345.678/0001-90",
        normalizedCustomerTaxId: "12345678000190",
      }),
    ];
    const found = resolveApplicableCustomerExclusionRule(
      {
        customerTaxId: "12345678000190",
        customerName: "Outro Nome",
        referenceDate: new Date("2026-07-10"),
      },
      rules
    );
    assert.ok(found);
    assert.equal(found.rule.id, "by-cnpj");
  });

  it("nome curto não gera falso positivo", () => {
    const rules = [rule({ id: "sm", normalizedCustomerName: "sm" })];
    const found = resolveApplicableCustomerExclusionRule(
      {
        customerName: "SM",
        referenceDate: new Date("2026-07-10"),
      },
      rules
    );
    assert.equal(found, null);
  });

  it("prioriza customerExternalId sobre nome", () => {
    const rules = [
      rule({ id: "by-name", normalizedCustomerName: "esmaltec" }),
      rule({ id: "by-ext", customerExternalId: 777 }),
    ];
    const found = resolveApplicableCustomerExclusionRule(
      {
        customerExternalId: 777,
        customerName: "ESMALTEC",
        referenceDate: new Date("2026-07-15"),
      },
      rules
    );
    assert.ok(found);
    assert.equal(found.rule.id, "by-ext");
  });

  it("não encontra regra inativa", () => {
    const rules = [rule({ id: "inactive", status: "INACTIVE" })];
    const found = resolveApplicableCustomerExclusionRule(
      {
        customerExternalId: 12345,
        referenceDate: new Date("2026-07-15"),
      },
      rules
    );
    assert.equal(found, null);
  });

  it("não encontra regra fora da vigência", () => {
    const rules = [
      rule({
        id: "jul",
        customerExternalId: 1,
        effectiveFrom: new Date("2026-07-01"),
        effectiveTo: new Date("2026-12-31"),
      }),
    ];
    assert.equal(
      resolveApplicableCustomerExclusionRule(
        { customerExternalId: 1, referenceDate: new Date("2026-06-30") },
        rules
      ),
      null
    );
    assert.equal(
      resolveApplicableCustomerExclusionRule(
        { customerExternalId: 1, referenceDate: new Date("2027-01-01") },
        rules
      ),
      null
    );
    assert.ok(
      resolveApplicableCustomerExclusionRule(
        { customerExternalId: 1, referenceDate: new Date("2026-07-01") },
        rules
      )
    );
  });

  it("valida conflito de vigência para mesmo cliente", () => {
    const existing = [
      {
        id: "existing",
        customerId: null,
        customerExternalId: 100,
        normalizedCustomerName: "esmaltec",
        effectiveFrom: new Date("2026-07-01"),
        effectiveTo: null,
      },
    ];
    const conflict = findConflictingActiveExclusionRule(
      {
        customerId: null,
        customerExternalId: 100,
        normalizedCustomerName: "esmaltec",
        effectiveFrom: new Date("2026-08-01"),
        effectiveTo: null,
      },
      existing
    );
    assert.ok(conflict);
    assert.equal(conflict.id, "existing");

    const noConflict = findConflictingActiveExclusionRule(
      {
        customerId: null,
        customerExternalId: 100,
        normalizedCustomerName: "esmaltec",
        effectiveFrom: new Date("2025-01-01"),
        effectiveTo: new Date("2025-12-31"),
      },
      existing
    );
    assert.equal(noConflict, null);
  });

  it("exclusionRulesTargetSameCustomer compara chaves distintas", () => {
    assert.equal(
      exclusionRulesTargetSameCustomer(
        { customerId: "a", customerExternalId: null, normalizedCustomerName: "" },
        { customerId: "a", customerExternalId: null, normalizedCustomerName: "" }
      ),
      true
    );
    assert.equal(
      exclusionRulesTargetSameCustomer(
        { customerId: null, customerExternalId: 5, normalizedCustomerName: "" },
        { customerId: null, customerExternalId: 5, normalizedCustomerName: "" }
      ),
      true
    );
    assert.equal(
      exclusionRulesTargetSameCustomer(
        { customerId: null, customerExternalId: null, normalizedCustomerName: "esmaltec" },
        { customerId: null, customerExternalId: null, normalizedCustomerName: "esmaltec" }
      ),
      true
    );
    assert.equal(
      exclusionRulesTargetSameCustomer(
        { customerId: "a", customerExternalId: null, normalizedCustomerName: "" },
        { customerId: "b", customerExternalId: null, normalizedCustomerName: "" }
      ),
      false
    );
  });

  it("exclusionDateRangesOverlap detecta sobreposição", () => {
    const openEnded = {
      effectiveFrom: new Date("2026-07-01"),
      effectiveTo: null,
    };
    assert.equal(
      exclusionDateRangesOverlap(openEnded, {
        effectiveFrom: new Date("2026-08-01"),
        effectiveTo: new Date("2026-09-01"),
      }),
      true
    );
    assert.equal(
      exclusionDateRangesOverlap(
        { effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-03-31") },
        { effectiveFrom: new Date("2026-04-01"), effectiveTo: new Date("2026-06-30") }
      ),
      false
    );
  });

  it("isCustomerExclusionEffectiveOn respeita status ACTIVE", () => {
    assert.equal(
      isCustomerExclusionEffectiveOn(
        {
          status: "INACTIVE",
          effectiveFrom: new Date("2026-01-01"),
          effectiveTo: null,
        },
        new Date("2026-06-01")
      ),
      false
    );
  });
});

describe("commissionCustomerExclusion validation", () => {
  it("cria regra — parse body válido", () => {
    const body = parseCustomerExclusionCreateBody({
      customerNameSnapshot: "ESMALTEC",
      customerExternalId: 12345,
      reason: "Cliente excluído de comissionamento",
      effectiveFrom: "2026-07-01",
    });
    assert.equal(body.customerNameSnapshot, "ESMALTEC");
    assert.equal(body.customerExternalId, 12345);
    assert.equal(body.reason, "Cliente excluído de comissionamento");
  });

  it("rejeita cliente ausente", () => {
    assert.throws(
      () =>
        parseCustomerExclusionCreateBody({
          reason: "Motivo",
          effectiveFrom: "2026-07-01",
        }),
      (error: unknown) =>
        error instanceof CommissionValidationError && error.code === "INVALID_FIELD"
    );
  });

  it("rejeita effectiveTo anterior a effectiveFrom", () => {
    assert.throws(
      () =>
        parseCustomerExclusionCreateBody({
          customerNameSnapshot: "ESMALTEC",
          reason: "Motivo",
          effectiveFrom: "2026-07-01",
          effectiveTo: "2026-06-01",
        }),
      (error: unknown) =>
        error instanceof CommissionValidationError && error.code === "INVALID_FIELD"
    );
  });

  it("lista regra — parse query", () => {
    const query = parseCustomerExclusionRulesQuery({
      page: "1",
      pageSize: "20",
      status: "ACTIVE",
      search: "esmaltec",
    });
    assert.equal(query.status, "ACTIVE");
    assert.equal(query.search, "esmaltec");
    assert.equal(query.page, 1);
  });

  it("atualiza regra — parse patch parcial", () => {
    const patch = parseCustomerExclusionUpdateBody({ reason: "Novo motivo" });
    assert.equal(patch.reason, "Novo motivo");
  });
});
