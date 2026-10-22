/**
 * Visão 360° de Comissões — loader, HTTP e prova de imutabilidade.
 *
 * Banco: Prisma SIMULADO em memória (globalThis.prisma antes do import). Toda tabela
 * oficial é congelada (deep freeze) e fotografada antes e depois; qualquer método de
 * escrita (create/update/upsert/delete/$transaction/$executeRaw...) é registrado e falha.
 * Não há PostgreSQL nesta máquina: a validação em base real descartável fica para a
 * homologação (ver docs/commissions/commission-360-view.md).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createCommission360ReadOnlyPrisma } from "./commission360ReadOnlyGuard.js";

const SELLER_A = "11111111-1111-4111-8111-111111111111";
const SELLER_B = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-10-22";
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const personA = { id: SELLER_A, name: "Ana", nomusPersonId: 10, type: "SELLER" };
const personB = { id: SELLER_B, name: "Bruno", nomusPersonId: 20, type: "SELLER" };
const customer = { companyName: "Cliente Alfa Ltda", tradeName: "Cliente Alfa", taxId: "11222333000144", nomusExternalPersonId: 501 };

function schedule(id: string, receivableId: number, nfeId: number, seller: typeof personA, amount: number, nominal: number) {
  return {
    id,
    status: "ACTIVE",
    createdAt: d("2026-09-01"),
    receivableId,
    receivableCode: String(nfeId),
    installmentNumber: 1,
    nfeId,
    salesOrderId: `so-${receivableId}`,
    customerId: "cust-1",
    canonicalSellerId: seller.id,
    receivableNominalAmount: nominal,
    receivableSharePercent: 100,
    scheduledCommissionAmount: amount,
    salesOrder: { orderCode: `PV-${receivableId}`, externalSellerId: seller.nomusPersonId },
    customer,
    canonicalSeller: seller,
    orderSnapshot: {
      status: "ACTIVE",
      saleDate: d("2026-09-01"),
      rawSellerId: seller.nomusPersonId,
      sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
      canonicalSellerName: seller.name,
      customerNameSnapshot: "Cliente Alfa",
    },
  };
}

function ar(externalId: number, nfeId: number, due: string, amount: number) {
  return {
    externalId,
    sourceInvoiceId: nfeId,
    sourceInvoiceNumber: String(nfeId),
    dueDate: d(due),
    settlementDate: null,
    amountReceivable: amount,
    amountReceived: 0,
    balanceReceivable: amount,
    status: false,
    suspendCollection: false,
    sourcePresenceStatus: "PRESENT",
    personName: "Cliente Alfa",
    personCnpj: "11222333000144",
  };
}

/** Base oficial simulada. */
function buildSeed() {
  return {
    commissionReceivableSchedule: [
      schedule("sch-1", 1001, 5001, personA, 30, 1000),
      schedule("sch-3", 3001, 7001, personB, 15, 500),
    ],
    nomusAccountsReceivable: [ar(1001, 5001, "2026-11-10", 1000), ar(2001, 6001, "2026-12-05", 2000), ar(3001, 7001, "2026-11-20", 500)],
    nomusReceivableReceipt: [],
    commissionReceiptCoverage: [
      {
        id: "cov-legacy-1",
        coverageSource: "NOMUS_LEGACY",
        coverageStatus: "COVERED",
        receiptExternalId: 77,
        receivableExternalId: 1001,
        coveredYear: 2026,
        coveredMonth: 8,
        coveredCommissionAmount: 5,
        legacyImportId: "imp-1",
      },
    ],
    commissionPaymentSchedule: [],
    commissionCustomerExclusionRule: [],
    commissionPaymentBatch: [
      {
        id: "batch-a",
        status: "PAID",
        paymentDate: d("2026-10-15"),
        periodStart: d("2026-10-01"),
        periodEnd: d("2026-10-31"),
        commissionPersonId: SELLER_A,
        totalPaid: 100,
        commissionPerson: personA,
        items: [{ id: "bi-1", status: "PAID", amountPaid: 100, commissionPaymentSchedule: null }],
      },
    ],
    commissionReceiptLedgerLine: [
      {
        id: "ll-1",
        closingId: "closing-10",
        year: 2026,
        month: 10,
        canonicalSellerId: SELLER_A,
        canonicalSellerName: "Ana",
        rawSellerId: 10,
        rawSellerName: "ANA",
        releasedCommissionAmount: 150,
        closing: { status: "CLOSED" },
        canonicalSeller: personA,
      },
    ],
    salesOrderItemFlowSnapshot: [
      {
        salesOrderId: "so-9",
        salesOrderItemId: "it-1",
        orderedQuantity: 10,
        shipTargetQuantity: 10,
        invoicedQuantity: 4,
        isActiveForKanban: true,
        progressInvoiced: 40,
        salesOrder: { status: "SENT_TO_NOMUS", externalSellerId: 10 },
      },
      {
        // Item já 100% faturado do mesmo pedido: entra na comissão total, não no potencial.
        salesOrderId: "so-9",
        salesOrderItemId: "it-2",
        orderedQuantity: 5,
        shipTargetQuantity: 5,
        invoicedQuantity: 5,
        isActiveForKanban: true,
        progressInvoiced: 100,
        salesOrder: { status: "SENT_TO_NOMUS", externalSellerId: 10 },
      },
    ],
    salesOrder: [{ id: "so-9", orderCode: "PV-009", status: "SENT_TO_NOMUS", externalSellerId: 10, issueDate: d("2026-10-01") }],
    commissionOrderSnapshot: [
      {
        id: "snap-9",
        status: "ACTIVE",
        salesOrderId: "so-9",
        nfeId: null,
        sourceHash: "h9",
        createdAt: d("2026-10-01"),
        saleDate: d("2026-10-01"),
        customerId: "cust-1",
        customerNameSnapshot: "Cliente Alfa",
        totalFinalCommissionAmount: 50,
        canonicalSellerId: SELLER_A,
        canonicalSellerName: "Ana",
        rawSellerId: 10,
        sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
        customer: { taxId: customer.taxId, nomusExternalPersonId: 501 },
        items: [
          { salesOrderItemId: "it-1", finalCommissionAmount: 50, status: "COMMISSIONABLE", productNameSnapshot: "Produto 1" },
          { salesOrderItemId: "it-2", finalCommissionAmount: 20, status: "COMMISSIONABLE", productNameSnapshot: "Produto 2" },
        ],
      },
      {
        id: "snap-2",
        status: "ACTIVE",
        salesOrderId: "so-2001",
        nfeId: 6001,
        sourceHash: "h2",
        createdAt: d("2026-09-15"),
        saleDate: d("2026-09-15"),
        customerId: "cust-1",
        customerNameSnapshot: "Cliente Alfa",
        totalFinalCommissionAmount: 60,
        canonicalSellerId: SELLER_A,
        canonicalSellerName: "Ana",
        rawSellerId: 10,
        sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
        customer: { taxId: customer.taxId, nomusExternalPersonId: 501 },
        items: [{ status: "COMMISSIONABLE" }],
      },
    ],
    salesOrderNfeLink: [
      { nfeExternalId: 5001, salesOrderId: "so-1001", SalesOrder: { orderCode: "PV-1001", status: "SENT_TO_NOMUS", externalSellerId: 10 } },
      { nfeExternalId: 6001, salesOrderId: "so-2001", SalesOrder: { orderCode: "PV-2001", status: "SENT_TO_NOMUS", externalSellerId: 10 } },
      { nfeExternalId: 7001, salesOrderId: "so-3001", SalesOrder: { orderCode: "PV-3001", status: "SENT_TO_NOMUS", externalSellerId: 20 } },
    ],
  } as Record<string, Array<Record<string, unknown>>>;
}

