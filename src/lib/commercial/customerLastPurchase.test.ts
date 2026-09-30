/**
 * "Última compra" do grid de Clientes = mesma verdade da rotina de 90 dias.
 * Os cenários abaixo passam pelo MESMO carregador (`loadLastValidInvoices`) e
 * comparam o resultado do grid com a decisão do motor de inatividade.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CUSTOMER_LAST_PURCHASE_NEVER_LABEL,
  CUSTOMER_LAST_PURCHASE_UNKNOWN_LABEL,
  customerLastPurchaseFromInvoice,
  formatCustomerLastPurchaseDay,
  formatCustomerLastPurchaseMonth,
} from "./customerLastPurchase.js";
import { attachCustomerLastPurchase } from "./customerLastPurchase.server.js";
import { loadLastValidInvoices } from "./customerCommercialOwnerInactivity.server.js";
import {
  decideCommercialOwnerInactivityAction,
  evaluateCommercialPortfolioPreservation,
  isPortfolioReviewDue,
} from "./customerCommercialOwnerInactivity.js";

const ROOT = path.join(import.meta.dirname, "..", "..", "..");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const spNoon = (iso: string) => new Date(`${iso}T15:00:00.000Z`);

type Seed = {
  orders?: Array<{ id: string; customerId: string; orderCode: string; issueDate: Date; status: string }>;
  nfeLinks?: Array<{ salesOrderId: string; nfeExternalId: number; nfeNumber: string | null; nfeStatus: number | null; dataProcessamento: Date | null; nomusNfeId?: string | null }>;
  nfes?: Array<{ id: string; externalId: number; numero: string | null; status: number | null; xmlDhEmi: Date | null; dataProcessamento: Date | null; xmlCancelamento: string | null }>;
  stockDocuments?: Array<{ id: string; idNfe: number | null; isCancelled: boolean; statusRaw: string | null; tipoDocumentoEstoque: string | null; dataDocumento: Date | null }>;
};

/** Prisma falso que conta consultas: cada findMany é UMA consulta, qualquer que seja o número de ids. */
function fakePrisma(seed: Seed) {
  const queries: string[] = [];
  const prisma = {
    salesOrder: {
      findMany: async ({ where }: { where: { customerId: { in: string[] } } }) => {
        queries.push("salesOrder");
        return (seed.orders ?? []).filter((row) => where.customerId.in.includes(row.customerId));
      },
    },
    salesOrderNfeLink: {
      findMany: async ({ where }: { where: { salesOrderId: { in: string[] } } }) => {
        queries.push("salesOrderNfeLink");
        return (seed.nfeLinks ?? []).filter((row) => where.salesOrderId.in.includes(row.salesOrderId));
      },
    },
    nomusNfe: {
      findMany: async ({ where }: { where: { externalId: { in: number[] } } }) => {
        queries.push("nomusNfe");
        return (seed.nfes ?? []).filter((row) => where.externalId.in.includes(row.externalId));
      },
    },
    nomusStockDocument: {
      findMany: async ({ where }: { where: { idNfe: { in: number[] } } }) => {
        queries.push("nomusStockDocument");
        return (seed.stockDocuments ?? []).filter((row) => row.idNfe != null && where.idNfe.in.includes(row.idNfe));
      },
    },
  };
  return { prisma: prisma as never, queries };
}

/** Pedido faturado com NF autorizada (e DS válido) numa data. */
function invoiced(customerId: string, orderId: string, iso: string, nfe: number, extra: Partial<Seed["nfes"] extends Array<infer R> | undefined ? R : never> = {}, stock: Partial<NonNullable<Seed["stockDocuments"]>[number]> | null = {}): Seed {
  const at = spNoon(iso);
  return {
    orders: [{ id: orderId, customerId, orderCode: `PD ${orderId}`, issueDate: at, status: "SENT_TO_NOMUS" }],
    nfeLinks: [{ salesOrderId: orderId, nfeExternalId: nfe, nfeNumber: String(nfe), nfeStatus: 4, dataProcessamento: at, nomusNfeId: `nfe-${nfe}` }],
    nfes: [{ id: `nfe-${nfe}`, externalId: nfe, numero: String(nfe), status: 4, xmlDhEmi: at, dataProcessamento: at, xmlCancelamento: null, ...extra }],
    stockDocuments: stock === null ? [] : [{ id: `st-${nfe}`, idNfe: nfe, isCancelled: false, statusRaw: "emitido", tipoDocumentoEstoque: "saida", dataDocumento: at, ...stock }],
  };
}

