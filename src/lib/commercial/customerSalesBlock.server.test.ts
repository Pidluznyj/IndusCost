import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CustomerSalesBlockedError } from "./customerSalesBlock.js";
import {
  assertCustomerSalesAllowed,
  attachCustomerSalesBlocks,
  attachSalesBlockToNestedCustomers,
  loadCustomerSalesBlockStatuses,
} from "./customerSalesBlock.server.js";

const CUSTOMER_A = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_B = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_C = "33333333-3333-4333-8333-333333333333";
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
    paymentMethodId: 10,
    paymentMethodName: "Boleto Bancário",
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

type Seed = {
  customers?: Array<{ id: string; nomusExternalPersonId: number | null }>;
  orders?: Array<{ customerId: string; externalCustomerId: number | null }>;
  ar?: ReturnType<typeof arTitle>[];
};

function createFakePrisma(seed: Seed) {
  const customers = [...(seed.customers ?? [])];
  const orders = [...(seed.orders ?? [])];
  const ar = [...(seed.ar ?? [])];
  const queries = { customer: 0, salesOrder: 0, ar: 0 };
  const prisma = {
    customer: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        queries.customer += 1;
        return customers.filter((row) => where.id.in.includes(row.id));
      },
    },
    salesOrder: {
      findMany: async ({ where }: { where: { customerId: { in: string[] } } }) => {
        queries.salesOrder += 1;
        return orders.filter((row) => where.customerId.in.includes(row.customerId));
      },
    },
    nomusAccountsReceivable: {
      findMany: async ({ where }: { where: { personId: { in: number[] } } }) => {
        queries.ar += 1;
        return ar.filter((row) => where.personId.in.includes(row.personId as number));
      },
    },
  };
  return { prisma: prisma as never, queries };
}

