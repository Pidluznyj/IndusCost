/**
 * Fixtures fiéis ao shape de NomusAccountsReceivable / NomusAccountsPayable
 * (money Decimal-like, rawPayload Json, presença origem).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  extractInstallmentFromNomusRaw,
  extractSalesOrderFromNomusRaw,
  toOfficialPayableView,
  toOfficialReceivableView,
  type OfficialNomusPayableRow,
  type OfficialNomusReceivableRow,
} from "../mappers/treasuryOfficialTitleMappers.js";
import {
  createEmptyOfficialTitlesMemoryStore,
  createMemoryTreasuryOfficialTitlesAdapter,
} from "./treasuryOfficialTitlesAdapter.memory.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Simula Prisma.Decimal(20,2) sem depender do client no teste do mapper. */
function decimalLike(value: string): { toFixed(digits: number): string } {
  return {
    toFixed(digits: number) {
      return Number(value).toFixed(digits);
    },
  };
}

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

/**
 * Fixture AR — título em aberto com NF, parcela e pedido no rawPayload Nomus.
 * Campos tipados alinhados a prisma/schema.prisma model NomusAccountsReceivable.
 */
const AR_OPEN: OfficialNomusReceivableRow = {
  id: "a1111111-1111-4111-8111-111111111111",
  externalId: 88421,
  status: false,
  personId: 1205,
  personName: "Cliente Industrial Sul Ltda",
  personCnpj: "12345678000199",
  description: "NF 45210 - Parcela 2/3",
  competenceDate: utcDate(2026, 6, 1),
  dueDate: utcDate(2026, 7, 15),
  amountReceivable: decimalLike("4252.80"),
  balanceReceivable: decimalLike("4252.80"),
  amountReceived: decimalLike("0.00"),
  settlementDate: null,
  sourceInvoiceId: 99001,
  sourceInvoiceNumber: "45210",
  sourcePresenceStatus: "PRESENT",
  sourceRemovedAt: null,
  syncedAt: new Date("2026-07-20T14:30:00.000Z"),
  rawPayload: {
    id: 88421,
    idNotaFiscal: 99001,
    numeroNotaFiscal: "45210",
    numeroParcela: 2,
    descricaoParcela: "2/3",
    idPedidoVenda: 55012,
    numeroPedido: "PV-55012",
    valorReceber: 4252.8,
    saldoReceber: 4252.8,
    status: false,
  },
};

/** AR liquidado — balance zero, amountReceived preenchido. */
const AR_SETTLED: OfficialNomusReceivableRow = {
  id: "a2222222-2222-4222-8222-222222222222",
  externalId: 88422,
  status: true,
  personId: 1205,
  personName: "Cliente Industrial Sul Ltda",
  personCnpj: "12345678000199",
  description: "NF 45209 - à vista",
  competenceDate: utcDate(2026, 5, 10),
  dueDate: utcDate(2026, 5, 10),
  amountReceivable: decimalLike("1000.00"),
  balanceReceivable: decimalLike("0.00"),
  amountReceived: decimalLike("1000.00"),
  settlementDate: utcDate(2026, 5, 10),
  sourceInvoiceId: 99000,
  sourceInvoiceNumber: "45209",
  sourcePresenceStatus: "PRESENT",
  sourceRemovedAt: null,
  syncedAt: new Date("2026-07-20T14:30:00.000Z"),
  rawPayload: { id: 88422, status: true },
};

/** AR removido da origem (cancelamento/ausência confirmada). */
const AR_REMOVED: OfficialNomusReceivableRow = {
  id: "a3333333-3333-4333-8333-333333333333",
  externalId: 88423,
  status: false,
  personId: 88,
  personName: "Cliente Removido SA",
  personCnpj: null,
  description: "Título ausente na origem",
  competenceDate: utcDate(2026, 4, 1),
  dueDate: utcDate(2026, 4, 30),
  amountReceivable: decimalLike("500.00"),
  balanceReceivable: decimalLike("500.00"),
  amountReceived: null,
  settlementDate: null,
  sourceInvoiceId: null,
  sourceInvoiceNumber: null,
  sourcePresenceStatus: "MISSING_CONFIRMED",
  sourceRemovedAt: new Date("2026-07-18T12:00:00.000Z"),
  syncedAt: new Date("2026-07-20T14:30:00.000Z"),
  rawPayload: { id: 88423 },
};

