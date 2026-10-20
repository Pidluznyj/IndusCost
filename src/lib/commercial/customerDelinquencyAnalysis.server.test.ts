/**
 * Integração do carregador com um stage em memória no formato do Prisma.
 * Não abre banco e não grava título.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerDelinquencyDb } from "./customerDelinquencyAnalysis.server.js";
import { analyzeCustomerDelinquency } from "./customerDelinquencyAnalysis.server.js";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const CNPJ = "11444777000161";
const TODAY = new Date(2026, 9, 19, 10, 0, 0);
const SYNCED = new Date(2026, 9, 19, 9, 0, 0);

type CustomerSeed = { id: string; taxId: string; nomusExternalPersonId: number | null };
type OrderSeed = { customerId: string; externalCustomerId: number | null };
type TitleSeed = {
  externalId: number;
  personId: number | null;
  personCnpj: string | null;
  personName?: string | null;
  companyName?: string | null;
  description?: string | null;
  comments?: string | null;
  dueDate: Date | null;
  settlementDate?: Date | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  sourceInvoiceId?: number | null;
  sourceInvoiceNumber?: string | null;
  paymentMethodName?: string | null;
  bankAccountName?: string | null;
  suspendCollection?: boolean | null;
  status?: boolean | null;
  syncedAt: Date;
  sourcePresenceStatus?: string | null;
  rawPayload?: unknown;
};
type RunSeed = { status: string; payloadComplete: boolean; startedAt: Date };

function createDb(seed: {
  customers: CustomerSeed[];
  orders?: OrderSeed[];
  titles?: TitleSeed[];
  run?: RunSeed | null;
}) {
  const queries = { customer: 0, orders: 0, titles: 0, aggregate: 0, run: 0 };
  const db = {
    customer: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        queries.customer += 1;
        return seed.customers.find((row) => row.id === where.id) ?? null;
      },
      findMany: async ({ where }: { where: { taxId: { in: string[] } } }) => {
        queries.customer += 1;
        return seed.customers.filter((row) => where.taxId.in.includes(row.taxId));
      },
    },
    salesOrder: {
      findMany: async ({ where }: { where: { customerId: string } }) => {
        queries.orders += 1;
        return (seed.orders ?? []).filter((row) => row.customerId === where.customerId);
      },
    },
    nomusAccountsReceivable: {
      aggregate: async () => {
        queries.aggregate += 1;
        const max = (seed.titles ?? []).reduce<Date | null>((current, row) => {
          if (!current || row.syncedAt.getTime() > current.getTime()) return row.syncedAt;
          return current;
        }, null);
        return { _max: { syncedAt: max } };
      },
      findMany: async ({ where }: { where: { personId: number } }) => {
        queries.titles += 1;
        return (seed.titles ?? [])
          .filter((row) => row.personId === where.personId)
          .map((row) => ({
            personName: "Cliente",
            companyName: "Lazarios",
            description: "Parcela",
            comments: null,
            settlementDate: null,
            sourceInvoiceId: 50,
            sourceInvoiceNumber: "100",
            paymentMethodName: "Boleto",
            bankAccountName: null,
            suspendCollection: false,
            status: false,
            sourcePresenceStatus: "PRESENT",
            rawPayload: { id: row.externalId },
            ...row,
          }));
      },
    },
    nomusSourceSyncRun: {
      findFirst: async () => {
        queries.run += 1;
        return seed.run === undefined
          ? { status: "SUCCESS", payloadComplete: true, startedAt: SYNCED }
          : seed.run;
      },
    },
  };
  return { db: db as unknown as CustomerDelinquencyDb, queries };
}

function customer(overrides: Partial<CustomerSeed> = {}): CustomerSeed {
  return {
    id: CUSTOMER_ID,
    taxId: CNPJ,
    nomusExternalPersonId: 100,
    ...overrides,
  };
}

function openTitle(overrides: Partial<TitleSeed> = {}): TitleSeed {
  return {
    externalId: 1,
    personId: 100,
    personCnpj: CNPJ,
    dueDate: new Date(2026, 9, 18),
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    syncedAt: SYNCED,
    ...overrides,
  };
}

describe("analyzeCustomerDelinquency — stage Nomus", () => {
  it("D+1 lê o stage uma vez e devolve o saldo vencido", async () => {
    const { db, queries } = createDb({
      customers: [customer()],
      orders: [{ customerId: CUSTOMER_ID, externalCustomerId: 100 }],
      titles: [openTitle()],
    });
    const result = await analyzeCustomerDelinquency(db, CUSTOMER_ID, TODAY);
    assert.equal(result.status, "OVERDUE");
    assert.equal(result.overdueTitleCount, 1);
    assert.equal(result.overdueAmount, 1000);
    assert.equal(result.maxDaysOverdue, 1);
    assert.equal(queries.titles, 1);
    assert.equal(queries.aggregate, 1);
  });

  it("parcial, quitação, cancelamento, renegociação e duplicata no mesmo stage", async () => {
    const { db } = createDb({
      customers: [customer()],
      orders: [{ customerId: CUSTOMER_ID, externalCustomerId: 100 }],
      titles: [
        openTitle({
          externalId: 1,
          amountReceivable: 1000,
          amountReceived: 250,
          balanceReceivable: 750,
        }),
        openTitle({
          externalId: 2,
          dueDate: new Date(2026, 8, 1),
          settlementDate: new Date(2026, 8, 2),
          amountReceived: 400,
          balanceReceivable: 0,
        }),
        openTitle({
          externalId: 3,
          dueDate: new Date(2026, 8, 1),
          rawPayload: { cancelado: true },
        }),
        openTitle({
          externalId: 10,
          dueDate: new Date(2026, 8, 15),
          balanceReceivable: 900,
          amountReceivable: 900,
        }),
        openTitle({
          externalId: 11,
          dueDate: new Date(2026, 9, 10),
          balanceReceivable: 900,
          amountReceivable: 900,
          rawPayload: { idTituloOrigem: 10 },
        }),
        openTitle({
          externalId: 20,
          sourceInvoiceId: null,
          sourceInvoiceNumber: null,
          description: "PD 010 Parcela 1 de 1",
          balanceReceivable: 300,
          amountReceivable: 300,
        }),
        openTitle({
          externalId: 21,
          sourceInvoiceId: 80,
          sourceInvoiceNumber: "80",
          description: "PD 010 Parcela 1 de 1",
          balanceReceivable: 300,
          amountReceivable: 300,
        }),
      ],
    });
    const result = await analyzeCustomerDelinquency(db, CUSTOMER_ID, TODAY);
    assert.equal(result.status, "OVERDUE");
    assert.deepEqual(result.evidence.overdueTitleIds, [1, 11, 21]);
    assert.equal(result.overdueAmount, 750 + 900 + 300);
    assert.ok(result.evidence.exclusions.some((row) => row.externalId === 2 && row.reason === "SETTLED"));
    assert.ok(result.evidence.exclusions.some((row) => row.externalId === 3 && row.reason === "CANCELLED"));
    assert.ok(
      result.evidence.exclusions.some((row) => row.externalId === 10 && row.reason === "SUPERSEDED_RENEGOTIATION")
    );
    assert.ok(
      result.evidence.exclusions.some((row) => row.externalId === 20 && row.reason === "SUPERSEDED_PRE_INVOICE")
    );
  });

  it("falha de sincronização não transforma atraso local em OVERDUE nem em REGULAR", async () => {
    const { db } = createDb({
      customers: [customer()],
      titles: [openTitle()],
      run: { status: "FAILED", payloadComplete: false, startedAt: SYNCED },
    });
    const result = await analyzeCustomerDelinquency(db, CUSTOMER_ID, TODAY);
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.unknownReason, "SYNC_FAILED");
    assert.equal(result.overdueAmount, null);
    assert.equal(result.openAmount, null);
  });

  it("título só com syncedAt anterior à janela fica UNKNOWN", async () => {
    const { db } = createDb({
      customers: [customer()],
      titles: [
        openTitle({ syncedAt: new Date(SYNCED.getTime() - 2 * 60 * 60 * 1000) }),
        openTitle({ externalId: 8, personId: 999, syncedAt: SYNCED }),
      ],
    });
    const result = await analyzeCustomerDelinquency(db, CUSTOMER_ID, TODAY);
    assert.equal(result.unknownReason, "SYNC_STALE");
  });

  it("CNPJ repetido em dois cadastros não cruza títulos", async () => {
    const { db, queries } = createDb({
      customers: [customer(), customer({ id: OTHER_ID, nomusExternalPersonId: 999 })],
      titles: [openTitle(), openTitle({ externalId: 9, personId: 999, balanceReceivable: 50 })],
    });
    const result = await analyzeCustomerDelinquency(db, CUSTOMER_ID, TODAY);
    assert.equal(result.unknownReason, "IDENTITY_AMBIGUOUS_CNPJ");
    assert.equal(queries.titles, 0);
  });

  it("cliente sem título na última sync completa é REGULAR", async () => {
    const { db } = createDb({
      customers: [customer()],
      titles: [openTitle({ personId: 999, externalId: 8 })],
    });
    const result = await analyzeCustomerDelinquency(db, CUSTOMER_ID, TODAY);
    assert.equal(result.status, "REGULAR");
    assert.equal(result.overdueTitleCount, 0);
    assert.equal(result.lastSyncedAt, SYNCED.toISOString());
  });
});
