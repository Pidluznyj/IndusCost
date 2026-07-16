import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyProductionOrdersSelectorProbeOutcome,
  homologationFromProbeStatus,
  isNomusRsqlSelectorRejectionError,
  resolveSelectorHomologationFromEnv,
} from "@/src/lib/nomusProductionOrdersSelectorProbe.js";

describe("OP-14.2 — probe/homologação de seletor RSQL", () => {
  it("classifica ACCEPTED em HTTP 200", () => {
    assert.equal(
      classifyProductionOrdersSelectorProbeOutcome({
        httpStatus: 200,
        bodyText: "[]",
        recordsReceived: 0,
        threw: false,
      }),
      "ACCEPTED"
    );
  });

  it("classifica REJECTED em 400 com mensagem de campo", () => {
    assert.equal(
      classifyProductionOrdersSelectorProbeOutcome({
        httpStatus: 400,
        bodyText: "Campo inválido: dataHoraEdicao",
        recordsReceived: null,
        threw: false,
      }),
      "REJECTED"
    );
  });

  it("classifica INCONCLUSIVE em 429/5xx/auth", () => {
    assert.equal(
      classifyProductionOrdersSelectorProbeOutcome({
        httpStatus: 429,
        bodyText: "rate limit",
        recordsReceived: null,
        threw: false,
      }),
      "INCONCLUSIVE"
    );
    assert.equal(
      classifyProductionOrdersSelectorProbeOutcome({
        httpStatus: 500,
        bodyText: "error",
        recordsReceived: null,
        threw: false,
      }),
      "INCONCLUSIVE"
    );
  });

  it("homologationFromProbeStatus e env", () => {
    assert.equal(homologationFromProbeStatus("ACCEPTED"), "accepted");
    assert.equal(homologationFromProbeStatus("REJECTED"), "rejected");
    assert.equal(
      resolveSelectorHomologationFromEnv(
        { NOMUS_PRODUCTION_ORDERS_INCREMENTAL_SELECTOR_HOMOLOGATION: "dataHoraEdicao:accepted" },
        "dataHoraEdicao"
      ),
      "accepted"
    );
  });

  it("detecta rejeição RSQL em Error", () => {
    assert.equal(
      isNomusRsqlSelectorRejectionError(new Error("Falha HTTP 400: campo inválido dataHoraEdicao")),
      true
    );
    assert.equal(isNomusRsqlSelectorRejectionError(new Error("Falha HTTP 500")), false);
  });
});
