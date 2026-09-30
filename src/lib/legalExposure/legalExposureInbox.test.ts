import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alertActionLabel, alertChannelOf, inboxMatchesFilter, isCriticalLegalAlert } from "./legalExposureInbox.js";

describe("legalExposureInbox", () => {
  it("separa canal jurídico de falha técnica e de dados", () => {
    assert.equal(alertChannelOf("NEW_CITATION"), "LEGAL");
    assert.equal(alertChannelOf("NEW_INTIMATION"), "LEGAL");
    assert.equal(alertChannelOf("SOURCE_FAILED"), "TECHNICAL");
    assert.equal(alertChannelOf("SOURCE_STALE"), "TECHNICAL");
    assert.equal(alertChannelOf("CANDIDATE_REVIEW"), "DATA");
  });

  it("rotula a ação sem copiar o código técnico", () => {
    assert.equal(alertActionLabel({ eventType: "NEW_CITATION", title: "Citação recebida" }), "Revisar nova citação");
    assert.equal(alertActionLabel({ eventType: "SOURCE_FAILED", title: "Falha DataJud" }), "Verificar falha da fonte");
  });

  it("filtra a caixa de entrada sem misturar jurídico e integração", () => {
    assert.equal(
      inboxMatchesFilter("legal", { channel: "LEGAL", severity: "HIGH", status: "OPEN" }),
      true
    );
    assert.equal(
      inboxMatchesFilter("legal", { channel: "TECHNICAL", severity: "HIGH", status: "OPEN" }),
      false
    );
    assert.equal(
      inboxMatchesFilter("technical", { channel: "TECHNICAL", severity: "MEDIUM", status: "OPEN" }),
      true
    );
    assert.equal(isCriticalLegalAlert({ channel: "LEGAL", severity: "HIGH" }), true);
    assert.equal(isCriticalLegalAlert({ channel: "TECHNICAL", severity: "CRITICAL" }), false);
  });
});
