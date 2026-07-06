import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTraceDiagnostic,
  mapAlertToDiagnostic,
  mergeTraceDiagnostics,
} from "./traceDiagnostic.js";

describe("traceDiagnostic", () => {
  it("createTraceDiagnostic usa code como status padrão", () => {
    const diag = createTraceDiagnostic({
      code: "NO_SCHEDULE",
      severity: "warning",
      message: "Sem schedule",
      source: "COMMISSION",
    });
    assert.equal(diag.status, "NO_SCHEDULE");
    assert.equal(diag.source, "COMMISSION");
  });

  it("mapAlertToDiagnostic preserva contexto", () => {
    const diag = mapAlertToDiagnostic(
      {
        code: "CUSTOMER_EXCLUDED",
        severity: "warning",
        message: "Cliente excluído",
        context: "SALE",
      },
      "COMMISSION",
      "CUSTOMER_EXCLUDED"
    );
    assert.equal(diag.context, "SALE");
    assert.equal(diag.severity, "warning");
  });

  it("mergeTraceDiagnostics deduplica por chave", () => {
    const a = createTraceDiagnostic({
      code: "X",
      severity: "info",
      message: "m",
      source: "A",
    });
    const merged = mergeTraceDiagnostics([a], [a]);
    assert.equal(merged.length, 1);
  });
});