function merge(...seeds: Seed[]): Seed {
  return {
    orders: seeds.flatMap((seed) => seed.orders ?? []),
    nfeLinks: seeds.flatMap((seed) => seed.nfeLinks ?? []),
    nfes: seeds.flatMap((seed) => seed.nfes ?? []),
    stockDocuments: seeds.flatMap((seed) => seed.stockDocuments ?? []),
  };
}

async function gridRow(seed: Seed, customerId = A) {
  const { prisma, queries } = fakePrisma(seed);
  const [row] = await attachCustomerLastPurchase(prisma, [{ id: customerId }]);
  return { row: row!, queries };
}

/** O que a rotina de 90 dias usa para o mesmo cliente, pelo mesmo carregador. */
async function routineInvoice(seed: Seed, customerId = A) {
  const { prisma } = fakePrisma(seed);
  return (await loadLastValidInvoices(prisma, [customerId])).get(customerId) ?? null;
}

describe("Última compra × rotina de 90 dias — mesmo carregador, mesma data", () => {
  it("1. NF válida recente → MM/AAAA da NF", async () => {
    const seed = invoiced(A, "o1", "2026-08-20", 100);
    const { row } = await gridRow(seed);
    assert.equal(row.lastPurchaseStatus, "VALID");
    assert.equal(row.lastPurchaseAt, (await routineInvoice(seed))?.invoiceDate?.toISOString());
    assert.equal(formatCustomerLastPurchaseMonth(row), "08/2026");
  });

  it("2. várias NFs válidas → a mais recente", async () => {
    const seed = merge(invoiced(A, "o1", "2026-03-10", 100), invoiced(A, "o2", "2026-06-25", 101), invoiced(A, "o3", "2026-05-02", 102));
    const { row } = await gridRow(seed);
    assert.equal(formatCustomerLastPurchaseMonth(row), "06/2026");
    assert.equal(row.lastPurchaseAt, (await routineInvoice(seed))?.invoiceDate?.toISOString());
  });

  it("3. NF mais recente cancelada → vale a NF válida antiga", async () => {
    const seed = merge(
      invoiced(A, "o1", "2026-05-22", 100),
      invoiced(A, "o2", "2026-09-10", 101, { status: 6, xmlCancelamento: "<canc/>" }, { isCancelled: true, statusRaw: "cancelado" })
    );
    const { row } = await gridRow(seed);
    assert.equal(formatCustomerLastPurchaseMonth(row), "05/2026");
    assert.equal(row.lastPurchaseAt, (await routineInvoice(seed))?.invoiceDate?.toISOString());
  });

  it("4. PV mais recente sem NF → não conta (05/2026, não 09/2026)", async () => {
    const seed = merge(invoiced(A, "o1", "2026-05-22", 100), {
      orders: [{ id: "o2", customerId: A, orderCode: "PD o2", issueDate: spNoon("2026-09-15"), status: "SENT_TO_NOMUS" }],
    });
    const { row } = await gridRow(seed);
    assert.equal(formatCustomerLastPurchaseMonth(row), "05/2026");
    assert.equal(row.lastPurchaseAt, (await routineInvoice(seed))?.invoiceDate?.toISOString());
  });

  it("5. faturamento parcial válido conta (a NF parcial mais recente reinicia)", async () => {
    const seed = merge(invoiced(A, "o1", "2026-04-01", 100), invoiced(A, "o1", "2026-08-01", 101));
    const { row } = await gridRow(seed);
    assert.equal(formatCustomerLastPurchaseMonth(row), "08/2026");
    assert.equal((await routineInvoice(seed))?.invoiceNumber, "101");
  });

  it("6. NF sem data própria → data do Documento de Saída válido (STOCK_DOCUMENT_DATE)", async () => {
    const seed = invoiced(A, "o1", "2026-07-03", 100, { xmlDhEmi: null, dataProcessamento: null });
    seed.nfeLinks![0]!.dataProcessamento = null;
    const { row } = await gridRow(seed);
    assert.equal(formatCustomerLastPurchaseMonth(row), "07/2026");
    const routine = await routineInvoice(seed);
    assert.equal(routine?.invoiceDateSource, "STOCK_DOCUMENT_DATE");
    assert.equal(row.lastPurchaseAt, routine?.invoiceDate?.toISOString());
  });

  it("7. NF sem data própria e DS cancelado → sem data utilizável (DATA_ANOMALY → “—”), como a rotina", async () => {
    const seed = invoiced(A, "o1", "2026-07-03", 100, { xmlDhEmi: null, dataProcessamento: null }, { isCancelled: true, statusRaw: "cancelado" });
    seed.nfeLinks![0]!.dataProcessamento = null;
    const { row } = await gridRow(seed);
    assert.equal(row.lastPurchaseStatus, "DATA_ANOMALY");
    assert.equal(row.lastPurchaseAt, null);
    assert.equal(formatCustomerLastPurchaseMonth(row), CUSTOMER_LAST_PURCHASE_UNKNOWN_LABEL);
    const routine = await routineInvoice(seed);
    assert.equal(routine?.invoiceDate, null);
    assert.equal(routine?.invoiceDateSource, "MISSING");
  });

  it("8. devolução/transferência: o DS não conta; a NF autorizada com data própria continua contando (regra existente)", async () => {
    const withReturn = invoiced(A, "o1", "2026-06-10", 100, {}, { tipoDocumentoEstoque: "devolucao" });
    assert.equal(formatCustomerLastPurchaseMonth((await gridRow(withReturn)).row), "06/2026");
    assert.equal((await routineInvoice(withReturn))?.stockDocumentId, null);
    // Sem data própria, um DS de transferência não empresta a data: vira anomalia, como na rotina.
    const transferOnlyDate = invoiced(A, "o1", "2026-06-10", 100, { xmlDhEmi: null, dataProcessamento: null }, { tipoDocumentoEstoque: "transferencia" });
    transferOnlyDate.nfeLinks![0]!.dataProcessamento = null;
    const { row } = await gridRow(transferOnlyDate);
    assert.equal(row.lastPurchaseStatus, "DATA_ANOMALY");
    assert.equal((await routineInvoice(transferOnlyDate))?.invoiceDate, null);
  });

  it("9. cliente nunca faturado → NEVER_INVOICED → “Nunca” (PV sem NF não muda isso)", async () => {
    const seed: Seed = { orders: [{ id: "o1", customerId: A, orderCode: "PD o1", issueDate: spNoon("2026-09-15"), status: "SENT_TO_NOMUS" }] };
    const { row } = await gridRow(seed);
    assert.equal(row.lastPurchaseStatus, "NEVER_INVOICED");
    assert.equal(row.lastPurchaseAt, null);
    assert.equal(formatCustomerLastPurchaseMonth(row), CUSTOMER_LAST_PURCHASE_NEVER_LABEL);
    assert.equal(await routineInvoice(seed), null);
    const decision = decideCommercialOwnerInactivityAction({
      hasActiveOwner: true,
      lastValidInvoice: null,
      referenceDate: spNoon("2026-09-30"),
      preservation: evaluateCommercialPortfolioPreservation({ referenceDate: spNoon("2026-09-30"), lastApprovedIssueDate: null, proposals: [], contacts: [] }),
    });
    assert.equal(decision.status, "NEVER_INVOICED");
  });

  it("10. data inválida/anômala nunca vira MM/AAAA inventado", () => {
    assert.equal(formatCustomerLastPurchaseMonth({ lastPurchaseAt: "não-é-data", lastPurchaseStatus: "VALID" }), CUSTOMER_LAST_PURCHASE_UNKNOWN_LABEL);
    assert.equal(formatCustomerLastPurchaseMonth({ lastPurchaseAt: null, lastPurchaseStatus: "DATA_ANOMALY" }), CUSTOMER_LAST_PURCHASE_UNKNOWN_LABEL);
    assert.deepEqual(customerLastPurchaseFromInvoice({ invoiceDate: null }), { lastPurchaseAt: null, lastPurchaseStatus: "DATA_ANOMALY" });
    assert.deepEqual(customerLastPurchaseFromInvoice(null), { lastPurchaseAt: null, lastPurchaseStatus: "NEVER_INVOICED" });
    assert.equal(formatCustomerLastPurchaseDay(null), null);
  });

  for (const [days, reference, due] of [
    [89, "2026-08-29", false],
    [90, "2026-08-30", true],
    [91, "2026-08-31", true],
  ] as const) {
    it(`${days} dias: a data do grid é exatamente a data que a rotina usa (revisão ${due ? "devida" : "não devida"})`, async () => {
      const seed = invoiced(A, "o1", "2026-06-01", 100);
      const { row } = await gridRow(seed);
      const routine = await routineInvoice(seed);
      assert.ok(routine?.invoiceDate);
      assert.equal(row.lastPurchaseAt, routine.invoiceDate!.toISOString());
      assert.equal(formatCustomerLastPurchaseMonth(row), "06/2026");
      assert.equal(isPortfolioReviewDue({ lastValidInvoiceDate: new Date(row.lastPurchaseAt!), referenceDate: spNoon(reference) }), due);
    });
  }
});

