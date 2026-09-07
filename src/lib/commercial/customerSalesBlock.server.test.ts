import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CustomerSalesBlockedError } from "./customerSalesBlock.js";
import {
  assertCustomerSalesAllowed,
  loadCustomerSalesBlockStatuses,
} from "./customerSalesBlock.server.js";

const CUSTOMER_A = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_B = "22222222-2222-4222-8222-222222222222";
const TODAY = new Date(2026, 8, 7);
const SYNCED = new Date("2026-09-07T10:00:00.000Z");

function arTitle(overrides: Record<string, unknown> = {}) {
  return {
    externalId: 1,
    companyName: "KOPPETEL",
    personId: 100,
    personName: "Platinum Maxxi",
    personCnpj: "11.111.111/0001-11",
    description: "CR",
    comments: null,
    dueDate: new Date(2026, 8, 1),
    competenceDate: null,
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodId: null,
    paymentMethodName: "Boleto",
    bankAccountName: null,
    sourceInvoiceId: 9,
    sourceInvoiceNumber: "NF-9",
    suspendCollection: false,
    status: true,
    syncedAt: SYNCED,
    sourcePresenceStatus: "PRESENT",
    ...overrides,
  };
}

function createFakePrisma(seed: {
  orders?: Array<{ customerId: string; externalCustomerId: number | null }>;
  ar?: ReturnType<typeof arTitle>[];
}) {
  const orders = [...(seed.orders ?? [])];
  const ar = [...(seed.ar ?? [])];
  return {
    salesOrder: {
      findMany: async ({ where }: { where: { customerId: { in: string[] } } }) =>
        orders.filter((row) => where.customerId.in.includes(row.customerId)),
    },
    nomusAccountsReceivable: {
      findMany: async ({ where }: { where: { personId: { in: number[] } } }) =>
        ar.filter((row) => where.personId.in.includes(row.personId as number)),
    },
  };
}

describe("customer sales block server", () => {
  it("SALE ALLOWED: sem boleto vencido não lança", async () => {
    const prisma = createFakePrisma({
      orders: [{ customerId: CUSTOMER_A, externalCustomerId: 100 }],
      ar: [arTitle({ dueDate: new Date(2026, 8, 20) })],
    });
    await assertCustomerSalesAllowed(prisma as never, CUSTOMER_A, TODAY);
  });

  it("SALE BLOCKED + bypass direto: boleto vencido rejeita no backend", async () => {
    const prisma = createFakePrisma({
      orders: [{ customerId: CUSTOMER_A, externalCustomerId: 100 }],
      ar: [arTitle()],
    });
    await assert.rejects(
      () => assertCustomerSalesAllowed(prisma as never, CUSTOMER_A, TODAY),
      (error: unknown) => {
        assert.ok(error instanceof CustomerSalesBlockedError);
        assert.equal(error.httpStatus, 409);
        assert.equal(error.code, "CUSTOMER_SALES_BLOCKED_OVERDUE_BOLETO");
        return true;
      }
    );
  });

  it("DEBT CLEARED: após quitação a venda volta a ser permitida", async () => {
    const prisma = createFakePrisma({
      orders: [{ customerId: CUSTOMER_A, externalCustomerId: 100 }],
      ar: [
        arTitle({
          balanceReceivable: 0,
          amountReceived: 1000,
          settlementDate: TODAY,
        }),
      ],
    });
    await assertCustomerSalesAllowed(prisma as never, CUSTOMER_A, TODAY);
  });

  it("UNRELATED CUSTOMER: dívida de outro personId não bloqueia", async () => {
    const prisma = createFakePrisma({
      orders: [{ customerId: CUSTOMER_A, externalCustomerId: 100 }],
      ar: [arTitle({ personId: 777 })],
    });
    await assertCustomerSalesAllowed(prisma as never, CUSTOMER_A, TODAY);
  });

  it("lote não faz N+1: dois clientes, uma consulta de AR", async () => {
    let arQueries = 0;
    const base = createFakePrisma({
      orders: [
        { customerId: CUSTOMER_A, externalCustomerId: 100 },
        { customerId: CUSTOMER_B, externalCustomerId: 200 },
      ],
      ar: [arTitle({ personId: 100 }), arTitle({ personId: 200, paymentMethodName: "PIX" })],
    });
    const prisma = {
      ...base,
      nomusAccountsReceivable: {
        findMany: async (args: { where: { personId: { in: number[] } } }) => {
          arQueries += 1;
          return base.nomusAccountsReceivable.findMany(args);
        },
      },
    };
    const map = await loadCustomerSalesBlockStatuses(prisma as never, [CUSTOMER_A, CUSTOMER_B], TODAY);
    assert.equal(arQueries, 1);
    assert.equal(map.get(CUSTOMER_A)?.blocked, true);
    assert.equal(map.get(CUSTOMER_B)?.blocked, false);
  });
});