// ---------------------------------------------------------------------------
// Prisma simulado (somente leitura)
// ---------------------------------------------------------------------------

type Call = { model: string; method: string; args: unknown };

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function cmp(a: unknown): unknown {
  return a instanceof Date ? a.getTime() : a;
}

const OPS = new Set(["in", "notIn", "not", "gte", "gt", "lte", "lt", "contains", "mode", "equals", "some"]);

function matchValue(value: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== "object" || cond instanceof Date) return cmp(value) === cmp(cond);
  const entries = Object.entries(cond as Record<string, unknown>);
  if (entries.length > 0 && entries.every(([key]) => OPS.has(key))) {
    for (const [op, arg] of entries) {
      if (op === "in" && !(arg as unknown[]).some((item) => cmp(item) === cmp(value))) return false;
      if (op === "notIn" && (arg as unknown[]).some((item) => cmp(item) === cmp(value))) return false;
      if (op === "not" && (arg !== null && typeof arg === "object" ? matchValue(value, arg) : cmp(value) === cmp(arg))) return false;
      if (op === "equals" && cmp(value) !== cmp(arg)) return false;
      if (op === "gte" && !((cmp(value) as number) >= (cmp(arg) as number))) return false;
      if (op === "gt" && !((cmp(value) as number) > (cmp(arg) as number))) return false;
      if (op === "lte" && !((cmp(value) as number) <= (cmp(arg) as number))) return false;
      if (op === "lt" && !((cmp(value) as number) < (cmp(arg) as number))) return false;
      if (op === "contains" && !String(value ?? "").toLowerCase().includes(String(arg).toLowerCase())) return false;
      if (op === "some" && !(Array.isArray(value) && value.some((item) => matchWhere(item, arg)))) return false;
    }
    return true;
  }
  // Filtro de relação: exige a relação presente na linha simulada.
  if (value == null || typeof value !== "object") return false;
  return matchWhere(value, cond);
}

