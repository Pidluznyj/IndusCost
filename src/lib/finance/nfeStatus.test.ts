import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isNomusNfeCancelled,
  isNomusNfeValidForBilling,
  normalizeNfeStatus,
} from "./nfeStatus.js";

describe("nfeStatus normalizeNfeStatus", () => {
  it("status 7 → CANCELED, não válida para faturamento", () => {
    const r = normalizeNfeStatus({ status: 7 });
    assert.equal(r.statusNormalized, "CANCELED");
    assert.equal(r.isCanceled, true);
    assert.equal(r.isValidForBilling, false);
    assert.equal(r.label, "Cancelada");
    assert.equal(isNomusNfeCancelled(7), true);
    assert.equal(isNomusNfeValidForBilling(7), false);
  });

  it("status 4 → AUTHORIZED, válida para faturamento", () => {
    const r = normalizeNfeStatus({ status: 4 });
    assert.equal(r.statusNormalized, "AUTHORIZED");
    assert.equal(r.isCanceled, false);
    assert.equal(r.isValidForBilling, true);
    assert.match(r.label, /Autorizada|Válida/i);
  });

  it("texto Cancelada → CANCELED", () => {
    const r = normalizeNfeStatus({ status: "Cancelada" });
    assert.equal(r.statusNormalized, "CANCELED");
    assert.equal(r.isCanceled, true);
    assert.equal(r.isValidForBilling, false);
  });

  it("não usa status financeiro (Recebido) como status fiscal", () => {
    const r = normalizeNfeStatus({ status: "Recebido" });
    assert.notEqual(r.statusNormalized, "AUTHORIZED");
    assert.equal(r.isCanceled, false);
  });
});
