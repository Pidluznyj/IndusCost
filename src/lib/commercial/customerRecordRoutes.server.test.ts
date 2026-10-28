/**
 * POST/PUT/DELETE /api/customers com um banco em memória que se comporta como o PostgreSQL nos pontos que importam:
 * `taxId` único como texto (P2002), lock consultivo por transação (serializa) e busca por dígitos.
 * Rotas reais (registerCustomerRecordRoutes) + rede de segurança real (handler global e encaminhamento async).
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { HttpError } from "@/src/lib/http";
import { createGlobalErrorHandler, installExpressAsyncErrorForwarding } from "@/src/lib/http/expressAsyncSafety.server.ts";
import {
  CUSTOMER_TAX_ID_DUPLICATE_CODE,
  CUSTOMER_TAX_ID_DUPLICATE_MESSAGE,
  registerCustomerRecordRoutes,
} from "./customerRecordRoutes.server.ts";
import { CUSTOMER_TAX_ID_DUPLICATE_UI_MESSAGE, describeCustomerSaveError } from "./customerSaveErrors.ts";

type Row = { id: string; companyName: string; taxId: string; createdAt: Date; updatedAt: Date; [k: string]: unknown };

function prismaError(code: string, message = "Unique constraint failed on the fields: (`taxId`)") {
  return Object.assign(new Error(message), { name: "PrismaClientKnownRequestError", code });
}

/** Banco em memória. `skipPrecheckOnce` simula a corrida em que outra origem grava entre a conferência e o create. */
function memoryDb() {
  const rows: Row[] = [];
  const locks = new Map<string, Promise<void>>();
  let seq = 0;
  const state = { skipPrecheckOnce: false, failNext: null as Error | null, fkOnDelete: new Set<string>(), updates: [] as Array<Record<string, unknown>> };
  const digits = (s: string) => s.replace(/\D/g, "");
  const sqlValues = (values: unknown[]) => values.flatMap((v) => (v && typeof v === "object" && Array.isArray((v as { values?: unknown[] }).values) ? (v as { values: unknown[] }).values : [v]));

  const client = (held: Array<() => void>) => ({
    async $executeRawUnsafe() {
      return 0; // SET LOCAL lock_timeout
    },
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      if (strings.join("?").includes("pg_advisory_xact_lock")) {
        const key = `${String(values[0])}:${String(values[1])}`;
        while (locks.has(key)) await locks.get(key);
        let release!: () => void;
        locks.set(key, new Promise<void>((r) => (release = r)));
        held.push(() => {
          locks.delete(key);
          release();
        });
        return [{ locked: "" }];
      }
      const [d, exclude] = sqlValues(values) as [string, string | undefined];
      if (state.skipPrecheckOnce) {
        state.skipPrecheckOnce = false;
        return [];
      }
      await new Promise((r) => setTimeout(r, 5));
      const hit = rows.filter((r) => digits(r.taxId) === d && r.id !== exclude).sort((a, b) => +a.createdAt - +b.createdAt)[0];
      return hit ? [{ id: hit.id }] : [];
    },
    customer: {
      async create({ data }: { data: Record<string, unknown> }) {
        if (state.failNext) {
          const e = state.failNext;
          state.failNext = null;
          throw e;
        }
        await new Promise((r) => setTimeout(r, 5));
        if (typeof data.companyName !== "string") throw new Prisma.PrismaClientValidationError("Argument `companyName` is missing.", { clientVersion: "test" });
        if (rows.some((r) => r.taxId === data.taxId)) throw prismaError("P2002");
        const row = { ...(data as Row), id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, createdAt: new Date(Date.now() + seq), updatedAt: new Date() };
        rows.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        state.updates.push(data);
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw prismaError("P2025", "Record to update not found.");
        if (typeof data.taxId === "string" && rows.some((r) => r.id !== row.id && r.taxId === data.taxId)) throw prismaError("P2002");
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      async delete({ where }: { where: { id: string } }) {
        if (state.fkOnDelete.has(where.id)) throw prismaError("P2003", "Foreign key constraint failed on the field: `Proposal_customerId_fkey`");
        const i = rows.findIndex((r) => r.id === where.id);
        if (i < 0) throw prismaError("P2025", "Record to delete does not exist.");
        rows.splice(i, 1);
      },
    },
  });

  const db = {
    ...client([]),
    async $transaction<T>(fn: (tx: unknown) => Promise<T>) {
      const held: Array<() => void> = [];
      try {
        return await fn(client(held));
      } finally {
        held.forEach((r) => r());
      }
    },
  };
  return { db: db as unknown as PrismaClient, rows, state };
}