function matchWhere(row: unknown, where: unknown): boolean {
  if (!where || typeof where !== "object") return true;
  for (const [key, cond] of Object.entries(where as Record<string, unknown>)) {
    if (cond === undefined) continue;
    if (key === "AND") {
      if (!(Array.isArray(cond) ? cond : [cond]).every((part) => matchWhere(row, part))) return false;
    } else if (key === "OR") {
      if (!(cond as unknown[]).some((part) => matchWhere(row, part))) return false;
    } else if (key === "NOT") {
      if ((Array.isArray(cond) ? cond : [cond]).some((part) => matchWhere(row, part))) return false;
    } else if (!matchValue((row as Record<string, unknown>)[key], cond)) {
      return false;
    }
  }
  return true;
}

const READ_METHODS = new Set(["findMany", "findFirst", "findUnique", "findFirstOrThrow", "findUniqueOrThrow", "count", "aggregate", "groupBy"]);

function createReadOnlyPrisma(seed: Record<string, Array<Record<string, unknown>>>) {
  const calls: Call[] = [];
  const writes: Call[] = [];
  const delegate = (model: string) =>
    new Proxy(
      {},
      {
        get(_target, method: string) {
          return async (args: { where?: unknown } = {}) => {
            const call = { model, method, args };
            if (!READ_METHODS.has(method)) {
              writes.push(call);
              throw new Error(`ESCRITA PROIBIDA na Visão 360°: ${model}.${method}`);
            }
            calls.push(call);
            const rows = (seed[model] ?? []).filter((row) => matchWhere(row, args.where));
            if (method === "count") return rows.length;
            if (method.startsWith("find") && method !== "findMany") return rows[0] ?? null;
            return rows;
          };
        },
      }
    );
  const client = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "then") return undefined;
        if (prop.startsWith("$")) {
          return async (...args: unknown[]) => {
            writes.push({ model: "$client", method: prop, args });
            throw new Error(`OPERAÇÃO PROIBIDA na Visão 360°: ${prop}`);
          };
        }
        return delegate(prop);
      },
    }
  );
  return { client, calls, writes };
}

const seed = deepFreeze(buildSeed());
const fingerprintBefore = JSON.stringify(seed);
const fake = createReadOnlyPrisma(seed);
// Mesma trava do script de auditoria por cima do banco simulado: os loaders reais rodam através dela.
const guard = createCommission360ReadOnlyPrisma(fake.client);
(globalThis as unknown as { prisma: unknown }).prisma = guard.client;

type ServerModule = typeof import("./commission360View.server.js");
let server: ServerModule;

const globalScope = {
  dataScope: "global" as const,
  sellerLocked: false,
  nomusSellerId: null,
  sellerResponsibleName: null,
  blockedReason: null,
  blockedMessage: null,
};
const ownScopeA = { ...globalScope, dataScope: "own" as const, sellerLocked: true, nomusSellerId: 10 };

before(async () => {
  server = await import("./commission360View.server.js");
});

