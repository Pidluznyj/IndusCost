/**
 * Persistência LIKE SERASA num PostgreSQL 17 REAL e descartável (schema completo do projeto + migration
 * 20261103120000_boa_vista_define_limite): reserva transacional, índice único parcial de consulta real em andamento,
 * corrida entre conexões, cache por modo (DEMO nunca satisfaz LIVE), cobrança desconhecida bloqueando reenvio e
 * BigInt do limite sugerido. Nada sai da máquina: o provedor é um `fetch` injetado.
 *
 * Executar: COMMISSION_PG17_BIN=<bin do PostgreSQL 17> npx tsx --test src/lib/boaVistaDefineLimite/likeSerasa.pg17.integration.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { commissionPg17BinDir, executeSqlFile, startCommissionPostgres17, type CommissionPg17Database } from "../../../scripts/testing/commissionPostgresHarness.js";
import { buildBoaVistaDemoResponse } from "./fixtures.js";
import { executeDemoLikeSerasaConsultation, executeLiveLikeSerasaConsultation } from "./query.js";
import { readLikeSerasaConfig } from "./config.js";
import { createPrismaBoaVistaStore } from "./store.server.js";

const REPO = resolve(import.meta.dirname ?? ".", "..", "..", "..");
const pg17Bin = commissionPg17BinDir();
const SKIP = pg17Bin ? false : "COMMISSION_PG17_BIN ausente: suíte PostgreSQL 17 não executada.";
const CNPJ = "11444777000161";
const CONFIG = readLikeSerasaConfig({ LIKE_SERASA_UNIT_PRICE_CENTS: "2150", LIKE_SERASA_CACHE_TTL_MS: "600000", LIKE_SERASA_TIMEOUT_MS: "2000" });
const LIVE = { allowed: true as const, reason: "OK" as const, declaredRole: "production", attestedRole: "production" };
const DEMO = { allowed: true, reason: "OK" as const };

describe("LIKE SERASA com PostgreSQL 17 real", { skip: SKIP }, () => {
  let db: CommissionPg17Database;
  let prisma: PrismaClient;
  let customerId = "";

  before(async () => {
    db = await startCommissionPostgres17(pg17Bin!, { schema: "final" });
    prisma = new PrismaClient({ datasourceUrl: db.poolUrl(12) });
    // O schema "final" vem do schema.prisma; o índice parcial existe só na migration: aplicada inteira, como no deploy.
    await executeSqlFile(db.url, join(REPO, "prisma/migrations/20261103120000_boa_vista_define_limite/migration.sql"));
    assert.ok(readFileSync(join(REPO, "prisma/migrations/20261103120000_boa_vista_define_limite/migration.sql"), "utf8").includes("inflight_live_cnpj_idx"));
    const customer = await prisma.customer.create({ data: { companyName: "Cliente PG17", taxId: "11.444.777/0001-61" } });
    customerId = customer.id;
  });

  after(async () => {
    await prisma?.$disconnect();
    await db?.stop();
  });

  function run(key: string, fetchImpl: typeof fetch, extra: Partial<Parameters<typeof executeLiveLikeSerasaConsultation>[0]> = {}) {
    return executeLiveLikeSerasaConsultation({
      store: createPrismaBoaVistaStore(prisma),
      config: CONFIG,
      liveDecision: LIVE,
      customerId,
      companyName: "Cliente PG17",
      cnpj: CNPJ,
      consent: true,
      idempotencyKey: key,
      userId: "admin",
      role: "SUPER_ADMIN",
      fetchImpl,
      ...extra,
    });
  }

  const ok = (): typeof fetch => async () => new Response(JSON.stringify(buildBoaVistaDemoResponse({ cnpj: CNPJ })), { status: 200, headers: { "content-type": "application/json" } });

  it("consulta real gravada com BigInt do limite, seções JSON, cobrança estimada; cache válido devolve sem nova chamada; idempotência pela chave única", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (...args) => {
      calls += 1;
      return ok()(...args);
    };
    const first = await run("pg-chave-1", fetchImpl);
    assert.equal(first.code, "OK", JSON.stringify(first));
    assert.equal(first.charged, true);
    const row = await prisma.boaVistaDefineLimiteConsultation.findUniqueOrThrow({ where: { idempotencyKey: "pg-chave-1" } });
    assert.equal(row.status, "SUCCEEDED");
    assert.equal(row.mode, "LIVE");
    assert.equal(row.suggestedLimitCents, 31670000n);
    assert.equal(row.score, 593);
    assert.equal(row.billingStatus, "ESTIMATED");
    assert.equal(row.chargedCostCents, 2150);
    assert.equal(typeof (row.sections as { limit: unknown }).limit, "object");
    const cached = await run("pg-chave-2", fetchImpl);
    assert.equal(cached.code, "CACHE_VALID");
    assert.equal(calls, 1);
    const same = await run("pg-chave-1", fetchImpl);
    assert.equal(same.code, "OK");
    assert.equal(same.charged, false);
    assert.equal(calls, 1);
  });

  it("corrida real entre conexões com chaves diferentes e forceRefresh: exatamente uma chamada ao provedor (transação + índice parcial)", async () => {
    let calls = 0;
    const slow: typeof fetch = async (...args) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return ok()(...args);
    };
    const results = await Promise.all(["pg-corrida-a", "pg-corrida-b", "pg-corrida-c", "pg-corrida-d"].map((key) => run(key, slow, { forceRefresh: true })));
    const codes = results.map((result) => result.code).sort();
    assert.equal(calls, 1, codes.join(","));
    assert.equal(codes.filter((code) => code === "OK").length, 1);
    assert.equal(codes.filter((code) => code === "IN_FLIGHT").length, 3);
    const inflight = await prisma.boaVistaDefineLimiteConsultation.count({ where: { cnpj: CNPJ, status: { in: ["RESERVED", "SENT"] } } });
    assert.equal(inflight, 0);
  });

  it("timeout deixa cobrança desconhecida e bloqueia qualquer reenvio real do mesmo CNPJ até conciliar", async () => {
    const hanging: typeof fetch = async (_input, init) => {
      await new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("abort"), { name: "AbortError" }))));
      return new Response("{}");
    };
    const timeout = await run("pg-timeout", hanging, { forceRefresh: true });
    assert.equal(timeout.code, "TIMEOUT");
    const row = await prisma.boaVistaDefineLimiteConsultation.findUniqueOrThrow({ where: { idempotencyKey: "pg-timeout" } });
    assert.equal(row.status, "UNKNOWN_BILLING");
    assert.equal(row.billingStatus, "UNKNOWN");
    const blocked = await run("pg-depois-timeout", ok(), { forceRefresh: true });
    assert.equal(blocked.code, "UNKNOWN_BILLING");
    // Conciliação manual: marcar como conciliada libera (simulada aqui por SQL direto, como o operador faria).
    await prisma.boaVistaDefineLimiteConsultation.update({ where: { id: row.id }, data: { billingStatus: "NOT_SENT", failureCode: "TIMEOUT_RECONCILED" } });
  });

  it("demonstração grava mode=DEMO sem cobrança e nunca satisfaz o cache da consulta real", async () => {
    const other = await prisma.customer.create({ data: { companyName: "Cliente Demo", taxId: "04.252.011/0001-10" } });
    const demo = await executeDemoLikeSerasaConsultation({
      store: createPrismaBoaVistaStore(prisma),
      config: CONFIG,
      demoDecision: DEMO,
      customerId: other.id,
      companyName: "Cliente Demo",
      cnpj: "04252011000110",
      consent: true,
      idempotencyKey: "pg-demo-1",
      userId: "admin",
      role: "SUPER_ADMIN",
    });
    assert.equal(demo.code, "OK", JSON.stringify(demo));
    const row = await prisma.boaVistaDefineLimiteConsultation.findUniqueOrThrow({ where: { idempotencyKey: "pg-demo-1" } });
    assert.equal(row.mode, "DEMO");
    assert.equal(row.billingStatus, "NOT_APPLICABLE");
    assert.equal(row.authorizedCostCents, 0);
    assert.match(String(row.providerQueryId), /^demo-/);
    let calls = 0;
    const live = await executeLiveLikeSerasaConsultation({
      store: createPrismaBoaVistaStore(prisma),
      config: CONFIG,
      liveDecision: LIVE,
      customerId: other.id,
      companyName: "Cliente Demo",
      cnpj: "04252011000110",
      consent: true,
      idempotencyKey: "pg-live-after-demo",
      userId: "admin",
      role: "SUPER_ADMIN",
      fetchImpl: async (...args) => {
        calls += 1;
        return ok()(...args);
      },
    });
    assert.equal(live.code, "OK");
    assert.equal(calls, 1, "a simulação não vale como cache da consulta real");
  });

  it("o cadastro do cliente não é alterado por nenhuma consulta (sem limite aprovado, sem bloqueio automático)", async () => {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    assert.equal(customer.companyName, "Cliente PG17");
    assert.equal(customer.taxId, "11.444.777/0001-61");
    const columns = (await prisma.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name = 'Customer' AND column_name ILIKE '%limit%'`)) as Array<{ column_name: string }>;
    assert.deepEqual(columns, [], "nenhuma coluna de limite de crédito foi criada no cadastro");
  });
});
