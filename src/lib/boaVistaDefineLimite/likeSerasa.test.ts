/**
 * Rotas e execução da consulta LIKE SERASA (Boa Vista via Direct Data) sem banco: store em memória, `fetch` injetado,
 * ambiente injetado, atestação de papel injetada. Nenhuma chamada sai da máquina.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import express from "express";
import type { RequestHandler } from "express";
import { fetchBoaVistaDefineLimite } from "./adapter.js";
import { readLikeSerasaConfig } from "./config.js";
import { buildBoaVistaDemoResponse } from "./fixtures.js";
import { createMemoryBoaVistaStore } from "./memoryStore.js";
import { registerLikeSerasaRoutes, resetLikeSerasaRateLimit } from "./routes.js";
import type { LikeSerasaStatusPayload } from "./view.js";

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const CNPJ = "11444777000161";
const CPF = "12345678909";

function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ base: `http://127.0.0.1:${address.port}`, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

type Options = {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  store?: ReturnType<typeof createMemoryBoaVistaStore>;
  now?: () => Date;
  audit?: (entry: { newValue: string; action: string }) => void;
  taxId?: string | null;
  roleFile?: string | null;
};

/** Produção atestada: papel declarado + arquivo do servidor + NODE_ENV + habilitação + token. */
const PRODUCTION_ENV: NodeJS.ProcessEnv = {
  INDUSCOST_OPERATIONAL_ROLE: "production",
  NODE_ENV: "production",
  LIKE_SERASA_LIVE_ENABLED: "1",
  LIKE_SERASA_DIRECT_DATA_TOKEN: "token-de-teste",
  LIKE_SERASA_UNIT_PRICE_CENTS: "2150",
  LIKE_SERASA_TIMEOUT_MS: "1000",
  LIKE_SERASA_CACHE_TTL_MS: "60000",
  LIKE_SERASA_RATE_LIMIT_PER_MINUTE: "100",
};
const HOMOLOG_ENV: NodeJS.ProcessEnv = { ...PRODUCTION_ENV, INDUSCOST_OPERATIONAL_ROLE: "homologation", LIKE_SERASA_DEMO_ENABLED: "1" };
const DEV_ENV: NodeJS.ProcessEnv = { NODE_ENV: "development", LIKE_SERASA_DEMO_ENABLED: "1", LIKE_SERASA_RATE_LIMIT_PER_MINUTE: "100" };

function appFor(role: string, options: Options = {}) {
  const store = options.store ?? createMemoryBoaVistaStore();
  const app = express();
  app.use(express.json());
  const calls: Array<{ action: string; value: Record<string, unknown> }> = [];
  registerLikeSerasaRoutes(
    app,
    {
      requireAppAuth: ((_req, _res, next) => next()) as RequestHandler,
      getCurrentAppUser: async () => ({ id: "user-1", role, name: "Admin", email: "admin@example.com" }),
    },
    {
      store,
      env: options.env ?? PRODUCTION_ENV,
      now: options.now,
      fetchImpl: options.fetchImpl,
      readRoleFile: () => (options.roleFile === undefined ? "production" : options.roleFile),
      customer: async () => ({ companyName: "Empresa Teste", taxId: options.taxId === undefined ? CNPJ : options.taxId }),
      audit: async (entry) => {
        calls.push({ action: entry.action, value: JSON.parse(entry.newValue) as Record<string, unknown> });
        options.audit?.(entry);
      },
    }
  );
  return { app, store, audits: calls };
}

function okResponse(body: unknown = buildBoaVistaDemoResponse({ cnpj: CNPJ }), status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function providerError(status: number, resultado: string, mensagem: string): Response {
  return okResponse({ metaDados: { resultado, mensagem, consultaUid: "uid-err", resultadoId: 0 }, retorno: null }, status);
}

function countingFetch(responder: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const state = { calls: 0, urls: [] as string[], headers: [] as Array<Record<string, string>> };
  const impl: typeof fetch = async (input, init) => {
    state.calls += 1;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url);
    state.urls.push(url.toString());
    state.headers.push(Object.fromEntries(new Headers(init?.headers as HeadersInit).entries()));
    return responder(url, init);
  };
  return { impl, state };
}

