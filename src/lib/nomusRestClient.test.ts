import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  NOMUS_HTTP_TIMEOUT_DEFAULT_MS,
  NOMUS_HTTP_TIMEOUT_MAX_MS,
  NOMUS_HTTP_TIMEOUT_MIN_MS,
  fetchNomusJson,
  resolveNomusHttpTimeoutMs,
} from "./nomusRestClient.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => init.headers?.[name.toLowerCase()] ?? null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Simula o bug real: fetch nunca resolve por si só — só se estabelece se o AbortController do timeout disparar. */
function hangingFetchThatOnlySettlesOnAbort(): typeof fetch {
  return (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = (init as RequestInit | undefined)?.signal;
      signal?.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
      // Sem o listener acima (bug original: fetch sem signal), esta promise
      // nunca resolveria — exatamente o hang de >20min relatado em produção.
    });
}

describe("resolveNomusHttpTimeoutMs — validação central (nunca fica sem timeout)", () => {
  it("ausente cai no padrão de 60000ms", () => {
    assert.equal(resolveNomusHttpTimeoutMs(undefined, {}), NOMUS_HTTP_TIMEOUT_DEFAULT_MS);
  });

  it("valor inválido (não numérico) cai no padrão, sem lançar", () => {
    assert.equal(
      resolveNomusHttpTimeoutMs(undefined, { NOMUS_HTTP_TIMEOUT_MS: "abc" }),
      NOMUS_HTTP_TIMEOUT_DEFAULT_MS
    );
  });

  it("valor zero ou negativo cai no padrão — não existe mais 'desligado'", () => {
    assert.equal(
      resolveNomusHttpTimeoutMs(undefined, { NOMUS_HTTP_TIMEOUT_MS: "0" }),
      NOMUS_HTTP_TIMEOUT_DEFAULT_MS
    );
    assert.equal(
      resolveNomusHttpTimeoutMs(undefined, { NOMUS_HTTP_TIMEOUT_MS: "-5" }),
      NOMUS_HTTP_TIMEOUT_DEFAULT_MS
    );
  });

  it("abaixo do mínimo é ajustado para 1000ms", () => {
    assert.equal(
      resolveNomusHttpTimeoutMs(undefined, { NOMUS_HTTP_TIMEOUT_MS: "50" }),
      NOMUS_HTTP_TIMEOUT_MIN_MS
    );
  });

  it("acima do máximo é ajustado para 300000ms", () => {
    assert.equal(
      resolveNomusHttpTimeoutMs(undefined, { NOMUS_HTTP_TIMEOUT_MS: "999999999" }),
      NOMUS_HTTP_TIMEOUT_MAX_MS
    );
  });

  it("valor válido dentro da faixa é respeitado", () => {
    assert.equal(resolveNomusHttpTimeoutMs(undefined, { NOMUS_HTTP_TIMEOUT_MS: "15000" }), 15000);
  });

  it("opção explícita tem prioridade sobre env", () => {
    assert.equal(resolveNomusHttpTimeoutMs(5000, { NOMUS_HTTP_TIMEOUT_MS: "99999999" }), 5000);
  });
});

