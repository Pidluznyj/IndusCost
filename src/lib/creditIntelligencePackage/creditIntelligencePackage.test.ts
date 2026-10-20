import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import express from "express";
import type { RequestHandler } from "express";
import { decideCommercialCredit } from "@/src/lib/commercial/commercialCreditDecision.js";
import type { CommercialDelinquencyAnalysis } from "@/src/lib/commercial/customerDelinquencyAnalysis.js";
import { fetchIeptbOnline } from "@/src/lib/ieptbOnline/adapter.js";
import { createMemoryIeptbStore } from "@/src/lib/ieptbOnline/memoryStore.js";
import { parseIeptbOnline } from "@/src/lib/ieptbOnline/parse.js";
import { createMemoryQuodStore } from "@/src/lib/quodDossier/memoryStore.js";
import { composePackageQuote } from "./compose.js";
import { executeCreditIntelligencePackage } from "./execute.js";
import { readCreditIntelligencePackageConfig } from "./config.js";
import { registerCreditIntelligencePackageRoutes, resetCreditIntelligencePackageRateLimit } from "./routes.js";

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const CNPJ = "28199918000120";

const enabledEnv: NodeJS.ProcessEnv = {
  QUOD_DOSSIER_ENABLED: "true",
  QUOD_DIRECT_DATA_TOKEN: "test-token",
  QUOD_DOSSIER_UNIT_PRICE_CENTS: "699",
  QUOD_DOSSIER_MONTHLY_LIMIT_CENTS: "20000",
  QUOD_DOSSIER_MAX_PER_CNPJ: "5",
  QUOD_DOSSIER_RATE_LIMIT_PER_MINUTE: "100",
  IEPTB_ONLINE_ENABLED: "true",
  IEPTB_ONLINE_UNIT_PRICE_CENTS: "350",
  IEPTB_ONLINE_MONTHLY_LIMIT_CENTS: "20000",
  IEPTB_ONLINE_MAX_PER_CNPJ: "5",
  IEPTB_ONLINE_RATE_LIMIT_PER_MINUTE: "100",
  CREDIT_INTELLIGENCE_MONTHLY_LIMIT_CENTS: "20000",
};

function quodBody(): unknown {
  return {
    metaDados: { consultaUid: "uid-quod", mensagem: "", resultado: "Sucesso" },
    retorno: {
      documentoConsultado: CNPJ,
      entidadeJuridica: {
        dadosCadastrais: { razaoSocial: "Duarte", situacaoCadastral: "ATIVA" },
        scoreEntidades: { entidadeJuridica: { score: 376, motivos: ["Atrasos vigentes"] } },
        pendenciaFinanceira: { status: "nada consta", totalPendencia: 0, protestos: [], acoesJudiciais: [], recuperacoesJudiciaisFalencia: [], chequesSemFundo: [] },
      },
    },
  };
}

function ieptbBody(has: boolean, extraState = false): unknown {
  return {
    metaDados: { consultaUid: "uid-ieptb", mensagem: "", resultado: "Sucesso", assincrono: false, data: "20/10/2026 12:00:00" },
    retorno: {
      documentoConsultado: CNPJ,
      constamProtestos: has,
      numeroTotalProtestos: has ? (extraState ? 2 : 1) : 0,
      valorTotalProtestos: has ? "150,00" : "0,00",
      observacoes: "",
      protestos: has
        ? [
            {
              estado: "SP",
              numeroTotalProtestosUF: 1,
              valorTotalProtestosEstado: "100,00",
              cartorios: [
                {
                  codigoCidade: "3550308",
                  cidade: "São Paulo",
                  numeroProtestos: 1,
                  valorTotalProtestosCartorio: "100,00",
                  titulos: [{ dataProtesto: "01/02/2026", valorProtestado: "100,00", documento: "NF 1" }],
                },
              ],
            },
            ...(extraState
              ? [
                  {
                    estado: "PR",
                    numeroTotalProtestosUF: 1,
                    valorTotalProtestosEstado: "50,00",
                    cartorios: [
                      {
                        codigoCidade: "4106902",
                        cidade: "Curitiba",
                        numeroProtestos: 1,
                        valorTotalProtestosCartorio: "50,00",
                        titulos: [{ dataProtesto: "03/03/2026", valorProtestado: "50,00", documento: "NF 2" }],
                      },
                    ],
                  },
                ]
              : []),
          ]
        : [],
    },
  };
}

