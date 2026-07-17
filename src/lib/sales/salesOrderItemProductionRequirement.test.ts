import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SALES_ORDER_ITEM_PRODUCTION_REQUIREMENT_CLASSIFICATIONS,
  resolveSalesOrderItemProductionRequirement,
  salesOrderItemProductionRequirementInconsistencyCode,
} from "./salesOrderItemProductionRequirement.js";

describe("salesOrderItemProductionRequirement", () => {
  it("expõe as 3 classificações oficiais", () => {
    assert.deepEqual([...SALES_ORDER_ITEM_PRODUCTION_REQUIREMENT_CLASSIFICATIONS], [
      "REQUIRED",
      "NOT_REQUIRED",
      "UNKNOWN",
    ]);
  });

  it("produto fabricado (classificação + roteiro) → REQUIRED", () => {
    const r = resolveSalesOrderItemProductionRequirement({
      productCommercialClass: "MANUFACTURED",
      costingMode: "OWN_PROCESS",
      hasProductRouting: true,
      routingStepCount: 2,
    });
    assert.equal(r.classification, "REQUIRED");
    assert.equal(r.requiresProduction, true);
    assert.equal(r.impliesInconsistency, false);
    assert.ok(
      r.evidence.signals.some((s) => s.reasonCode === "PRODUCT_CLASS_MANUFACTURED")
    );
    assert.ok(
      r.evidence.signals.some((s) => s.reasonCode === "PRODUCT_ROUTING_PRESENT")
    );
    assert.ok(["PRODUCT", "ROUTING"].includes(r.sourceEntity));
  });

  it("OWN_PROCESS sem outras evidências → REQUIRED (regra oficial do produto)", () => {
    const r = resolveSalesOrderItemProductionRequirement({
      productType: "PRODUCT",
      costingMode: "OWN_PROCESS",
    });
    assert.equal(r.classification, "REQUIRED");
    assert.equal(r.reasonCode, "COSTING_MODE_OWN_PROCESS");
    assert.equal(r.sourceEntity, "PRODUCT");
    assert.equal(r.confidence, "MEDIUM");
  });

  it("revenda comprovada sem OP/BOM/roteiro → NOT_REQUIRED", () => {
    const r = resolveSalesOrderItemProductionRequirement({
      productCommercialClass: "RESALE",
      hasOfficialProductionOrderLink: false,
    });
    assert.equal(r.classification, "NOT_REQUIRED");
    assert.equal(r.requiresProduction, false);
    assert.equal(r.reasonCode, "PRODUCT_CLASS_RESALE");
    assert.equal(r.sourceEntity, "PRODUCT");
    assert.equal(r.impliesInconsistency, false);
  });

  it("estoque comprovado sem evidência produtiva → NOT_REQUIRED", () => {
    const r = resolveSalesOrderItemProductionRequirement({
      productCommercialClass: "STOCK",
      hasProductBom: false,
      hasProductRouting: false,
    });
    assert.equal(r.classification, "NOT_REQUIRED");
    assert.equal(r.reasonCode, "PRODUCT_CLASS_STOCK");
    assert.equal(r.requiresProduction, false);
  });

  it("OP oficial vinculada → REQUIRED (existência de OP é evidência)", () => {
    const r = resolveSalesOrderItemProductionRequirement({
      hasOfficialProductionOrderLink: true,
      productionOrderLinkIsCurrent: true,
    });
    assert.equal(r.classification, "REQUIRED");
    assert.equal(r.reasonCode, "OFFICIAL_PRODUCTION_ORDER_LINK");
    assert.equal(r.sourceEntity, "PRODUCTION_ORDER_LINK");
    assert.equal(r.confidence, "HIGH");
  });

  it("BOM ou roteiro presentes → REQUIRED", () => {
    const bom = resolveSalesOrderItemProductionRequirement({
      hasProductBom: true,
      bomLineCount: 3,
    });
    assert.equal(bom.classification, "REQUIRED");
    assert.equal(bom.reasonCode, "PRODUCT_BOM_PRESENT");
    assert.equal(bom.sourceEntity, "BOM");

    const routing = resolveSalesOrderItemProductionRequirement({
      routingStepCount: 1,
    });
    assert.equal(routing.classification, "REQUIRED");
    assert.equal(routing.reasonCode, "PRODUCT_ROUTING_PRESENT");
  });

  it("movimentação de produção → REQUIRED", () => {
    const r = resolveSalesOrderItemProductionRequirement({
      inventoryMovementType: "PRODUCTION_ENTRY",
    });
    assert.equal(r.classification, "REQUIRED");
    assert.equal(r.reasonCode, "PRODUCTION_MOVEMENT_PRESENT");
    assert.equal(r.sourceEntity, "MOVEMENT");
  });

  it("ausência de evidência → UNKNOWN (não conclui; inconsistência)", () => {
    const r = resolveSalesOrderItemProductionRequirement({});
    assert.equal(r.classification, "UNKNOWN");
    assert.equal(r.requiresProduction, null);
    assert.equal(r.reasonCode, "NO_EVIDENCE");
    assert.equal(r.sourceEntity, "NONE");
    assert.equal(r.impliesInconsistency, true);
    assert.equal(
      salesOrderItemProductionRequirementInconsistencyCode(r),
      "REQUIRES_PRODUCTION_UNKNOWN"
    );
  });

  it("ausência de OP sozinha não implica NOT_REQUIRED", () => {
    const r = resolveSalesOrderItemProductionRequirement({
      hasOfficialProductionOrderLink: false,
    });
    assert.notEqual(r.classification, "NOT_REQUIRED");
    assert.equal(r.classification, "UNKNOWN");
    assert.equal(r.reasonCode, "OP_ABSENCE_NOT_CONCLUSIVE");
    assert.equal(r.impliesInconsistency, true);
  });

  it("conflito: revenda + OP oficial → UNKNOWN", () => {
    const r = resolveSalesOrderItemProductionRequirement({
      productCommercialClass: "RESALE",
      hasOfficialProductionOrderLink: true,
      productionOrderLinkIsCurrent: true,
    });
    assert.equal(r.classification, "UNKNOWN");
    assert.equal(r.reasonCode, "CONFLICTING_EVIDENCE");
    assert.equal(r.requiresProduction, null);
    assert.equal(r.impliesInconsistency, true);
    assert.ok(r.evidence.requiredSignalCount >= 1);
    assert.ok(r.evidence.notRequiredSignalCount >= 1);
  });

  it("conflito: estoque + BOM → UNKNOWN", () => {
    const r = resolveSalesOrderItemProductionRequirement({
      productCommercialClass: "STOCK",
      hasProductBom: true,
    });
    assert.equal(r.classification, "UNKNOWN");
    assert.equal(r.reasonCode, "CONFLICTING_EVIDENCE");
  });

  it("regra IndusCost explícita true/false", () => {
    const yes = resolveSalesOrderItemProductionRequirement({
      explicitRequiresProduction: true,
    });
    assert.equal(yes.classification, "REQUIRED");
    assert.equal(yes.reasonCode, "EXPLICIT_REQUIRES_PRODUCTION_TRUE");

    const no = resolveSalesOrderItemProductionRequirement({
      explicitRequiresProduction: false,
    });
    assert.equal(no.classification, "NOT_REQUIRED");
    assert.equal(no.reasonCode, "EXPLICIT_REQUIRES_PRODUCTION_FALSE");
  });

  it("BOM_ONLY e FINISHING_SERVICE → REQUIRED (estrutura/serviço produtivo)", () => {
    assert.equal(
      resolveSalesOrderItemProductionRequirement({ costingMode: "BOM_ONLY" })
        .classification,
      "REQUIRED"
    );
    assert.equal(
      resolveSalesOrderItemProductionRequirement({
        costingMode: "FINISHING_SERVICE",
      }).classification,
      "REQUIRED"
    );
  });

  it("link OP não atual não conta como evidência oficial", () => {
    const r = resolveSalesOrderItemProductionRequirement({
      hasOfficialProductionOrderLink: true,
      productionOrderLinkIsCurrent: false,
    });
    assert.equal(r.classification, "UNKNOWN");
    assert.equal(r.reasonCode, "NO_EVIDENCE");
  });
});