describe("competência MM/AAAA no calendário de Brasília", () => {
  it("meia-noite de 01/08 em Brasília (03:00Z) é agosto, não julho; 23:30 de 31/07 é julho", () => {
    assert.equal(formatCustomerLastPurchaseMonth({ lastPurchaseAt: "2026-08-01T03:00:00.000Z", lastPurchaseStatus: "VALID" }), "08/2026");
    assert.equal(formatCustomerLastPurchaseMonth({ lastPurchaseAt: "2026-08-01T02:30:00.000Z", lastPurchaseStatus: "VALID" }), "07/2026");
    assert.equal(formatCustomerLastPurchaseMonth({ lastPurchaseAt: "2025-12-15T12:00:00.000Z", lastPurchaseStatus: "VALID" }), "12/2025");
    assert.equal(formatCustomerLastPurchaseDay("2026-08-25T15:00:00.000Z"), "25/08/2026");
  });
});

describe("listagem: lote, paginação e independência do responsável", () => {
  it("resolve a página inteira em 4 consultas, sem N+1, e devolve o campo para todos", async () => {
    const seed = merge(invoiced(A, "o1", "2026-08-20", 100), invoiced(B, "o2", "2026-05-22", 101));
    const { prisma, queries } = fakePrisma(seed);
    const page = Array.from({ length: 20 }, (_, index) => ({ id: index === 0 ? A : index === 1 ? B : index === 2 ? C : `id-${index}` }));
    const rows = await attachCustomerLastPurchase(prisma, page);
    assert.equal(rows.length, 20);
    assert.deepEqual(queries, ["salesOrder", "salesOrderNfeLink", "nomusNfe", "nomusStockDocument"]);
    assert.equal(formatCustomerLastPurchaseMonth(rows[0]!), "08/2026");
    assert.equal(formatCustomerLastPurchaseMonth(rows[1]!), "05/2026");
    assert.equal(rows[2]!.lastPurchaseStatus, "NEVER_INVOICED");
    assert.ok(rows.every((row) => "lastPurchaseAt" in row && "lastPurchaseStatus" in row));
    // Página vazia não consulta nada.
    const empty = fakePrisma(seed);
    assert.deepEqual(await attachCustomerLastPurchase(empty.prisma, []), []);
    assert.deepEqual(empty.queries, []);
  });

  it("cliente sem pedidos gera uma única consulta e sai como Nunca", async () => {
    const { prisma, queries } = fakePrisma({});
    const [row] = await attachCustomerLastPurchase(prisma, [{ id: C }]);
    assert.deepEqual(queries, ["salesOrder"]);
    assert.equal(row!.lastPurchaseStatus, "NEVER_INVOICED");
  });

  it("a última compra não depende do responsável: cliente removido da carteira mantém sua compra histórica", async () => {
    // O carregador só olha PV → NF → DS; nada de owner, vendedor, CR ou proposta.
    const { prisma, queries } = fakePrisma(invoiced(A, "o1", "2026-04-18", 100));
    const [row] = await attachCustomerLastPurchase(prisma, [{ id: A, commercialOwnerName: null }]);
    assert.equal(row!.commercialOwnerName, null);
    assert.equal(formatCustomerLastPurchaseMonth(row!), "04/2026");
    assert.ok(!queries.some((name) => /owner|receivable|proposal|activity/i.test(name)));
    const source = readFileSync(path.join(ROOT, "src/lib/commercial/customerLastPurchase.server.ts"), "utf8");
    assert.match(source, /loadLastValidInvoices\(/);
    assert.doesNotMatch(source, /crmCustomerCommercialOwner|accountsReceivable|issueDate|SENT_TO_NOMUS|for\s*\(/);
  });
});

describe("prova arquitetural: uma única fonte para grid, export e rotina", () => {
  it("grid e export chamam attachCustomerLastPurchase → loadLastValidInvoices (o mesmo da rotina); nenhum reimplementa a regra fiscal", () => {
    const server = readFileSync(path.join(ROOT, "server.ts"), "utf8");
    const handler = /app\.get\("\/api\/customers"[\s\S]*?app\.get\("\/api\/customers\/indicators"/.exec(server)?.[0] ?? "";
    assert.match(handler, /attachCustomerLastPurchase\(prisma, withOwners\)/);
    assert.doesNotMatch(handler, /loadLastValidInvoices\(|\.salesOrderNfeLink|\.nomusNfe/);
    const exportServer = readFileSync(path.join(ROOT, "src/lib/customerListReportExport.server.ts"), "utf8");
    assert.match(exportServer, /attachCustomerLastPurchase\(prisma, withOwners\)/);
    const exportPure = readFileSync(path.join(ROOT, "src/lib/customerListReportExport.ts"), "utf8");
    assert.match(exportPure, /formatCustomerLastPurchaseMonth/);
    assert.doesNotMatch(exportPure, /xmlDhEmi|dataProcessamento|nomusNfe/);
    const routine = readFileSync(path.join(ROOT, "src/lib/commercial/customerCommercialOwnerInactivity.server.ts"), "utf8");
    assert.match(routine, /export async function loadLastValidInvoices/);
    assert.match(routine, /loadLastValidInvoices\(client, customerIds\)|loadLastValidInvoices\(/);
    const attach = readFileSync(path.join(ROOT, "src/lib/commercial/customerLastPurchase.server.ts"), "utf8");
    assert.match(attach, /import \{ loadLastValidInvoices \} from "\.\/customerCommercialOwnerInactivity\.server\.js"/);
  });

  it("grid: cabeçalho, célula MM/AAAA / Nunca entre Responsável e Localização, colunas e colSpan coerentes", () => {
    const grid = readFileSync(path.join(ROOT, "src/components/CustomerModule.tsx"), "utf8");
    const headers = [...grid.matchAll(/<th className="px-3 py-2 font-semibold text-xs whitespace-nowrap">([^<]+)<\/th>/g)].map((match) => match[1]);
    assert.deepEqual(headers, ["Cliente", "Score CNPJ", "Responsável Comercial", "Última compra", "Localização", "Status"]);
    assert.match(grid, /formatCustomerLastPurchaseMonth\(/);
    assert.match(grid, /data-testid="customer-last-purchase"/);
    assert.equal((grid.match(/colSpan=\{7\}/g) ?? []).length, 2);
    assert.doesNotMatch(grid, /colSpan=\{6\}/);
    assert.equal((grid.match(/<col( className=|\s*\/>)/g) ?? []).length, 7);
    // O responsável continua editável e a paginação/filtro seguem como estavam.
    assert.match(grid, /aria-label="Editar responsável comercial"/);
    assert.match(grid, /q\.set\("commercialOwner", ownerFilter\)/);
    assert.match(grid, /q\.set\("page", String\(page\)\)/);
    const print = readFileSync(path.join(ROOT, "src/components/customers/CustomerListReportPrintDocument.tsx"), "utf8");
    assert.match(print, /<th className="col-purchase">Última compra<\/th>/);
    assert.match(print, /\{row\.lastPurchase\}/);
  });
});