function analysis(overdue = false): CommercialDelinquencyAnalysis {
  return {
    status: overdue ? "OVERDUE" : "REGULAR",
    unknownReason: null,
    overdueTitleCount: overdue ? 1 : 0,
    overdueAmount: overdue ? 500 : 0,
    openAmount: overdue ? 500 : 0,
    maxDaysOverdue: overdue ? 3 : 0,
    lastSyncedAt: "2026-10-19T12:00:00.000Z",
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
      includedTitleIds: overdue ? [1] : [],
      overdueTitleIds: overdue ? [1] : [],
      protestedTitleIds: [],
      protestReading: "NOT_IN_SOURCE",
      exclusions: [],
    },
  };
}

function config(env: NodeJS.ProcessEnv = enabledEnv) {
  return readCreditIntelligencePackageConfig(env);
}

async function seedQuodCache(store: ReturnType<typeof createMemoryQuodStore>, now = new Date()) {
  const reserved = await store.reserve({
    customerId: CUSTOMER,
    companyName: "Duarte",
    cnpj: CNPJ,
    idempotencyKey: "seed-quod",
    requestedByUserId: "admin",
    requestedByRole: "SUPER_ADMIN",
    authorizedCostCents: 699,
    now,
    monthlyLimitCents: 20000,
    monthStart: new Date(now.getFullYear(), now.getMonth(), 1),
    monthEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    maxPerCnpj: 5,
    intervalStart: new Date(0),
    forceRefresh: true,
    cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
  });
  if (reserved.ok === false) throw new Error("seed quod");
  await store.complete(reserved.row.id, {
    status: "SUCCEEDED",
    billingStatus: "ESTIMATED",
    chargedCostCents: 699,
    consultedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
}

async function seedIeptbCache(store: ReturnType<typeof createMemoryIeptbStore>, now = new Date(), clear = true) {
  const reserved = await store.reserve({
    customerId: CUSTOMER,
    companyName: "Duarte",
    cnpj: CNPJ,
    idempotencyKey: "seed-ieptb",
    requestedByUserId: "admin",
    requestedByRole: "SUPER_ADMIN",
    authorizedCostCents: 350,
    now,
    monthlyLimitCents: 20000,
    monthStart: new Date(now.getFullYear(), now.getMonth(), 1),
    monthEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    maxPerCnpj: 5,
    intervalStart: new Date(0),
    forceRefresh: true,
    cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
  });
  if (reserved.ok === false) throw new Error("seed ieptb");
  await store.complete(reserved.row.id, {
    status: "SUCCEEDED",
    billingStatus: "ESTIMATED",
    chargedCostCents: 350,
    confirmedProtest: !clear,
    confirmedClear: clear,
    consultedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
}

function fetchMock(handler: (url: string) => unknown): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("TOKEN=")) throw new Error("token na URL");
    const body = handler(url);
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

describe("composição do pacote QUOD + IEPTB", () => {
  it("caso A inéditos: R$ 10,49", () => {
    const quote = composePackageQuote({
      quodEnabled: true,
      ieptbEnabled: true,
      quodPriceCents: 699,
      ieptbPriceCents: 350,
      quodState: "NOT_CONSULTED",
      ieptbState: "NOT_CONSULTED",
    });
    assert.equal(quote.totalCents, 1049);
    assert.equal(quote.totalLabel, (1049 / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
    assert.equal(quote.complete, false);
  });

  it("caso B QUOD cache + IEPTB inédito: R$ 3,50", () => {
    const quote = composePackageQuote({
      quodEnabled: true,
      ieptbEnabled: true,
      quodPriceCents: 699,
      ieptbPriceCents: 350,
      quodState: "VALID",
      ieptbState: "NOT_CONSULTED",
    });
    assert.equal(quote.quod.action, "CACHE");
    assert.equal(quote.ieptb.action, "QUERY");
    assert.equal(quote.totalCents, 350);
  });

  it("caso C ambos cache: R$ 0,00", () => {
    const quote = composePackageQuote({
      quodEnabled: true,
      ieptbEnabled: true,
      quodPriceCents: 699,
      ieptbPriceCents: 350,
      quodState: "VALID",
      ieptbState: "VALID",
    });
    assert.equal(quote.totalCents, 0);
    assert.equal(quote.complete, true);
  });

  it("caso D QUOD vencido + IEPTB válido: R$ 6,99", () => {
    const quote = composePackageQuote({
      quodEnabled: true,
      ieptbEnabled: true,
      quodPriceCents: 699,
      ieptbPriceCents: 350,
      quodState: "STALE",
      ieptbState: "VALID",
    });
    assert.equal(quote.totalCents, 699);
  });

  it("não chama análise completa se uma fonte falta", () => {
    const quote = composePackageQuote({
      quodEnabled: true,
      ieptbEnabled: true,
      quodPriceCents: 699,
      ieptbPriceCents: 350,
      quodState: "VALID",
      ieptbState: "STALE",
    });
    assert.equal(quote.complete, false);
  });
});

describe("execução do pacote", () => {
  it("reusa QUOD em cache e cobra só IEPTB, sem repetir QUOD em falha posterior", async () => {
    const quodStore = createMemoryQuodStore();
    const ieptbStore = createMemoryIeptbStore();
    await seedQuodCache(quodStore);
    const calls: string[] = [];
    const outcome = await executeCreditIntelligencePackage({
      quodStore,
      ieptbStore,
      config: config(),
      customerId: CUSTOMER,
      companyName: "Duarte",
      cnpj: CNPJ,
      consent: true,
      idempotencyKey: "pkg-1",
      userId: "admin",
      role: "SUPER_ADMIN",
      fetchImpl: fetchMock((url) => {
        calls.push(url);
        if (url.includes("DossieCreditoCompleto")) throw new Error("QUOD não deveria ser chamado");
        return ieptbBody(false);
      }),
    });
    assert.equal(outcome.quote.quod.action, "CACHE");
    assert.ok(calls.every((url) => url.includes("ProtestosOnline")));
    assert.equal(outcome.ieptb?.confirmedClear, true);
    assert.equal(outcome.charged, true);
  });

  it("ambos em cache não disparam fetch", async () => {
    const quodStore = createMemoryQuodStore();
    const ieptbStore = createMemoryIeptbStore();
    await seedQuodCache(quodStore);
    await seedIeptbCache(ieptbStore);
    let called = 0;
    const outcome = await executeCreditIntelligencePackage({
      quodStore,
      ieptbStore,
      config: config(),
      customerId: CUSTOMER,
      companyName: "Duarte",
      cnpj: CNPJ,
      consent: true,
      idempotencyKey: "pkg-cache",
      userId: "admin",
      role: "SUPER_ADMIN",
      fetchImpl: (async () => {
        called += 1;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    assert.equal(called, 0);
    assert.equal(outcome.charged, false);
    assert.equal(outcome.authorizedCostCents, 0);
    assert.equal(outcome.complete, true);
  });

  it("sem consentimento não cobra", async () => {
    const outcome = await executeCreditIntelligencePackage({
      quodStore: createMemoryQuodStore(),
      ieptbStore: createMemoryIeptbStore(),
      config: config(),
      customerId: CUSTOMER,
      companyName: "Duarte",
      cnpj: CNPJ,
      consent: false,
      idempotencyKey: "x",
      userId: "admin",
      role: "SUPER_ADMIN",
    });
    assert.equal(outcome.code, "CONSENT_REQUIRED");
    assert.equal(outcome.charged, false);
  });

  it("orçamento global compartilhado bloqueia o pacote de 10,49", async () => {
    const quodStore = createMemoryQuodStore();
    const ieptbStore = createMemoryIeptbStore();
    const outcome = await executeCreditIntelligencePackage({
      quodStore,
      ieptbStore,
      config: config({ ...enabledEnv, CREDIT_INTELLIGENCE_MONTHLY_LIMIT_CENTS: "699" }),
      customerId: CUSTOMER,
      companyName: "Duarte",
      cnpj: CNPJ,
      consent: true,
      idempotencyKey: "pkg-budget",
      userId: "admin",
      role: "SUPER_ADMIN",
      fetchImpl: fetchMock(() => quodBody()),
    });
    assert.equal(outcome.code, "BUDGET");
    assert.equal(outcome.charged, false);
  });

  it("timeout do IEPTB não reenvia o QUOD já gravado", async () => {
    const quodStore = createMemoryQuodStore();
    const ieptbStore = createMemoryIeptbStore();
    const calls: string[] = [];
    const outcome = await executeCreditIntelligencePackage({
      quodStore,
      ieptbStore,
      config: config(),
      customerId: CUSTOMER,
      companyName: "Duarte",
      cnpj: CNPJ,
      consent: true,
      idempotencyKey: "pkg-timeout",
      userId: "admin",
      role: "SUPER_ADMIN",
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("DossieCreditoCompleto")) {
          return new Response(JSON.stringify(quodBody()), { status: 200 });
        }
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }) as typeof fetch,
    });
    assert.equal(outcome.code, "PARTIAL");
    assert.equal(quodStore.rows.filter((row) => row.status === "SUCCEEDED").length, 1);
    assert.equal(ieptbStore.rows.some((row) => row.billingStatus === "UNKNOWN"), true);
    assert.equal(calls.filter((url) => url.includes("DossieCreditoCompleto")).length, 1);
  });
});

describe("IEPTB parse e crédito", () => {
  it("resultado vazio só é sem ocorrência com constamProtestos false", () => {
    const parsed = parseIeptbOnline(ieptbBody(false));
    assert.equal(parsed.confirmedClear, true);
    assert.equal(parsed.confirmedProtest, false);
    const incomplete = parseIeptbOnline({ metaDados: { assincrono: true } });
    assert.equal(incomplete.confirmedClear, false);
    assert.equal(incomplete.insufficient, true);
  });

  it("protestos em vários estados não são somados ao QUOD", () => {
    const parsed = parseIeptbOnline(ieptbBody(true, true));
    assert.deepEqual(parsed.states.sort(), ["PR", "SP"]);
    assert.equal(parsed.confirmedProtest, true);
    const decision = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis(true),
      cadastral: { score: 91, verdict: "VENDA LIBERADA" },
      ieptb: { state: "VALID", confirmedProtest: true, insufficient: false },
      now: new Date(2026, 9, 20),
    });
    assert.equal(decision.customerStatus, "BLOQUEADO");
    assert.ok(decision.reasons.includes("OVERDUE_OPEN_BALANCE"));
    assert.ok(decision.reasons.includes("IEPTB_NATIONAL_PROTEST"));
  });

  it("IEPTB confirmado em cliente regular vai para análise, não libera", () => {
    const decision = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis(false),
      ieptb: { state: "VALID", confirmedProtest: true, insufficient: false },
      now: new Date(2026, 9, 20),
    });
    assert.equal(decision.customerStatus, "EM_ANALISE");
    assert.equal(decision.reason, "IEPTB_NATIONAL_PROTEST");
  });
});

describe("rotas do pacote", () => {
  function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
    const server = createServer(app);
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        resolve({
          base: `http://127.0.0.1:${address.port}`,
          close: () => new Promise((done) => server.close(() => done())),
        });
      });
    });
  }

  function requestJson(base: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: unknown }> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, base);
      const payload = init.body == null ? null : JSON.stringify(init.body);
      const req = httpRequest(
        url,
        {
          method: init.method ?? "GET",
          headers: {
            origin: base,
            connection: "close",
            ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : null });
          });
        }
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  it("ADMIN lê GET sem cobrança; POST continua só SUPER_ADMIN; POST sem checkbox não cobra", async () => {
    resetCreditIntelligencePackageRateLimit();
    const quodStore = createMemoryQuodStore();
    const ieptbStore = createMemoryIeptbStore();
    const app = express();
    app.use(express.json());
    let role = "ADMIN";
    const requireAppAuth: RequestHandler = (_req, _res, next) => next();
    registerCreditIntelligencePackageRoutes(
      app,
      { requireAppAuth, getCurrentAppUser: async () => ({ id: "u1", role, name: "User" }) },
      {
        quodStore,
        ieptbStore,
        env: enabledEnv,
        customer: async () => ({ companyName: "Duarte", cnpj: CNPJ }),
      }
    );
    const http = await listen(app);
    try {
      const readable = await requestJson(http.base, `/api/customers/${CUSTOMER}/credit-intelligence-package`);
      assert.equal(readable.status, 200);
      const paidAsAdmin = await requestJson(http.base, `/api/customers/${CUSTOMER}/credit-intelligence-package`, {
        method: "POST",
        body: { consent: true, idempotencyKey: "abc12345" },
      });
      assert.equal(paidAsAdmin.status, 403);
      role = "SUPER_ADMIN";
      const opened = await requestJson(http.base, `/api/customers/${CUSTOMER}/credit-intelligence-package`);
      assert.equal(opened.status, 200);
      const body = opened.json as { quote: { totalCents: number } };
      assert.equal(body.quote.totalCents, 1049);
      const denied = await requestJson(http.base, `/api/customers/${CUSTOMER}/credit-intelligence-package`, {
        method: "POST",
        body: { consent: false, idempotencyKey: "abc12345" },
      });
      assert.equal(denied.status, 422);
      assert.equal(quodStore.rows.length, 0);
      assert.equal(ieptbStore.rows.length, 0);
    } finally {
      await http.close();
    }
  });
});

describe("popup e adaptador", () => {
  it("adaptador IEPTB não coloca token na URL", async () => {
    let seen = "";
    await fetchIeptbOnline({
      cnpj: CNPJ,
      config: { baseUrl: "https://apiv3.directd.com.br", token: "segredo", timeoutMs: 1000 },
      fetchImpl: (async (input: RequestInfo | URL) => {
        seen = String(input);
        return new Response(JSON.stringify(ieptbBody(false)), { status: 200 });
      }) as typeof fetch,
    });
    assert.match(seen, /\/api\/ProtestosOnline/);
    assert.doesNotMatch(seen, /segredo/);
    assert.doesNotMatch(seen, /TOKEN=/);
  });
});
