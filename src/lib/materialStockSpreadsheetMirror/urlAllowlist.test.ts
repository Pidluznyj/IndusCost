import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateMaterialStockSpreadsheetWebhookUrl } from "./urlAllowlist.js";

describe("materialStockSpreadsheetMirror urlAllowlist", () => {
  const allowed = ["logic.azure.com", "api.powerautomate.com"];

  it("aceita host permitido https", () => {
    const r = validateMaterialStockSpreadsheetWebhookUrl(
      "https://prod-12.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke",
      allowed
    );
    assert.equal(r.ok, true);
  });

  it("rejeita destino inválido / privado / http", () => {
    assert.equal(
      validateMaterialStockSpreadsheetWebhookUrl("http://logic.azure.com/x", allowed)
        .ok,
      false
    );
    assert.equal(
      validateMaterialStockSpreadsheetWebhookUrl("https://127.0.0.1/hook", allowed)
        .ok,
      false
    );
    assert.equal(
      validateMaterialStockSpreadsheetWebhookUrl(
        "https://evil.example.com/hook",
        allowed
      ).ok,
      false
    );
    assert.equal(
      validateMaterialStockSpreadsheetWebhookUrl("", allowed).ok,
      false
    );
  });
});
