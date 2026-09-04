import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { clearMaterialMarketPtaxCache } from "@/src/lib/materialMarketPtax.js";
import { getEconomicContextSafe, resetEconomicContextCache } from "./economicContextService.js";
import { ECONOMIC_CONTEXT_DISCLAIMER } from "./economicContextTypes.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("economicContextService — BCB complementar", () => {
  beforeEach(() => {
    resetEconomicContextCache();
    clearMaterialMarketPtaxCache();
  });
  afterEach(() => {
    resetEconomicContextCache();
    clearMaterialMarketPtaxCache();
  });

  it("falha do BCB não lança e devolve contexto indisponível", async () => {
    const payload = await getEconomicContextSafe({
      fetchImpl: (async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }) as typeof fetch,
    });
    assert.equal(payload.status, "unavailable");
    assert.equal(payload.sourceLabel, "Banco Central do Brasil");
    assert.equal(payload.disclaimer, ECONOMIC_CONTEXT_DISCLAIMER);
    assert.ok(payload.indicators.every((row) => row.status === "unavailable"));
  });

  it("Selic/IPCA OK e PTAX falha → resultado parcial", async () => {
    const payload = await getEconomicContextSafe({
      fetchImpl: (async (input) => {
        const url = String(input);
        if (url.includes("bcdata.sgs.432")) {
          return jsonResponse(200, [{ data: "04/09/2026", valor: "15,00" }]);
        }
        if (url.includes("bcdata.sgs.13522")) {
          return jsonResponse(200, [{ data: "01/08/2026", valor: "4,50" }]);
        }
        return jsonResponse(500, { error: "ptax down" });
      }) as typeof fetch,
    });
    assert.equal(payload.status, "partial");
    assert.equal(payload.indicators.find((row) => row.code === "SELIC_TARGET")?.status, "ok");
    assert.equal(payload.indicators.find((row) => row.code === "IPCA_12M")?.status, "ok");
    assert.equal(payload.indicators.find((row) => row.code === "USD_PTAX_SELL")?.status, "unavailable");
  });

  it("todas as séries BCB OK", async () => {
    const payload = await getEconomicContextSafe({
      fetchImpl: (async (input) => {
        const url = String(input);
        if (url.includes("bcdata.sgs.432")) {
          return jsonResponse(200, [{ data: "04/09/2026", valor: "15,00" }]);
        }
        if (url.includes("bcdata.sgs.13522")) {
          return jsonResponse(200, [{ data: "01/08/2026", valor: "4,50" }]);
        }
        if (url.includes("CotacaoDolarDia")) {
          return jsonResponse(200, { value: [{ cotacaoCompra: 5.1, cotacaoVenda: 5.2 }] });
        }
        if (url.includes("CotacaoMoedaDia")) {
          return jsonResponse(200, {
            value: [{ cotacaoVenda: 5.8, tipoBoletim: "Fechamento" }],
          });
        }
        throw new Error(`URL BCB inesperada: ${url}`);
      }) as typeof fetch,
    });
    assert.equal(payload.status, "ok");
    assert.equal(payload.indicators.filter((row) => row.status === "ok").length, 4);
  });

  it("cache evita nova ida ao BCB", async () => {
    let calls = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls += 1;
      const url = String(input);
      if (url.includes("bcdata.sgs")) {
        return jsonResponse(200, [{ data: "04/09/2026", valor: "15,00" }]);
      }
      return jsonResponse(200, {
        value: [{ cotacaoCompra: 5.1, cotacaoVenda: 5.2, tipoBoletim: "Fechamento" }],
      });
    }) as typeof fetch;
    const first = await getEconomicContextSafe({ fetchImpl });
    const second = await getEconomicContextSafe({ fetchImpl });
    assert.equal(first.fromCache, false);
    assert.equal(second.fromCache, true);
    assert.ok(calls > 0);
    assert.equal(second.status, first.status);
  });
});
