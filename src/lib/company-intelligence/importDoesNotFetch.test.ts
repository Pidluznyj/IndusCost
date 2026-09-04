import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("import do módulo de CNPJ", () => {
  it("não dispara chamada externa ao importar o agregador", async () => {
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await import("./lookupCompanyRegistry.js");
      await import("./providers/brasilApiCnpjProvider.js");
      await import("./providers/publicaCnpjWsProvider.js");
      await import("../economic-context/economicContextService.js");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
