import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { decideCommercialCredit, applyExternalProtestConsultation } from "../commercialCreditDecision.js";
import { readCommercialCreditDecision } from "../commercialCreditDecision.server.js";
import type { CommercialDelinquencyAnalysis } from "../customerDelinquencyAnalysis.js";
import {
  classifyExternalProtestCredit,
  createExternalProtestProvider,
  readExternalProtestConfig,
  type ExternalProtestProviderResult,
} from "./externalProtestProvider.js";
import { executeExternalProtestConsultation, type ExternalProtestCache, type ExternalProtestCacheRow } from "./externalProtestQuery.js";
import { createScriptedExternalProtestProvider } from "./externalProtestTestProvider.js";

const CNPJ = "11444777000161";
const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date(2026, 9, 19, 12, 0, 0);
const SYNCED = new Date(2026, 9, 19, 9, 0, 0);

function config(overrides: Partial<ReturnType<typeof readExternalProtestConfig>> = {}) {
  return {
    enabled: true,
    provider: "test" as const,
    cacheTtlMs: 60 * 60 * 1000,
    timeoutMs: 1000,
    maxRetries: 1,
    rateLimitPerMinute: 10,
    credentialsPresent: false,
    ...overrides,
  };
}

function result(
  executionStatus: ExternalProtestProviderResult["executionStatus"],
  protestSituation: ExternalProtestProviderResult["protestSituation"],
  errorCode: string | null = null
): ExternalProtestProviderResult {
  return {
    executionStatus,
    protestSituation,
    occurrenceId: protestSituation === "CONFIRMED_CURRENT" ? "prot-9" : null,
    evidenceRef: "evidencia-teste",
    source: "test",
    errorCode,
  };
}

function memoryCache(): ExternalProtestCache & { rows: ExternalProtestCacheRow[] } {
  const rows: ExternalProtestCacheRow[] = [];
  return {
    rows,
    async findFresh(cnpj, now) {
      return (
        rows
          .filter((row) => row.cnpj === cnpj && row.validUntil.getTime() > now.getTime())
          .sort((a, b) => b.consultedAt.getTime() - a.consultedAt.getTime())[0] ?? null
      );
    },
    async countAttempts(provider, since) {
      return rows.filter(
        (row) =>
          row.provider === provider &&
          row.consultedAt.getTime() >= since.getTime() &&
          ["SUCCESS", "FAILED", "TIMEOUT", "UNAVAILABLE"].includes(row.executionStatus)
      ).length;
    },
    async insert(row) {
      rows.push(row);
    },
  };
}

function regularAnalysis(): CommercialDelinquencyAnalysis {
  return {
    status: "REGULAR",
    unknownReason: null,
    overdueTitleCount: 0,
    overdueAmount: 0,
    openAmount: 0,
    maxDaysOverdue: 0,
    lastSyncedAt: SYNCED.toISOString(),
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
      sourceMaxSyncedAt: SYNCED.toISOString(),
      includedTitleIds: [],
      overdueTitleIds: [],
      protestedTitleIds: [],
      protestReading: "NOT_IN_SOURCE",
      exclusions: [],
    },
  };
}

function creditDb() {
  const title = {
    externalId: 9,
    personId: 100,
    personName: "Cliente",
    personCnpj: CNPJ,
    companyName: "Lazarios",
    description: "Parcela",
    comments: null,
    dueDate: new Date(2026, 9, 30),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    sourceInvoiceId: 50,
    sourceInvoiceNumber: "100",
    paymentMethodName: "Boleto",
    bankAccountName: null,
    suspendCollection: false,
    status: false,
    syncedAt: SYNCED,
    sourcePresenceStatus: "PRESENT",
    rawPayload: { id: 9 },
  };
  return {
    customer: {
      findUnique: async () => ({ id: CUSTOMER, taxId: CNPJ, nomusExternalPersonId: 100 }),
      findMany: async () => [{ id: CUSTOMER }],
    },
    salesOrder: { findMany: async () => [] },
    nomusAccountsReceivable: {
      aggregate: async () => ({ _max: { syncedAt: SYNCED } }),
      findMany: async () => [title],
    },
    nomusSourceSyncRun: {
      findFirst: async () => ({ status: "SUCCESS", payloadComplete: true, startedAt: SYNCED }),
    },
    customerCorporateLink: { findMany: async () => [] },
    commercialExternalProtest: { findMany: async () => [] },
    commercialCreditException: { findMany: async () => [] },
    commercialCreditOccurrence: { findMany: async () => [] },
    commercialCorporateMembership: { findMany: async () => [], findFirst: async () => null },
    customerCnpjLookup: { findFirst: async () => null },
  };
}

