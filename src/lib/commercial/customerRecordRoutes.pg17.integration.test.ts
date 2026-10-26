/**
 * Cadastro de clientes num PostgreSQL 17 REAL (schema completo do projeto, descartável, loopback): reprodução do
 * incidente de 26/10/2026 com o CNPJ 08.535.015/0001-66 já cadastrado (com máscara) desde 08/04/2026.
 * Prova: 409 em qualquer formato, registro existente intocado, corrida real entre conexões sem duplicata, e a
 * Inteligência de CNPJ (que grava só dígitos) também reconhece o cliente existente.
 *
 * Executar: COMMISSION_PG17_BIN=<bin do PostgreSQL 17> npx tsx --test src/lib/commercial/customerRecordRoutes.pg17.integration.test.ts
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { commissionPg17BinDir, startCommissionPostgres17, type CommissionPg17Database } from "../../../scripts/testing/commissionPostgresHarness.js";
import { createGlobalErrorHandler, installExpressAsyncErrorForwarding } from "@/src/lib/http/expressAsyncSafety.server.ts";
import { CUSTOMER_TAX_ID_DUPLICATE_CODE, registerCustomerRecordRoutes } from "./customerRecordRoutes.server.ts";

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
});
