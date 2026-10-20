import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { calculateCommercialRiskScore } from "@/src/lib/companyCommercialRiskScore.js";
import { decideCommercialCredit } from "@/src/lib/commercial/commercialCreditDecision.js";
import type { CommercialDelinquencyAnalysis } from "@/src/lib/commercial/customerDelinquencyAnalysis.js";
import type { CnpjWeeklyRefreshConfig } from "./config.js";
import { createMemoryCnpjRefreshStore } from "./memoryStore.js";
import { createCnpjRefreshRunner, processCnpjRefreshRun } from "./refreshRun.js";
import type { CustomerOfficialSnapshot, SupplierOfficialSnapshot } from "./store.js";

const CNPJ = "11444777000161";
const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const SUPPLIER = "22222222-2222-4222-8222-222222222222";
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const config: CnpjWeeklyRefreshConfig = {
  enabled: true,
  minIntervalMs: 0,
  timeoutMs: 1_000,
  maxRetries: 0,
  backoffBaseMs: 1,
  backoffCapMs: 10,
  circuitFailureThreshold: 20,
  circuitPauseMs: 10,
  heartbeatStaleMs: 60_000,
  maxItems: null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function brasil(name: string) {
  return {
    cnpj: CNPJ,
    razao_social: name,
    nome_fantasia: "FANTASIA",
    descricao_situacao_cadastral: "ATIVA",
    data_inicio_atividade: "2010-05-01",
    descricao_porte: "DEMAIS",
    capital_social: 100000,
    cnae_fiscal: 2511000,
    cnae_fiscal_descricao: "Fabrica",
    descricao_identificador_matriz_filial: "MATRIZ",
    qsa: [{ nome_socio: "PESSOA OCULTA", qualificacao_socio: "Sócio" }],
  };
}

function publica(name: string) {
  return {
    razao_social: name,
    capital_social: "100000.00",
    porte: { descricao: "Demais" },
    estabelecimento: {
      cnpj: CNPJ,
      nome_fantasia: "FANTASIA",
      situacao_cadastral: "Ativa",
      data_inicio_atividade: "2010-05-01",
      tipo: "Matriz",
      atividade_principal: { id: "2511000", descricao: "Fabrica" },
    },
    socios: [{ nome: "PESSOA OCULTA", qualificacao_socio: { descricao: "Sócio" } }],
  };
}

function customer(): CustomerOfficialSnapshot {
  return {
    id: CUSTOMER,
    companyName: "NOME INTERNO",
    tradeName: "CONTATO INTERNO",
    address: "Rua Interna",
    city: "Curitiba",
    state: "PR",
    zipCode: "80000-000",
    taxId: CNPJ,
  };
}

function supplier(): SupplierOfficialSnapshot {
  return { id: SUPPLIER, legalName: "FORNECEDOR INTERNO", tradeName: null, displayName: "Apelido interno" };
}

function overdue(): CommercialDelinquencyAnalysis {
  return {
    status: "OVERDUE",
    unknownReason: null,
    overdueTitleCount: 1,
    overdueAmount: 100,
    openAmount: 100,
    maxDaysOverdue: 1,
    lastSyncedAt: "2026-10-19T12:00:00.000Z",
    evidence: {
      source: "NomusAccountsReceivable",
      toleranceDays: 0,
      toleranceUnit: "CALENDAR_DAYS",
      referenceDate: "2026-10-19",
      cnpj: CNPJ,
      nomusPersonId: 10,
      identity: "RESOLVED",
      syncRunStatus: "SUCCESS",
      payloadComplete: true,
      sourceMaxSyncedAt: "2026-10-19T12:00:00.000Z",
      includedTitleIds: [1],
      overdueTitleIds: [1],
      protestedTitleIds: [],
      protestReading: "NOT_IN_SOURCE",
      exclusions: [],
    },
  } as CommercialDelinquencyAnalysis;
}

describe("execução semanal de CNPJ", () => {
  it("consulta cliente e fornecedor uma vez, ignora CPF, inválido e documento vazio", async () => {
    const calls: string[] = [];
    const store = createMemoryCnpjRefreshStore({
      parties: [
        { partyType: "CUSTOMER", partyId: CUSTOMER, rawDocument: CNPJ },
        { partyType: "SUPPLIER", partyId: SUPPLIER, rawDocument: CNPJ },
        { partyType: "CUSTOMER", partyId: "33333333-3333-4333-8333-333333333333", rawDocument: "52998224725" },
        { partyType: "SUPPLIER", partyId: "44444444-4444-4444-8444-444444444444", rawDocument: "" },
        { partyType: "SUPPLIER", partyId: "55555555-5555-4555-8555-555555555555", rawDocument: "11111111111111" },
      ],
      customers: [customer()],
      suppliers: [supplier()],
    });
    const runner = createCnpjRefreshRunner({
      store,
      config,
      sleep: async () => undefined,
      fetchImpl: async (input) => {
        calls.push(String(input));
        const url = String(input);
        if (url.includes("brasilapi")) return json(brasil("EMPRESA NOVA LTDA"));
        return json(publica("EMPRESA NOVA LTDA"));
      },
    });
    const started = await runner.startManual("admin-1");
    assert.equal(started.ok, true);
    if (started.ok) await started.task;
    const item = store.items.find((row) => row.cnpj === CNPJ);
    assert.equal(item?.partyKind, "BOTH");
    assert.deepEqual(item?.supplierIds, [SUPPLIER]);
    assert.equal(store.items.filter((row) => row.documentClass === "CPF").length, 1);
    assert.equal(store.items.filter((row) => row.documentClass === "MISSING").length, 1);
    assert.equal(store.items.filter((row) => row.documentClass === "INVALID").length, 1);
    assert.equal(calls.length, 2);
    assert.equal(store.customers[0]?.companyName, "NOME INTERNO");
    assert.equal(store.suppliers[0]?.displayName, "Apelido interno");
    assert.ok(store.divergences.some((row) => row.field === "companyName" && row.partyKind === "CUSTOMER"));
    assert.equal(store.audits.length >= 2, true);
    assert.equal(store.lookups[0]?.riskScore, calculateCommercialRiskScore(store.lookups[0]!.summary).score);
    const blocked = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: overdue(),
      cadastral: { score: 91, verdict: "VENDA LIBERADA" },
      now: new Date(2026, 9, 19),
    });
    assert.equal(blocked.cadastralIgnored, true);
    assert.equal(blocked.allowed, false);
    assert.notEqual(blocked.customerStatus, "LIBERADO");
  });

  it("grava alteração real e não repete o que ficou igual", async () => {
    let name = "EMPRESA ANTIGA LTDA";
    const store = createMemoryCnpjRefreshStore({
      parties: [{ partyType: "CUSTOMER", partyId: CUSTOMER, rawDocument: CNPJ }],
      customers: [{ ...customer(), companyName: "EMPRESA ANTIGA LTDA" }],
    });
    const deps = {
      store,
      config,
      sleep: async () => undefined,
      fetchImpl: async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("brasilapi")) return json(brasil(name));
        return json(publica(name));
      },
    };
    const first = createCnpjRefreshRunner(deps);
    const started = await first.startManual("admin-1");
    if (started.ok) await started.task;
    const changesAfterFirst = store.changes.length;
    name = "EMPRESA NOVA LTDA";
    const again = await createCnpjRefreshRunner(deps).startManual("admin-1");
    if (again.ok) await again.task;
    assert.ok(store.changes.some((change) => change.field === "companyName" && change.nextValue === "EMPRESA NOVA LTDA"));
    assert.equal(store.changes.some((change) => `${change.previousValue ?? ""} ${change.nextValue ?? ""}`.includes("PESSOA OCULTA")), false);
    const secondRun = store.runs[1];
    const secondItem = store.items.find((item) => item.runId === secondRun?.id && item.cnpj === CNPJ);
    assert.equal(secondItem?.status, "UPDATED");
    name = "EMPRESA NOVA LTDA";
    const third = await createCnpjRefreshRunner(deps).startManual("admin-1");
    if (third.ok) await third.task;
    const thirdRun = store.runs.at(-1);
    const thirdItem = store.items.find((item) => item.runId === thirdRun?.id && item.cnpj === CNPJ);
    const thirdChanges = store.changes.filter((change) => change.runId === thirdRun?.id).map((change) => change.field);
    assert.deepEqual(thirdChanges, []);
    assert.equal(thirdItem?.status, "UNCHANGED");
    assert.equal(store.changes.filter((change) => change.field === "companyName").length, 1);
    assert.ok(store.changes.length >= changesAfterFirst);
  });

  it("não apaga dado válido quando uma fonte falha e a outra responde", async () => {
    const store = createMemoryCnpjRefreshStore({
      parties: [{ partyType: "CUSTOMER", partyId: CUSTOMER, rawDocument: CNPJ }],
      customers: [customer()],
    });
    const ok = createCnpjRefreshRunner({
      store,
      config,
      sleep: async () => undefined,
      fetchImpl: async (input) => (String(input).includes("brasilapi") ? json(brasil("EMPRESA NOVA LTDA")) : json(publica("EMPRESA NOVA LTDA"))),
    });
    const started = await ok.startManual("admin-1");
    if (started.ok) await started.task;
    const before = store.lookups.length;
    const partial = createCnpjRefreshRunner({
      store,
      config,
      sleep: async () => undefined,
      fetchImpl: async (input) => {
        if (String(input).includes("brasilapi")) return new Response("erro", { status: 500 });
        const body = publica("EMPRESA NOVA LTDA");
        body.estabelecimento.nome_fantasia = "";
        return json(body);
      },
    });
    const second = await partial.startManual("admin-1");
    if (second.ok) await second.task;
    assert.equal(store.lookups.at(-1)?.summary.tradeName, "FANTASIA");
    assert.ok(store.items.some((item) => item.status === "PARTIAL"));
    assert.ok(store.lookups.length > before);
  });

  it("não substitui a consulta anterior quando as duas fontes falham", async () => {
    const store = createMemoryCnpjRefreshStore({
      parties: [{ partyType: "CUSTOMER", partyId: CUSTOMER, rawDocument: CNPJ }],
      customers: [customer()],
    });
    const ok = await createCnpjRefreshRunner({
      store,
      config,
      sleep: async () => undefined,
      fetchImpl: async (input) => (String(input).includes("brasilapi") ? json(brasil("EMPRESA NOVA LTDA")) : json(publica("EMPRESA NOVA LTDA"))),
    }).startManual("admin-1");
    if (ok.ok) await ok.task;
    const before = store.lookups.length;
    const failed = await createCnpjRefreshRunner({
      store,
      config,
      sleep: async () => undefined,
      fetchImpl: async () => new Response("erro", { status: 500 }),
    }).startManual("admin-1");
    if (failed.ok) await failed.task;
    assert.equal(store.lookups.length, before);
    assert.equal(store.runs.at(-1)?.failedCount, 1);
    assert.equal(store.customers[0]?.companyName, "NOME INTERNO");
  });

  it("retoma só o item pendente e impede outra execução simultânea", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    const store = createMemoryCnpjRefreshStore({
      parties: [{ partyType: "CUSTOMER", partyId: CUSTOMER, rawDocument: CNPJ }],
      customers: [customer()],
    });
    const deps = {
      store,
      config,
      sleep: async () => undefined,
      fetchImpl: async (input: RequestInfo | URL) => {
        entered += 1;
        if (entered === 1) await gate;
        return String(input).includes("brasilapi") ? json(brasil("EMPRESA NOVA LTDA")) : json(publica("EMPRESA NOVA LTDA"));
      },
    };
    const runner = createCnpjRefreshRunner(deps);
    const started = runner.startManual("admin-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const run = store.runs[0];
    assert.ok(run);
    const blocked = await runner.startManual("admin-2");
    assert.equal(blocked.ok, false);
    const second = processCnpjRefreshRun(run.id, deps);
    await second;
    assert.equal(store.lookups.length, 0);
    release();
    const startedResult = await started;
    if (startedResult.ok) await startedResult.task;
    assert.equal(store.lookups.length, 1);
    run.status = "INTERRUPTED";
    store.items[0]!.status = "PENDING";
    const callsBefore = entered;
    await processCnpjRefreshRun(run.id, deps);
    assert.ok(entered > callsBefore);
    store.items.find((item) => item.cnpj === CNPJ)!.status = "UNCHANGED";
    const frozen = entered;
    await processCnpjRefreshRun(run.id, deps);
    assert.equal(entered, frozen);
  });

  it("reprocessa falha sem repetir consulta já concluída", async () => {
    const calls: string[] = [];
    let fail = true;
    const store = createMemoryCnpjRefreshStore({
      parties: [
        { partyType: "CUSTOMER", partyId: CUSTOMER, rawDocument: CNPJ },
        { partyType: "SUPPLIER", partyId: SUPPLIER, rawDocument: "00000000000191" },
      ],
      customers: [customer()],
      suppliers: [supplier()],
    });
    const deps = {
      store,
      config: { ...config, maxRetries: 1 },
      sleep: async () => undefined,
      fetchImpl: async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (fail && url.includes(CNPJ)) return new Response("limite", { status: 429, headers: { "retry-after": "0" } });
        if (url.includes("brasilapi")) {
          return json(url.includes("00000000000191") ? { ...brasil("FORNECEDOR OFICIAL"), cnpj: "00000000000191" } : brasil("EMPRESA NOVA LTDA"));
        }
        return json(url.includes("00000000000191") ? { ...publica("FORNECEDOR OFICIAL"), estabelecimento: { ...publica("FORNECEDOR OFICIAL").estabelecimento, cnpj: "00000000000191" } } : publica("EMPRESA NOVA LTDA"));
      },
    };
    const runner = createCnpjRefreshRunner(deps);
    const started = await runner.startManual("admin-1");
    if (started.ok) await started.task;
    const run = store.runs[0]!;
    assert.ok(run.failedCount >= 1);
    fail = false;
    const doneBefore = store.items.filter((item) => item.status === "UNCHANGED" || item.status === "UPDATED").length;
    const retried = await runner.retryFailures(run.id, "admin-1");
    assert.equal(retried.ok, true);
    const doneAfter = store.items.filter((item) => item.status === "UNCHANGED" || item.status === "UPDATED" || item.status === "PARTIAL").length;
    assert.ok(doneAfter >= doneBefore);
    assert.equal(store.customers[0]?.taxId, CNPJ);
  });

  it("não grava cadastro operacional nem título do Nomus", () => {
    const refresh = readFileSync(join(root, "src/lib/cnpjWeeklyRefresh/refreshRun.ts"), "utf8");
    const store = readFileSync(join(root, "src/lib/cnpjWeeklyRefresh/store.server.ts"), "utf8");
    const sql = readFileSync(join(root, "prisma/migrations/20261024120000_cnpj_weekly_refresh/migration.sql"), "utf8").toUpperCase();
    for (const source of [refresh, store]) {
      assert.equal(source.includes("customer.update"), false);
      assert.equal(source.includes("financialSupplier.update"), false);
      assert.equal(source.includes("nomusAccountsReceivable"), false);
      assert.equal(source.includes("decideCommercialCredit"), false);
    }
    assert.equal(sql.includes("DROP TABLE"), false);
    assert.equal(sql.includes("DELETE FROM"), false);
    assert.equal(sql.includes("TRUNCATE"), false);
    assert.equal(sql.includes("NOMUSACCOUNTSRECEIVABLE"), false);
  });
});