/**
 * Fixture AP — fornecedor, documentNumber tipado, paymentDate distinto.
 */
const AP_OPEN: OfficialNomusPayableRow = {
  id: "b1111111-1111-4111-8111-111111111111",
  externalId: 33110,
  status: false,
  personId: 440,
  personName: "Fornecedor Aços Norte ME",
  personCnpj: "98765432000155",
  description: "Compra matéria-prima Parcela 1",
  documentNumber: "NF-7788",
  competenceDate: utcDate(2026, 6, 5),
  dueDate: utcDate(2026, 7, 20),
  amountPayable: decimalLike("15890.55"),
  balancePayable: decimalLike("15890.55"),
  amountPaid: decimalLike("0.00"),
  settlementDate: null,
  paymentDate: null,
  sourceInvoiceId: 77001,
  sourceInvoiceNumber: "7788",
  sourcePresenceStatus: "PRESENT",
  sourceRemovedAt: null,
  syncedAt: new Date("2026-07-21T09:00:00.000Z"),
  rawPayload: {
    id: 33110,
    numeroDocumento: "NF-7788",
    parcela: 1,
    valorPagar: 15890.55,
    saldoPagar: 15890.55,
  },
};

const AP_PARTIAL: OfficialNomusPayableRow = {
  id: "b2222222-2222-4222-8222-222222222222",
  externalId: 33111,
  status: false,
  personId: 440,
  personName: "Fornecedor Aços Norte ME",
  personCnpj: "98765432000155",
  description: "Serviço manutenção",
  documentNumber: "DOC-12",
  competenceDate: utcDate(2026, 5, 1),
  dueDate: utcDate(2026, 6, 1),
  amountPayable: decimalLike("2000.00"),
  balancePayable: decimalLike("800.00"),
  amountPaid: decimalLike("1200.00"),
  settlementDate: utcDate(2026, 5, 28),
  paymentDate: utcDate(2026, 5, 27),
  sourceInvoiceId: null,
  sourceInvoiceNumber: null,
  sourcePresenceStatus: "PRESENT",
  sourceRemovedAt: null,
  syncedAt: new Date("2026-07-21T09:00:00.000Z"),
  rawPayload: { id: 33111 },
};

