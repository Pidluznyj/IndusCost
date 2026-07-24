import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  clearUiSessionGetCacheForTests,
  fetchUiSessionCachedJson,
  readUiSessionGetCache,
  uiSessionGetCacheSizeForTests,
} from "@/src/lib/uiSessionGetCache.js";

describe("fetchUiSessionCachedJson", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearUiSessionGetCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearUiSessionGetCacheForTests();
    mock.restoreAll();
  });

  it("reutiliza cache na mesma chave e nao refaz fetch", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: true, n: calls }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const a = await fetchUiSessionCachedJson<{ ok: boolean; n: number }>(
      "/api/finance/cash-flow/dashboard?year=2026"
    );
    const b = await fetchUiSessionCachedJson<{ ok: boolean; n: number }>(
      "/api/finance/cash-flow/dashboard?year=2026"
    );
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
    assert.equal(uiSessionGetCacheSizeForTests(), 1);
  });

  it("nao compartilha chaves de filtro diferentes", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ calls }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await fetchUiSessionCachedJson("/api/finance/accounts-receivable/overdue?a=1");
    await fetchUiSessionCachedJson("/api/finance/accounts-receivable/overdue?a=2");
    assert.equal(calls, 2);
    assert.equal(readUiSessionGetCache("/api/finance/accounts-receivable/overdue?a=1") != null, true);
    assert.equal(readUiSessionGetCache("/api/finance/accounts-receivable/overdue?a=2") != null, true);
  });

  it("skipCache ignora leitura e atualiza valor", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ calls }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const first = await fetchUiSessionCachedJson<{ calls: number }>("/api/x");
    const second = await fetchUiSessionCachedJson<{ calls: number }>("/api/x", {
      skipCache: true,
    });
    assert.equal(first.calls, 1);
    assert.equal(second.calls, 2);
    assert.equal(calls, 2);
  });

  it("respeita AbortSignal e nao grava cache abortado", async () => {
    const controller = new AbortController();
    globalThis.fetch = (async (_input, init) => {
      controller.abort();
      if (init?.signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        throw err;
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await assert.rejects(
      () =>
        fetchUiSessionCachedJson("/api/finance/cash-flow/daily-radar?page=1", {
          signal: controller.signal,
        }),
      (e: unknown) => e instanceof DOMException && e.name === "AbortError"
    );
    assert.equal(readUiSessionGetCache("/api/finance/cash-flow/daily-radar?page=1"), null);
  });
});