describe("Visão 360° — loader com Prisma simulado", () => {
  it("monta os indicadores a partir das fontes oficiais (visão global)", async () => {
    const payload = await server.getCommission360View({ from: "2026-01", to: "2026-12" }, globalScope, TODAY);
    assert.equal(payload.cards.forecastOnReceivables, 45);
    assert.equal(payload.cards.paidConfirmed, 100);
    assert.equal(payload.cards.legacyUnconfirmed, 5);
    assert.equal(payload.cards.releasedNotPaid, 50);
    assert.equal(payload.cards.potentialOnOrders, 30);
    assert.equal(payload.cards.uncoveredReceivablesCount, 1);
    assert.equal(payload.cards.uncoveredReceivablesBalance, 2000);
    const total = payload.diagnostic.at(-1)!;
    assert.equal(total.crCount, 3);
    assert.equal(total.openBalance, 3500);
    assert.equal(total.coveredBalance, 1500);
    assert.equal(total.potentialUncoveredCommission, 60);
    const statuses = Object.fromEntries(payload.detail.receivables!.map((row) => [row.receivableId, row.status]));
    assert.deepEqual(statuses, { 1001: "COBERTO_FUTURA", 2001: "SEM_SCHEDULE", 3001: "COBERTO_FUTURA" });
  });

  it("potencial do pedido: comissão total inclui itens já faturados; só a parte não faturada é potencial", async () => {
    const payload = await server.getCommission360View({ from: "2026-01", to: "2026-12", section: "potential" }, globalScope, TODAY);
    const row = payload.detail.potential!.find((item) => item.salesOrderId === "so-9")!;
    assert.equal(row.totalCommission, 70);
    assert.equal(row.invoicedCommission, 40);
    assert.equal(row.pendingCommission, 30);
    assert.equal(payload.cards.potentialOnOrders, 30);
  });

  it("a população da conciliação parte dos CRs, não dos schedules", async () => {
    await server.getCommission360View({ from: "2026-11", to: "2026-12" }, globalScope, TODAY);
    const arCall = fake.calls.find(
      (call) => call.model === "nomusAccountsReceivable" && (call.args as { where: { dueDate?: unknown } }).where.dueDate
    );
    assert.ok(arCall, "carrega os títulos pela data de vencimento");
  });

  it("T20: escopo próprio restringe todas as consultas ao vendedor do usuário", async () => {
    fake.calls.length = 0;
    const payload = await server.getCommission360View({ from: "2026-01", to: "2026-12", sellerId: SELLER_B }, ownScopeA, TODAY);
    assert.equal(payload.sellerLocked, true);
    assert.equal(payload.filters.canonicalSellerId, null);
    assert.equal(payload.cards.forecastOnReceivables, 30);
    assert.deepEqual(
      payload.detail.receivables!.map((row) => row.receivableId).sort(),
      [1001, 2001]
    );
    assert.ok(payload.bySeller.every((row) => row.sellerName !== "Bruno"));
    const where = (model: string) =>
      fake.calls.filter((call) => call.model === model).map((call) => JSON.stringify((call.args as { where: unknown }).where));
    assert.ok(where("commissionPaymentBatch").every((w) => w.includes('"nomusPersonId":10')));
    assert.ok(where("commissionReceiptLedgerLine").every((w) => w.includes('"rawSellerId":10')));
    assert.ok(where("salesOrderItemFlowSnapshot").every((w) => w.includes('"externalSellerId":10')));
    assert.ok(where("commissionReceivableSchedule")[0]!.includes('"rawSellerId":10'));
  });

  it("vendedor sem vínculo Nomus não recebe nenhum dado", async () => {
    const payload = await server.getCommission360View({}, { ...ownScopeA, nomusSellerId: null }, TODAY);
    assert.equal(payload.cards.forecastOnReceivables, 0);
    assert.equal(payload.cards.paidConfirmed, 0);
    assert.equal(payload.cards.potentialOnOrders, 0);
    assert.equal(payload.detail.totalRows, 0);
  });

  it("exportação CSV da conciliação usa as mesmas classificações", async () => {
    const { csv, filename } = await server.exportCommission360ReceivablesCsv({ from: "2026-11", to: "2026-12" }, globalScope, TODAY);
    assert.match(filename, /^comissoes-visao-360-conciliacao-2026-11-a-2026-12\.csv$/);
    assert.match(csv, /2001;6001;2026-12-05;.*Sem schedule válido/);
  });

  it("T21: nenhuma consulta escreve nem altera a base oficial", async () => {
    await server.getCommission360View({ from: "2026-01", to: "2026-12", section: "paid" }, globalScope, TODAY);
    await server.getCommission360View({ from: "2026-01", to: "2026-12", section: "potential" }, ownScopeA, TODAY);
    await server.exportCommission360ReceivablesCsv({}, globalScope, TODAY);
    assert.deepEqual(fake.writes, []);
    assert.deepEqual(guard.blocked, [], "a trava do script não bloqueou nada: os loaders só leem");
    assert.ok(guard.reads.size > 0);
    assert.ok(fake.calls.every((call) => READ_METHODS.has(call.method)));
    assert.equal(JSON.stringify(seed), fingerprintBefore, "snapshots, schedules, recebimentos, coberturas, fechamentos e pagamentos idênticos");
  });
});