describe("fetchNomusJson — timeout por tentativa nunca deixa a requisição pendurada", () => {
  it("resposta normal antes do timeout retorna o JSON sem retry", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const result = await fetchNomusJson(new URL("https://nomus.example/propostas"), {
      timeoutMs: 50,
      maxRetries: 2,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 1);
  });

  it("requisição que nunca responde é abortada pelo timeout e faz retry (reproduz o bug real)", async () => {
    let calls = 0;
    globalThis.fetch = (async (url, init) => {
      calls += 1;
      if (calls < 3) return hangingFetchThatOnlySettlesOnAbort()(url, init);
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const result = await fetchNomusJson(new URL("https://nomus.example/propostas"), {
      timeoutMs: 30,
      maxRetries: 4,
      retryBaseMs: 5,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 3, "deveria ter tentado 2x (timeout) antes de suceder na 3ª");
  });

  it("timeout em TODAS as tentativas lança erro real (nunca fica pendurado pra sempre)", async () => {
    globalThis.fetch = hangingFetchThatOnlySettlesOnAbort() as typeof fetch;

    // timeoutMs abaixo de NOMUS_HTTP_TIMEOUT_MIN_MS é sempre ajustado para
    // 1000ms (piso de configuração) — mesmo passado explicitamente por opção.
    await assert.rejects(
      () =>
        fetchNomusJson(new URL("https://nomus.example/propostas"), {
          timeoutMs: 20,
          maxRetries: 1,
          retryBaseMs: 5,
        }),
      /Timeout HTTP após 1000ms/
    );
  });

  it("ECONNRESET (erro transitório de rede) é retried, não falha na hora", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        const err = new TypeError("fetch failed");
        (err as unknown as { cause: { code: string } }).cause = { code: "ECONNRESET" };
        throw err;
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const result = await fetchNomusJson(new URL("https://nomus.example/propostas"), {
      timeoutMs: 50,
      maxRetries: 2,
      retryBaseMs: 5,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  });

  it("ETIMEDOUT e EAI_AGAIN também são elegíveis a retry", async () => {
    for (const code of ["ETIMEDOUT", "EAI_AGAIN"]) {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        if (calls === 1) {
          const err = new TypeError("fetch failed");
          (err as unknown as { code: string }).code = code;
          throw err;
        }
        return jsonResponse({ ok: true });
      }) as typeof fetch;

      const result = await fetchNomusJson(new URL("https://nomus.example/propostas"), {
        timeoutMs: 50,
        maxRetries: 2,
        retryBaseMs: 5,
      });
      assert.deepEqual(result, { ok: true }, `falhou para código ${code}`);
      assert.equal(calls, 2, `falhou para código ${code}`);
    }
  });

  it("erro de rede transitório esgotando as tentativas lança erro real (exit code != 0 no chamador)", async () => {
    globalThis.fetch = (async () => {
      const err = new TypeError("fetch failed");
      (err as unknown as { code: string }).code = "ECONNRESET";
      throw err;
    }) as typeof fetch;

    await assert.rejects(
      () =>
        fetchNomusJson(new URL("https://nomus.example/propostas"), {
          timeoutMs: 50,
          maxRetries: 1,
          retryBaseMs: 5,
        }),
      /Falha de rede transitória \(network_ECONNRESET\)/
    );
  });

  it("erro NÃO transitório (ex.: TypeError de programação sem code) não faz retry — falha na hora", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new TypeError("Invalid URL");
    }) as typeof fetch;

    await assert.rejects(
      () =>
        fetchNomusJson(new URL("https://nomus.example/propostas"), {
          timeoutMs: 50,
          maxRetries: 3,
          retryBaseMs: 5,
        }),
      /Invalid URL/
    );
    assert.equal(calls, 1, "erro permanente não deveria disparar retry");
  });

  it("HTTP 429 com tempoAteLiberar aguarda o tempo indicado e tenta de novo", async () => {
    let calls = 0;
    const waits: number[] = [];
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ tempoAteLiberar: 3 }, { status: 429 });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const result = await fetchNomusJson(new URL("https://nomus.example/propostas"), {
      timeoutMs: 50,
      maxRetries: 2,
      sleepFn: async (ms) => {
        waits.push(ms);
      },
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(waits[0], 4000); // (3 + 1)*1000
  });

  it("HTTP 5xx seguido de sucesso é tratado como retryable", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ error: "boom" }, { status: 503 });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const result = await fetchNomusJson(new URL("https://nomus.example/propostas"), {
      timeoutMs: 50,
      maxRetries: 2,
      retryBaseMs: 5,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  });

  it("HTTP 400 (erro permanente) nunca faz retry", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse({ error: "bad request" }, { status: 400 });
    }) as typeof fetch;

    await assert.rejects(
      () =>
        fetchNomusJson(new URL("https://nomus.example/propostas"), {
          timeoutMs: 50,
          maxRetries: 3,
          retryBaseMs: 5,
        }),
      /Falha HTTP 400/
    );
    assert.equal(calls, 1);
  });

  it("timer do AbortController é sempre removido (sucesso, erro HTTP e timeout) — sem handle pendurado", async () => {
    const originalClearTimeout = globalThis.clearTimeout;
    let clearCalls = 0;
    globalThis.clearTimeout = ((...args: Parameters<typeof clearTimeout>) => {
      clearCalls += 1;
      return originalClearTimeout(...args);
    }) as typeof clearTimeout;

    try {
      globalThis.fetch = (async () => jsonResponse({ ok: true })) as typeof fetch;
      await fetchNomusJson(new URL("https://nomus.example/a"), { timeoutMs: 50 });
      assert.equal(clearCalls, 1, "sucesso deveria limpar o timer 1x");

      clearCalls = 0;
      globalThis.fetch = (async () => jsonResponse({}, { status: 400 })) as typeof fetch;
      await assert.rejects(() => fetchNomusJson(new URL("https://nomus.example/b"), { timeoutMs: 50 }));
      assert.equal(clearCalls, 1, "erro HTTP permanente deveria limpar o timer 1x");

      clearCalls = 0;
      globalThis.fetch = hangingFetchThatOnlySettlesOnAbort() as typeof fetch;
      await assert.rejects(() =>
        fetchNomusJson(new URL("https://nomus.example/c"), { timeoutMs: 15, maxRetries: 0 })
      );
      assert.equal(clearCalls, 1, "timeout deveria limpar o timer 1x");
    } finally {
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});
