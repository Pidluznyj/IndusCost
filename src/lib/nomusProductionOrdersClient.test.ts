import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createNomusProductionOrdersClient,
  fingerprintProductionOrdersPage,
  NomusProductionOrdersClientError,
} from "@/src/lib/nomusProductionOrdersClient.js";
import { NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE } from "@/src/lib/fixtures/nomusProductionOrderOp05800.js";

const BASE = "https://nomus.test/rest/";

type MockCall = { url: string; signalAborted?: boolean };

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

async function withMockedFetch<T>(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
  run: () => Promise<T>
): Promise<{ result: T; calls: MockCall[] }> {
  const calls: MockCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, signalAborted: init?.signal?.aborted });
    return handler(input, init);
  }) as typeof fetch;
  try {
    const result = await run();
    return { result, calls };
  } finally {
    globalThis.fetch = original;
  }
}

function createClient(overrides: Parameters<typeof createNomusProductionOrdersClient>[0] = {}) {
  return createNomusProductionOrdersClient({
    baseUrl: BASE,
    pageSize: 2,
    maxPages: 10,
    maxRetries: 2,
    retryBaseMs: 1,
    timeoutMs: 5_000,
    sleepFn: async () => undefined,
    logger: () => undefined,
    env: {
      NOMUS_TOKEN: "secret-token-for-tests",
      NOMUS_AUTH_HEADER_NAME: "X-Api-Key",
      NOMUS_AUTH_HEADER_VALUE: "secret-header-value",
    },
    ...overrides,
  });
}

describe("nomusProductionOrdersClient — sucesso", () => {
  it("listPage lê array direto e preserva raw", async () => {
    const { result, calls } = await withMockedFetch(
      () => jsonResponse([NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE]),
      async () => createClient().listPage({ page: 1 })
    );
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]!.id, 30347);
    assert.equal(result.rawPayload != null, true);
    assert.equal(result.hasNext, false);
    assert.match(calls[0]!.url, /\/ordens\?/);
    assert.match(calls[0]!.url, /pagina=1/);
    assert.match(calls[0]!.url, /tamanhoPagina=2/);
    assert.equal(result.urlForLog.includes("secret"), false);
  });

  it("listPage aceita envelope e RSQL por nome", async () => {
    const { result, calls } = await withMockedFetch(
      () => jsonResponse({ ordens: [NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE], totalPaginas: 1 }),
      async () => createClient().fetchByName("OP 05800 - 003", { maxPages: 1 })
    );
    assert.equal(result.items.length, 1);
    assert.equal(result.stoppedReason, "no_next");
    const called = new URL(calls[0]!.url);
    assert.equal(called.searchParams.get("query"), 'nome=="OP 05800 - 003"');
  });

  it("fetchIncremental percorre páginas até página vazia", async () => {
    let page = 0;
    const { result } = await withMockedFetch(
      () => {
        page += 1;
        if (page === 1) return jsonResponse([{ id: 1 }, { id: 2 }]);
        if (page === 2) return jsonResponse([{ id: 3 }]);
        return jsonResponse([]);
      },
      async () => createClient({ pageSize: 2, maxPages: 5 }).fetchIncremental()
    );
    assert.equal(result.pagesRead, 2);
    assert.equal(result.items.map((i) => i.id).join(","), "1,2,3");
    assert.equal(result.stoppedReason, "no_next");
  });

  it("traversePages encerra em página vazia", async () => {
    const { result } = await withMockedFetch(
      () => jsonResponse([]),
      async () => createClient().traversePages({ startPage: 1 })
    );
    assert.equal(result.pagesRead, 1);
    assert.equal(result.items.length, 0);
    assert.equal(result.stoppedReason, "empty_page");
  });
});

