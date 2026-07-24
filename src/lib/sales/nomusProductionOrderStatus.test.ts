import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isNomusProductionOrderStatusCanceled,
  isNomusProductionOrderStatusClosed,
  normalizeNomusProductionOrderStatus,
} from "./nomusProductionOrderStatus.js";

describe("normalizeNomusProductionOrderStatus", () => {
  it("normaliza Encerrada com acentos e caixa", () => {
    const r = normalizeNomusProductionOrderStatus("  ENCERRADA ");
    assert.equal(r.statusNormalized, "CLOSED");
    assert.equal(r.isClosed, true);
    assert.equal(r.isCanceled, false);
  });

  it("normaliza Cancelada", () => {
    assert.equal(isNomusProductionOrderStatusCanceled("Cancelada"), true);
    assert.equal(normalizeNomusProductionOrderStatus("Cancelada").isActivePlan, false);
  });

  it("normaliza Liberada e Requisitada*", () => {
    assert.equal(normalizeNomusProductionOrderStatus("Liberada").isReleased, true);
    assert.equal(
      normalizeNomusProductionOrderStatus("Requisitada parcialmente").statusNormalized,
      "REQUISITIONED_PARTIAL"
    );
    assert.equal(
      normalizeNomusProductionOrderStatus("Requisitada totalmente").statusNormalized,
      "REQUISITIONED_TOTAL"
    );
    assert.equal(isNomusProductionOrderStatusClosed("Liberada"), false);
    assert.equal(isNomusProductionOrderStatusClosed("Requisitada totalmente"), false);
  });

  it("status desconhecido não é Encerrada", () => {
    const r = normalizeNomusProductionOrderStatus("Em andamento");
    assert.equal(r.statusNormalized, "UNKNOWN");
    assert.equal(r.isClosed, false);
    assert.equal(r.isActivePlan, true);
  });
});
