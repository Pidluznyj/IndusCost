import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasProductionCostDifference,
  resolveProductEngineeringCostWarning,
} from "./productEngineeringCostWarning.js";

describe("resolveProductEngineeringCostWarning", () => {
  it("officialCost=0.912785 e calculatedCost=0.912785 não gera pendência crítica", () => {
    const warning = resolveProductEngineeringCostWarning({
      officialCost: 0.912785,
      calculatedCost: 0.912785,
      officialHash: "pub",
      calculatedHash: "pub",
      hasDraft: false,
      hasOfficialPublished: true,
    });
    assert.ok(
      warning.warningStatus === "NONE" || warning.warningStatus === "COST_PUBLISHED_OK"
    );
    assert.equal(warning.hasCostImpact, false);
    assert.notEqual(warning.message, "Custo pendente para publicação");
  });

  it("officialCost=0.889728 e calculatedCost=0.912785 gera COST_DIFF_PENDING_PUBLICATION", () => {
    const warning = resolveProductEngineeringCostWarning({
      officialCost: 0.889728,
      calculatedCost: 0.912785,
      hasDraft: true,
      hasOfficialPublished: true,
    });
    assert.equal(warning.warningStatus, "COST_DIFF_PENDING_PUBLICATION");
    assert.equal(warning.hasCostImpact, true);
    assert.equal(warning.message, "Custo pendente para publicação");
  });

  it("custo igual com hash técnico diferente gera TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT", () => {
    const warning = resolveProductEngineeringCostWarning({
      officialCost: 0.912785,
      calculatedCost: 0.912785,
      officialHash: "hash-published",
      calculatedHash: "hash-draft",
      hasDraft: true,
      hasOfficialPublished: true,
    });
    assert.equal(warning.warningStatus, "TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT");
    assert.equal(warning.hasCostImpact, false);
    assert.equal(warning.hasTechnicalSnapshotPending, true);
    assert.equal(warning.message, "Snapshot técnico pendente sem impacto de custo");
  });

  it("produto sem custo oficial retorna MISSING_OFFICIAL_COST", () => {
    const warning = resolveProductEngineeringCostWarning({
      officialCost: null,
      calculatedCost: 0.912785,
      hasDraft: true,
      hasOfficialPublished: false,
    });
    assert.equal(warning.warningStatus, "MISSING_OFFICIAL_COST");
  });

  it("618.08AA — diferença zero sem alerta crítico", () => {
    const official = 0.912785;
    const calculated = 0.912785;
    assert.equal(hasProductionCostDifference(official, calculated), false);
    const warning = resolveProductEngineeringCostWarning({
      officialCost: official,
      calculatedCost: calculated,
      officialHash: "a",
      calculatedHash: "b",
      hasDraft: true,
      hasOfficialPublished: true,
    });
    assert.equal(warning.difference, 0);
    assert.equal(warning.warningStatus, "TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT");
    assert.notEqual(warning.warningStatus, "COST_DIFF_PENDING_PUBLICATION");
  });

  it("draft equivalente (mesmo custo e hash) não gera alerta de pendência", () => {
    const warning = resolveProductEngineeringCostWarning({
      officialCost: 0.912785,
      calculatedCost: 0.912785,
      officialHash: "hash-618",
      calculatedHash: "hash-618",
      hasDraft: true,
      hasOfficialPublished: true,
    });
    assert.equal(warning.hasCostImpact, false);
    assert.equal(warning.hasTechnicalSnapshotPending, false);
    assert.ok(
      warning.warningStatus === "NONE" || warning.warningStatus === "COST_PUBLISHED_OK"
    );
    assert.notEqual(warning.message, "Custo pendente para publicação");
  });

  it("tolerância ignora micro-diferença de ponto flutuante", () => {
    assert.equal(hasProductionCostDifference(0.912785, 0.9127850000004), false);
    const warning = resolveProductEngineeringCostWarning({
      officialCost: 0.912785,
      calculatedCost: 0.9127850000004,
      hasDraft: true,
      hasOfficialPublished: true,
      officialHash: "h1",
      calculatedHash: "h1",
    });
    assert.notEqual(warning.warningStatus, "COST_DIFF_PENDING_PUBLICATION");
  });
});