describe("nomusProductionOrdersClient — erros HTTP", () => {
  it("HTTP 429 usa tempoAteLiberar + margem e retenta até sucesso", async () => {
    const waits: number[] = [];
    let attempt = 0;
    const { result } = await withMockedFetch(
      () => {
        attempt += 1;
        if (attempt === 1) {
          return jsonResponse({ tempoAteLiberar: 3 }, 429);
        }
        return jsonResponse([{ id: 10 }]);
      },
      async () =>
        createClient({
          maxRetries: 3,
          sleepFn: async (ms) => {
            waits.push(ms);
          },
        }).listPage()
    );
    assert.equal(result.items[0]!.id, 10);
    assert.deepEqual(waits, [3 * 1000 + 1000]);
  });

  it("HTTP 500 retenta e depois falha", async () => {
    let calls = 0;
    await assert.rejects(
      async () =>
        withMockedFetch(
          () => {
            calls += 1;
            return new Response("upstream fail", { status: 500 });
          },
          async () => createClient({ maxRetries: 2, retryBaseMs: 1 }).listPage()
        ),
      (err: unknown) => {
        assert.ok(err instanceof NomusProductionOrdersClientError);
        assert.equal(err.code, "HTTP_ERROR");
        assert.equal(err.status, 500);
        assert.equal(err.message.includes("secret"), false);
        return true;
      }
    );
    assert.equal(calls, 3); // attempt 0..2
  });

  it("HTTP 400 não recuperável (sem retry)", async () => {
    let calls = 0;
    await assert.rejects(
      async () =>
        withMockedFetch(
          () => {
            calls += 1;
            return new Response('{"message":"Bearer leak-token"}', { status: 400 });
          },
          async () => createClient({ maxRetries: 5 }).listPage()
        ),
      (err: unknown) => {
        assert.ok(err instanceof NomusProductionOrdersClientError);
        assert.equal(err.status, 400);
        assert.equal(err.message.includes("leak-token"), false);
        assert.match(err.message, /Bearer <redigido>|Falha HTTP 400/);
        return true;
      }
    );
    assert.equal(calls, 1);
  });

  it("timeout aborta e esgota retries", async () => {
    await assert.rejects(
      async () =>
        withMockedFetch(
          (_input, init) =>
            new Promise((_resolve, reject) => {
              const signal = init?.signal;
              if (!signal) {
                reject(new Error("missing signal"));
                return;
              }
              const fail = () => {
                const err = new Error("Aborted");
                err.name = "AbortError";
                reject(err);
              };
              if (signal.aborted) fail();
              else signal.addEventListener("abort", fail, { once: true });
            }),
          async () =>
            createClient({
              timeoutMs: 20,
              maxRetries: 1,
              retryBaseMs: 1,
              sleepFn: async () => undefined,
            }).listPage()
        ),
      (err: unknown) => {
        assert.ok(err instanceof NomusProductionOrdersClientError);
        assert.match(err.message, /Timeout HTTP/);
        assert.equal(err.message.includes("secret"), false);
        return true;
      }
    );
  });
});

describe("nomusProductionOrdersClient — paginação defensiva", () => {
  it("detecta página repetida", async () => {
    await assert.rejects(
      async () =>
        withMockedFetch(
          () => jsonResponse([{ id: 1 }, { id: 2 }]),
          async () => createClient({ pageSize: 2, maxPages: 3 }).traversePages()
        ),
      (err: unknown) => {
        assert.ok(err instanceof NomusProductionOrdersClientError);
        assert.equal(err.code, "REPEATED_PAGE");
        return true;
      }
    );
  });

  it("detecta IDs repetidos entre páginas", async () => {
    let page = 0;
    await assert.rejects(
      async () =>
        withMockedFetch(
          () => {
            page += 1;
            if (page === 1) return jsonResponse([{ id: 1 }, { id: 2 }]);
            return jsonResponse([{ id: 2 }, { id: 3 }]);
          },
          async () => createClient({ pageSize: 2, maxPages: 5 }).traversePages()
        ),
      (err: unknown) => {
        assert.ok(err instanceof NomusProductionOrdersClientError);
        assert.equal(err.code, "REPEATED_IDS");
        return true;
      }
    );
  });

  it("rejeita retorno fora do formato esperado", async () => {
    await assert.rejects(
      async () =>
        withMockedFetch(
          () => jsonResponse("nao-e-lista"),
          async () => createClient().listPage()
        ),
      (err: unknown) => {
        assert.ok(err instanceof NomusProductionOrdersClientError);
        assert.equal(err.code, "UNEXPECTED_PAYLOAD_SHAPE");
        return true;
      }
    );
  });

  it("fingerprint estável por IDs", () => {
    assert.equal(
      fingerprintProductionOrdersPage([{ id: 2 }, { id: 1 }]),
      fingerprintProductionOrdersPage([{ id: 1 }, { id: 2 }])
    );
  });
});
