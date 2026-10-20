import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readCnpjWeeklyRefreshConfig } from "./config.js";
import { createThrottledCnpjFetch } from "./throttle.js";

const base = {
  minIntervalMs: 0,
  timeoutMs: 40,
  maxRetries: 1,
  backoffBaseMs: 25,
  backoffCapMs: 100,
  circuitFailureThreshold: 2,
  circuitPauseMs: 5_000,
};

describe("limite das consultas de CNPJ", () => {
  it("usa intervalo mínimo de 3 segundos por padrão", () => {
    assert.equal(readCnpjWeeklyRefreshConfig({}).minIntervalMs, 3_000);
    assert.equal(readCnpjWeeklyRefreshConfig({}).enabled, false);
  });

  it("respeita HTTP 429 e Retry-After", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl = createThrottledCnpjFetch(
      { ...base, minIntervalMs: 3_000, maxRetries: 1 },
      {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        now: () => 0,
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) return new Response("limite", { status: 429, headers: { "retry-after": "2" } });
          return new Response("ok", { status: 200 });
        },
      }
    );
    const response = await fetchImpl("https://brasilapi.com.br/api/cnpj/v1/11444777000161");
    assert.equal(response.status, 200);
    assert.ok(sleeps.some((ms) => ms >= 2_000));
  });

  it("repete HTTP 500 e devolve 504 quando as tentativas acabam", async () => {
    let calls = 0;
    const fetchImpl = createThrottledCnpjFetch(base, {
      sleep: async () => undefined,
      now: () => 0,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response("erro", { status: 500 });
        if (calls === 2) return new Response("ok", { status: 200 });
        return new Response("gateway", { status: 504 });
      },
    });
    const recovered = await fetchImpl("https://brasilapi.com.br/x");
    assert.equal(recovered.status, 200);
    assert.equal(calls, 2);
    const exhausted = await fetchImpl("https://publica.cnpj.ws/cnpj/1");
    assert.equal(exhausted.status, 504);
    assert.equal(calls, 4);
  });

  it("encerra a tentativa quando o tempo limite estoura", async () => {
    const fetchImpl = createThrottledCnpjFetch({ ...base, maxRetries: 0, timeoutMs: 30 }, {
      sleep: async () => undefined,
      fetchImpl: (_input, init) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(new Response("tarde", { status: 200 })), 300);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    });
    await assert.rejects(() => fetchImpl("https://brasilapi.com.br/api/cnpj/v1/11444777000161"));
  });

  it("abre o circuito depois de falhas seguidas", async () => {
    const sleeps: number[] = [];
    const fetchImpl = createThrottledCnpjFetch({ ...base, maxRetries: 0 }, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => 1_000,
      fetchImpl: async () => new Response("erro", { status: 500 }),
    });
    await fetchImpl("https://brasilapi.com.br/a");
    await fetchImpl("https://brasilapi.com.br/b");
    await fetchImpl("https://brasilapi.com.br/c");
    assert.ok(sleeps.some((ms) => ms >= 5_000));
  });
});