describe("Visão 360° — HTTP", () => {
  let baseUrl = "";
  let close: () => Promise<void> = async () => {};
  let currentUser: Record<string, unknown> | null = null;
  let resourceAllowed = true;

  before(async () => {
    const express = (await import("express")).default;
    const { registerCommissionsRoutes } = await import("../commissionsRoutes.js");
    const app = express();
    registerCommissionsRoutes(app, {
      requireAppAuth: ((_req: unknown, _res: unknown, next: () => void) => next()) as never,
      requireResource: (() =>
        ((_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void) =>
          resourceAllowed ? next() : res.status(403).json({ error: "FORBIDDEN_RESOURCE" }))) as never,
      getCurrentAppUser: (async () => currentUser) as never,
    });
    const httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => httpServer.close(() => resolve()));
  });

  after(async () => close());

  const user = (partial: Record<string, unknown>) => ({
    id: "u1",
    name: "Teste",
    email: "t@test.com",
    role: "VIEWER",
    permissions: [],
    effectivePermissions: [],
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    sessionId: "s1",
    ...partial,
  });

  it("GET /api/commissions/visao-360 devolve o payload para o administrador", async () => {
    currentUser = user({ role: "ADMIN" });
    resourceAllowed = true;
    const res = await fetch(`${baseUrl}/api/commissions/visao-360?from=2026-01&to=2026-12`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { title: string; cards: { forecastOnReceivables: number } };
    assert.equal(body.title, "Visão 360° de Comissões");
    assert.equal(body.cards.forecastOnReceivables, 45);
  });

  it("T20 (HTTP): vendedor só vê o próprio escopo, mesmo pedindo outro vendedor", async () => {
    currentUser = user({ role: "SELLER", externalSellerId: 10 });
    const res = await fetch(`${baseUrl}/api/commissions/visao-360?sellerId=${SELLER_B}&from=2026-01&to=2026-12`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { sellerLocked: boolean; cards: { forecastOnReceivables: number } };
    assert.equal(body.sellerLocked, true);
    assert.equal(body.cards.forecastOnReceivables, 30);
  });

  it("sem escopo de comissão, sem recurso ou sem sessão: bloqueado", async () => {
    currentUser = user({ role: "VIEWER" });
    assert.equal((await fetch(`${baseUrl}/api/commissions/visao-360`)).status, 403);
    currentUser = user({ role: "SELLER" });
    assert.equal((await fetch(`${baseUrl}/api/commissions/visao-360`)).status, 403);
    currentUser = null;
    assert.equal((await fetch(`${baseUrl}/api/commissions/visao-360`)).status, 401);
    currentUser = user({ role: "ADMIN" });
    resourceAllowed = false;
    assert.equal((await fetch(`${baseUrl}/api/commissions/visao-360`)).status, 403);
    resourceAllowed = true;
  });

  it("entrada inválida vira 400 e não há rota de escrita", async () => {
    currentUser = user({ role: "ADMIN" });
    assert.equal((await fetch(`${baseUrl}/api/commissions/visao-360?from=2026-99`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/commissions/visao-360`, { method: "POST" })).status, 404);
    const csv = await fetch(`${baseUrl}/api/commissions/visao-360/conciliacao.csv?from=2026-11&to=2026-12`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
    assert.deepEqual(fake.writes, []);
  });
});

describe("Visão 360° — T26: o motor oficial não é alterado nem chamado para escrever", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  const files = [
    "src/lib/commissions/commission360View.ts",
    "src/lib/commissions/commission360View.server.ts",
    "src/lib/commissions/commission360View.shared.ts",
    "src/lib/commissions/commission360ReadOnlyGuard.ts",
    "src/lib/commissions/commissionR1Audit.ts",
    "src/lib/commissions/commissionR1Audit.server.ts",
    "scripts/auditCommission360CrReconciliation.ts",
    "scripts/auditCommissionR1Duplication.ts",
    "src/components/commissions/pages/Commissions360ViewPage.tsx",
  ];

  it("nenhuma operação de escrita no código novo", () => {
    for (const file of files) {
      // Comentários fora. No módulo da trava, a transação READ ONLY e as três instruções de
      // conferência são verificadas literalmente em commission360ReadOnlyGuard.test.ts; o hash
      // SHA-256 dos fontes (node:crypto) não é Prisma.
      const source = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/createHash\("sha256"\)\.update\(/g, "")
        .replace(/base\.\$transaction\(/g, "")
        .replace(/\$executeRawUnsafe\("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"\)/g, "")
        .replace(/\$queryRawUnsafe\(SESSION_SQL,/g, "")
        .replace(/\$queryRawUnsafe\(\s*"SELECT current_setting\('transaction_read_only'\)[^"]*"/g, "")
        .replace(/\$executeRawUnsafe: \(sql: string\) => Promise<unknown>/g, "")
        .replace(/\$queryRawUnsafe: \(sql: string, \.\.\.params: unknown\[\]\) => Promise<unknown>/g, "")
        .replace(/\$transaction: \(fn:/g, "");
      assert.doesNotMatch(source, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/, file);
      assert.doesNotMatch(source, /\$(transaction|executeRaw|executeRawUnsafe|queryRaw|queryRawUnsafe)\s*[(<`]/, file);
      assert.doesNotMatch(source, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/, file);
    }
  });

  it("não importa módulos que gravam comissão (materialização, scheduler, fechamento, pagamento, reprocesso)", () => {
    const forbidden = [
      "commissionOrderMaterializer.server",
      "commissionMaterializationOrchestrator",
      "commissionMaterializationAfterNomusSync",
      "commissionReceivableScheduler.server",
      "commissionReceiptClosing.server",
      "commissionReceiptClosingApi.server",
      "commissionReceiptCoverage.server",
      "commissionReceiptEngine",
      "commissionLegacyCoverageImport.server",
      "commission-payment-service",
      "commission-calculation-service",
      "commissionReprocess",
      "commissionCustomerExclusionReprocess",
      "commissionPersonResolution",
      "commissionPersons.server",
      "commissionAudit.server",
    ];
    for (const file of files) {
      const imports = [...read(file).matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]!);
      for (const target of imports) {
        assert.ok(!forbidden.some((name) => target.includes(name)), `${file} importa ${target}`);
      }
    }
  });

  it("nenhum módulo oficial de comissão importa a Visão 360°, a trava ou a auditoria R1 (o motor não depende delas)", () => {
    const dir = join(process.cwd(), "src/lib/commissions");
    const ours = /^(commission360View|commission360ReadOnlyGuard|commissionR1Audit)/;
    const offenders = readdirSync(dir)
      .filter((name) => /\.(ts|tsx)$/.test(name) && !name.includes(".test.") && !ours.test(name))
      .filter((name) => /from\s+["'][^"']*(commission360View|commission360ReadOnlyGuard|commissionR1Audit)/.test(readFileSync(join(dir, name), "utf8")));
    assert.deepEqual(offenders, []);
  });

  it("as rotas da Visão 360° são só GET e usam o mesmo guard da Previsão", () => {
    const routes = read("src/lib/commissionsRoutes.ts");
    assert.doesNotMatch(routes, /app\.(post|put|patch|delete)\(\s*["']\/api\/commissions\/visao-360/);
    assert.match(routes, /app\.get\("\/api\/commissions\/visao-360", \.\.\.reportsGuard/);
    assert.match(routes, /app\.get\("\/api\/commissions\/visao-360\/conciliacao\.csv", \.\.\.reportsGuard/);
  });
});
