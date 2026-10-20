import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import express from "express";
import type { RequestHandler } from "express";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { decideCommercialCredit } from "@/src/lib/commercial/commercialCreditDecision.js";
import type { CommercialDelinquencyAnalysis } from "@/src/lib/commercial/customerDelinquencyAnalysis.js";
import { fetchQuodDossier } from "./adapter.js";
import { canAccessQuodDossier, readQuodDossierConfig } from "./config.js";
import { createMemoryQuodStore } from "./memoryStore.js";
import { parseQuodDossier } from "./parse.js";
import { registerQuodDossierRoutes, resetQuodDossierRateLimit } from "./routes.js";

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const CNPJ = "11444777000161";

function analysis(overrides: Partial<CommercialDelinquencyAnalysis> = {}): CommercialDelinquencyAnalysis {
  return {
    status: "REGULAR",
    unknownReason: null,
    overdueTitleCount: 0,
    overdueAmount: 0,
    openAmount: 0,
    maxDaysOverdue: 0,
    lastSyncedAt: "2026-10-19T12:00:00.000Z",
    ...overrides,
    evidence: {
      source: "NomusAccountsReceivable",
      toleranceDays: 0,
      toleranceUnit: "CALENDAR_DAYS",
      referenceDate: "2026-10-19",
      cnpj: CNPJ,
      nomusPersonId: 100,
      identity: "RESOLVED",
      syncRunStatus: "SUCCESS",
      payloadComplete: true,
      sourceMaxSyncedAt: "2026-10-19T12:00:00.000Z",
      includedTitleIds: [],
      overdueTitleIds: [],
      protestedTitleIds: [],
      protestReading: "NOT_IN_SOURCE",
      exclusions: [],
      ...overrides.evidence,
    },
  };
}

function dossier(score: number | null, restrictions: boolean): unknown {
  return {
    metaDados: { consultaUid: "uid-quod", mensagem: "", resultado: "Sucesso" },
    retorno: {
      documentoConsultado: CNPJ,
      entidadeJuridica: {
        dadosCadastrais: { razaoSocial: "Empresa Teste", situacaoCadastral: "ATIVA" },
        scoreEntidades: { entidadeJuridica: score == null ? { motivos: [] } : { score, motivos: ["motivo informado"] } },
        pendenciaFinanceira: restrictions
          ? {
              status: "consta",
              totalPendencia: 1,
              protestos: [{ situacao: "ativo", valorTotal: 150, cartorios: [{ cidade: "São Paulo", nome: "Cartório", quantidadeProtestos: 1, valorProtestado: 150 }] }],
              acoesJudiciais: [],
              recuperacoesJudiciaisFalencia: [],
              chequesSemFundo: [],
            }
          : { status: "nada consta neste retorno", totalPendencia: 0, protestos: [], acoesJudiciais: [], recuperacoesJudiciaisFalencia: [], chequesSemFundo: [] },
      },
    },
  };
}

function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ base: `http://127.0.0.1:${address.port}`, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

function appFor(role: string, options: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv; store?: ReturnType<typeof createMemoryQuodStore>; now?: () => Date; audit?: (entry: { newValue: string }) => void } = {}) {
  const store = options.store ?? createMemoryQuodStore();
  const app = express();
  app.use(express.json());
  registerQuodDossierRoutes(
    app,
    {
      requireAppAuth: ((_req, _res, next) => next()) as RequestHandler,
      getCurrentAppUser: async () => ({ id: "user-1", role, name: "Admin", email: "admin@example.com" }),
    },
    {
      store,
      env: options.env,
      now: options.now,
      fetchImpl: options.fetchImpl,
      customer: async () => ({ companyName: "Empresa Teste", cnpj: CNPJ }),
      audit: async (entry) => options.audit?.(entry),
    }
  );
  return { app, store };
}