describe("customer sales block server — identidade pelo Customer.nomusExternalPersonId", () => {
  it("SALE ALLOWED: cliente com ID Nomus, sem pedido, sem boleto vencido → não lança", async () => {
    const { prisma } = createFakePrisma({
      customers: [{ id: CUSTOMER_A, nomusExternalPersonId: 100 }],
      ar: [arTitle({ dueDate: new Date(2026, 8, 20) })],
    });
    await assertCustomerSalesAllowed(prisma, CUSTOMER_A, TODAY);
  });

  it("SALE BLOCKED + bypass direto: boleto (ID 10) vencido rejeita no backend com o código de boleto", async () => {
    const { prisma } = createFakePrisma({
      customers: [{ id: CUSTOMER_A, nomusExternalPersonId: 100 }],
      orders: [{ customerId: CUSTOMER_A, externalCustomerId: 100 }],
      ar: [arTitle()],
    });
    await assert.rejects(
      () => assertCustomerSalesAllowed(prisma, CUSTOMER_A, TODAY),
      (error: unknown) => {
        assert.ok(error instanceof CustomerSalesBlockedError);
        assert.equal(error.httpStatus, 409);
        assert.equal(error.code, "CUSTOMER_SALES_BLOCKED_OVERDUE_BOLETO");
        assert.equal(error.reason, "OVERDUE_BOLETO");
        return true;
      }
    );
  });

  it("TEST R (servidor): cliente SEM SalesOrder com boleto vencido é bloqueado — pedido não é requisito", async () => {
    const { prisma, queries } = createFakePrisma({
      customers: [{ id: CUSTOMER_A, nomusExternalPersonId: 100 }],
      ar: [arTitle()],
    });
    const map = await loadCustomerSalesBlockStatuses(prisma, [CUSTOMER_A], TODAY);
    assert.equal(map.get(CUSTOMER_A)?.blocked, true);
    assert.equal(map.get(CUSTOMER_A)?.reason, "OVERDUE_BOLETO");
    assert.equal(queries.salesOrder, 1);
  });

  it("TEST T (servidor, CUNHA): Customer 1389 com pedidos {1389, 61} → hard block por identidade, sem consultar AR", async () => {
    const { prisma, queries } = createFakePrisma({
      customers: [{ id: CUSTOMER_A, nomusExternalPersonId: 1389 }],
      orders: [
        { customerId: CUSTOMER_A, externalCustomerId: 1389 },
        { customerId: CUSTOMER_A, externalCustomerId: 61 },
      ],
      ar: [],
    });
    await assert.rejects(
      () => assertCustomerSalesAllowed(prisma, CUSTOMER_A, TODAY),
      (error: unknown) => {
        assert.ok(error instanceof CustomerSalesBlockedError);
        assert.equal(error.code, "CUSTOMER_SALES_BLOCKED_FINANCIAL_IDENTITY_UNRESOLVED");
        assert.equal(error.reason, "FINANCIAL_IDENTITY_UNRESOLVED");
        assert.equal(error.httpStatus, 409);
        assert.doesNotMatch(error.message, /boleto/i);
        return true;
      }
    );
    assert.equal(queries.ar, 0);
    const map = await loadCustomerSalesBlockStatuses(prisma, [CUSTOMER_A], TODAY);
    assert.equal(map.get(CUSTOMER_A)?.resolution, "UNRESOLVED_IDENTITY_CONFLICT");
    assert.equal(map.get(CUSTOMER_A)?.nomusPersonId, null);
  });

  it("TEST U (servidor): sem nomusExternalPersonId e sem pedidos → hard block por identidade", async () => {
    const { prisma } = createFakePrisma({
      customers: [{ id: CUSTOMER_A, nomusExternalPersonId: null }],
    });
    await assert.rejects(
      () => assertCustomerSalesAllowed(prisma, CUSTOMER_A, TODAY),
      (error: unknown) =>
        error instanceof CustomerSalesBlockedError &&
        error.code === "CUSTOMER_SALES_BLOCKED_FINANCIAL_IDENTITY_UNRESOLVED"
    );
  });

  it("cliente inexistente no banco → fail closed (identidade não validável)", async () => {
    const { prisma } = createFakePrisma({});
    await assert.rejects(
      () => assertCustomerSalesAllowed(prisma, CUSTOMER_A, TODAY),
      (error: unknown) =>
        error instanceof CustomerSalesBlockedError && error.reason === "FINANCIAL_IDENTITY_UNRESOLVED"
    );
  });

  it("DEBT CLEARED: após quitação a venda volta a ser permitida", async () => {
    const { prisma } = createFakePrisma({
      customers: [{ id: CUSTOMER_A, nomusExternalPersonId: 100 }],
      ar: [arTitle({ balanceReceivable: 0, amountReceived: 1000, settlementDate: TODAY })],
    });
    await assertCustomerSalesAllowed(prisma, CUSTOMER_A, TODAY);
  });

  it("UNRELATED CUSTOMER: dívida de outro personId não bloqueia", async () => {
    const { prisma } = createFakePrisma({
      customers: [{ id: CUSTOMER_A, nomusExternalPersonId: 100 }],
      ar: [arTitle({ personId: 777 })],
    });
    await assertCustomerSalesAllowed(prisma, CUSTOMER_A, TODAY);
  });

  it("TEST Y (servidor): mesmo companyName, personIds 1341 e 791 — a dívida não cruza", async () => {
    const debt = (externalId: number, dueDate: Date) =>
      arTitle({
        externalId,
        personId: 1341,
        companyName: "CONSTRUTORA MARRETA LTDA",
        personName: "CONSTRUTORA MARRETA LTDA",
        dueDate,
        amountReceivable: 3280,
        balanceReceivable: 3280,
        sourceInvoiceId: externalId,
        sourceInvoiceNumber: `NF-${externalId}`,
        description: `T${externalId}`,
      });
    const { prisma } = createFakePrisma({
      customers: [
        { id: CUSTOMER_A, nomusExternalPersonId: 1341 },
        { id: CUSTOMER_B, nomusExternalPersonId: 791 },
      ],
      orders: [
        { customerId: CUSTOMER_A, externalCustomerId: 1341 },
        { customerId: CUSTOMER_B, externalCustomerId: 791 },
      ],
      ar: [
        debt(15206, new Date(2026, 4, 6)),
        debt(15207, new Date(2026, 4, 13)),
        arTitle({ externalId: 30001, personId: 791, companyName: "CONSTRUTORA MARRETA LTDA", dueDate: new Date(2026, 9, 1) }),
      ],
    });
    const map = await loadCustomerSalesBlockStatuses(prisma, [CUSTOMER_A, CUSTOMER_B], TODAY);
    assert.equal(map.get(CUSTOMER_A)?.blocked, true);
    assert.equal(map.get(CUSTOMER_A)?.overdueOpenBalance, 6560);
    assert.equal(map.get(CUSTOMER_B)?.blocked, false);
    assert.equal(map.get(CUSTOMER_B)?.nomusPersonId, 791);
  });

  it("lote não faz N+1: três clientes → 1 consulta de Customer, 1 de SalesOrder, 1 de AR", async () => {
    const { prisma, queries } = createFakePrisma({
      customers: [
        { id: CUSTOMER_A, nomusExternalPersonId: 100 },
        { id: CUSTOMER_B, nomusExternalPersonId: 200 },
        { id: CUSTOMER_C, nomusExternalPersonId: null },
      ],
      orders: [
        { customerId: CUSTOMER_A, externalCustomerId: 100 },
        { customerId: CUSTOMER_B, externalCustomerId: 200 },
      ],
      ar: [arTitle({ personId: 100 }), arTitle({ personId: 200, paymentMethodId: 13, paymentMethodName: "Pix" })],
    });
    const map = await loadCustomerSalesBlockStatuses(prisma, [CUSTOMER_A, CUSTOMER_B, CUSTOMER_C], TODAY);
    assert.deepEqual(queries, { customer: 1, salesOrder: 1, ar: 1 });
    assert.equal(map.get(CUSTOMER_A)?.blocked, true);
    assert.equal(map.get(CUSTOMER_B)?.blocked, false);
    assert.equal(map.get(CUSTOMER_C)?.blocked, true);
    assert.equal(map.get(CUSTOMER_C)?.reason, "FINANCIAL_IDENTITY_UNRESOLVED");
  });

  it("linhas já carregadas com nomusExternalPersonId não consultam Customer de novo", async () => {
    const { prisma, queries } = createFakePrisma({
      ar: [arTitle({ personId: 100 })],
    });
    const rows = await attachCustomerSalesBlocks(
      prisma,
      [
        { id: CUSTOMER_A, nomusExternalPersonId: 100, companyName: "A" },
        { id: CUSTOMER_B, nomusExternalPersonId: 200, companyName: "B" },
      ],
      { includeFinancialDetails: false, now: TODAY }
    );
    assert.equal(queries.customer, 0);
    assert.equal(queries.salesOrder, 1);
    assert.equal(queries.ar, 1);
    assert.equal(rows[0].salesBlock.blocked, true);
    assert.equal(rows[0].salesBlock.reason, "OVERDUE_BOLETO");
    assert.equal(rows[0].salesBlock.overdueOpenBalance, undefined);
    assert.equal(rows[1].salesBlock.blocked, false);
  });

  it("propostas com Customer aninhado sem o ID Nomus carregam Customer em uma consulta set-based", async () => {
    const { prisma, queries } = createFakePrisma({
      customers: [
        { id: CUSTOMER_A, nomusExternalPersonId: 100 },
        { id: CUSTOMER_B, nomusExternalPersonId: null },
      ],
      ar: [arTitle({ personId: 100 })],
    });
    const rows = await attachSalesBlockToNestedCustomers(
      prisma,
      [
        { id: "p1", customerId: CUSTOMER_A, Customer: { id: CUSTOMER_A } },
        { id: "p2", customerId: CUSTOMER_A, Customer: { id: CUSTOMER_A } },
        { id: "p3", customerId: CUSTOMER_B, Customer: { id: CUSTOMER_B } },
      ],
      { includeFinancialDetails: true, now: TODAY }
    );
    assert.deepEqual(queries, { customer: 1, salesOrder: 1, ar: 1 });
    assert.equal(rows[0].Customer?.salesBlock?.reason, "OVERDUE_BOLETO");
    assert.equal(rows[1].Customer?.salesBlock?.blocked, true);
    assert.equal(rows[2].Customer?.salesBlock?.reason, "FINANCIAL_IDENTITY_UNRESOLVED");
    assert.equal(rows[2].Customer?.salesBlock?.nomusPersonId, null);
  });
});
