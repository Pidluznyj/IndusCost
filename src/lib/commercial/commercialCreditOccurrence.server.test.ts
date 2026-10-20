import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { readCommercialCreditDecision } from "./commercialCreditDecision.server.js";
import {
  CommercialCreditOccurrenceError,
  createCommercialCreditOccurrence,
  listCommercialCreditOccurrences,
  upsertNomusConfirmedProtest,
  type CommercialCreditOccurrenceStore,
} from "./commercialCreditOccurrence.server.js";

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const ACTOR = "44444444-4444-4444-8444-444444444444";
const CNPJ = "11444777000161";
const TODAY = new Date(2026, 9, 19, 12, 0, 0);
const SYNCED = new Date(2026, 9, 19, 9, 0, 0);
const JUSTIFICATION = "Protesto confirmado em cartório e ainda pendente de regularização.";
const FINANCE = { id: ACTOR, role: "ADMIN", assignedPermissions: ["commercial.credit.exception.grant"] };

type Title = {
  externalId: number;
  personId: number;
  personName: string;
  personCnpj: string;
  companyName: string;
  description: string;
  comments: null;
  dueDate: Date;
  settlementDate: Date | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  sourceInvoiceId: number;
  sourceInvoiceNumber: string;
  paymentMethodName: string;
  bankAccountName: null;
  suspendCollection: boolean;
  status: boolean;
  syncedAt: Date;
  sourcePresenceStatus: string;
  rawPayload: Record<string, unknown>;
};

type Row = {
  id: string;
  customerId: string;
  titleExternalId: number | null;
  kind: string;
  status: string;
  origin: string;
  occurredAt: Date;
  responsibleUserId: string;
  justification: string;
  dedupeKey: string;
  closesOccurrenceId: string | null;
  closedAt: Date | null;
  closedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function settledTitle(protest: boolean): Title {
  return {
    externalId: 9,
    personId: 100,
    personName: "Cliente",
    personCnpj: CNPJ,
    companyName: "Lazarios",
    description: "Parcela",
    comments: null,
    dueDate: new Date(2026, 8, 1),
    settlementDate: new Date(2026, 9, 10),
    amountReceivable: 1000,
    amountReceived: 1000,
    balanceReceivable: 0,
    sourceInvoiceId: 50,
    sourceInvoiceNumber: "100",
    paymentMethodName: "Boleto",
    bankAccountName: null,
    suspendCollection: false,
    status: false,
    syncedAt: SYNCED,
    sourcePresenceStatus: "PRESENT",
    rawPayload: protest ? { protestado: true } : { id: 9 },
  };
}

function proof() {
  return [{ fileName: "comprovante.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 regularizacao formal") }];
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => (value == null ? row[key] == null : row[key] === value));
}

function createStore(title: Title) {
  const titles = [title];
  const rows: Row[] = [];
  const evidences: Array<{ id: string; occurrenceId: string; fileName: string }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const store = {
    customer: {
      findUnique: async () => ({ id: CUSTOMER, taxId: CNPJ, nomusExternalPersonId: 100 }),
      findMany: async () => [{ id: CUSTOMER }],
    },
    salesOrder: { findMany: async () => [] },
    nomusAccountsReceivable: {
      aggregate: async () => ({ _max: { syncedAt: SYNCED } }),
      findMany: async () => titles,
      findFirst: async ({ where }: { where: { externalId: number; personId: number } }) =>
        titles.find((row) => row.externalId === where.externalId && row.personId === where.personId) ?? null,
    },
    nomusSourceSyncRun: {
      findFirst: async () => ({ status: "SUCCESS", payloadComplete: true, startedAt: SYNCED }),
    },
    customerCorporateLink: { findMany: async () => [] },
    commercialExternalProtest: { findMany: async () => [] },
    commercialCreditException: { findMany: async () => [] },
    commercialCorporateMembership: { findMany: async () => [], findFirst: async () => null },
    customerCnpjLookup: { findFirst: async () => null },
    commercialCreditOccurrence: {
      findMany: async ({ where }: { where: { customerId: string } }) =>
        rows
          .filter((row) => row.customerId === where.customerId)
          .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((row) => matches(row as unknown as Record<string, unknown>, where)) ?? null,
      create: async ({ data }: { data: Row }) => {
        if (rows.some((row) => row.dedupeKey === data.dedupeKey)) {
          const error = new Error("unique") as Error & { code: string };
          error.code = "P2002";
          throw error;
        }
        rows.push(data);
        return data;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((item) => item.id === where.id);
        if (!row) throw new Error("missing occurrence");
        Object.assign(row, data);
        return row;
      },
    },
    commercialCreditOccurrenceEvidence: {
      findMany: async ({ where }: { where: { occurrenceId?: string } }) =>
        evidences.filter((file) => where.occurrenceId == null || file.occurrenceId === where.occurrenceId),
      create: async ({ data }: { data: { id: string; occurrenceId: string; fileName: string } }) => {
        evidences.push(data);
        return data;
      },
    },
    $transaction: async <T>(fn: (tx: CommercialCreditOccurrenceStore) => Promise<T>) => fn(store as unknown as CommercialCreditOccurrenceStore),
  };
  return { store: store as unknown as CommercialCreditOccurrenceStore, titles, rows, audits };
}

