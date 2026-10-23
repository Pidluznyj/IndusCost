/**
 * Pedidos de Compra Nomus — resiliência num PostgreSQL 17 descartável, com o cliente HTTP REAL
 * (`fetchNomusJson`) sobre um `fetch` simulado (nenhum acesso à rede):
 * pedido alterado/cancelado/temporariamente ausente, resposta inválida ou vazia, paginação interrompida,
 * HTTP 429 recuperado e não recuperado, 401, falha de banco, reexecução idempotente e independência
 * em relação a Contas a Receber. Nenhum cenário apaga linha ou grava ausência sem evidência completa.
 *
 * Executar: COMMISSION_PG17_BIN=<bin do PostgreSQL 17> npm run test:nomus:purchase-orders:pg
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  assertPrismaOnTestDatabase,
  commissionPg17BinDir,
  startCommissionPostgres17,
  type CommissionPg17Database,
} from "../../../scripts/testing/commissionPostgresHarness.js";

const pg17Bin = commissionPg17BinDir();
const SKIP = pg17Bin ? false : "COMMISSION_PG17_BIN ausente: suite de integração PostgreSQL 17 não executada.";

const BASE_URL = "https://nomus.invalid/rest";
const TOKEN = "TOKEN-SECRETO-NAO-PODE-VAZAR-7f3a";
const T0 = new Date("2026-10-23T06:37:00.000Z");
const H = 3_600_000;

function order(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    codigoPedido: `PC${String(id - 1).padStart(5, "0")}`,
    idPessoaFornecedor: 215,
    nomeFornecedor: "FORNECEDOR TESTE",
    cnpjFornecedor: "03.261.226/0001-34",
    status: "Aprovado",
    cancelado: false,
    dataEmissao: "20/10/2026",
    valorTotal: "1.000,00",
    itensPedidoCompra: [{ item: "000010", idProduto: 1, quantidade: "10", valorUnitario: "100,00", status: 2 }],
    parcelas: [{ dataVencimento: "20/11/2026", valorParcela: "1.000,00" }],
    ...overrides,
  };
}

type Behavior =
  | { kind: "ok" }
  | { kind: "status"; status: number; times: number; body?: string }
  | { kind: "malformed"; onPage: number }
  | { kind: "empty" }
  | { kind: "failOnPage"; page: number; status: number };

describe("Pedidos de Compra Nomus — resiliência no PostgreSQL 17", { skip: SKIP }, () => {
  let database: CommissionPg17Database;
  let prisma: PrismaClient;
  let lockDir: string;
  let canonical: typeof import("./nomusCanonicalSync.server.js");
  let service: typeof import("./nomusPurchaseOrderSyncService.server.js");
  let rest: typeof import("../nomusRestClient.js");
  const orders = new Map<number, Record<string, unknown>>();
  let behavior: Behavior = { kind: "ok" };
  let httpCalls = 0;
  let now = T0;
  let env: Record<string, string> = {};
  let captured: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };

  /** `fetch` global simulado: o cliente HTTP real (retry, 429, timeout) roda por cima dele. */
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    httpCalls += 1;
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    assert.equal(auth, `Bearer ${TOKEN}`, "credencial enviada só no cabeçalho");
    const page = Number(url.searchParams.get("pagina") ?? "1");
    const size = Number(url.searchParams.get("tamanhoPagina") ?? "50");
    if (behavior.kind === "status" && behavior.times > 0) {
      behavior.times -= 1;
      return new Response(behavior.body ?? `{"erro":"status ${behavior.status}","token":"${TOKEN}"}`, { status: behavior.status });
    }
    if (behavior.kind === "failOnPage" && page >= behavior.page) {
      return new Response("erro interno", { status: behavior.status });
    }
    if (behavior.kind === "malformed" && page === behavior.onPage) {
      return new Response(JSON.stringify({ mensagem: "Serviço indisponível" }), { status: 200 });
    }
    if (behavior.kind === "empty") return new Response("[]", { status: 200 });
    const all = [...orders.values()].sort((a, b) => Number(a.id) - Number(b.id));
    return new Response(JSON.stringify(all.slice((page - 1) * size, page * size)), { status: 200 });
  };

  const run = async (
    strategy: "RECENT_WINDOW" | "FULL_RECONCILIATION",
    options: { trigger?: "SCHEDULED_HOURLY" | "SCHEDULED_DAILY" | "CLI"; prisma?: PrismaClient } = {}
  ) => {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    return canonical.runNomusPurchaseOrdersSync(
      {
        strategy,
        mode: "apply",
        scope: undefined,
        sourceTrigger: options.trigger ?? (strategy === "FULL_RECONCILIATION" ? "SCHEDULED_DAILY" : "SCHEDULED_HOURLY"),
        allowMissingDetection: strategy === "FULL_RECONCILIATION",
        allowMissingConfirmation: strategy === "FULL_RECONCILIATION",
      },
      (execution) =>
        service.executeNomusPurchaseOrdersSync(execution, {
          prisma: options.prisma ?? prisma,
          fetchJson: (url, opts) => rest.fetchNomusJson(url, { ...opts, sleepFn: async () => undefined }),
          env: { ...env },
          now: () => now,
          probeGlobalLockHeld: () => false,
          waitForGlobalLockToFree: () => true,
          log: (line) => captured.push(line),
        })
    );
  };
  const po = (externalId: number) =>
    prisma.nomusPurchaseOrder.findUniqueOrThrow({
      where: { externalId },
      include: { items: true, presenceEvents: { orderBy: { occurredAt: "asc" } } },
    });
  const runRow = (id: string | null) => prisma.nomusSourceSyncRun.findUniqueOrThrow({ where: { id: id! } });
  /** Cliente com um delegate trocado; o resto continua ligado ao PrismaClient real. */
  const withDelegate = (name: string, override: (real: Record<string, unknown>) => Record<string, unknown>) =>
    new Proxy(prisma, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (prop === name) return override(value as Record<string, unknown>);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as PrismaClient;

  before(async () => {
    lockDir = mkdtempSync(join(tmpdir(), "induscost-po-res-"));
    database = await startCommissionPostgres17(pg17Bin!);
    prisma = new PrismaClient({ datasourceUrl: database.poolUrl(4) });
    await assertPrismaOnTestDatabase(prisma, database.validation.marker);
    process.env.DATABASE_URL = database.url;
    canonical = await import("./nomusCanonicalSync.server.js");
    service = await import("./nomusPurchaseOrderSyncService.server.js");
    rest = await import("../nomusRestClient.js");
    globalThis.fetch = fakeFetch as typeof fetch;
    // Toda saída de console do cliente HTTP e do serviço é capturada para provar que o token não vaza.
    for (const level of ["log", "warn", "error", "info"] as const) {
      console[level] = (...args: unknown[]) => {
        captured.push(args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      };
    }
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    Object.assign(console, originalConsole);
    await prisma?.$disconnect();
    await database?.stop();
    rmSync(lockDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    env = {
      NOMUS_BASE_URL: BASE_URL,
      NOMUS_TOKEN: TOKEN,
      NOMUS_MAX_RETRIES: "3",
      NOMUS_PO_SCHEDULE_SOURCE: "independent",
      NOMUS_SOURCE_RECONCILE_PURCHASE_ORDERS_ENABLED: "1",
      NOMUS_PO_RECONCILE_PREVIEW_ONLY: "0",
      NOMUS_PO_RECONCILE_APPLY_CONFIRMED_ENABLED: "1",
      NOMUS_PURCHASE_ORDERS_CANONICAL_LOCK_FILE: join(lockDir, "po.canonical.lock"),
    };
    behavior = { kind: "ok" };
    httpCalls = 0;
  });

  it("R1. pedido novo e independência de CR: CR falhou e a agenda de Compras roda mesmo assim", async () => {
    await prisma.nomusSourceSyncRun.create({
      data: { entityType: "ACCOUNTS_RECEIVABLE", strategy: "FULL_RECONCILIATION", scope: {}, startedAt: T0, status: "FAILED", finishedAt: T0 },
    });
    for (let id = 101; id <= 110; id += 1) orders.set(id, order(id));
    now = T0;
    const result = await run("RECENT_WINDOW", { trigger: "SCHEDULED_HOURLY" });
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.counters.created, 10);
    assert.equal((await po(101)).sourcePresenceStatus, "PRESENT");
  });

  it("R2. reexecução idempotente: nada criado, nada alterado, nenhum evento", async () => {
    now = new Date(T0.getTime() + H);
    const result = await run("RECENT_WINDOW");
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.counters.created, 0);
    assert.equal(result.counters.updated, 0);
    assert.equal(result.counters.unchanged, 10);
    assert.equal(await prisma.nomusPurchaseOrderPresenceEvent.count(), 0);
  });

  it("R3. pedido alterado no Nomus: atualiza cabeçalho e itens, presença intacta", async () => {
    const before = await po(102);
    orders.set(
      102,
      order(102, {
        valorTotal: "1.500,00",
        itensPedidoCompra: [
          { item: "000010", idProduto: 1, quantidade: "10", valorUnitario: "100,00", status: 2 },
          { item: "000020", idProduto: 2, quantidade: "5", valorUnitario: "100,00", status: 2 },
        ],
      })
    );
    now = new Date(T0.getTime() + 2 * H);
    const result = await run("RECENT_WINDOW");
    assert.equal(result.counters.updated, 1);
    const after = await po(102);
    assert.notEqual(after.payloadHash, before.payloadHash);
    assert.equal(after.items.length, 2);
    assert.equal(after.sourcePresenceStatus, "PRESENT");
    assert.equal(after.id, before.id, "mesmo registro, sem recriar o pedido");
  });

  it("R4. pedido cancelado no Nomus: fase CANCELED, continua PRESENT (cancelado ≠ excluído)", async () => {
    orders.set(103, order(103, { cancelado: true, status: "Cancelado" }));
    now = new Date(T0.getTime() + 3 * H);
    await run("RECENT_WINDOW");
    now = new Date(T0.getTime() + 4 * H);
    const full = await run("FULL_RECONCILIATION");
    assert.equal(full.status, "SUCCESS");
    assert.equal(full.payloadComplete, true);
    const row = await po(103);
    assert.equal(row.stage, "CANCELED");
    assert.equal(row.sourcePresenceStatus, "PRESENT");
    assert.equal(row.presenceEvents.length, 0);
  });

  it("R5. pedido temporariamente ausente: vira candidata e volta a PRESENT sem confirmar", async () => {
    const saved = orders.get(104)!;
    orders.delete(104);
    now = new Date(T0.getTime() + 5 * H);
    await run("FULL_RECONCILIATION");
    assert.equal((await po(104)).sourcePresenceStatus, "MISSING_CANDIDATE");
    orders.set(104, saved);
    now = new Date(T0.getTime() + 6 * H);
    await run("RECENT_WINDOW");
    const row = await po(104);
    assert.equal(row.sourcePresenceStatus, "PRESENT");
    assert.equal(row.missingConsecutiveRuns, 0);
    assert.deepEqual(row.presenceEvents.map((e) => e.action), ["MISSING_CANDIDATE", "REACTIVATE"]);
  });

  it("R6. resposta inválida (HTTP 200 sem lista) não encerra a paginação como completa", async () => {
    orders.delete(105);
    behavior = { kind: "malformed", onPage: 1 };
    now = new Date(T0.getTime() + 7 * H);
    const result = await run("FULL_RECONCILIATION");
    assert.equal(result.status, "INCONCLUSIVE");
    assert.equal(result.payloadComplete, false);
    assert.match(JSON.stringify((await runRow(result.runId)).summaryJson), /MALFORMED_PAYLOAD_INCOMPLETE_SNAPSHOT/);
    assert.equal((await po(105)).sourcePresenceStatus, "PRESENT");
  });

  it("R7. universo vazio com pedidos locais: INCONCLUSIVE, nenhuma ausência", async () => {
    behavior = { kind: "empty" };
    now = new Date(T0.getTime() + 8 * H);
    const result = await run("FULL_RECONCILIATION");
    assert.equal(result.status, "INCONCLUSIVE");
    assert.match(JSON.stringify((await runRow(result.runId)).summaryJson), /EMPTY_UNIVERSE_WITH_LOCAL_RECORDS/);
    assert.equal(await prisma.nomusPurchaseOrder.count({ where: { sourcePresenceStatus: { not: "PRESENT" } } }), 0);
  });

  it("R8. paginação interrompida na página 2 (HTTP 500 persistente): FAILED, sem ausência", async () => {
    env.NOMUS_PO_PAGE_SIZE = "3";
    behavior = { kind: "failOnPage", page: 2, status: 500 };
    now = new Date(T0.getTime() + 9 * H);
    const result = await run("FULL_RECONCILIATION");
    assert.equal(result.status, "FAILED");
    const row = await runRow(result.runId);
    assert.equal(row.pagesRead, 1);
    assert.equal(row.payloadComplete, false);
    assert.equal(await prisma.nomusPurchaseOrder.count({ where: { sourcePresenceStatus: { not: "PRESENT" } } }), 0);
  });

  it("R9. HTTP 429 recuperado pelo cliente real: SUCCESS com o 429 contado", async () => {
    behavior = { kind: "status", status: 429, times: 2, body: '{"tempoAteLiberar":1}' };
    now = new Date(T0.getTime() + 10 * H);
    const result = await run("RECENT_WINDOW");
    assert.equal(result.status, "SUCCESS");
    assert.equal((await runRow(result.runId)).http429Count, 2);
  });

  it("R10. HTTP 429 persistente: FAILED (HTTP_429_UNRECOVERED), sem ausência", async () => {
    behavior = { kind: "status", status: 429, times: 99 };
    now = new Date(T0.getTime() + 11 * H);
    const result = await run("FULL_RECONCILIATION");
    assert.equal(result.status, "FAILED");
    const row = await runRow(result.runId);
    assert.equal(row.http429Count, 3);
    assert.match(JSON.stringify(row.summaryJson), /HTTP_429_UNRECOVERED/);
    assert.equal(await prisma.nomusPurchaseOrder.count({ where: { sourcePresenceStatus: { not: "PRESENT" } } }), 0);
  });

  it("R11. falha de autenticação (401): FAILED na 1ª tentativa, sem retry e sem vazar credencial", async () => {
    behavior = { kind: "status", status: 401, times: 99 };
    captured = [];
    now = new Date(T0.getTime() + 12 * H);
    const result = await run("RECENT_WINDOW");
    assert.equal(result.status, "FAILED");
    assert.equal(httpCalls, 1, "401 não é repetido");
    const row = await runRow(result.runId);
    assert.equal(row.errorMessage, "Falha HTTP 401 no Nomus (pedidoscompra)");
    const everything = JSON.stringify(row) + captured.join("\n");
    assert.doesNotMatch(everything, new RegExp(TOKEN));
  });

  it("R12. falha de banco ao carregar o espelho: run FAILED registrado, presença intocada", async () => {
    const broken = withDelegate("nomusPurchaseOrder", (real) =>
      new Proxy(real, {
        get(d, p) {
          if (p === "findMany") return async () => { throw new Error("connection terminated unexpectedly"); };
          const value = Reflect.get(d, p);
          return typeof value === "function" ? value.bind(d) : value;
        },
      })
    );
    now = new Date(T0.getTime() + 13 * H);
    const result = await run("FULL_RECONCILIATION", { prisma: broken });
    assert.equal(result.status, "FAILED");
    assert.match((await runRow(result.runId)).errorMessage ?? "", /connection terminated/);
    assert.equal(await prisma.nomusPurchaseOrder.count({ where: { sourcePresenceStatus: { not: "PRESENT" } } }), 0);
  });

  it("R13. banco indisponível antes de registrar o run: erro propagado (saída ≠ 0) e lock liberado", async () => {
    const down = withDelegate("nomusSourceSyncRun", () => ({
      create: async () => {
        throw new Error("database is down");
      },
    }));
    await assert.rejects(run("RECENT_WINDOW", { prisma: down }), /database is down/);
    now = new Date(T0.getTime() + 14 * H);
    const next = await run("RECENT_WINDOW");
    assert.equal(next.status, "SUCCESS", "lock de entidade não ficou preso");
  });

  it("R14. 2ª varredura completa confirma o excluído (105) e mantém o histórico", async () => {
    now = new Date(T0.getTime() + 30 * H);
    const first = await run("FULL_RECONCILIATION");
    assert.equal(first.status, "SUCCESS");
    assert.equal((await po(105)).sourcePresenceStatus, "MISSING_CANDIDATE");
    now = new Date(T0.getTime() + 54 * H);
    await run("FULL_RECONCILIATION");
    const row = await po(105);
    assert.equal(row.sourcePresenceStatus, "MISSING_CONFIRMED");
    assert.equal(row.items.length, 1);
    assert.deepEqual(row.presenceEvents.map((e) => e.action), ["MISSING_CANDIDATE", "MISSING_CONFIRMED"]);
    assert.equal(await prisma.nomusPurchaseOrder.count(), 10);
  });
});
