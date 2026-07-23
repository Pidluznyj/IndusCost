import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySalesOrderFlowIntegrity,
  parseSalesOrderFlowIntegrityAuditArgs,
  resolveSalesOrderFlowIntegrityExitCode,
} from "./salesOrderFlowIntegrityAudit.js";

describe("salesOrderFlowIntegrityAudit", () => {
  it("classifica FALSE_WAITING_OP genérico (padrão PD 02047/02049)", () => {
    const r = classifySalesOrderFlowIntegrity({
      calculatedStage: "SHIPPED_COMPLETED",
      persistedStage: "WAITING_PRODUCTION_ORDER",
      hasValidNfe: true,
      hasStockDocumentWithNfe: true,
      hasO2cAllocation: false,
      commerciallyClosedItemCount: 1,
      itemsWithNfeCoverage: 1,
      itemsWithDocumentCoverage: 1,
      remainingFulfillmentTotal: 0,
    });
    assert.equal(r.kind, "FALSE_WAITING_OP");
  });

  it("classifica MISSING_FISCAL_LINKS quando encerrado sem NF/DS", () => {
    const r = classifySalesOrderFlowIntegrity({
      calculatedStage: "WAITING_OUTPUT_DOCUMENT",
      persistedStage: "WAITING_OUTPUT_DOCUMENT",
      hasValidNfe: false,
      hasStockDocumentWithNfe: false,
      hasO2cAllocation: false,
      commerciallyClosedItemCount: 2,
      itemsWithNfeCoverage: 0,
      itemsWithDocumentCoverage: 0,
      remainingFulfillmentTotal: 0,
    });
    assert.equal(r.kind, "MISSING_FISCAL_LINKS");
  });

  it("classifica LEGITIMATE_WAITING_OP com residual", () => {
    const r = classifySalesOrderFlowIntegrity({
      calculatedStage: "WAITING_PRODUCTION_ORDER",
      persistedStage: "WAITING_PRODUCTION_ORDER",
      hasValidNfe: false,
      hasStockDocumentWithNfe: false,
      hasO2cAllocation: false,
      commerciallyClosedItemCount: 0,
      itemsWithNfeCoverage: 0,
      itemsWithDocumentCoverage: 0,
      remainingFulfillmentTotal: 100,
    });
    assert.equal(r.kind, "LEGITIMATE_WAITING_OP");
  });

  it("classifica OK quando alinhado com vínculos", () => {
    const r = classifySalesOrderFlowIntegrity({
      calculatedStage: "SHIPPED_COMPLETED",
      persistedStage: "SHIPPED_COMPLETED",
      hasValidNfe: true,
      hasStockDocumentWithNfe: true,
      hasO2cAllocation: true,
      commerciallyClosedItemCount: 1,
      itemsWithNfeCoverage: 1,
      itemsWithDocumentCoverage: 1,
      remainingFulfillmentTotal: 0,
    });
    assert.equal(r.kind, "OK");
  });

  it("parse CLI e exit code", () => {
    const args = parseSalesOrderFlowIntegrityAuditArgs([
      "--from=2025-01-01",
      "--to=2026-12-31",
      "--exclude-completed",
      "--batch-size=25",
    ]);
    assert.equal(args.includeCompleted, false);
    assert.equal(args.batchSize, 25);
    assert.equal(resolveSalesOrderFlowIntegrityExitCode({ actionable: 0 }), 0);
    assert.equal(resolveSalesOrderFlowIntegrityExitCode({ actionable: 3 }), 1);
  });
});