const enabledEnv: NodeJS.ProcessEnv = {
  QUOD_DOSSIER_ENABLED: "true",
  QUOD_DIRECT_DATA_TOKEN: "token-de-teste",
  QUOD_DOSSIER_UNIT_PRICE_CENTS: "699",
  QUOD_DOSSIER_MONTHLY_LIMIT_CENTS: "6990",
  QUOD_DOSSIER_TIMEOUT_MS: "1000",
  QUOD_DOSSIER_CACHE_TTL_MS: "60000",
  QUOD_DOSSIER_CNPJ_INTERVAL_MS: "60000",
  QUOD_DOSSIER_MAX_PER_CNPJ: "1",
  QUOD_DOSSIER_RATE_LIMIT_PER_MINUTE: "100",
};

async function post(base: string, body: unknown, origin: string) {
  return fetch(`${base}/api/customers/${CUSTOMER}/quod-dossier`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("dossiê QUOD", () => {
  it("só SUPER_ADMIN acessa; ADMIN, gestor, vendedor, viewer e exceção comercial não", () => {
    resetQuodDossierRateLimit();
    assert.equal(canAccessQuodDossier({ role: "SUPER_ADMIN" }), true);
    for (const role of ["ADMIN", "COMMERCIAL_MANAGER", "SELLER", "VIEWER"]) {
      assert.equal(canAccessQuodDossier({ role }), false);
    }
    assert.equal(canAccessQuodDossier({ role: "ADMIN" }), false);
  });

  it("recusa chamada direta, confirmação ausente e cancelamento sem cobrança", async () => {
    resetQuodDossierRateLimit();
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    };
    const { app } = appFor("SELLER", { fetchImpl, env: enabledEnv });
    const server = await listen(app);
    const denied = await post(server.base, { consent: true, idempotencyKey: "chave-12345678" }, server.base);
    assert.equal(denied.status, 403);
    const peek = await fetch(`${server.base}/api/customers/${CUSTOMER}/quod-dossier`);
    assert.equal(peek.status, 403);
    await server.close();

    const allowed = appFor("SUPER_ADMIN", { fetchImpl, env: enabledEnv });
    const open = await listen(allowed.app);
    const missing = await post(open.base, { consent: false, idempotencyKey: "chave-12345678" }, open.base);
    assert.equal(missing.status, 422);
    const idle = await fetch(`${open.base}/api/customers/${CUSTOMER}/quod-dossier`);
    assert.equal(idle.status, 200);
    assert.equal(calls, 0);
    await open.close();
  });

  it("SUPER_ADMIN consulta com consentimento, cache não cobra e reconsulta depois do vencimento cobra de novo", async () => {
    resetQuodDossierRateLimit();
    let calls = 0;
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls += 1;
      const url = String(input);
      seen.push(url);
      assert.equal(init && "method" in init ? init.method : undefined, "GET");
      assert.equal(url.includes("TOKEN"), false);
      assert.equal(url.includes("token-de-teste"), false);
      const headers = new Headers(init?.headers);
      assert.match(headers.get("authorization") ?? "", /^Bearer /);
      return new Response(JSON.stringify(dossier(820, false)), { status: 200 });
    };
    let clock = new Date("2026-10-20T12:00:00.000Z");
    const env = { ...enabledEnv, QUOD_DOSSIER_CACHE_TTL_MS: "1000", QUOD_DOSSIER_CNPJ_INTERVAL_MS: "1000" };
    const { app } = appFor("SUPER_ADMIN", { fetchImpl, env, now: () => clock });
    const server = await listen(app);
    const first = await post(server.base, { consent: true, idempotencyKey: "chave-primeira" }, server.base);
    assert.equal(first.status, 200);
    const cached = await post(server.base, { consent: true, idempotencyKey: "chave-segunda" }, server.base);
    assert.equal(cached.status, 409);
    const cachedBody = await cached.json() as { code: string; charged: boolean };
    assert.equal(cachedBody.code, "CACHE_VALID");
    assert.equal(cachedBody.charged, false);
    assert.equal(calls, 1);
    const view = await fetch(`${server.base}/api/customers/${CUSTOMER}/quod-dossier`, { headers: { origin: server.base } });
    assert.equal(view.status, 200);
    assert.equal(calls, 1);
    clock = new Date(clock.getTime() + 5000);
    const again = await post(server.base, { consent: true, idempotencyKey: "chave-terceira" }, server.base);
    assert.equal(again.status, 200);
    assert.equal(calls, 2);
    await server.close();
  });

  it("estoura orçamento, duplica concorrência, timeout sem retry, 401, 429 e 5xx", async () => {
    resetQuodDossierRateLimit();
    const budgetEnv = { ...enabledEnv, QUOD_DOSSIER_MONTHLY_LIMIT_CENTS: "699", QUOD_DOSSIER_MAX_PER_CNPJ: "5" };
    let mode = "ok";
    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls += 1;
      if (mode === "timeout") {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("abort");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
      if (mode === "auth") return new Response("{}", { status: 401 });
      if (mode === "429") return new Response("{}", { status: 429 });
      if (mode === "500") return new Response("{}", { status: 500 });
      return new Response(JSON.stringify(dossier(100, false)), { status: 200 });
    };
    const budget = appFor("SUPER_ADMIN", { fetchImpl, env: budgetEnv, now: () => new Date("2026-10-20T12:00:00.000Z") });
    const budgetServer = await listen(budget.app);
    assert.equal((await post(budgetServer.base, { consent: true, idempotencyKey: "orcamento-1" }, budgetServer.base)).status, 200);
    const stored = budget.store.rows[0];
    if (stored) stored.validUntil = "2020-01-01T00:00:00.000Z";
    const blocked = await post(budgetServer.base, { consent: true, idempotencyKey: "orcamento-2" }, budgetServer.base);
    assert.equal((await blocked.json() as { code: string }).code, "BUDGET");
    assert.equal(calls, 1);
    await budgetServer.close();

    calls = 0;
    const concurrentStore = createMemoryQuodStore();
    const concurrent = appFor("SUPER_ADMIN", { fetchImpl, env: enabledEnv, store: concurrentStore });
    const concurrentServer = await listen(concurrent.app);
    const pair = await Promise.all([
      post(concurrentServer.base, { consent: true, idempotencyKey: "concorrente-1" }, concurrentServer.base),
      post(concurrentServer.base, { consent: true, idempotencyKey: "concorrente-2" }, concurrentServer.base),
    ]);
    const codes = await Promise.all(pair.map(async (response) => (await response.json() as { code: string }).code));
    assert.equal(codes.filter((code) => code === "OK").length, 1);
    assert.equal(codes.includes("IN_FLIGHT") || codes.includes("CACHE_VALID"), true);
    assert.equal(calls, 1);
    await concurrentServer.close();

    mode = "timeout";
    calls = 0;
    const timeoutEnv = { ...enabledEnv, QUOD_DOSSIER_TIMEOUT_MS: "30", QUOD_DOSSIER_CACHE_TTL_MS: "1", QUOD_DOSSIER_CNPJ_INTERVAL_MS: "1" };
    const timeout = appFor("SUPER_ADMIN", { fetchImpl, env: timeoutEnv });
    const timeoutServer = await listen(timeout.app);
    const timed = await post(timeoutServer.base, { consent: true, idempotencyKey: "timeout-1" }, timeoutServer.base);
    assert.equal((await timed.json() as { code: string }).code, "TIMEOUT");
    const retried = await post(timeoutServer.base, { consent: true, idempotencyKey: "timeout-2" }, timeoutServer.base);
    assert.equal((await retried.json() as { code: string }).code, "UNKNOWN_BILLING");
    assert.equal(calls, 1);
    await timeoutServer.close();

    for (const next of ["auth", "429", "500"] as const) {
      mode = next;
      calls = 0;
      const isolated = appFor("SUPER_ADMIN", { fetchImpl, env: { ...enabledEnv, QUOD_DOSSIER_CACHE_TTL_MS: "1" } });
      const isolatedServer = await listen(isolated.app);
      const response = await post(isolatedServer.base, { consent: true, idempotencyKey: `falha-${next}` }, isolatedServer.base);
      const body = await response.json() as { code: string };
      assert.equal(calls, 1);
      assert.equal(body.code, next === "auth" ? "AUTH" : next === "429" ? "RATE_LIMIT" : "HTTP_ERROR");
      await isolatedServer.close();
    }
  });

  it("payload incompleto, score ausente, restrição, bloqueio interno e preço configurado", async () => {
    const incomplete = parseQuodDossier({ metaDados: { consultaUid: "x" } });
    assert.equal(incomplete.insufficient, true);
    assert.equal(incomplete.confirmedRestriction, false);
    const noScore = parseQuodDossier(dossier(null, false));
    assert.equal(noScore.score, null);
    assert.equal(noScore.sections.score.scale, null);
    const restricted = parseQuodDossier(dossier(900, true));
    assert.equal(restricted.confirmedRestriction, true);
    assert.match(restricted.sections.protests.coverageNote, /São Paulo/);

    const overdue = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis({ status: "OVERDUE", overdueTitleCount: 1, overdueAmount: 10 }),
      cadastral: { score: 91, verdict: "VENDA LIBERADA" },
      quod: { state: "VALID", confirmedRestriction: false, insufficient: false },
      now: new Date("2026-10-20T12:00:00.000Z"),
    });
    assert.equal(overdue.status, "BLOQUEADO");
    assert.equal(overdue.cadastralIgnored, true);
    assert.equal(overdue.evidence.cadastralScore, 91);

    const review = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis(),
      quod: { state: "VALID", confirmedRestriction: true, insufficient: false },
      now: new Date("2026-10-20T12:00:00.000Z"),
    });
    assert.equal(review.status, "EM_ANALISE");
    assert.equal(review.reason, "QUOD_EXTERNAL_RESTRICTION");

    const price = readQuodDossierConfig({ QUOD_DOSSIER_UNIT_PRICE_CENTS: "1050" });
    assert.equal(price.unitPriceCents, 1050);
    assert.equal(readQuodDossierConfig({}).unitPriceCents, 699);
  });

  it("falha de persistência não repete a cobrança e o PDF fica restrito", async () => {
    resetQuodDossierRateLimit();
    const store = createMemoryQuodStore();
    store.failCompleteTimes = 1;
    let calls = 0;
    const audits: string[] = [];
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify(dossier(400, true)), { status: 200 });
    };
    const { app } = appFor("SUPER_ADMIN", { fetchImpl, env: enabledEnv, store, audit: (entry) => audits.push(entry.newValue) });
    const server = await listen(app);
    const failed = await post(server.base, { consent: true, idempotencyKey: "persistencia-1" }, server.base);
    assert.equal((await failed.json() as { code: string }).code, "PERSISTENCE_FAILED");
    assert.equal(calls, 1);
    assert.equal(store.rows[0]?.status, "UNKNOWN_BILLING");
    assert.equal(store.rows.some((row) => row.status === "SUCCEEDED"), false);
    assert.match(audits[0] ?? "", /PERSISTENCE_FAILED|UNKNOWN/);
    const pdf = await fetch(`${server.base}/api/customers/${CUSTOMER}/quod-dossier/${store.rows[0]?.id}`);
    const pdfBody = await pdf.text();
    assert.equal(pdf.status, 200);
    assert.equal(pdfBody.includes("token-de-teste"), false);
    await server.close();

    const outsider = appFor("VIEWER", { env: enabledEnv, store });
    const outsiderServer = await listen(outsider.app);
    const hidden = await fetch(`${outsiderServer.base}/api/customers/${CUSTOMER}/quod-dossier/${store.rows[0]?.id}`);
    assert.equal(hidden.status, 403);
    await outsiderServer.close();
  });

  it("o adaptador não coloca token na URL e a consulta CNPJ continua no lugar", async () => {
    let captured = "";
    await fetchQuodDossier({
      cnpj: CNPJ,
      config: { baseUrl: "https://apiv3.directd.com.br", token: "segredo", timeoutMs: 1000 },
      fetchImpl: async (input) => {
        captured = String(input);
        return new Response(JSON.stringify(dossier(10, false)), { status: 200 });
      },
    });
    assert.equal(captured.includes("segredo"), false);
    assert.match(captured, /\/api\/DossieCreditoCompleto\?CNPJ=/);
    const routes = readFileSync(join(process.cwd(), "src/lib/companyIntelligenceRoutes.ts"), "utf8");
    assert.match(routes, /company-intelligence/);
    const quod = readFileSync(join(process.cwd(), "src/lib/quodDossier/query.ts"), "utf8");
    assert.equal(quod.includes("customer.update"), false);
    assert.equal(quod.includes("nomusAccountsReceivable"), false);
  });
});