describe("treasuryOfficialTitleMappers", () => {
  it("mapeia AR aberto com todos os campos canônicos (money string, datas civis)", () => {
    const view = toOfficialReceivableView(AR_OPEN);
    assert.equal(view.id, AR_OPEN.id);
    assert.equal(view.externalId, 88421);
    assert.equal(view.installmentNumber, 2);
    assert.equal(view.installmentLabel, "2/3");
    assert.deepEqual(view.counterparty, {
      personId: 1205,
      name: "Cliente Industrial Sul Ltda",
      taxId: "12345678000199",
      role: "CUSTOMER",
    });
    assert.equal(view.documentNumber, null);
    assert.equal(view.salesOrderExternalId, 55012);
    assert.equal(view.salesOrderCode, "PV-55012");
    assert.deepEqual(view.invoice, { externalId: 99001, number: "45210" });
    assert.equal(view.issuedOn, "2026-06-01");
    assert.equal(view.dueDate, "2026-07-15");
    assert.equal(view.originalAmount, "4252.80");
    assert.equal(view.openBalance, "4252.80");
    assert.deepEqual(view.settlements, {
      settledAmount: "0.00",
      settledAt: null,
      paidAt: null,
    });
    assert.equal(view.cancellation.isCancelledOrRemovedFromSource, false);
    assert.equal(view.officialStatus.nomusStatus, false);
    assert.equal(view.officialStatus.isOpen, true);
    assert.equal(view.officialStatus.isSettled, false);
    assert.equal(view.lastSyncedAt, "2026-07-20T14:30:00.000+00:00");
  });

  it("mapeia AR liquidado e AP com documentNumber + paymentDate", () => {
    const ar = toOfficialReceivableView(AR_SETTLED);
    assert.equal(ar.officialStatus.isOpen, false);
    assert.equal(ar.officialStatus.isSettled, true);
    assert.equal(ar.settlements.settledAmount, "1000.00");
    assert.equal(ar.settlements.settledAt, "2026-05-10");

    const ap = toOfficialPayableView(AP_PARTIAL);
    assert.equal(ap.counterparty.role, "SUPPLIER");
    assert.equal(ap.documentNumber, "DOC-12");
    assert.equal(ap.originalAmount, "2000.00");
    assert.equal(ap.openBalance, "800.00");
    assert.equal(ap.settlements.settledAmount, "1200.00");
    assert.equal(ap.settlements.settledAt, "2026-05-28");
    assert.equal(ap.settlements.paidAt, "2026-05-27");
    assert.equal(ap.officialStatus.isOpen, true);
    assert.equal(ap.officialStatus.isSettled, false);
  });

  it("deriva cancelamento de MISSING_CONFIRMED / sourceRemovedAt", () => {
    const view = toOfficialReceivableView(AR_REMOVED);
    assert.equal(view.cancellation.isCancelledOrRemovedFromSource, true);
    assert.equal(view.cancellation.sourcePresenceStatus, "MISSING_CONFIRMED");
    assert.equal(
      view.cancellation.sourceRemovedAt,
      "2026-07-18T12:00:00.000+00:00"
    );
  });

  it("extrai parcela da descrição quando rawPayload não traz numeroParcela", () => {
    const fromDesc = extractInstallmentFromNomusRaw(null, "Cobrança Parcela: 3");
    assert.equal(fromDesc.installmentNumber, 3);
    assert.equal(fromDesc.installmentLabel, "Parcela 3");
    const order = extractSalesOrderFromNomusRaw({ pedidoId: "99", orderCode: "X" });
    assert.equal(order.salesOrderExternalId, 99);
    assert.equal(order.salesOrderCode, "X");
  });
});

describe("treasuryOfficialTitlesAdapter.memory — read-only repository", () => {
  it("find/list AR e AP com filtros openOnly e personId", async () => {
    const store = createEmptyOfficialTitlesMemoryStore();
    store.receivables.push(AR_OPEN, AR_SETTLED, AR_REMOVED);
    store.payables.push(AP_OPEN, AP_PARTIAL);
    const adapter = createMemoryTreasuryOfficialTitlesAdapter(store);

    const byId = await adapter.findReceivableById(AR_OPEN.id);
    assert.equal(byId?.externalId, 88421);

    const byExt = await adapter.findPayableByExternalId(33110);
    assert.equal(byExt?.documentNumber, "NF-7788");
    assert.equal(byExt?.installmentNumber, 1);

    const openAr = await adapter.listReceivables({ openOnly: true });
    assert.equal(openAr.total, 2);
    assert.ok(openAr.rows.every((r) => r.officialStatus.isOpen));

    const byPerson = await adapter.listPayables({ personId: 440, pageSize: 1 });
    assert.equal(byPerson.total, 2);
    assert.equal(byPerson.rows.length, 1);
    assert.equal(byPerson.pageSize, 1);
  });

  it("não expõe superfície de escrita no adapter Prisma (fonte)", () => {
    const source = readFileSync(
      join(here, "treasuryOfficialTitlesAdapter.server.ts"),
      "utf8"
    );
    assert.match(source, /findUnique|findMany|count/);
    assert.doesNotMatch(source, /\.(create|update|upsert|delete|createMany)\s*\(/);
    assert.match(source, /OfficialReceivableView|toOfficialReceivableView/);
    assert.match(source, /OfficialPayableView|toOfficialPayableView/);
  });
});