describe("cadastro de clientes — documento duplicado e erros controlados", () => {
  let base = "";
  let close: () => Promise<void>;
  let mem: ReturnType<typeof memoryDb>;
  const radar: string[] = [];

  before(async () => {
    installExpressAsyncErrorForwarding();
    const app = express();
    app.use(express.json());
    const pass: express.RequestHandler = (_req, _res, next) => next();
    app.get("/alive", (_req, res) => res.json({ ok: true }));
    registerCustomerRecordRoutes(app, {
      // Cada teste troca o banco em memória; as rotas enxergam sempre o atual.
      prisma: new Proxy({}, { get: (_t, prop) => (mem.db as unknown as Record<string | symbol, unknown>)[prop] }) as PrismaClient,
      requireAppAuth: pass,
      requireResource: () => pass,
      onCustomerContactChanged: (id) => {
        radar.push(id);
      },
    } as Parameters<typeof registerCustomerRecordRoutes>[1]);
    app.use(createGlobalErrorHandler({ production: true, log: () => {} }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((r) => server.close(() => r()));
  });
  after(() => close());
  beforeEach(() => {
    mem = memoryDb();
    radar.length = 0;
  });

  const send = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const create = (taxId: unknown, companyName = "Cliente") => send("POST", "/api/customers", { companyName, taxId });

  it("C1. cria cliente novo; o documento é gravado como digitado (só trim)", async () => {
    const r = await create("  08.535.015/0001-66 ");
    assert.equal(r.status, 200);
    assert.equal(r.body.taxId, "08.535.015/0001-66");
    assert.equal(mem.rows.length, 1);
  });

  it("C2. mesmo CNPJ de novo → 409 estável com o cliente existente; nada criado nem alterado; servidor vivo", async () => {
    const first = await create("08.535.015/0001-66");
    const before = JSON.stringify(mem.rows);
    for (let i = 0; i < 2; i++) {
      const r = await create("08.535.015/0001-66", "Outro nome");
      assert.equal(r.status, 409);
      assert.deepEqual(r.body, {
        error: CUSTOMER_TAX_ID_DUPLICATE_CODE,
        code: CUSTOMER_TAX_ID_DUPLICATE_CODE,
        message: "Este CNPJ/CPF já está cadastrado. Consulte o cliente existente.",
        existingCustomerId: first.body.id,
        details: { existingCustomerId: first.body.id },
      });
    }
    assert.equal(JSON.stringify(mem.rows), before);
    assert.equal((await send("GET", "/alive")).status, 200);
  });

  it("C3. mesmo documento em outro formato (só dígitos × com máscara; CPF também) → 409", async () => {
    await create("08.535.015/0001-66");
    assert.equal((await create("08535015000166")).status, 409);
    await create("123.456.789-09");
    assert.equal((await create("12345678909")).status, 409);
    assert.equal(mem.rows.length, 2);
  });

  it("C4. duas requisições simultâneas com o mesmo CNPJ → uma 200 e uma 409; um único cliente", async () => {
    const results = await Promise.all([create("08.535.015/0001-66", "A"), create("08.535.015/0001-66", "B")]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(mem.rows.length, 1);
  });

  it("C5. simultâneas em formatos diferentes (o índice único não pega) → lock por dígitos: uma 200 e uma 409", async () => {
    const results = await Promise.all([create("08.535.015/0001-66"), create("08535015000166"), create("08.535.015/000166")]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
    assert.equal(mem.rows.length, 1);
  });

  it("C6. P2002 do banco (outra origem gravou entre a conferência e o create) → mesmo 409 com o existente", async () => {
    const first = await create("08.535.015/0001-66");
    mem.state.skipPrecheckOnce = true;
    const r = await create("08.535.015/0001-66");
    assert.equal(r.status, 409);
    assert.equal(r.body.code, CUSTOMER_TAX_ID_DUPLICATE_CODE);
    assert.equal(r.body.existingCustomerId, first.body.id);
    assert.equal(mem.rows.length, 1);
  });

  it("C7. sem documento → 400; corpo inválido → 400; dados incompletos → 400 sem detalhes do Prisma", async () => {
    assert.equal((await create("")).body.code, "TAX_ID_REQUIRED");
    assert.equal((await create("---")).status, 400);
    assert.equal((await send("POST", "/api/customers", [1, 2])).status, 400);
    const r = await send("POST", "/api/customers", { taxId: "08.535.015/0001-66" });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "INVALID_CUSTOMER_DATA");
    assert.doesNotMatch(JSON.stringify(r.body), /Argument|companyName/);
  });

  it("C8. erro inesperado → 500 controlado sem dados internos; outros usuários continuam atendidos", async () => {
    mem.state.failNext = new Error("connection reset; password=segredo; SELECT * FROM \"Customer\"");
    const r = await create("08.535.015/0001-66");
    assert.equal(r.status, 500);
    assert.equal(r.body.code, "CUSTOMER_SAVE_FAILED");
    assert.doesNotMatch(JSON.stringify(r.body), /segredo|SELECT|stack/);
    assert.equal((await send("GET", "/alive")).status, 200);
    assert.equal((await create("08.535.015/0001-66")).status, 200, "próxima tentativa funciona");
  });

  it("C9. PUT: documento de outro cliente (qualquer formato) → 409; vínculos Person removidos; inexistente → 404", async () => {
    const a = await create("08.535.015/0001-66", "A");
    const b = await create("11.222.333/0001-81", "B");
    const r = await send("PUT", `/api/customers/${b.body.id}`, { taxId: "08535015000166" });
    assert.equal(r.status, 409);
    assert.equal(r.body.existingCustomerId, a.body.id);
    assert.equal(mem.rows.find((x) => x.id === b.body.id)!.taxId, "11.222.333/0001-81");
    const ok = await send("PUT", `/api/customers/${a.body.id}`, { taxId: "08.535.015/0001-66", phone: "1", personId: "x", contactPersonId: "y" });
    assert.equal(ok.status, 200, "o próprio documento não conflita com ele mesmo");
    assert.ok(!("personId" in mem.state.updates.at(-1)!) && !("contactPersonId" in mem.state.updates.at(-1)!));
    assert.deepEqual(radar, [a.body.id]);
    assert.equal((await send("PUT", "/api/customers/00000000-0000-4000-8000-999999999999", { phone: "1" })).status, 404);
  });

  it("C10. DELETE: cliente com vínculos → 409; inexistente → 404; nada derruba o servidor", async () => {
    const a = await create("08.535.015/0001-66");
    mem.state.fkOnDelete.add(a.body.id);
    const linked = await send("DELETE", `/api/customers/${a.body.id}`);
    assert.equal(linked.status, 409);
    assert.equal(linked.body.code, "CUSTOMER_HAS_LINKED_RECORDS");
    assert.doesNotMatch(JSON.stringify(linked.body), /fkey/);
    assert.equal((await send("DELETE", "/api/customers/00000000-0000-4000-8000-999999999999")).status, 404);
    assert.equal((await send("GET", "/alive")).status, 200);
  });

  it("C11. tela: o 409 vira a mensagem pedida e o id para abrir o cliente existente", () => {
    assert.equal(CUSTOMER_TAX_ID_DUPLICATE_MESSAGE, CUSTOMER_TAX_ID_DUPLICATE_UI_MESSAGE);
    const dup = new HttpError(409, "qualquer texto do servidor", CUSTOMER_TAX_ID_DUPLICATE_CODE, undefined, undefined, { existingCustomerId: "abc" });
    assert.deepEqual(describeCustomerSaveError(dup), { message: "Este CNPJ/CPF já está cadastrado. Consulte o cliente existente.", existingCustomerId: "abc" });
    assert.deepEqual(describeCustomerSaveError(new HttpError(500, "Não foi possível salvar o cliente.")), { message: "Não foi possível salvar o cliente." });
  });
});
