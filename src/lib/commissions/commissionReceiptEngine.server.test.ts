import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";
import {
  resolveMaterializedItemExclusionMeta,
  resolveMaterializedScheduleExclusionRuleId,
} from "./commissionReceiptEngine.js";

function exclusionRule(
  partial: Partial<CustomerExclusionRuleSnapshot> & Pick<CustomerExclusionRuleSnapshot, "id">
): CustomerExclusionRuleSnapshot {
  return {
    customerId: null,
    customerExternalId: 200,
    customerNameSnapshot: "Cliente Teste",
    normalizedCustomerName: "cliente teste",
    reason: "Política comercial",
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    status: "ACTIVE",
    notes: null,
    ...partial,
  };
}

function serverSrc(): string {
  return readFileSync(
    join(process.cwd(), "src/lib/commissions/commissionReceiptEngine.server.ts"),
    "utf8"
  );
}

describe("commissionReceiptEngine.server static", () => {
  it("loadMaterializedSchedulesByReceivableId não seleciona exclusionRuleId inexistente", () => {
    const src = serverSrc();
    assert.doesNotMatch(src, /exclusionRuleId:\s*true/);
    assert.match(src, /exclusionReason:\s*true/);
    assert.match(src, /ruleSnapshotJson:\s*true/);
    assert.match(src, /resolveMaterializedItemExclusionMeta/);
  });

  it("preview carrega regras de exclusão para enriquecer rastreabilidade", () => {
    const src = serverSrc();
    assert.match(src, /loadActiveCustomerExclusionRuleSnapshots\(\)/);
    assert.doesNotMatch(
      src,
      /useLegacyFallback \? loadActiveCustomerExclusionRuleSnapshots\(\) : Promise\.resolve\(\[\]\)/
    );
  });
});

describe("resolveMaterializedItemExclusionMeta", () => {
  it("lê exclusionReason do snapshot de item", () => {
    const meta = resolveMaterializedItemExclusionMeta({
      exclusionReason: "Cliente bloqueado",
      status: "CUSTOMER_EXCLUDED",
      ruleSnapshotJson: null,
    });
    assert.equal(meta.exclusionReason, "Cliente bloqueado");
    assert.equal(meta.exclusionRuleId, null);
  });

  it("lê exclusionRuleId embutido em ruleSnapshotJson quando existir", () => {
    const meta = resolveMaterializedItemExclusionMeta({
      exclusionReason: "Política",
      status: "CUSTOMER_EXCLUDED",
      ruleSnapshotJson: { exclusionRuleId: "ex-99", ruleId: "rule-1" },
    });
    assert.equal(meta.exclusionRuleId, "ex-99");
  });
});

describe("resolveMaterializedScheduleExclusionRuleId", () => {
  it("resolve regra ativa quando schedule está CUSTOMER_EXCLUDED", () => {
    const ruleId = resolveMaterializedScheduleExclusionRuleId({
      schedule: {
        customerId: "cust-1",
        scheduleStatus: "CUSTOMER_EXCLUDED",
        exclusionRuleId: null,
      },
      receivable: {
        customerId: "cust-1",
        customerExternalId: 10,
        customerName: "ESMALTEC",
        settlementDate: new Date("2026-06-15"),
      },
      exclusionRules: [exclusionRule({ id: "ex-1", customerId: "cust-1" })],
    });
    assert.equal(ruleId, "ex-1");
  });
});