async function post(base: string, body: unknown, origin = base, demo = false) {
  const response = await fetch(`${base}/api/customers/${CUSTOMER}/like-serasa`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, host: new URL(base).host },
    body: JSON.stringify(demo ? { ...(body as object), demo: true } : body),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function get(base: string): Promise<LikeSerasaStatusPayload> {
  const response = await fetch(`${base}/api/customers/${CUSTOMER}/like-serasa`);
  return (await response.json()) as LikeSerasaStatusPayload;
}

// A rota exige chave com pelo menos 8 caracteres; o prefixo garante isso para os identificadores curtos dos casos.
const consent = (key = "idempotente-1") => ({ consent: true, idempotencyKey: `chave-${key}` });

describe("consulta LIKE SERASA — rotas, bloqueios e cobrança", () => {
  it("configuração: custo 2150 centavos por padrão, R$ 21,50 exibido, cache de 7 dias, produto/fonte/atribuição", async () => {
    const config = readLikeSerasaConfig({});
    assert.equal(config.unitPriceCents, 2150);
    assert.equal(config.cacheTtlMs, 7 * 24 * 60 * 60 * 1000);
    assert.equal(config.liveEnabled, false);
    const { app } = appFor("SUPER_ADMIN", { env: { ...DEV_ENV, LIKE_SERASA_UNIT_PRICE_CENTS: "" } });
    const server = await listen(app);
    try {
      const payload = await get(server.base);
      assert.equal(payload.priceLabel.replace(/ /g, " "), "R$ 21,50");
      assert.equal(payload.displayName, "LIKE SERASA");
      assert.equal(payload.provider, "Direct Data");
      assert.equal(payload.source, "Boa Vista");
      assert.match(payload.attribution, /Boa Vista — consulta disponibilizada pela Direct Data/);
      assert.equal(payload.state, "NOT_CONSULTED");
      assert.equal(payload.live.allowed, false);
      assert.equal(payload.live.reason, "ROLE_UNDECLARED");
      assert.equal(payload.document.kind, "CNPJ");
      assert.equal(payload.document.formatted, "11.444.777/0001-61");
    } finally {
      await server.close();
    }
  });

  it("usuário não SUPER_ADMIN: histórico legível, consulta paga recusada (403) sem chamar o provedor", async () => {
    resetLikeSerasaRateLimit();
    const fetcher = countingFetch(() => okResponse());
    const { app } = appFor("MANAGER", { fetchImpl: fetcher.impl });
    const server = await listen(app);
    try {
      const payload = await get(server.base);
      assert.equal(payload.canRequest, false);
      const result = await post(server.base, consent());
      assert.equal(result.status, 403);
      assert.equal(fetcher.state.calls, 0);
    } finally {
      await server.close();
    }
  });

  it("consentimento ausente: 422 CONSENT_REQUIRED, nada enviado, auditoria registrada", async () => {
    resetLikeSerasaRateLimit();
    const fetcher = countingFetch(() => okResponse());
    const { app, audits } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl });
    const server = await listen(app);
    try {
      const result = await post(server.base, { idempotencyKey: "chave-idempotente-1" });
      assert.equal(result.status, 422);
      assert.equal(result.json.code, "CONSENT_REQUIRED");
      assert.equal(fetcher.state.calls, 0);
      assert.equal(audits[0]?.value.code, "CONSENT_REQUIRED");
    } finally {
      await server.close();
    }
  });

  it("origem diferente do host: 403 sem consulta", async () => {
    resetLikeSerasaRateLimit();
    const fetcher = countingFetch(() => okResponse());
    const { app } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl });
    const server = await listen(app);
    try {
      const result = await post(server.base, consent(), "https://outro.exemplo");
      assert.equal(result.status, 403);
      assert.equal(fetcher.state.calls, 0);
    } finally {
      await server.close();
    }
  });

  it("pessoa física (CPF): 422 NOT_LEGAL_ENTITY, nada reservado nem enviado", async () => {
    resetLikeSerasaRateLimit();
    const fetcher = countingFetch(() => okResponse());
    const { app, store } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl, taxId: CPF });
    const server = await listen(app);
    try {
      const payload = await get(server.base);
      assert.equal(payload.document.kind, "CPF");
      const result = await post(server.base, consent());
      assert.equal(result.status, 422);
      assert.equal(result.json.code, "NOT_LEGAL_ENTITY");
      assert.match(String(result.json.message), /exclusivamente pessoa jurídica/);
      assert.equal(store.rows.length, 0);
      assert.equal(fetcher.state.calls, 0);
    } finally {
      await server.close();
    }
  });

  it("CNPJ inválido (dígito verificador) ou ausente: 422 INVALID_CNPJ, sem cobrança", async () => {
    resetLikeSerasaRateLimit();
    const fetcher = countingFetch(() => okResponse());
    for (const taxId of ["11444777000162", "", null]) {
      const { app, store } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl, taxId });
      const server = await listen(app);
      try {
        const result = await post(server.base, consent(`chave-${taxId ?? "nulo"}`));
        assert.equal(result.status, 422, String(taxId));
        assert.equal(result.json.code, "INVALID_CNPJ");
        assert.equal(store.rows.length, 0);
      } finally {
        await server.close();
      }
    }
    assert.equal(fetcher.state.calls, 0);
  });

  it("bloqueio completo em desenvolvimento: token ausente ou presente por engano, nenhuma requisição real", async () => {
    resetLikeSerasaRateLimit();
    const fetcher = countingFetch(() => okResponse());
    for (const env of [DEV_ENV, { ...DEV_ENV, LIKE_SERASA_DIRECT_DATA_TOKEN: "token-acidental", LIKE_SERASA_LIVE_ENABLED: "1" }]) {
      const { app, store } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl, env, roleFile: null });
      const server = await listen(app);
      try {
        const result = await post(server.base, consent());
        assert.equal(result.status, 403);
        assert.equal(result.json.code, "ENVIRONMENT_BLOCKED");
        assert.match(String(result.json.message), /somente em produção/);
        assert.equal(store.rows.length, 0, "nada reservado");
      } finally {
        await server.close();
      }
    }
    assert.equal(fetcher.state.calls, 0);
  });

  it("bloqueio completo em homologação, inclusive com NODE_ENV=production e token presente; ambiente desconhecido idem", async () => {
    resetLikeSerasaRateLimit();
    const fetcher = countingFetch(() => okResponse());
    const cases: Array<[NodeJS.ProcessEnv, string | null, string]> = [
      [HOMOLOG_ENV, "homologation", "ROLE_NOT_PRODUCTION"],
      [{ ...HOMOLOG_ENV, NODE_ENV: "production" }, "homologation", "ROLE_NOT_PRODUCTION"],
      [{ ...PRODUCTION_ENV, INDUSCOST_OPERATIONAL_ROLE: "" }, "production", "ROLE_UNDECLARED"],
      [PRODUCTION_ENV, null, "ATTESTATION_MISSING"],
      [PRODUCTION_ENV, "homologation", "ATTESTATION_MISMATCH"],
    ];
    for (const [env, roleFile, reason] of cases) {
      const { app, store } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl, env, roleFile });
      const server = await listen(app);
      try {
        const payload = await get(server.base);
        assert.equal(payload.live.allowed, false, reason);
        assert.equal(payload.live.reason, reason);
        const result = await post(server.base, consent());
        assert.equal(result.status, 403, reason);
        assert.equal(result.json.code, "ENVIRONMENT_BLOCKED");
        assert.equal(store.rows.length, 0);
      } finally {
        await server.close();
      }
    }
    assert.equal(fetcher.state.calls, 0);
  });

  it("produção com funcionalidade desabilitada ou sem token: bloqueado antes de qualquer reserva", async () => {
    resetLikeSerasaRateLimit();
    const fetcher = countingFetch(() => okResponse());
    for (const env of [{ ...PRODUCTION_ENV, LIKE_SERASA_LIVE_ENABLED: "false" }, { ...PRODUCTION_ENV, LIKE_SERASA_DIRECT_DATA_TOKEN: "" }]) {
      const { app, store } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl, env });
      const server = await listen(app);
      try {
        const result = await post(server.base, consent());
        assert.equal(result.status, 403);
        assert.equal(result.json.code, "ENVIRONMENT_BLOCKED");
        assert.equal(store.rows.length, 0);
      } finally {
        await server.close();
      }
    }
    assert.equal(fetcher.state.calls, 0);
  });

  it("produção habilitada com HTTP simulado: consulta autorizada, GET com Bearer e GERARCOMPROVANTE, token fora da URL, cobrança estimada, relatório e histórico persistidos", async () => {
    resetLikeSerasaRateLimit();
    const fetcher = countingFetch(() => okResponse());
    const { app, store, audits } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl });
    const server = await listen(app);
    try {
      const result = await post(server.base, consent());
      assert.equal(result.status, 200, JSON.stringify(result.json));
      assert.equal(result.json.code, "OK");
      assert.equal(result.json.charged, true);
      assert.equal(result.json.mode, "LIVE");
      assert.equal(fetcher.state.calls, 1);
      const url = new URL(fetcher.state.urls[0]!);
      assert.equal(url.pathname, "/api/BoaVistaDefineLimitePositivoPJ");
      assert.equal(url.searchParams.get("CNPJ"), CNPJ);
      assert.equal(url.searchParams.get("GERARCOMPROVANTE"), "Desabilitar");
      assert.equal(url.searchParams.get("TOKEN"), null);
      assert.doesNotMatch(url.toString(), /token-de-teste/);
      assert.equal(fetcher.state.headers[0]?.authorization, "Bearer token-de-teste");
      const consultation = result.json.consultation as Record<string, unknown>;
      assert.equal(consultation.score, 593);
      assert.equal(consultation.scoreClass, "B");
      assert.equal(consultation.suggestedLimitCents, 31670000);
      assert.equal(consultation.billingStatus, "ESTIMATED");
      assert.equal(consultation.authorizedCostCents, 2150);
      assert.equal(consultation.chargedCostCents, 2150);
      assert.equal(consultation.parserVersion, "bvdl-pj-1");
      const row = store.rows[0]!;
      assert.equal(row.status, "SUCCEEDED");
      assert.equal(row.mode, "LIVE");
      assert.equal(row.rawPayload, null, "retorno bruto não é retido por padrão");
      const payload = await get(server.base);
      assert.equal(payload.state, "VALID");
      assert.equal(payload.history.length, 1);
      assert.equal(payload.history[0]?.billingLabel, "Estimada pelo valor autorizado");
      const audit = audits.at(-1)!;
      assert.equal(audit.action, "LIKE_SERASA_QUERY");
      assert.equal(audit.value.code, "OK");
      assert.equal(audit.value.charged, true);
      assert.equal(audit.value.creditEffect, "NONE");
      assert.equal(audit.value.environment, "production-attested");
    } finally {
      await server.close();
    }
  });

  it("cache válido: segunda consulta devolve o resultado anterior sem custo; vencida: nova consulta; atualização manual com forceRefresh", async () => {
    resetLikeSerasaRateLimit();
    const fetcher = countingFetch(() => okResponse());
    let clock = Date.parse("2026-10-28T12:00:00Z");
    const { app } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl, now: () => new Date(clock) });
    const server = await listen(app);
    try {
      assert.equal((await post(server.base, consent("k1"))).json.code, "OK");
      const cached = await post(server.base, consent("k2"));
      assert.equal(cached.status, 200);
      assert.equal(cached.json.code, "CACHE_VALID");
      assert.equal(cached.json.charged, false);
      assert.ok(cached.json.consultation, "resultado anterior devolvido");
      assert.equal(fetcher.state.calls, 1);
      const forced = await post(server.base, { ...consent("k3"), forceRefresh: true });
      assert.equal(forced.json.code, "OK");
      assert.equal(fetcher.state.calls, 2);
      clock += 61_000;
      assert.equal((await get(server.base)).state, "STALE");
      const renewed = await post(server.base, consent("k4"));
      assert.equal(renewed.json.code, "OK");
      assert.equal(fetcher.state.calls, 3);
    } finally {
      await server.close();
    }
  });

  it("duplo clique / reenvio: mesma chave de idempotência não gera segunda chamada; chaves diferentes concorrentes: exatamente uma consulta", async () => {
    resetLikeSerasaRateLimit();
    const fetcher = countingFetch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return okResponse();
    });
    const { app } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl });
    const server = await listen(app);
    try {
      const [a, b, c] = await Promise.all([post(server.base, consent("mesma")), post(server.base, consent("mesma")), post(server.base, consent("outra"))]);
      const codes = [a.json.code, b.json.code, c.json.code].sort();
      assert.equal(fetcher.state.calls, 1, "uma única chamada paga");
      assert.ok(codes.includes("OK"));
      assert.ok(codes.includes("IN_FLIGHT"), codes.join(","));
      const again = await post(server.base, consent("mesma"));
      assert.equal(again.json.code, "OK");
      assert.equal(again.json.charged, false);
      assert.equal(fetcher.state.calls, 1);
    } finally {
      await server.close();
    }
  });

  it("timeout: cobrança desconhecida, sem repetição automática; nova tentativa é recusada até conciliar", async () => {
    resetLikeSerasaRateLimit();
    const fetcher = countingFetch(async (_url, init) => {
      await new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("abortado"), { name: "AbortError" }))));
      return okResponse();
    });
    const { app, store } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl, env: { ...PRODUCTION_ENV, LIKE_SERASA_TIMEOUT_MS: "1000" } });
    const server = await listen(app);
    try {
      const result = await post(server.base, consent("t1"));
      assert.equal(result.status, 502);
      assert.equal(result.json.code, "TIMEOUT");
      assert.equal(store.rows[0]?.status, "UNKNOWN_BILLING");
      assert.equal(store.rows[0]?.billingStatus, "UNKNOWN");
      assert.equal(fetcher.state.calls, 1);
      const retry = await post(server.base, consent("t2"));
      assert.equal(retry.status, 409);
      assert.equal(retry.json.code, "UNKNOWN_BILLING");
      assert.equal(fetcher.state.calls, 1, "nenhuma repetição automática");
      assert.equal((await get(server.base)).state, "UNKNOWN_BILLING");
    } finally {
      await server.close();
    }
  });

  it("erros do provedor: 403 saldo insuficiente (402, não enviada), 401 autenticação, 429 limite, 500 falha, 400 CNPJ recusado — nenhuma repetição", async () => {
    resetLikeSerasaRateLimit();
    const cases: Array<[number, string, string, number, string]> = [
      [403, "Saldo Insuficiente Para Realizar Esta Consulta", "Saldo insuficiente para realizar esta consulta.", 402, "INSUFFICIENT_BALANCE"],
      [401, "Não Autorizado", "Token inválido ou ausente.", 502, "AUTH"],
      [429, "", "Muitas requisições", 502, "RATE_LIMIT"],
      // Resultado oficial "Falha Ao Realizar Consulta" está na tabela de não cobrados do classificador Direct Data.
      [500, "Falha Ao Realizar Consulta", "Falha ao realizar a consulta.", 502, "UNAVAILABLE"],
      [500, "", "Erro interno sem resultado oficial.", 502, "HTTP_ERROR"],
      [400, "Documento Entrada Inválida", "Parâmetro 'CNPJ' inválido ou ausente.", 400, "INVALID_INPUT"],
      [503, "Consulta Em Manutenção", "Em manutenção.", 502, "UNAVAILABLE"],
    ];
    for (const [httpStatus, resultado, mensagem, expectedStatus, expectedCode] of cases) {
      const fetcher = countingFetch(() => providerError(httpStatus, resultado, mensagem));
      const { app, store } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl });
      const server = await listen(app);
      try {
        const result = await post(server.base, consent(`e-${httpStatus}`));
        assert.equal(result.status, expectedStatus, `${httpStatus}: ${JSON.stringify(result.json)}`);
        assert.equal(result.json.code, expectedCode);
        assert.equal(fetcher.state.calls, 1);
        assert.equal(store.rows.length, 1);
        assert.notEqual(store.rows[0]?.status, "SUCCEEDED");
      } finally {
        await server.close();
      }
    }
  });

  it("resposta parcial (sem score e sem restrições) e resposta inesperada: PARTIAL; cobrança estimada se o provedor disse Sucesso, indeterminada sem resultado oficial; histórico preservado", async () => {
    resetLikeSerasaRateLimit();
    const cases: Array<[unknown, string]> = [
      [buildBoaVistaDemoResponse({ cnpj: CNPJ, variant: "partial" }), "ESTIMATED"],
      [{ metaDados: { resultado: "Sucesso", consultaUid: "uid-x" }, retorno: { inesperado: true } }, "UNKNOWN"],
      [{ foo: "bar" }, "UNKNOWN"],
    ];
    for (const [body, billing] of cases) {
      const fetcher = countingFetch(() => okResponse(body));
      const { app, store } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl });
      const server = await listen(app);
      try {
        const result = await post(server.base, consent("p1"));
        assert.equal(result.status, 409, JSON.stringify(result.json));
        assert.equal(result.json.code, "PARTIAL");
        assert.equal(store.rows[0]?.status, "PARTIAL");
        assert.equal(store.rows[0]?.billingStatus, billing);
        const payload = await get(server.base);
        assert.equal(payload.state, "PARTIAL");
        assert.equal(payload.history.length, 1);
      } finally {
        await server.close();
      }
    }
  });

  it("limite ausente e score ausente no retorno de sucesso: resultado gravado como parcial, sem zero inventado", async () => {
    resetLikeSerasaRateLimit();
    const body = { metaDados: { resultado: "Sucesso", consultaUid: "uid-l" }, retorno: { cnpj: CNPJ, razaoSocial: "EMPRESA X", restricoes: { protestos: { quantidade: "0", valorTotal: "0,00" } } } };
    const fetcher = countingFetch(() => okResponse(body));
    const { app, store } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl });
    const server = await listen(app);
    try {
      const result = await post(server.base, consent("l1"));
      assert.equal(result.json.code, "PARTIAL");
      const consultation = result.json.consultation as Record<string, unknown>;
      assert.equal(consultation.score, null);
      assert.equal(consultation.suggestedLimitCents, null);
      assert.equal((consultation.sections as { limit: { available: boolean } }).limit.available, false);
      assert.equal(store.rows[0]?.billingStatus, "ESTIMATED", "resultado oficial Sucesso: cobrança estimada mesmo parcial");
    } finally {
      await server.close();
    }
  });

  it("falha ao salvar o retorno: PERSISTENCE_FAILED, consulta marcada como cobrança desconhecida, sem reenvio", async () => {
    resetLikeSerasaRateLimit();
    const fetcher = countingFetch(() => okResponse());
    const store = createMemoryBoaVistaStore();
    store.failCompleteTimes = 1;
    const { app } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl, store });
    const server = await listen(app);
    try {
      const result = await post(server.base, consent("f1"));
      assert.equal(result.status, 502);
      assert.equal(result.json.code, "PERSISTENCE_FAILED");
      assert.equal(store.rows[0]?.status, "UNKNOWN_BILLING");
      const retry = await post(server.base, consent("f2"));
      assert.equal(retry.json.code, "UNKNOWN_BILLING");
      assert.equal(fetcher.state.calls, 1);
    } finally {
      await server.close();
    }
  });

  it("retenção do retorno bruto só com LIKE_SERASA_STORE_RAW_PAYLOAD, e redigido; comprovante só com LIKE_SERASA_RECEIPT_ENABLED", async () => {
    resetLikeSerasaRateLimit();
    const body = buildBoaVistaDemoResponse({ cnpj: CNPJ }) as { metaDados: Record<string, unknown> };
    body.metaDados.urlComprovante = "https://comprovante.exemplo/abc.pdf";
    const fetcher = countingFetch(() => okResponse(body));
    const { app, store } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl, env: { ...PRODUCTION_ENV, LIKE_SERASA_STORE_RAW_PAYLOAD: "1", LIKE_SERASA_RECEIPT_ENABLED: "1" } });
    const server = await listen(app);
    try {
      const result = await post(server.base, consent("r1"));
      assert.equal(result.json.code, "OK");
      assert.equal(new URL(fetcher.state.urls[0]!).searchParams.get("GERARCOMPROVANTE"), "Habilitar");
      const raw = store.rows[0]?.rawPayload as { retorno: { governancas: { socios: Array<{ documento: string }> }; email?: unknown } };
      assert.equal(raw.retorno.governancas.socios[0]?.documento, "•••91");
      assert.equal(raw.retorno.email, undefined);
      assert.equal((result.json.consultation as { hasReceipt: boolean }).hasReceipt, true);
      assert.doesNotMatch(JSON.stringify(result.json), /comprovante\.exemplo/, "a URL não vai no relatório");
      const receipt = await fetch(`${server.base}/api/customers/${CUSTOMER}/like-serasa/${store.rows[0]!.id}/receipt`);
      assert.equal(receipt.status, 200);
      assert.equal(((await receipt.json()) as { url: string }).url, "https://comprovante.exemplo/abc.pdf");
      const payload = await get(server.base);
      assert.doesNotMatch(JSON.stringify(payload), /comprovante\.exemplo/);
    } finally {
      await server.close();
    }
  });

  it("demonstração: só com flag e fora de produção; gravada como DEMO sem cobrança; nunca satisfaz o cache real; nenhuma rede", async () => {
    resetLikeSerasaRateLimit();
    const fetcher = countingFetch(() => okResponse());
    const { app, store } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl, env: HOMOLOG_ENV, roleFile: "homologation" });
    const server = await listen(app);
    try {
      const demo = await post(server.base, consent("d1"), server.base, true);
      assert.equal(demo.status, 200, JSON.stringify(demo.json));
      assert.equal(demo.json.code, "OK");
      assert.equal(demo.json.mode, "DEMO");
      assert.equal(demo.json.charged, false);
      assert.equal(store.rows[0]?.mode, "DEMO");
      assert.equal(store.rows[0]?.billingStatus, "NOT_APPLICABLE");
      assert.equal(store.rows[0]?.authorizedCostCents, 0);
      assert.match(String(store.rows[0]?.providerQueryId), /^demo-/);
      assert.match(String(store.rows[0]?.companyName), /SIMULADO|Empresa Teste/);
      const live = await post(server.base, consent("d2"));
      assert.equal(live.json.code, "ENVIRONMENT_BLOCKED", "a demonstração não libera a consulta real");
      assert.equal(fetcher.state.calls, 0);
      const payload = await get(server.base);
      assert.equal(payload.consultation?.mode, "DEMO");
      assert.equal(payload.history[0]?.billingLabel, "Não se aplica (simulação)");
    } finally {
      await server.close();
    }
    const production = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl, env: { ...PRODUCTION_ENV, LIKE_SERASA_DEMO_ENABLED: "1" } });
    const prodServer = await listen(production.app);
    try {
      const blocked = await post(prodServer.base, consent("d3"), prodServer.base, true);
      assert.equal(blocked.status, 403);
      assert.equal(blocked.json.code, "DEMO_BLOCKED");
      assert.equal(production.store.rows.length, 0);
    } finally {
      await prodServer.close();
    }
  });

  it("rate limit por usuário (429) sem chamar o provedor", async () => {
    resetLikeSerasaRateLimit();
    const fetcher = countingFetch(() => okResponse());
    const { app } = appFor("SUPER_ADMIN", { fetchImpl: fetcher.impl, env: { ...PRODUCTION_ENV, LIKE_SERASA_RATE_LIMIT_PER_MINUTE: "1" } });
    const server = await listen(app);
    try {
      assert.equal((await post(server.base, consent("rl1"))).json.code, "OK");
      const second = await post(server.base, consent("rl2"));
      assert.equal(second.status, 429);
      assert.equal(fetcher.state.calls, 1);
    } finally {
      await server.close();
    }
  });

  it("adapter: timeout local vira TIMEOUT com cobrança desconhecida; o token nunca aparece na URL", async () => {
    const fetcher = countingFetch(async (_url, init) => {
      await new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("x"), { name: "AbortError" }))));
      return okResponse();
    });
    const result = await fetchBoaVistaDefineLimite({ cnpj: CNPJ, config: { baseUrl: "https://apiv3.directd.com.br", token: "segredo", timeoutMs: 1000, receiptEnabled: false }, fetchImpl: fetcher.impl });
    assert.equal(result.outcome, "TIMEOUT");
    assert.equal(result.charge, "unknown");
    assert.doesNotMatch(fetcher.state.urls[0]!, /segredo/);
  });
});