async function decision(store: CommercialCreditOccurrenceStore) {
  return readCommercialCreditDecision(store as never, {
    customerId: CUSTOMER,
    enforcement: "CREDIT_GRANT",
    paymentTerms: "30",
    now: TODAY,
  });
}

describe("ocorrência de crédito — persistência", () => {
  it("cria encaminhamento sem bloqueio crítico e rejeita protesto duplicado", async () => {
    const { store } = createStore(settledTitle(false));
    const forwarded = await createCommercialCreditOccurrence(store, {
      customerId: CUSTOMER,
      kind: "PROTEST_FORWARDED",
      titleExternalId: 9,
      occurredAt: TODAY,
      justification: JUSTIFICATION,
      actor: FINANCE,
      now: TODAY,
      auditWriter: async () => undefined,
    });
    assert.equal(forwarded.kind, "PROTEST_FORWARDED");
    assert.equal(forwarded.blocksCredit, false);
    assert.equal((await decision(store)).decision.customerStatus, "LIBERADO");

    const confirmed = await createCommercialCreditOccurrence(store, {
      customerId: CUSTOMER,
      kind: "PROTEST_CONFIRMED",
      titleExternalId: 9,
      occurredAt: TODAY,
      justification: JUSTIFICATION,
      actor: FINANCE,
      now: TODAY,
      auditWriter: async () => undefined,
    });
    assert.equal(confirmed.blocksCredit, true);
    await assert.rejects(
      () =>
        createCommercialCreditOccurrence(store, {
          customerId: CUSTOMER,
          kind: "PROTEST_CONFIRMED",
          titleExternalId: 9,
          occurredAt: TODAY,
          justification: JUSTIFICATION,
          actor: FINANCE,
          now: TODAY,
          auditWriter: async () => undefined,
        }),
      (error: unknown) => error instanceof CommercialCreditOccurrenceError && error.code === "OCCURRENCE_DUPLICATE"
    );
  });

  it("integração Nomus não grava o mesmo protesto duas vezes", async () => {
    const { store, rows } = createStore(settledTitle(false));
    const first = await upsertNomusConfirmedProtest(store, {
      customerId: CUSTOMER,
      titleExternalId: 9,
      occurredAt: TODAY,
      justification: JUSTIFICATION,
      actor: FINANCE,
      now: TODAY,
      auditWriter: async () => undefined,
    });
    const second = await upsertNomusConfirmedProtest(store, {
      customerId: CUSTOMER,
      titleExternalId: 9,
      occurredAt: TODAY,
      justification: JUSTIFICATION,
      actor: FINANCE,
      now: TODAY,
      auditWriter: async () => undefined,
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.occurrence.id, first.occurrence.id);
    assert.equal(rows.filter((row) => row.kind === "PROTEST_CONFIRMED").length, 1);
  });

  it("quitação não cancela protesto; regularização com comprovante encerra e audita", async () => {
    const { store, titles, rows, audits } = createStore(settledTitle(true));
    const before = await decision(store);
    assert.equal(before.decision.customerStatus, "BLOQUEIO_CRITICO");
    assert.equal(rows.length, 0);
    assert.equal(titles[0]?.balanceReceivable, 0);
    assert.equal(titles[0]?.rawPayload.protestado, true);

    const created = await createCommercialCreditOccurrence(store, {
      customerId: CUSTOMER,
      kind: "PROTEST_CONFIRMED",
      titleExternalId: 9,
      occurredAt: TODAY,
      justification: JUSTIFICATION,
      actor: FINANCE,
      now: TODAY,
      auditWriter: async (entry) => {
        audits.push(entry);
      },
    });
    assert.equal((await decision(store)).decision.customerStatus, "BLOQUEIO_CRITICO");
    assert.equal(rows.find((row) => row.id === created.id)?.status, "CONFIRMED_PENDING");
    assert.equal(titles[0]?.rawPayload.protestado, true);

    await assert.rejects(
      () =>
        createCommercialCreditOccurrence(store, {
          customerId: CUSTOMER,
          kind: "REGULARIZATION",
          titleExternalId: 9,
          occurredAt: TODAY,
          justification: "Regularização formal autorizada pelo financeiro.",
          evidences: [],
          actor: FINANCE,
          now: TODAY,
          auditWriter: async (entry) => {
            audits.push(entry);
          },
        }),
      (error: unknown) => error instanceof CommercialCreditOccurrenceError && error.code === "OCCURRENCE_EVIDENCE"
    );

    await createCommercialCreditOccurrence(store, {
      customerId: CUSTOMER,
      kind: "REGULARIZATION",
      closesOccurrenceId: created.id,
      occurredAt: TODAY,
      justification: "Regularização formal autorizada pelo financeiro com comprovante.",
      evidences: proof(),
      actor: FINANCE,
      now: TODAY,
      fileStore: async () => ({
        storageKey: "commercial-credit/test/comprovante.pdf",
        fileName: "comprovante.pdf",
        fileSize: 32,
      }),
      auditWriter: async (entry) => {
        audits.push(entry);
      },
    });
    const after = await decision(store);
    assert.equal(after.decision.customerStatus, "LIBERADO");
    assert.equal(rows.find((row) => row.id === created.id)?.status, "CLOSED");
    assert.equal(titles[0]?.balanceReceivable, 0);
    assert.equal(titles[0]?.rawPayload.protestado, true);
    assert.ok(audits.some((entry) => entry.action === "CREATE"));
    assert.ok(audits.some((entry) => entry.action === "REGULARIZE"));
    assert.doesNotMatch(JSON.stringify(audits), /balanceReceivable|amountReceivable|overdueAmount/);
    const history = await listCommercialCreditOccurrences(store, CUSTOMER);
    assert.ok(history.some((row) => row.kind === "REGULARIZATION" && row.evidenceFileNames.includes("comprovante.pdf")));
  });

  it("rejeita quem não tem permissão explícita de Financeiro ou Diretoria", async () => {
    const { store } = createStore(settledTitle(false));
    await assert.rejects(
      () =>
        createCommercialCreditOccurrence(store, {
          customerId: CUSTOMER,
          kind: "NEGOTIATION",
          occurredAt: TODAY,
          justification: JUSTIFICATION,
          actor: { id: ACTOR, role: "SUPER_ADMIN", assignedPermissions: [] },
          now: TODAY,
        }),
      (error: unknown) =>
        error instanceof CommercialCreditOccurrenceError && error.code === "OCCURRENCE_IMPLICIT_SUPER_ADMIN"
    );
    await assert.rejects(
      () =>
        createCommercialCreditOccurrence(store, {
          customerId: CUSTOMER,
          kind: "NEGOTIATION",
          occurredAt: TODAY,
          justification: JUSTIFICATION,
          actor: { id: ACTOR, role: "SELLER", assignedPermissions: ["customers.view"] },
          now: TODAY,
        }),
      (error: unknown) => error instanceof CommercialCreditOccurrenceError && error.code === "OCCURRENCE_FORBIDDEN"
    );
  });

  it("desfaz a ocorrência se a auditoria falha", async () => {
    const { store } = createStore(settledTitle(false));
    await assert.rejects(
      () =>
        createCommercialCreditOccurrence(store, {
          customerId: CUSTOMER,
          kind: "PROTEST_CONFIRMED",
          titleExternalId: 9,
          occurredAt: TODAY,
          justification: JUSTIFICATION,
          actor: FINANCE,
          now: TODAY,
          auditWriter: async () => {
            throw new Error("audit");
          },
        }),
      /auditoria/
    );
    const history = await listCommercialCreditOccurrences(store, CUSTOMER);
    assert.equal(history[0]?.blocksCredit, false);
    assert.equal((await decision(store)).decision.customerStatus, "LIBERADO");
  });

  it("não altera título financeiro e a rota usa a permissão atribuída", () => {
    const source = readFileSync(new URL("./commercialCreditOccurrence.server.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /balanceReceivable|isFinanceArReceivedOrSettled|nomusAccountsReceivable\.update/);
    const routes = readFileSync(new URL("../companyIntelligenceRoutes.ts", import.meta.url), "utf8");
    const slice = routes.slice(routes.indexOf("/api/customers/:id/credit-occurrences"));
    assert.match(slice, /assignedPermissions: user\.permissions/);
    assert.doesNotMatch(slice, /effectivePermissions|requireResource/);
    const panel = readFileSync(
      new URL("../../components/customers/CustomerCnpjIntelligencePanel.tsx", import.meta.url),
      "utf8"
    );
    const customer = readFileSync(new URL("../../components/CustomerModule.tsx", import.meta.url), "utf8");
    assert.match(panel, /CustomerCreditOccurrenceHistory/);
    assert.match(customer, /Ocorrências de crédito/);
  });
});
