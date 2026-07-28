import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSalesOrderFlowCardStayReason,
  humanizeSalesOrderFlowStageReason,
  SALES_ORDER_FLOW_STAGE_STAY_REASON,
} from "./salesOrderFlowStayReason.js";

describe("salesOrderFlowStayReason", () => {
  it("humaniza stageReason com prefixo canônico", () => {
    assert.equal(
      humanizeSalesOrderFlowStageReason(
        "PRODUCTION_ORDER_MISSING — Saldo residual exige produção e não há OP válida vinculada para cobri-lo."
      ),
      "Saldo residual exige produção e não há OP válida vinculada para cobri-lo."
    );
  });

  it("remove jargão técnico e inglês da mensagem", () => {
    assert.equal(
      humanizeSalesOrderFlowStageReason(
        "Saldo residual exige produção, mas linkedQuantity de OP é insuficiente."
      ),
      "Saldo residual exige produção, mas quantidade vinculada de OP é insuficiente."
    );
    assert.equal(
      humanizeSalesOrderFlowStageReason(
        "Item aguardando liberação comercial (status PENDING)."
      ),
      "Item aguardando liberação comercial."
    );
    assert.doesNotMatch(
      humanizeSalesOrderFlowStageReason(
        "Produção satisfeita (ou proxy OP); falta Documento de Saída."
      ) ?? "",
      /proxy|linkedQuantity|PENDING/i
    );
  });

  it("usa bottleneckReason como motivo de permanência na coluna", () => {
    const stay = buildSalesOrderFlowCardStayReason({
      stage: "WAITING_PRODUCTION_ORDER",
      bottleneckReason:
        "PRODUCTION_ORDER_MISSING — Saldo residual exige produção e não há OP válida vinculada para cobri-lo.",
      nextAction: "Abrir ou vincular Ordem de Produção aos itens liberados.",
    });
    assert.equal(
      stay.whyHere,
      "Saldo residual exige produção e não há OP válida vinculada para cobri-lo."
    );
    assert.equal(
      stay.missingToLeave,
      "Abrir ou vincular Ordem de Produção aos itens liberados."
    );
  });

  it("fallback por etapa quando não há gargalo", () => {
    const stay = buildSalesOrderFlowCardStayReason({
      stage: "WAITING_NFE",
      bottleneckReason: null,
      nextAction: null,
    });
    assert.equal(stay.whyHere, SALES_ORDER_FLOW_STAGE_STAY_REASON.WAITING_NFE);
    assert.match(stay.missingToLeave, /NF-e/i);
  });
});
