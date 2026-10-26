/**
 * Cadastro de clientes num PostgreSQL 17 REAL (schema completo do projeto, descartável, loopback): reprodução do
 * incidente de 26/10/2026 com o CNPJ 08.535.015/0001-66 já cadastrado (com máscara) desde 08/04/2026.
 * Prova: 409 em qualquer formato, registro existente intocado, corrida real entre conexões sem duplicata, e a
 * Inteligência de CNPJ (que grava só dígitos) também reconhece o cliente existente.
 *
 * Executar: COMMISSION_PG17_BIN=<bin do PostgreSQL 17> npx tsx --test src/lib/commercial/customerRecordRoutes.pg17.integration.test.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { commissionPg17BinDir, startCommissionPostgres17, type CommissionPg17Database } from "../../../scripts/testing/commissionPostgresHarness.js";
import { createGlobalErrorHandler, installExpressAsyncErrorForwarding } from "@/src/lib/http/expressAsyncSafety.server.ts";
import {
  CUSTOMER_TAX_ID_DUPLICATE_CODE,
  CUSTOMER_TAX_ID_LOCK_NAMESPACE,
  CUSTOMER_TAX_ID_LOCK_TIMEOUT_MS,
  createCustomerRecord,
  registerCustomerRecordRoutes,
} from "./customerRecordRoutes.server.ts";

const REPO = resolve(import.meta.dirname ?? ".", "..", "..", "..");

const pg17Bin = commissionPg17BinDir();
const SKIP = pg17Bin ? false : "COMMISSION_PG17_BIN ausente: suíte PostgreSQL 17 não executada.";
const INCIDENT_CNPJ = "08.535.015/0001-66";

describe("cadastro de clientes com PostgreSQL 17 real", { skip: SKIP }, () => {
  let db: CommissionPg17Database;
  let prisma: PrismaClient;
  let base = "";
  let close: () => Promise<void>;
  let existingId = "";
  let previousDatabaseUrl: string | undefined;

  before(async () => {
    db = await startCommissionPostgres17(pg17Bin!, { schema: "final" });
    prisma = new PrismaClient({ datasourceUrl: db.poolUrl(12) });
    const seeded = await prisma.customer.create({
      data: { companyName: "Cliente de abril", taxId: INCIDENT_CNPJ, createdAt: new Date("2026-04-08T12:00:00Z") },
    });
    existingId = seeded.id;
    installExpressAsyncErrorForwarding();
    const app = express();
    app.use(express.json());
    const pass: express.RequestHandler = (_req, _res, next) => next();
    app.get("/alive", (_req, res) => res.json({ ok: true }));
    registerCustomerRecordRoutes(app, { prisma, requireAppAuth: pass, requireResource: () => pass });
    app.use(createGlobalErrorHandler({ production: true, log: () => {} }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((r) => server.close(() => r()));
  });
  after(async () => {
    if (previousDatabaseUrl !== undefined) process.env.DATABASE_URL = previousDatabaseUrl;
    await close?.();
    await prisma?.$disconnect();
    await db?.stop();
  });

  const post = (taxId: string, companyName = "Tentativa") =>
    fetch(`${base}/api/customers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyName, taxId }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const countByDigits = async (digits: string) =>
    Number(((await prisma.$queryRawUnsafe(`SELECT count(*)::int AS c FROM "Customer" WHERE regexp_replace("taxId", '[^0-9]', '', 'g') = '${digits}'`)) as Array<{ c: number }>)[0]!.c);

  it("P1. incidente: o mesmo CNPJ (com e sem máscara) duas vezes → 409, cliente de abril intocado, servidor vivo", async () => {
    const before = await prisma.customer.findUniqueOrThrow({ where: { id: existingId } });
    for (const taxId of [INCIDENT_CNPJ, INCIDENT_CNPJ, "08535015000166"]) {
      const r = await post(taxId);
      assert.equal(r.status, 409, JSON.stringify(r.body));
      assert.equal(r.body.code, CUSTOMER_TAX_ID_DUPLICATE_CODE);
      assert.equal(r.body.message, "Este CNPJ/CPF já está cadastrado. Consulte o cliente existente.");
      assert.equal(r.body.existingCustomerId, existingId);
    }
    const afterRow = await prisma.customer.findUniqueOrThrow({ where: { id: existingId } });
    assert.deepEqual(afterRow, before);
    assert.equal(await countByDigits("08535015000166"), 1);
    assert.equal((await fetch(`${base}/alive`)).status, 200);
  });

  it("P2. corrida real: 8 cadastros simultâneos do mesmo CNPJ novo em formatos diferentes → exatamente 1 cliente", async () => {
    const formats = ["11.222.333/0001-81", "11222333000181", "11.222.333/0001-81", "11222333/0001-81"];
    const results = await Promise.all(Array.from({ length: 8 }, (_v, i) => post(formats[i % formats.length]!, `Concorrente ${i}`)));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 409, 409, 409, 409, 409, 409, 409], JSON.stringify(results.map((r) => r.body)));
    assert.equal(await countByDigits("11222333000181"), 1);
    const createdId = results.find((r) => r.status === 200)!.body.id;
    assert.ok(results.filter((r) => r.status === 409).every((r) => r.body.existingCustomerId === createdId));
  });

  it("P3. Inteligência de CNPJ (grava só dígitos) reconhece o cliente com máscara → DUPLICATE_TAX_ID, sem duplicar", async () => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = db.poolUrl(4);
    const { createCustomerFromCompanyIntelligence } = await import("@/src/lib/companyCnpjLookup.ts");
    const lookup = await prisma.customerCnpjLookup.create({
      data: {
        cnpj: "08535015000166",
        rawJson: {},
        normalizedSummary: { cnpj: "08535015000166", companyName: "Razão pública", stateTaxIds: [] },
        riskScore: 0,
        riskVerdict: "OK",
        riskDetails: {},
        commercialInsights: {},
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await assert.rejects(createCustomerFromCompanyIntelligence({ lookupId: lookup.id }), (e: unknown) => (e as { code?: string }).code === "DUPLICATE_TAX_ID");
    assert.equal(await countByDigits("08535015000166"), 1);
  });

  // ---------------------------------------------------------------------------------------------------------
  // Lock consultivo por documento
  // ---------------------------------------------------------------------------------------------------------

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** Locks consultivos deste módulo (namespace próprio, forma de duas chaves), com o estado da sessão dona. */
  const advisoryLocks = async () =>
    (await prisma.$queryRawUnsafe(
      `SELECT l.pid, l.granted, l.mode, a.state, a.wait_event_type, a.wait_event FROM pg_locks l LEFT JOIN pg_stat_activity a ON a.pid = l.pid WHERE l.locktype = 'advisory' AND l.objsubid = 2 AND l.classid = ${CUSTOMER_TAX_ID_LOCK_NAMESPACE}::oid ORDER BY l.granted DESC`
    )) as Array<{ pid: number; granted: boolean; mode: string; state: string; wait_event_type: string | null; wait_event: string | null }>;

  /** Cliente Prisma próprio (pool separado) que para DENTRO da transação, já com o lock, antes do INSERT. */
  function gatedClient() {
    let enter!: () => void;
    const entered = new Promise<void>((r) => (enter = r));
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    let failWith: Error | null = null;
    const base = new PrismaClient({ datasourceUrl: db.poolUrl(3) });
    const client = base.$extends({
      query: {
        customer: {
          async create({ args, query }) {
            enter();
            await gate;
            if (failWith) throw failWith;
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
    return { client, entered, release: () => open(), failNext: (e: Error) => (failWith = e), disconnect: () => base.$disconnect() };
  }
  const settled = <T>(p: Promise<T>) => {
    const s = { done: false };
    p.then(() => (s.done = true), () => (s.done = true));
    return s;
  };

  it("L1. o lock é tomado DENTRO da transação (sessão 'idle in transaction', ExclusiveLock) e some no commit", async () => {
    const g = gatedClient();
    try {
      const p = createCustomerRecord(g.client, { companyName: "L1", taxId: "22.333.444/0001-05" });
      await g.entered;
      const held = await advisoryLocks();
      assert.equal(held.length, 1, JSON.stringify(held));
      assert.equal(held[0]!.granted, true);
      assert.equal(held[0]!.mode, "ExclusiveLock");
      assert.equal(held[0]!.state, "idle in transaction");
      g.release();
      await p;
      assert.deepEqual(await advisoryLocks(), []);
    } finally {
      await g.disconnect();
    }
  });

  it("L2. entre conexões diferentes: a segunda espera no lock (wait_event advisory) e, liberada, recebe 409", async () => {
    const g = gatedClient();
    const other = new PrismaClient({ datasourceUrl: db.poolUrl(3) });
    try {
      const first = createCustomerRecord(g.client, { companyName: "L2-A", taxId: "33.444.555/0001-81" });
      await g.entered;
      const second = createCustomerRecord(other, { companyName: "L2-B", taxId: "33444555000181" });
      const secondState = settled(second);
      await sleep(600);
      const locks = await advisoryLocks();
      const waiting = locks.find((l) => !l.granted);
      assert.ok(waiting, JSON.stringify(locks));
      assert.equal(waiting!.wait_event_type, "Lock");
      assert.equal(waiting!.wait_event, "advisory");
      assert.equal(secondState.done, false, "a segunda conexão está bloqueada, não concluída");
      g.release();
      const created = await first;
      await assert.rejects(second, (e: unknown) => (e as { code?: string; existingCustomerId?: string }).code === CUSTOMER_TAX_ID_DUPLICATE_CODE && (e as { existingCustomerId?: string }).existingCustomerId === created.id);
      assert.equal(await countByDigits("33444555000181"), 1);
      assert.deepEqual(await advisoryLocks(), []);
    } finally {
      await g.disconnect();
      await other.$disconnect();
    }
  });

  it("L3. entre PROCESSOS Node diferentes (4, formatos variados, mesmo instante): exatamente 1 cliente", async () => {
    const dir = mkdtempSync(join(tmpdir(), "customer-lock-proc-"));
    try {
      const script = join(dir, "create.mts");
      writeFileSync(
        script,
        `import { createRequire } from "node:module";
const { PrismaClient } = createRequire(${JSON.stringify(join(REPO, "package.json"))})("@prisma/client");
const { createCustomerRecord } = await import(${JSON.stringify(pathToFileURL(join(REPO, "src/lib/commercial/customerRecordRoutes.server.ts")).href)});
const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DB_URL });
await prisma.$queryRawUnsafe("SELECT 1");
await new Promise((r) => setTimeout(r, Math.max(0, Number(process.env.START_AT) - Date.now())));
try {
  const c = await createCustomerRecord(prisma, { companyName: "processo " + process.pid, taxId: process.env.TAX });
  console.log("RESULT=created:" + c.id);
} catch (e) {
  console.log("RESULT=" + (e.code ?? e.name));
} finally {
  await prisma.$disconnect();
}
`
      );
      const { NODE_TEST_CONTEXT: _ctx, ...env } = process.env;
      const startAt = Date.now() + 6000;
      const formats = ["44.555.666/0001-63", "44555666000163", "44.555.666/000163", "44555666/0001-63"];
      const runs = formats.map(
        (tax) =>
          new Promise<string>((resolveRun) => {
            const child = spawn(process.execPath, ["--import", "tsx", script], { cwd: REPO, env: { ...env, TEST_DB_URL: db.poolUrl(2), START_AT: String(startAt), TAX: tax }, stdio: ["ignore", "pipe", "pipe"] });
            let out = "";
            child.stdout.on("data", (d) => (out += d));
            child.stderr.on("data", (d) => (out += d));
            child.on("exit", () => resolveRun(/RESULT=(\S+)/.exec(out)?.[1] ?? `sem resultado: ${out.slice(-400)}`));
          })
      );
      const results = await Promise.all(runs);
      assert.equal(results.filter((r) => r.startsWith("created:")).length, 1, results.join("\n"));
      assert.equal(results.filter((r) => r === CUSTOMER_TAX_ID_DUPLICATE_CODE).length, 3, results.join("\n"));
      assert.equal(await countByDigits("44555666000163"), 1);
      assert.deepEqual(await advisoryLocks(), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("L4. falha depois do lock (rollback): lock liberado na hora; o próximo cadastro do mesmo documento não espera", async () => {
    const g = gatedClient();
    try {
      g.failNext(new Error("falha inesperada depois do lock"));
      const p = createCustomerRecord(g.client, { companyName: "L4", taxId: "55.666.777/0001-90" });
      await g.entered;
      assert.equal((await advisoryLocks()).length, 1);
      g.release();
      await assert.rejects(p, /falha inesperada depois do lock/);
      assert.deepEqual(await advisoryLocks(), []);
      assert.equal(await countByDigits("55666777000190"), 0, "rollback: nada gravado");
      const t0 = Date.now();
      const created = await createCustomerRecord(prisma, { companyName: "L4 ok", taxId: "55666777000190" });
      assert.ok(created.id);
      assert.ok(Date.now() - t0 < 2000, `não esperou lock (${Date.now() - t0} ms)`);
    } finally {
      await g.disconnect();
    }
  });

  it("L5. lock preso por outra sessão: espera até lock_timeout e devolve 409 CUSTOMER_TAX_ID_BUSY; servidor vivo; depois funciona", async () => {
    const holder = new PrismaClient({ datasourceUrl: db.poolUrl(2) });
    try {
      let entered!: () => void;
      const holding = new Promise<void>((r) => (entered = r));
      const held = holder.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(${CUSTOMER_TAX_ID_LOCK_NAMESPACE}::int, hashtext(${"66777888000108"}))::text AS locked`;
          entered();
          await sleep(CUSTOMER_TAX_ID_LOCK_TIMEOUT_MS + 2500);
        },
        { timeout: 30_000 }
      );
      await holding;
      const t0 = Date.now();
      const r = await post("66.777.888/0001-08");
      const elapsed = Date.now() - t0;
      assert.equal(r.status, 409, JSON.stringify(r.body));
      assert.equal(r.body.code, "CUSTOMER_TAX_ID_BUSY");
      assert.doesNotMatch(JSON.stringify(r.body), /55P03|lock timeout/);
      assert.ok(elapsed >= CUSTOMER_TAX_ID_LOCK_TIMEOUT_MS - 300 && elapsed < CUSTOMER_TAX_ID_LOCK_TIMEOUT_MS + 2500, `esperou ${elapsed} ms`);
      assert.equal((await fetch(`${base}/alive`)).status, 200);
      await held;
      assert.equal((await post("66.777.888/0001-08")).status, 200);
      assert.deepEqual(await advisoryLocks(), []);
    } finally {
      await holder.$disconnect();
    }
  });

  it("L6. carga: 20 cadastros simultâneos por dois servidores (pools separados) → 1 cliente, 19 × 409, nenhum lock sobra", async () => {
    const second = new PrismaClient({ datasourceUrl: db.poolUrl(10) });
    const app2 = express();
    app2.use(express.json());
    const pass: express.RequestHandler = (_req, _res, next) => next();
    registerCustomerRecordRoutes(app2, { prisma: second, requireAppAuth: pass, requireResource: () => pass });
    app2.use(createGlobalErrorHandler({ production: true, log: () => {} }));
    const server2 = app2.listen(0, "127.0.0.1");
    await new Promise((r) => server2.once("listening", r));
    const base2 = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
    try {
      const formats = ["77.888.999/0001-23", "77888999000123"];
      const results = await Promise.all(
        Array.from({ length: 20 }, (_v, i) =>
          fetch(`${i % 2 ? base2 : base}/api/customers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyName: `L6-${i}`, taxId: formats[i % 2] }) }).then((r) => r.status)
        )
      );
      assert.deepEqual([...results].sort(), [200, ...Array(19).fill(409)]);
      assert.equal(await countByDigits("77888999000123"), 1);
      assert.deepEqual(await advisoryLocks(), []);
    } finally {
      await new Promise((r) => server2.close(() => r(undefined)));
      await second.$disconnect();
    }
  });
});