describe("protesto externo — contrato e configuração", () => {
  it("nasce desligado e não copia a credencial", () => {
    const disabled = readExternalProtestConfig({});
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.provider, "disabled");
    const secret = "segredo-nao-pode-vazar";
    const configured = readExternalProtestConfig({
      EXTERNAL_PROTEST_ENABLED: "true",
      EXTERNAL_PROTEST_PROVIDER: "serasa",
      EXTERNAL_PROTEST_API_TOKEN: secret,
    });
    assert.equal(configured.enabled, true);
    assert.equal(configured.credentialsPresent, true);
    assert.equal(JSON.stringify(configured).includes(secret), false);
  });

  it("não contém cliente HTTP de bureau", () => {
    const files = [
      "./externalProtestProvider.ts",
      "./externalProtestQuery.ts",
      "./externalProtestQuery.server.ts",
      "./externalProtestTestProvider.ts",
    ];
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.equal(source.includes("fetch("), false);
      assert.equal(/https?:\/\//.test(source), false);
      assert.equal(/serasaexperian|protestosp|cheerio|puppeteer/i.test(source), false);
    }
  });
});

describe("protesto externo — consulta simulada", () => {
  it("desligado não chama o provedor e não afirma ausência", async () => {
    const calls: string[] = [];
    const fact = await executeExternalProtestConsultation({
      cnpj: CNPJ,
      customerId: CUSTOMER,
      now: NOW,
      config: config({ enabled: false, provider: "disabled" }),
      provider: {
        id: "test",
        consult: async (request) => {
          calls.push(request.cnpj);
          throw new Error("não deveria consultar");
        },
      },
      cache: memoryCache(),
    });
    assert.deepEqual(calls, []);
    assert.equal(fact.executionStatus, "DISABLED");
    assert.equal(fact.reliableClear, false);
    assert.equal(fact.protestSituation, "NOT_CONSULTED");
  });

  it("falha que diz sem protesto continua em revisão", async () => {
    const provider = createScriptedExternalProtestProvider({
      results: [result("FAILED", "NONE_FOUND", "HTTP_500")],
    });
    const fact = await executeExternalProtestConsultation({
      cnpj: CNPJ,
      customerId: CUSTOMER,
      now: NOW,
      config: config({ maxRetries: 0 }),
      provider,
      cache: memoryCache(),
    });
    assert.equal(fact.reliableClear, false);
    assert.equal(fact.confirmedCurrent, false);
    assert.equal(fact.review, "UNAVAILABLE");
    assert.notEqual(fact.protestSituation, "NONE_FOUND");
  });

  it("repete só falha transitória e usa o cache na segunda leitura", async () => {
    const provider = createScriptedExternalProtestProvider({
      results: [result("TIMEOUT", "UNREADABLE", "TIMEOUT"), result("SUCCESS", "NONE_FOUND")],
    });
    const cache = memoryCache();
    let slept = 0;
    const first = await executeExternalProtestConsultation({
      cnpj: CNPJ,
      customerId: CUSTOMER,
      now: NOW,
      config: config(),
      provider,
      cache,
      sleep: async () => {
        slept += 1;
      },
    });
    const second = await executeExternalProtestConsultation({
      cnpj: CNPJ,
      customerId: CUSTOMER,
      now: NOW,
      config: config(),
      provider,
      cache,
      sleep: async () => {
        slept += 1;
      },
    });
    assert.equal(slept, 1);
    assert.deepEqual(provider.calls, [CNPJ, CNPJ]);
    assert.equal(first.reliableClear, true);
    assert.equal(second.reliableClear, true);
    assert.equal(provider.calls.length, 2);
  });

  it("estoura o tempo sem declarar ausência", async () => {
    const provider = createScriptedExternalProtestProvider({ results: [], hang: true });
    const fact = await executeExternalProtestConsultation({
      cnpj: CNPJ,
      customerId: CUSTOMER,
      now: NOW,
      config: config({ timeoutMs: 20, maxRetries: 0 }),
      provider,
      cache: memoryCache(),
    });
    assert.equal(fact.executionStatus, "TIMEOUT");
    assert.equal(fact.reliableClear, false);
    assert.equal(fact.review, "UNAVAILABLE");
  });

  it("respeita o limite de consultas", async () => {
    const provider = createScriptedExternalProtestProvider({
      results: [result("SUCCESS", "NONE_FOUND")],
    });
    const cache = memoryCache();
    cache.rows.push({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      customerId: CUSTOMER,
      cnpj: "14055501000180",
      provider: "test",
      executionStatus: "SUCCESS",
      protestSituation: "NONE_FOUND",
      occurrenceId: null,
      evidenceRef: "outra",
      source: "test",
      consultedAt: NOW,
      validUntil: new Date(NOW.getTime() - 1000),
      errorCode: null,
    });
    for (let index = 0; index < 10; index += 1) {
      cache.rows.push({
        ...cache.rows[0]!,
        id: `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, "0")}`,
        cnpj: CNPJ,
        consultedAt: NOW,
        validUntil: new Date(NOW.getTime() - 1000),
      });
    }
    const fact = await executeExternalProtestConsultation({
      cnpj: CNPJ,
      customerId: CUSTOMER,
      now: NOW,
      config: config({ rateLimitPerMinute: 10 }),
      provider,
      cache,
    });
    assert.equal(provider.calls.length, 0);
    assert.equal(fact.executionStatus, "RATE_LIMITED");
    assert.equal(fact.reliableClear, false);
  });

  it("provedor sem contrato não abre rede e não libera por ausência", async () => {
    const provider = createExternalProtestProvider(config({ provider: "cenprot" }));
    const audits: Array<Record<string, unknown>> = [];
    const fact = await executeExternalProtestConsultation({
      cnpj: CNPJ,
      customerId: CUSTOMER,
      now: NOW,
      config: config({ provider: "cenprot", maxRetries: 2 }),
      provider,
      cache: memoryCache(),
      audit: async (entry) => {
        audits.push(entry);
      },
    });
    assert.equal(fact.executionStatus, "UNAVAILABLE");
    assert.equal(fact.reliableClear, false);
    assert.equal(audits.length, 1);
    assert.equal(JSON.stringify(audits).includes("EXTERNAL_PROTEST_API_TOKEN"), false);
    assert.match(String(audits[0]?.newValue), /PROVIDER_NOT_CONTRACTED|UNAVAILABLE|UNREADABLE/);
  });
});

