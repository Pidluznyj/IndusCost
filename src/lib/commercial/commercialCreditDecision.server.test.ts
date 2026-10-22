/**
 * Integração do motor de crédito com o stage de inadimplência em memória.
 * Não abre banco e não grava título.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CommercialCreditDeniedError } from "./commercialCreditDecision.js";
import { CommercialCreditExceptionError } from "./commercialCreditDecision.js";
import {
  assertCommercialCreditAllows,
  grantCommercialCreditException,
  type CommercialCreditDb,
} from "./commercialCreditDecision.server.js";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const RELATED_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "55555555-5555-4555-8555-555555555555";
const CNPJ = "11444777000161";
const RELATED_CNPJ = "50798391000100";
const TODAY = new Date(2026, 9, 19, 10, 0, 0);
const SYNCED = new Date(2026, 9, 19, 9, 0, 0);

type CustomerSeed = { id: string; taxId: string; nomusExternalPersonId: number | null };
type OrderSeed = { customerId: string; externalCustomerId: number | null };
type TitleSeed = {
  externalId: number;
  personId: number | null;
  personCnpj: string | null;
  dueDate: Date | null;
  settlementDate?: Date | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  syncedAt: Date;
  rawPayload?: unknown;
};
type ExceptionSeed = {
  id: string;
  customerId: string;
  scope: string;
  justification: string;
  expiresAt: Date;
  grantedByUserId: string;
  grantedByPermission: string;
  activeKey: string;
  revokedAt: Date | null;
  createdAt: Date;
};

function createDb(seed: {
  customers: CustomerSeed[];
  orders?: OrderSeed[];
  titles?: TitleSeed[];
  links?: Array<{ customerId: string; relatedCustomerId: string }>;
  protests?: Array<{ customerId: string; status: string; effectiveFrom: Date; effectiveUntil: Date | null }>;
  exceptions?: ExceptionSeed[];
  run?: { status: string; payloadComplete: boolean } | null;
}) {
  const exceptions = seed.exceptions ?? [];
  const audits: Array<Record<string, unknown>> = [];
  const db = {
    customer: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        seed.customers.find((row) => row.id === where.id) ?? null,
      findMany: async (args?: {
        where?: {
          id?: { in?: string[] };
          taxId?: { in?: string[]; startsWith?: string };
          OR?: Array<{ taxId?: { startsWith?: string } }>;
        };
        skip?: number;
        take?: number;
      }) => {
        const where = args?.where;
        let rows = seed.customers;
        if (where?.id?.in) rows = rows.filter((row) => where.id?.in?.includes(row.id));
        if (where?.taxId?.in) rows = rows.filter((row) => where.taxId?.in?.includes(row.taxId));
        if (where?.taxId?.startsWith) {
          const prefix = where.taxId.startsWith;
          rows = rows.filter((row) => row.taxId.startsWith(prefix));
        }
        const prefixes = (where?.OR ?? []).map((item) => item.taxId?.startsWith).filter((value): value is string => Boolean(value));
        if (prefixes.length > 0) {
          rows = seed.customers.filter((row) => prefixes.some((prefix) => row.taxId.startsWith(prefix)));
        }
        const skip = args?.skip ?? 0;
        const take = args?.take ?? rows.length;
        return rows.slice(skip, skip + take);
      },
    },
    salesOrder: {
      findMany: async ({ where }: { where: { customerId: string } }) =>
        (seed.orders ?? []).filter((row) => row.customerId === where.customerId),
    },
    nomusAccountsReceivable: {
      aggregate: async () => {
        const max = (seed.titles ?? []).reduce<Date | null>((current, row) => {
          if (!current || row.syncedAt.getTime() > current.getTime()) return row.syncedAt;
          return current;
        }, null);
        return { _max: { syncedAt: max } };
      },
      findMany: async ({ where }: { where: { personId: number } }) =>
        (seed.titles ?? [])
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
          })),
    },
    nomusSourceSyncRun: {
      findFirst: async () =>
        seed.run === undefined ? { status: "SUCCESS", payloadComplete: true, startedAt: SYNCED } : seed.run,
    },
    customerCorporateLink: {
      findMany: async (args: {
        where?: {
          customerId?: string;
          OR?: Array<{ customerId?: { in?: string[] }; relatedCustomerId?: { in?: string[] } }>;
        };
        take?: number;
      }) => {
        const ids = new Set<string>();
        if (args.where?.customerId) ids.add(args.where.customerId);
        for (const clause of args.where?.OR ?? []) {
          for (const id of clause.customerId?.in ?? []) ids.add(id);
          for (const id of clause.relatedCustomerId?.in ?? []) ids.add(id);
        }
        return (seed.links ?? [])
          .filter((row) => ids.size === 0 || ids.has(row.customerId) || ids.has(row.relatedCustomerId))
          .slice(0, args.take);
      },
    },
    commercialExternalProtest: {
      findMany: async ({ where }: { where: { customerId: string } }) =>
        (seed.protests ?? []).filter((row) => row.customerId === where.customerId),
    },
    commercialCreditOccurrence: {
      findMany: async () => [],
    },
    commercialCorporateMembership: {
      findMany: async () => [],
      findFirst: async () => null,
    },
    customerCnpjLookup: { findFirst: async () => null },
    commercialCreditException: {
      findMany: async ({ where }: { where: { customerId: string; activeKey?: string; revokedAt?: null } }) =>
        exceptions.filter(
          (row) =>
            row.customerId === where.customerId &&
            (where.activeKey == null || row.activeKey === where.activeKey) &&
            (where.revokedAt === undefined || row.revokedAt === null)
        ),
      findFirst: async ({ where }: { where: { customerId: string; scope: string; activeKey: string } }) =>
        exceptions.find(
          (row) => row.customerId === where.customerId && row.scope === where.scope && row.activeKey === where.activeKey
        ) ?? null,
      create: async ({ data }: { data: Omit<ExceptionSeed, "id" | "createdAt"> }) => {
        const clash = exceptions.find(
          (row) => row.customerId === data.customerId && row.scope === data.scope && row.activeKey === data.activeKey
        );
        if (clash) {
          const error = new Error("unique") as Error & { code: string };
          error.code = "P2002";
          throw error;
        }
        const created: ExceptionSeed = {
          ...data,
          id: `66666666-6666-4666-8666-${String(exceptions.length + 1).padStart(12, "0")}`,
          createdAt: TODAY,
        };
        exceptions.push(created);
        return created;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<ExceptionSeed> }) => {
        const row = exceptions.find((item) => item.id === where.id);
        if (!row) throw new Error("missing exception");
        Object.assign(row, data);
        return row;
      },
    },
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
  };
  return {
    db: db as unknown as CommercialCreditDb,
    audits,
    exceptions,
    auditWriter: async (entry: Record<string, unknown>) => {
      audits.push(entry);
    },
  };
}

function customer(overrides: Partial<CustomerSeed> = {}): CustomerSeed {
  return { id: CUSTOMER_ID, taxId: CNPJ, nomusExternalPersonId: 100, ...overrides };
}

function openTitle(overrides: Partial<TitleSeed> = {}): TitleSeed {
  return {
    externalId: 1,
    personId: 100,
    personCnpj: CNPJ,
    dueDate: new Date(2026, 9, 15),
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    syncedAt: SYNCED,
    ...overrides,
  };
}

const financeActor = {
  id: ACTOR_ID,
  role: "ADMIN",
  assignedPermissions: ["commercial.credit.exception.grant"],
};

describe("assertCommercialCreditAllows — stage Nomus", () => {
  it("bloqueia prazo no D+4 e libera depois da quitação confirmada", async () => {
    const title = openTitle();
    const stage = createDb({
      customers: [customer()],
      orders: [{ customerId: CUSTOMER_ID, externalCustomerId: 100 }],
      titles: [title],
    });
    await assert.rejects(
      () =>
        assertCommercialCreditAllows(stage.db, {
          customerId: CUSTOMER_ID,
          enforcement: "CREDIT_GRANT",
          paymentTerms: "30/60",
          now: TODAY,
          audit: { entityId: CUSTOMER_ID, action: "PROPOSAL_APPROVE", performedBy: ACTOR_ID },
          auditWriter: stage.auditWriter,
        }),
      (error: unknown) => {
        assert.ok(error instanceof CommercialCreditDeniedError);
        assert.equal(error.status, "BLOQUEADO");
        assert.equal(error.reason, "OVERDUE_OPEN_BALANCE");
        return true;
      }
    );
    assert.equal(stage.audits.length, 1);
    assert.equal(JSON.stringify(stage.audits[0]).includes("1000"), false);

    title.balanceReceivable = 0;
    title.amountReceived = 1000;
    title.settlementDate = TODAY;
    const released = await assertCommercialCreditAllows(stage.db, {
      customerId: CUSTOMER_ID,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      now: TODAY,
      audit: { entityId: CUSTOMER_ID, action: "PROPOSAL_APPROVE", performedBy: ACTOR_ID },
      auditWriter: stage.auditWriter,
    });
    assert.equal(released.status, "LIBERADO");
    assert.equal(released.allowed, true);
    assert.equal(stage.audits.length, 1);
  });

  it("vencimento no dia da análise não bloqueia prazo", async () => {
    const stage = createDb({
      customers: [customer()],
      orders: [{ customerId: CUSTOMER_ID, externalCustomerId: 100 }],
      titles: [openTitle({ dueDate: new Date(2026, 9, 19) })],
    });
    const decision = await assertCommercialCreditAllows(stage.db, {
      customerId: CUSTOMER_ID,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      now: TODAY,
    });
    assert.equal(decision.status, "LIBERADO");
  });

  it("sincronismo falho permanece não verificado", async () => {
    const stage = createDb({
      customers: [customer()],
      orders: [{ customerId: CUSTOMER_ID, externalCustomerId: 100 }],
      titles: [],
      run: { status: "FAILED", payloadComplete: false },
    });
    await assert.rejects(
      () =>
        assertCommercialCreditAllows(stage.db, {
          customerId: CUSTOMER_ID,
          enforcement: "CREDIT_GRANT",
          paymentTerms: "30",
          cadastral: { score: 99, verdict: "VENDA LIBERADA" },
          now: TODAY,
        }),
      (error: unknown) => error instanceof CommercialCreditDeniedError && error.reason === "FINANCIAL_UNVERIFIED"
    );
  });

  it("vínculo societário retém análise sem somar o saldo do relacionado", async () => {
    const stage = createDb({
      customers: [
        customer(),
        customer({ id: RELATED_ID, taxId: RELATED_CNPJ, nomusExternalPersonId: 200 }),
      ],
      orders: [
        { customerId: CUSTOMER_ID, externalCustomerId: 100 },
        { customerId: RELATED_ID, externalCustomerId: 200 },
      ],
      titles: [
        openTitle({
          personId: 200,
          personCnpj: RELATED_CNPJ,
          dueDate: new Date(2026, 8, 1),
          balanceReceivable: 987654.32,
          amountReceivable: 987654.32,
        }),
      ],
      links: [{ customerId: CUSTOMER_ID, relatedCustomerId: RELATED_ID }],
    });
    await assert.rejects(
      () =>
        assertCommercialCreditAllows(stage.db, {
          customerId: CUSTOMER_ID,
          enforcement: "CREDIT_GRANT",
          paymentTerms: "45",
          now: TODAY,
          audit: { entityId: CUSTOMER_ID, action: "GENERATE_SALES_ORDER", performedBy: ACTOR_ID },
          auditWriter: stage.auditWriter,
        }),
      (error: unknown) => {
        assert.ok(error instanceof CommercialCreditDeniedError);
        assert.equal(error.status, "BLOQUEADO");
        assert.equal(error.reason, "RELATED_PARTY_DELINQUENT");
        return true;
      }
    );
    assert.equal(JSON.stringify(stage.audits[0]).includes("987654"), false);
  });

  it("rascunho do mesmo inadimplente continua permitido", async () => {
    const stage = createDb({
      customers: [customer()],
      orders: [{ customerId: CUSTOMER_ID, externalCustomerId: 100 }],
      titles: [openTitle()],
    });
    const draft = await assertCommercialCreditAllows(stage.db, {
      customerId: CUSTOMER_ID,
      enforcement: "DRAFT",
      paymentTerms: "30",
      now: TODAY,
      audit: { entityId: CUSTOMER_ID, action: "PROPOSAL_DRAFT", performedBy: ACTOR_ID },
      auditWriter: stage.auditWriter,
    });
    assert.equal(draft.allowed, true);
    assert.equal(draft.customerStatus, "BLOQUEADO");
    assert.equal(stage.audits.length, 0);
  });

  it("exceção de Financeiro desbloqueia o escopo e a segunda concessão concorrente falha", async () => {
    const stage = createDb({
      customers: [customer()],
      orders: [{ customerId: CUSTOMER_ID, externalCustomerId: 100 }],
      titles: [openTitle()],
    });
    const input = {
      customerId: CUSTOMER_ID,
      scope: "OVERDUE",
      justification: "Financeiro conferiu o recebimento e autorizou este prazo.",
      expiresAt: new Date(2026, 10, 19),
      actor: financeActor,
      now: TODAY,
      auditWriter: stage.auditWriter,
    };
    const [first, second] = await Promise.allSettled([
      grantCommercialCreditException(stage.db, input),
      grantCommercialCreditException(stage.db, input),
    ]);
    const fulfilled = [first, second].filter((row) => row.status === "fulfilled");
    const rejected = [first, second].filter((row) => row.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].status === "rejected");
    assert.ok(rejected[0].reason instanceof CommercialCreditExceptionError);
    assert.equal(rejected[0].reason.code, "EXCEPTION_ALREADY_ACTIVE");
    assert.equal(stage.audits.filter((row) => row.action === "GRANT").length, 1);

    const released = await assertCommercialCreditAllows(stage.db, {
      customerId: CUSTOMER_ID,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      now: TODAY,
    });
    assert.equal(released.status, "LIBERADO");
    assert.equal(released.reason, "EXCEPTION_APPLIED");
  });

  it("SUPER_ADMIN sem permissão explícita não grava exceção", async () => {
    const stage = createDb({ customers: [customer()] });
    await assert.rejects(
      () =>
        grantCommercialCreditException(stage.db, {
          customerId: CUSTOMER_ID,
          scope: "OVERDUE",
          justification: "Tentativa implícita pelo papel de super administrador.",
          expiresAt: new Date(2026, 10, 19),
          actor: { id: ACTOR_ID, role: "SUPER_ADMIN", assignedPermissions: [] },
          now: TODAY,
          auditWriter: stage.auditWriter,
        }),
      (error: unknown) => error instanceof CommercialCreditExceptionError && error.code === "EXCEPTION_IMPLICIT_SUPER_ADMIN"
    );
    assert.equal(stage.exceptions.length, 0);
    assert.equal(stage.audits.length, 0);
  });

  it("protesto interno confirmado no título aberto gera bloqueio crítico", async () => {
    const stage = createDb({
      customers: [customer()],
      orders: [{ customerId: CUSTOMER_ID, externalCustomerId: 100 }],
      titles: [
        openTitle({
          dueDate: new Date(2026, 10, 19),
          rawPayload: { protestado: true },
        }),
      ],
    });
    await assert.rejects(
      () =>
        assertCommercialCreditAllows(stage.db, {
          customerId: CUSTOMER_ID,
          enforcement: "CREDIT_GRANT",
          paymentTerms: "30",
          cadastral: { score: 99, verdict: "VENDA LIBERADA" },
          now: TODAY,
        }),
      (error: unknown) =>
        error instanceof CommercialCreditDeniedError && error.status === "BLOQUEIO_CRITICO" && error.reason === "INTERNAL_PROTEST"
    );
  });

  it("protesto externo vigente bloqueia cliente regular no stage", async () => {
    const stage = createDb({
      customers: [customer()],
      orders: [{ customerId: CUSTOMER_ID, externalCustomerId: 100 }],
      titles: [openTitle({ personId: 999, personCnpj: null, externalId: 2, balanceReceivable: 10, amountReceivable: 10 })],
      protests: [
        {
          customerId: CUSTOMER_ID,
          status: "CONFIRMED_CURRENT",
          effectiveFrom: new Date(2026, 9, 1),
          effectiveUntil: null,
        },
      ],
    });
    await assert.rejects(
      () =>
        assertCommercialCreditAllows(stage.db, {
          customerId: CUSTOMER_ID,
          enforcement: "CREDIT_GRANT",
          paymentTerms: "30",
          now: TODAY,
        }),
      (error: unknown) => error instanceof CommercialCreditDeniedError && error.reason === "EXTERNAL_PROTEST"
    );
  });
});

describe("pontos de concessão de crédito", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const server = readFileSync(join(root, "server.ts"), "utf8");
  const salesSync = readFileSync(join(root, "scripts/nomusSalesOrdersSyncV1.ts"), "utf8");
  const proposalSync = readFileSync(join(root, "scripts/nomusProposalsSyncV1.ts"), "utf8");

  function between(source: string, start: string, end: string) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `${start} → ${end}`);
    return source.slice(from, to);
  }

  it("aprovação, alteração de prazo, criação aprovada e pedido chamam o mesmo motor", () => {
    const generate = between(server, 'app.post("/api/proposals/:id/generate-sales-order"', 'app.post("/api/proposals"');
    const create = between(server, 'app.post("/api/proposals", requireAppAuth', 'app.put("/api/proposals/:id"');
    const update = between(server, 'app.put("/api/proposals/:id"', 'app.patch("/api/proposals/:id/status"');
    const status = between(server, 'app.patch("/api/proposals/:id/status"', 'app.delete("/api/proposals/:id"');
    for (const handler of [generate, create, update, status]) {
      assert.equal(handler.includes("assertCommercialCreditAllows"), true);
    }
    assert.ok(generate.indexOf("assertCommercialCreditAllows") < generate.indexOf("salesOrder.create"));
    assert.ok(create.indexOf("assertCommercialCreditAllows") < create.indexOf("proposal.create"));
    assert.ok(create.includes('requestedStatus === "APPROVED"'));
    assert.ok(update.indexOf("assertCommercialCreditAllows") < update.indexOf("proposal.update"));
    assert.ok(status.indexOf("assertCommercialCreditAllows") < status.indexOf("proposal.update"));
    assert.equal(server.split("salesOrder.create(").length - 1, 1);
  });

  it("a exceção não usa o bypass de SUPER_ADMIN nem o corpo como antecipação", () => {
    const route = between(server, 'app.post("/api/commercial/credit-exceptions"', "const PROPOSAL_STATUS_VALUES");
    assert.equal(route.includes("assignedPermissions: auth.permissions"), true);
    assert.equal(route.includes("effectivePermissions"), false);
    assert.equal(route.includes("requireResource"), false);
    assert.equal(server.includes("advanceConfirmation:"), false);
    assert.equal(server.includes("REQUEST_BODY"), false);
  });

  it("sync Nomus só espelha obrigação com documento externo", () => {
    assert.ok(salesSync.indexOf("assertExistingNomusObligationMirror") < salesSync.indexOf("salesOrder.create("));
    assert.ok(proposalSync.indexOf("assertExistingNomusObligationMirror") < proposalSync.indexOf("proposal.create("));
    assert.ok(salesSync.includes("externalDocumentId: nomusHeader.externalSalesOrderId"));
    assert.ok(proposalSync.includes("externalDocumentId: proposalCreateData.externalProposalId"));
  });
});
