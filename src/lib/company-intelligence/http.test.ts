import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertAllowedHttpsUrl, fetchKnownHostJson, KnownHostFetchError } from "./http.js";

describe("company-intelligence HTTP", () => {
  it("permite somente hosts conhecidos em HTTPS", () => {
    assert.equal(assertAllowedHttpsUrl("https://brasilapi.com.br/api/cnpj/v1/1").hostname, "brasilapi.com.br");
    assert.equal(assertAllowedHttpsUrl("https://publica.cnpj.ws/cnpj/1").hostname, "publica.cnpj.ws");
    assert.equal(assertAllowedHttpsUrl("https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados").hostname, "api.bcb.gov.br");
    assert.throws(() => assertAllowedHttpsUrl("https://example.com/x"), KnownHostFetchError);
    assert.throws(() => assertAllowedHttpsUrl("http://brasilapi.com.br/x"), KnownHostFetchError);
  });

  it("mapeia abort para timeout individual", async () => {
    await assert.rejects(
      () =>
        fetchKnownHostJson("https://brasilapi.com.br/api/cnpj/v1/1", {
          timeoutMs: 50,
          fetchImpl: (async () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            throw err;
          }) as typeof fetch,
        }),
      (error: unknown) => error instanceof KnownHostFetchError && error.kind === "timeout"
    );
  });

  it("dispara timeout real sem esperar o default de 15s", async () => {
    await assert.rejects(
      () =>
        fetchKnownHostJson("https://publica.cnpj.ws/cnpj/1", {
          timeoutMs: 20,
          fetchImpl: (async (_url, init) =>
            new Promise((_, reject) => {
              init?.signal?.addEventListener("abort", () => {
                const err = new Error("aborted");
                err.name = "AbortError";
                reject(err);
              });
            })) as typeof fetch,
        }),
      (error: unknown) => error instanceof KnownHostFetchError && error.kind === "timeout"
    );
  });
});