describe("protesto externo — motor de crédito", () => {
  it("confirmado e vigente bloqueia prazo e não bloqueia à vista", () => {
    const term = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: regularAnalysis(),
      externalProtest: "CONFIRMED_CURRENT",
      now: NOW,
    });
    const cash = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "À vista",
      delinquency: regularAnalysis(),
      externalProtest: "CONFIRMED_CURRENT",
      now: NOW,
    });
    assert.equal(term.customerStatus, "BLOQUEADO");
    assert.equal(term.reason, "EXTERNAL_PROTEST");
    assert.equal(term.allowed, false);
    assert.equal(cash.allowed, true);
    assert.equal(cash.customerStatus, "BLOQUEADO");
  });

  it("cancelado, não confirmado e desatualizado ficam em revisão", () => {
    for (const review of ["CANCELLED", "UNCONFIRMED", "STALE", "UNAVAILABLE"] as const) {
      const decision = decideCommercialCredit({
        customerId: CUSTOMER,
        enforcement: "CREDIT_GRANT",
        paymentTerms: "30",
        delinquency: regularAnalysis(),
        externalProtestReview: review,
        now: NOW,
      });
      assert.equal(decision.customerStatus, "BLOQUEADO");
      assert.equal(decision.reason, "EXTERNAL_PROTEST_REVIEW");
      assert.equal(decision.allowed, false);
      assert.equal(decision.evidence.externalProtestReview, review);
    }
    const stale = classifyExternalProtestCredit({
      enabled: true,
      executionStatus: "SUCCESS",
      protestSituation: "NONE_FOUND",
      consultedAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1000),
      validUntil: new Date(NOW.getTime() - 1000),
      now: NOW,
    });
    assert.equal(stale.reliableClear, false);
    assert.equal(stale.review, "STALE");
    assert.notEqual(stale.protestSituation, "NONE_FOUND");
  });

  it("a consulta simulada confirmada entra na decisão real e a falha não libera", async () => {
    const confirmed = createScriptedExternalProtestProvider({
      results: [result("SUCCESS", "CONFIRMED_CURRENT")],
    });
    const blocked = await readCommercialCreditDecision(creditDb() as never, {
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      now: NOW,
      externalProtestQuery: {
        config: config(),
        provider: confirmed,
        cache: memoryCache(),
        env: {},
      },
    });
    assert.equal(blocked.decision.customerStatus, "BLOQUEADO");
    assert.equal(blocked.decision.reason, "EXTERNAL_PROTEST");
    assert.equal(blocked.decision.allowed, false);
    assert.equal(blocked.externalProtestConsultation.occurrenceId, "prot-9");
    assert.equal(blocked.externalProtestConsultation.evidenceRef, "evidencia-teste");

    const failed = await readCommercialCreditDecision(creditDb() as never, {
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      now: NOW,
      externalProtestQuery: {
        config: config({ maxRetries: 0 }),
        provider: createScriptedExternalProtestProvider({ results: [result("FAILED", "NONE_FOUND", "DOWN")] }),
        cache: memoryCache(),
        env: {},
      },
    });
    assert.equal(failed.decision.customerStatus, "BLOQUEADO");
    assert.equal(failed.decision.reason, "EXTERNAL_PROTEST_REVIEW");
    assert.equal(failed.decision.allowed, false);
    assert.equal(failed.externalProtestConsultation.reliableClear, false);

    const merged = applyExternalProtestConsultation({
      stored: "ABSENT",
      confirmedCurrent: false,
      review: "NONE",
    });
    assert.equal(merged.externalProtest, "ABSENT");
    assert.equal(merged.review, "NONE");
  });
});
