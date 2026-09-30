/**
 * Testes da guarda de sessão de borda (Cloudflare Access expirado).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createEdgeSessionGuardFetch,
  claimEdgeSessionReload,
  EDGE_SESSION_PROBE_PATH,
  EDGE_SESSION_RELOAD_COOLDOWN_MS,
} from "./edgeSessionGuard.js";

const ORIGIN = "https://app.example.com";

type Call = { input: unknown; init: RequestInit | undefined };

function setup(opts: {
  main: () => Promise<Response>;
  probe?: () => Promise<Response>;
}) {
  const calls: Call[] = [];
  let expired = 0;
  const guarded = createEdgeSessionGuardFetch({
    origin: ORIGIN,
    fetch: (input, init) => {
      calls.push({ input, init });
      if (input === EDGE_SESSION_PROBE_PATH && init?.redirect === "manual") {
        return (opts.probe ?? (async () => new Response("{}")))();
      }
      return opts.main();
    },
    onEdgeSessionExpired: () => {
      expired += 1;
    },
  });
  return { guarded, calls, expiredCount: () => expired };
}

const opaqueRedirect = async () => ({ type: "opaqueredirect" }) as Response;
const networkFailure = async (): Promise<Response> => {
  throw new TypeError("Failed to fetch");
};

test("resposta normal passa direto, sem sonda", async () => {
  const res = new Response("{}", { status: 500 });
  const { guarded, calls, expiredCount } = setup({ main: async () => res });
  assert.equal(await guarded("/api/x"), res);
  assert.equal(calls.length, 1);
  assert.equal(expiredCount(), 0);
});

test("falha de rede + sonda redirecionada pela borda dispara novo login", async () => {
  const { guarded, calls, expiredCount } = setup({
    main: networkFailure,
    probe: opaqueRedirect,
  });
  await assert.rejects(guarded("/api/x", { method: "POST" }), TypeError);
  assert.equal(expiredCount(), 1);
  // A chamada original (POST) não é repetida; só a sonda GET.
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init?.method, "GET");
  assert.equal(calls[1].init?.credentials, "include");
});

test("falha de rede com sonda respondendo normal não redireciona", async () => {
  const { guarded, expiredCount } = setup({ main: networkFailure });
  await assert.rejects(guarded("/api/x"), TypeError);
  assert.equal(expiredCount(), 0);
});

test("falha de rede com sonda também falhando é só rede", async () => {
  const { guarded, expiredCount } = setup({ main: networkFailure, probe: networkFailure });
  await assert.rejects(guarded("/api/x"), TypeError);
  assert.equal(expiredCount(), 0);
});

test("abort não dispara sonda", async () => {
  const controller = new AbortController();
  controller.abort();
  const { guarded, calls } = setup({
    main: async () => {
      throw new DOMException("Aborted", "AbortError");
    },
    probe: opaqueRedirect,
  });
  await assert.rejects(guarded("/api/x", { signal: controller.signal }));
  assert.equal(calls.length, 1);
});

test("chamada cross-origin não dispara sonda", async () => {
  const { guarded, calls, expiredCount } = setup({
    main: networkFailure,
    probe: opaqueRedirect,
  });
  await assert.rejects(guarded("https://outro.example.com/api"), TypeError);
  assert.equal(calls.length, 1);
  assert.equal(expiredCount(), 0);
});

test("falhas simultâneas compartilham uma única sonda", async () => {
  const { guarded, calls } = setup({ main: networkFailure, probe: opaqueRedirect });
  await Promise.allSettled([guarded("/api/a"), guarded("/api/b"), guarded("/api/c")]);
  const probes = calls.filter((c) => c.input === EDGE_SESSION_PROBE_PATH);
  assert.equal(probes.length, 1);
});

test("claimEdgeSessionReload respeita o cooldown anti-loop", () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
  assert.equal(claimEdgeSessionReload(storage, 1_000_000), true);
  assert.equal(claimEdgeSessionReload(storage, 1_000_000 + 5_000), false);
  assert.equal(
    claimEdgeSessionReload(storage, 1_000_000 + EDGE_SESSION_RELOAD_COOLDOWN_MS + 1),
    true
  );
  assert.equal(claimEdgeSessionReload(null, 0), true);
});
