import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SALES_ORDER_FLOW_INCONSISTENCY_CODES,
  SALES_ORDER_FLOW_INCONSISTENCY_LABELS,
  SALES_ORDER_FLOW_INCONSISTENCY_SEVERITIES,
  SALES_ORDER_FLOW_INCONSISTENCY_SEVERITY_BY_CODE,
  SALES_ORDER_FLOW_STAGES,
  SALES_ORDER_FLOW_STAGE_LABELS,
  SALES_ORDER_FLOW_STAGE_NEXT_ACTION,
  SALES_ORDER_FLOW_STAGE_PRIORITY,
  SALES_ORDER_FLOW_STAGE_RESPONSIBLE_AREA,
  compareSalesOrderFlowStagePriority,
  getSalesOrderFlowInconsistencyGuidance,
  getSalesOrderFlowStageLabel,
  getSalesOrderFlowStagePriority,
  isSalesOrderFlowInconsistencyCode,
  isSalesOrderFlowStage,
  listSalesOrderFlowStagesByPriority,
  maxSalesOrderFlowInconsistencySeverity,
  pickSalesOrderFlowStageFromItemStages,
  salesOrderFlowHasAuxiliaryInconsistency,
  stagePriority,
  type SalesOrderFlowStage,
} from "./salesOrderFlowCatalog.js";

describe("salesOrderFlowCatalog", () => {
  it("expõe exatamente as 7 colunas operacionais oficiais", () => {
    assert.deepEqual([...SALES_ORDER_FLOW_STAGES], [
      "WAITING_RELEASE",
      "WAITING_PRODUCTION_ORDER",
      "IN_PRODUCTION",
      "WAITING_OUTPUT_DOCUMENT",
      "WAITING_NFE",
      "SHIPPED_COMPLETED",
      "CANCELED",
    ]);
  });

  it("mantém stagePriority alinhado ao mapa canônico", () => {
    assert.equal(stagePriority, SALES_ORDER_FLOW_STAGE_PRIORITY);
    for (const stage of SALES_ORDER_FLOW_STAGES) {
      assert.equal(typeof SALES_ORDER_FLOW_STAGE_PRIORITY[stage], "number");
      assert.equal(getSalesOrderFlowStagePriority(stage), SALES_ORDER_FLOW_STAGE_PRIORITY[stage]);
      assert.equal(getSalesOrderFlowStageLabel(stage), SALES_ORDER_FLOW_STAGE_LABELS[stage]);
      assert.ok(SALES_ORDER_FLOW_STAGE_NEXT_ACTION[stage].length > 0);
      assert.ok(SALES_ORDER_FLOW_STAGE_RESPONSIBLE_AREA[stage]);
    }
  });

  it("ordena estágios pela primeira obrigação (menor prioridade primeiro)", () => {
    const ordered = listSalesOrderFlowStagesByPriority();
    assert.deepEqual(ordered, [
      "WAITING_RELEASE",
      "WAITING_PRODUCTION_ORDER",
      "IN_PRODUCTION",
      "WAITING_OUTPUT_DOCUMENT",
      "WAITING_NFE",
      "SHIPPED_COMPLETED",
      "CANCELED",
    ]);

    for (let i = 1; i < ordered.length; i += 1) {
      assert.ok(
        compareSalesOrderFlowStagePriority(ordered[i - 1]!, ordered[i]!) < 0,
        `${ordered[i - 1]} deve preceder ${ordered[i]}`
      );
    }

    assert.ok(
      SALES_ORDER_FLOW_STAGE_PRIORITY.WAITING_RELEASE <
        SALES_ORDER_FLOW_STAGE_PRIORITY.WAITING_PRODUCTION_ORDER
    );
    assert.ok(
      SALES_ORDER_FLOW_STAGE_PRIORITY.SHIPPED_COMPLETED <
        SALES_ORDER_FLOW_STAGE_PRIORITY.CANCELED
    );
  });

  it("guarda de tipo rejeita strings fora do catálogo", () => {
    assert.equal(isSalesOrderFlowStage("WAITING_RELEASE"), true);
    assert.equal(isSalesOrderFlowStage("INCONSISTENT"), false);
    assert.equal(isSalesOrderFlowStage("OPEN"), false);
    assert.equal(isSalesOrderFlowInconsistencyCode("ITEM_STATUS_UNKNOWN"), true);
    assert.equal(isSalesOrderFlowInconsistencyCode("WAITING_RELEASE"), false);
  });

  it("catálogo de inconsistências cobre severidade e label para cada código", () => {
    assert.ok(SALES_ORDER_FLOW_INCONSISTENCY_SEVERITIES.includes("INFO"));
    assert.ok(SALES_ORDER_FLOW_INCONSISTENCY_SEVERITIES.includes("CRITICAL"));
    for (const code of SALES_ORDER_FLOW_INCONSISTENCY_CODES) {
      assert.ok(SALES_ORDER_FLOW_INCONSISTENCY_SEVERITY_BY_CODE[code]);
      assert.ok(SALES_ORDER_FLOW_INCONSISTENCY_LABELS[code].length > 0);
      const guidance = getSalesOrderFlowInconsistencyGuidance(code);
      assert.ok(guidance.meaning.length > 0);
      assert.ok(guidance.howToFix.length > 0);
      assert.ok(guidance.responsibleAreaHint.length > 0);
    }
  });

  it("agrega a coluna do pedido pela primeira obrigação dos itens ativos", () => {
    assert.equal(pickSalesOrderFlowStageFromItemStages([]), null);
    assert.equal(
      pickSalesOrderFlowStageFromItemStages(["CANCELED", "CANCELED"]),
      "CANCELED"
    );
    assert.equal(
      pickSalesOrderFlowStageFromItemStages([
        "WAITING_NFE",
        "WAITING_RELEASE",
        "IN_PRODUCTION",
      ]),
      "WAITING_RELEASE"
    );
    assert.equal(
      pickSalesOrderFlowStageFromItemStages([
        "SHIPPED_COMPLETED",
        "WAITING_OUTPUT_DOCUMENT",
        "CANCELED",
      ]),
      "WAITING_OUTPUT_DOCUMENT"
    );
    assert.equal(
      pickSalesOrderFlowStageFromItemStages([
        "SHIPPED_COMPLETED",
        "SHIPPED_COMPLETED",
        "CANCELED",
      ]),
      "SHIPPED_COMPLETED"
    );
  });

  it("trata INCONSISTENT como condição auxiliar via códigos", () => {
    const codes = ["DOCUMENT_WITHOUT_NFE", "DUPLICATE_TRUTH_RISK"] as const;
    assert.equal(salesOrderFlowHasAuxiliaryInconsistency(codes), true);
    assert.equal(salesOrderFlowHasAuxiliaryInconsistency([]), false);
    assert.equal(maxSalesOrderFlowInconsistencySeverity(codes), "CRITICAL");
    assert.equal(maxSalesOrderFlowInconsistencySeverity(["DOCUMENT_WITHOUT_NFE"]), "INFO");
    assert.equal(maxSalesOrderFlowInconsistencySeverity([]), null);
  });

  it("não permite prioridade duplicada entre colunas operacionais", () => {
    const priorities = SALES_ORDER_FLOW_STAGES.map(
      (stage: SalesOrderFlowStage) => SALES_ORDER_FLOW_STAGE_PRIORITY[stage]
    );
    assert.equal(new Set(priorities).size, priorities.length);
  });
});
