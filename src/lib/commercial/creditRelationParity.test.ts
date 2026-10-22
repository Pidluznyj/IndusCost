/**
 * O mesmo CNPJ, no mesmo instante, produz o mesmo score e a mesma decisão
 * na lista, no detalhe, no Excel, no relatório e na autorização.
 * Indício cadastral não confirma vínculo. Não consulta bureau.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CommercialCreditDeniedError } from "./commercialCreditDecision.js";
import {
  assertCommercialCreditAllows,
  readCommercialCreditDecision,
} from "./commercialCreditDecision.server.js";
import { buildCommercialCreditIntelligenceView } from "./commercialCreditIntelligenceView.js";
import { loadPortfolioCredit } from "./portfolioCredit.server.js";
import { loadSameRootPeerMap } from "./corporateRadarCatalog.server.js";
import { mapCustomerListReportExportRow } from "../customerListReportExport.js";

const NOW = new Date("2026-10-22T15:00:00.000Z");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";

function validCnpj(base12: string): string {
  const digit = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((total, char, index) => total + Number(char) * weights[index]!, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const first = digit(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = digit(base12 + String(first), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${first}${second}`;
}

const CNPJ_A = validCnpj("123456780001");
const CNPJ_B = validCnpj("123456780002");
const CNPJ_C = validCnpj("223456780001");
const CNPJ_D = validCnpj("323456780001");

type CustomerRow = {
  id: string;
  taxId: string;
  companyName: string;
  nomusExternalPersonId: number;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
};

type TitleRow = {
  externalId: number;
  personId: number;
  personCnpj: string;
  dueDate: Date;
  settlementDate: Date | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  syncedAt: Date;
};

function customer(id: string, taxId: string, personId: number, extra: Partial<CustomerRow> = {}): CustomerRow {
  return { id, taxId, companyName: `Cliente ${personId}`, nomusExternalPersonId: personId, ...extra };
}

function overdueTitle(personId: number, cnpj: string, externalId: number): TitleRow {
  return {
    externalId,
    personId,
    personCnpj: cnpj,
    dueDate: new Date("2026-10-01T00:00:00.000Z"),
    settlementDate: null,
    amountReceivable: 6560,
    amountReceived: 0,
    balanceReceivable: 6560,
    syncedAt: NOW,
  };
}

function decorateTitle(row: TitleRow) {
  return {
    ...row,
    personName: "Cliente",
    companyName: "Lazarios",
    description: "NF",
    comments: null,
    sourceInvoiceId: 50,
    sourceInvoiceNumber: "100",
    paymentMethodName: "BOLETO",
    bankAccountName: null,
    suspendCollection: false,
    status: false,
    sourcePresenceStatus: "PRESENT",
    rawPayload: { id: row.externalId },
  };
}

function createDb(input: {
  customers: CustomerRow[];
  titles?: TitleRow[];
  links?: Array<{ customerId: string; relatedCustomerId: string; status?: string }>;
  quod?: Array<Record<string, unknown>>;
  ieptb?: Array<Record<string, unknown>>;
  quodThrows?: boolean;
  membershipThrows?: boolean;
}) {
  const customers = [...input.customers].sort((left, right) => left.id.localeCompare(right.id));
  const titles = input.titles ?? [];
  const links = input.links ?? [];
  const matchCustomer = (args?: { where?: Record<string, unknown>; skip?: number; take?: number }) => {
    const where = args?.where ?? {};
    let rows = customers;
    const idIn = (where.id as { in?: string[] } | undefined)?.in;
    const taxIn = (where.taxId as { in?: string[] } | undefined)?.in;
    const startsWith = (where.taxId as { startsWith?: string } | undefined)?.startsWith;
    const prefixes = ((where.OR as Array<{ taxId?: { startsWith?: string } }> | undefined) ?? [])
      .map((item) => item.taxId?.startsWith)
      .filter((value): value is string => Boolean(value));
    if (idIn) rows = rows.filter((row) => idIn.includes(row.id));
    if (taxIn) rows = rows.filter((row) => taxIn.includes(row.taxId));
    if (startsWith) rows = rows.filter((row) => row.taxId.startsWith(startsWith));
    if (prefixes.length > 0) rows = rows.filter((row) => prefixes.some((prefix) => row.taxId.startsWith(prefix)));
    const skip = args?.skip ?? 0;
    const take = args?.take ?? rows.length;
    return rows.slice(skip, skip + take);
  };
  return {
    customer: {
      findUnique: async ({ where }: { where: { id: string } }) => customers.find((row) => row.id === where.id) ?? null,
      findMany: async (args?: { where?: Record<string, unknown>; skip?: number; take?: number }) => matchCustomer(args),
    },
    salesOrder: {
      findMany: async ({ where }: { where?: { customerId?: string | { in?: string[] } } }) => {
        const wanted = where?.customerId;
        return customers
          .filter((row) => {
            if (!wanted) return true;
            if (typeof wanted === "string") return row.id === wanted;
            return wanted.in?.includes(row.id) ?? false;
          })
          .map((row) => ({ customerId: row.id, externalCustomerId: row.nomusExternalPersonId }));
      },
    },
    nomusAccountsReceivable: {
      aggregate: async () => ({ _max: { syncedAt: NOW } }),
      findMany: async ({ where }: { where?: { personId?: number | { in?: number[] } } }) => {
        const personId = where?.personId;
        return titles
          .filter((row) => {
            if (personId == null) return true;
            if (typeof personId === "number") return row.personId === personId;
            return personId.in?.includes(row.personId) ?? false;
          })
          .map(decorateTitle);
      },
    },
    nomusSourceSyncRun: {
      findFirst: async () => ({ status: "SUCCESS", payloadComplete: true, startedAt: NOW }),
    },
    customerCorporateLink: {
      findMany: async (args?: { where?: { OR?: Array<{ customerId?: { in?: string[] }; relatedCustomerId?: { in?: string[] } }> } }) => {
        const ids = new Set<string>();
        for (const clause of args?.where?.OR ?? []) {
          for (const id of clause.customerId?.in ?? []) ids.add(id);
          for (const id of clause.relatedCustomerId?.in ?? []) ids.add(id);
        }
        return links.filter((row) => ids.size === 0 || ids.has(row.customerId) || ids.has(row.relatedCustomerId));
      },
    },
    commercialExternalProtest: { findMany: async () => [] },
    commercialCreditException: { findMany: async () => [] },
    commercialCreditOccurrence: { findMany: async () => [] },
    commercialCorporateMembership: {
      findMany: async () => {
        if (input.membershipThrows) throw new Error("qsa-down");
        return [];
      },
      findFirst: async () => null,
      create: async () => {
        throw new Error("read");
      },
    },
    customerCnpjLookup: { findFirst: async () => null, findMany: async () => [] },
    quodDossierConsultation: {
      findMany: async () => {
        if (input.quodThrows) throw new Error("quod-down");
        return input.quod ?? [];
      },
    },
    ieptbOnlineConsultation: { findMany: async () => input.ieptb ?? [] },
  };
}

const favorableQuod = (customerId: string, cnpj: string, restriction = false) => ({
  customerId,
  cnpj,
  status: "SUCCEEDED",
  confirmedRestriction: restriction,
  insufficient: false,
  validUntil: new Date("2026-12-01T00:00:00.000Z"),
  consultedAt: NOW,
});

const favorableIeptb = (customerId: string, cnpj: string, protest = false) => ({
  customerId,
  cnpj,
  status: "SUCCEEDED",
  confirmedProtest: protest,
  confirmedClear: !protest,
  insufficient: false,
  validUntil: new Date("2026-12-01T00:00:00.000Z"),
  consultedAt: NOW,
});

async function compareConsumers(db: ReturnType<typeof createDb>, row: CustomerRow) {
  const read = await readCommercialCreditDecision(db as never, {
    customerId: row.id,
    enforcement: "CREDIT_GRANT",
    paymentTerms: "30",
    cadastral: { score: 100, verdict: "VENDA LIBERADA" },
    now: NOW,
    externalProtestQuery: { env: {} },
  });
  const portfolio = await loadPortfolioCredit(db as never, [{
    id: row.id,
    taxId: row.taxId,
    nomusExternalPersonId: row.nomusExternalPersonId,
    cnpjRisk: { score: 100, verdict: "VENDA LIBERADA" },
  }], NOW);
  const snap = portfolio.get(row.id);
  assert.ok(snap);
  const view = buildCommercialCreditIntelligenceView({
    decision: read.decision,
    delinquency: read.delinquency,
    externalProtest: read.externalProtest,
    revealFinancial: false,
  });
  const exported = mapCustomerListReportExportRow({
    companyName: row.companyName,
    portfolioCredit: snap,
  });
  assert.equal(snap.decision.customerStatus, read.decision.customerStatus);
  assert.equal(snap.decision.reason, read.decision.reason);
  assert.equal(snap.confidence.label, view.confidenceScoreLabel);
  assert.equal(snap.confidence.policyVersion, view.confidencePolicyVersion);
  assert.equal(exported.cnpjScore, snap.confidence.label);
  assert.match(exported.creditDecision, new RegExp(snap.decision.decisionTitle));
  assert.equal(exported.cnpjScore.includes("VENDA"), false);
  if (read.decision.customerStatus === "LIBERADO") {
    const allowed = await assertCommercialCreditAllows(db as never, {
      customerId: row.id,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      cadastral: { score: 100, verdict: "VENDA LIBERADA" },
      now: NOW,
    });
    assert.equal(allowed.customerStatus, read.decision.customerStatus);
    assert.equal(allowed.reason, read.decision.reason);
  } else {
    await assert.rejects(
      () => assertCommercialCreditAllows(db as never, {
        customerId: row.id,
        enforcement: "CREDIT_GRANT",
        paymentTerms: "30",
        cadastral: { score: 100, verdict: "VENDA LIBERADA" },
        now: NOW,
      }),
      (error: unknown) => {
        assert.ok(error instanceof CommercialCreditDeniedError);
        assert.equal(error.reason, read.decision.reason);
        return true;
      }
    );
    assert.equal(read.decision.allowed, false);
  }
  return { read, snap };
}

describe("paridade da decisão entre carteira, detalhe e operação", () => {
  it("indício de telefone segura a análise e não confirma o grupo nem transfere a dívida", async () => {
    const phone = "11987654321";
    const db = createDb({
      customers: [
        customer(A, CNPJ_A, 100, { phone }),
        customer(C, CNPJ_C, 300, { phone }),
      ],
      titles: [overdueTitle(300, CNPJ_C, 9)],
      quod: [favorableQuod(A, CNPJ_A), favorableQuod(C, CNPJ_C)],
      ieptb: [favorableIeptb(A, CNPJ_A), favorableIeptb(C, CNPJ_C)],
    });
    const { read, snap } = await compareConsumers(db, customer(A, CNPJ_A, 100, { phone }));
    assert.equal(read.decision.customerStatus, "EM_ANALISE");
    assert.equal(read.decision.reason, "RELATED_PARTY_UNVERIFIED");
    assert.equal(snap.decision.reasonGroup, "avaliacao_pendente");
    assert.equal(snap.confidence.score, 100);
    assert.equal(read.decision.allowed, false);
  });

  it("grupo confirmado inadimplente bloqueia quem não tem dívida própria", async () => {
    const db = createDb({
      customers: [customer(A, CNPJ_A, 100), customer(B, CNPJ_B, 200)],
      titles: [overdueTitle(200, CNPJ_B, 9)],
      links: [{ customerId: A, relatedCustomerId: B, status: "CONFIRMED" }],
      quod: [favorableQuod(A, CNPJ_A), favorableQuod(B, CNPJ_B)],
      ieptb: [favorableIeptb(A, CNPJ_A), favorableIeptb(B, CNPJ_B)],
    });
    const { read, snap } = await compareConsumers(db, customer(A, CNPJ_A, 100));
    assert.equal(read.decision.customerStatus, "BLOQUEADO");
    assert.equal(read.decision.reason, "RELATED_PARTY_DELINQUENT");
    assert.equal(snap.decision.reasonGroup, "risco_compartilhado");
    assert.equal(snap.confidence.score, 100);
    assert.equal(read.decision.allowed, false);
  });

  it("QUOD restritivo, IEPTB positivo, fonte ausente e falha de leitura ficam iguais nos consumidores", async () => {
    const regular = createDb({
      customers: [customer(A, CNPJ_A, 100)],
      quod: [favorableQuod(A, CNPJ_A, true)],
      ieptb: [favorableIeptb(A, CNPJ_A)],
    });
    const restricted = await compareConsumers(regular, customer(A, CNPJ_A, 100));
    assert.equal(restricted.read.decision.customerStatus, "BLOQUEADO");
    assert.equal(restricted.read.decision.reason, "QUOD_EXTERNAL_RESTRICTION");
    assert.equal(restricted.snap.confidence.quod.status, "RESTRITIVA");
    assert.notEqual(restricted.snap.confidence.quod.status, "AUSENTE");

    const protested = createDb({
      customers: [customer(A, CNPJ_A, 100)],
      quod: [favorableQuod(A, CNPJ_A)],
      ieptb: [favorableIeptb(A, CNPJ_A, true)],
    });
    const protest = await compareConsumers(protested, customer(A, CNPJ_A, 100));
    assert.equal(protest.read.decision.customerStatus, "BLOQUEADO");
    assert.equal(protest.read.decision.reason, "IEPTB_NATIONAL_PROTEST");

    const absent = createDb({ customers: [customer(D, CNPJ_D, 400)] });
    const clean = await compareConsumers(absent, customer(D, CNPJ_D, 400));
    assert.equal(clean.read.decision.customerStatus, "LIBERADO");
    assert.equal(clean.snap.confidence.quod.status, "AUSENTE");
    assert.equal(clean.snap.confidence.ieptb.status, "AUSENTE");
    assert.equal(clean.read.decision.allowed, true);

    const failed = createDb({ customers: [customer(A, CNPJ_A, 100)], quodThrows: true });
    const failure = await compareConsumers(failed, customer(A, CNPJ_A, 100));
    assert.equal(failure.read.decision.customerStatus, "BLOQUEADO");
    assert.equal(failure.snap.confidence.quod.status, "FALHA");
    assert.notEqual(failure.snap.decision.customerStatus, "LIBERADO");
    assert.equal(failure.read.decision.allowed, false);
  });

  it("um lote grande não muda a decisão de quem seria consultado sozinho", async () => {
    const extras = Array.from({ length: 40 }, (_, index) => {
      const root = String(52000000 + index).padStart(8, "0");
      return customer(
        `55555555-5555-4555-8555-${String(index + 1).padStart(12, "0")}`,
        validCnpj(`${root}0001`),
        1000 + index
      );
    });
    const rows = [customer(A, CNPJ_A, 100), customer(B, CNPJ_B, 200), customer(D, CNPJ_D, 400), ...extras];
    const db = createDb({
      customers: rows,
      titles: [overdueTitle(200, CNPJ_B, 9)],
      links: [{ customerId: A, relatedCustomerId: B, status: "CONFIRMED" }],
    });
    const alone = await loadPortfolioCredit(db as never, [{ id: A, taxId: CNPJ_A, nomusExternalPersonId: 100, cnpjRisk: { score: 80 } }], NOW);
    const batch = await loadPortfolioCredit(
      db as never,
      rows.map((row) => ({ id: row.id, taxId: row.taxId, nomusExternalPersonId: row.nomusExternalPersonId, cnpjRisk: { score: 80 } })),
      NOW
    );
    const read = await readCommercialCreditDecision(db as never, {
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      cadastral: { score: 80, verdict: null },
      now: NOW,
      externalProtestQuery: { env: {} },
    });
    assert.equal(alone.get(A)?.decision.customerStatus, "BLOQUEADO");
    assert.equal(batch.get(A)?.decision.customerStatus, alone.get(A)?.decision.customerStatus);
    assert.equal(batch.get(A)?.decision.reason, alone.get(A)?.decision.reason);
    assert.equal(batch.get(A)?.confidence.label, alone.get(A)?.confidence.label);
    assert.equal(read.decision.customerStatus, batch.get(A)?.decision.customerStatus);
    assert.equal(read.decision.reason, batch.get(A)?.decision.reason);
    assert.equal(batch.get(D)?.decision.customerStatus, "LIBERADO");
  });

  it("o teto de uma raiz não coloca outra raiz em análise", async () => {
    const small = customer(D, CNPJ_D, 400);
    const wide = [customer(A, CNPJ_A, 100), customer(B, CNPJ_B, 200), customer(C, CNPJ_C, 300)];
    const loaded = await loadSameRootPeerMap({ customer: {
      findMany: async (args?: { where?: { OR?: Array<{ taxId?: { startsWith?: string } }> }; take?: number; skip?: number }) => {
        const prefixes = (args?.where?.OR ?? []).map((item) => item.taxId?.startsWith).filter((value): value is string => Boolean(value));
        const rows = [...wide, small].filter((row) => prefixes.length === 0 || prefixes.some((prefix) => row.taxId.startsWith(prefix)));
        return rows.slice(args?.skip ?? 0, (args?.skip ?? 0) + (args?.take ?? rows.length));
      },
    } }, [wide[0]!, small], { examineLimit: 2 });
    assert.equal(loaded.readFailed, false);
    assert.equal(loaded.overflowCustomerIds.has(A), true);
    assert.equal(loaded.overflowCustomerIds.has(D), false);
    assert.deepEqual(loaded.peers.get(D), []);
  });

  it("a carteira não depende do teto global antigo nem dispara protesto pago", () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const portfolio = readFileSync(join(directory, "portfolioCredit.server.ts"), "utf8");
    const relation = readFileSync(join(directory, "corporateRelation.server.ts"), "utf8");
    const decision = readFileSync(join(directory, "commercialCreditDecision.server.ts"), "utf8");
    assert.equal(portfolio.includes("2000"), false);
    assert.equal(portfolio.includes("resolveExternalProtestForDecision"), false);
    assert.equal(relation.includes("take: 8000"), false);
    assert.equal(decision.includes("take: 40"), false);
  });

  it("QSA indisponível preserva o bloqueio da filial e, sem restrição, fica em análise", async () => {
    const blockedDb = createDb({
      customers: [customer(A, CNPJ_A, 100), customer(B, CNPJ_B, 200)],
      titles: [overdueTitle(200, CNPJ_B, 9)],
      membershipThrows: true,
      quod: [favorableQuod(A, CNPJ_A), favorableQuod(B, CNPJ_B)],
      ieptb: [favorableIeptb(A, CNPJ_A), favorableIeptb(B, CNPJ_B)],
    });
    const blocked = await compareConsumers(blockedDb, customer(A, CNPJ_A, 100));
    assert.equal(blocked.read.decision.customerStatus, "BLOQUEADO");
    assert.equal(blocked.read.decision.reason, "RELATED_PARTY_DELINQUENT");
    assert.equal(blocked.snap.decision.customerStatus, "BLOQUEADO");
    assert.equal(blocked.snap.decision.reasonGroup, "risco_compartilhado");
    assert.equal(blocked.read.decision.reasons.includes("RELATED_PARTY_UNVERIFIED"), true);
    assert.equal(blocked.snap.decision.reasons.includes("RELATED_PARTY_UNVERIFIED"), true);
    assert.equal(blocked.read.decision.allowed, false);

    const openDb = createDb({
      customers: [customer(D, CNPJ_D, 400)],
      membershipThrows: true,
      quod: [favorableQuod(D, CNPJ_D)],
      ieptb: [favorableIeptb(D, CNPJ_D)],
    });
    const open = await compareConsumers(openDb, customer(D, CNPJ_D, 400));
    assert.equal(open.read.decision.customerStatus, "EM_ANALISE");
    assert.equal(open.read.decision.reason, "RELATED_PARTY_UNVERIFIED");
    assert.equal(open.snap.decision.customerStatus, "EM_ANALISE");
    assert.notEqual(open.read.decision.customerStatus, "LIBERADO");
    assert.equal(open.read.decision.allowed, false);
  });

  it("o teto do catálogo não libera e não apaga filial inadimplente já encontrada", async () => {
    const openDb = createDb({
      customers: [customer(A, CNPJ_A, 100), customer(D, CNPJ_D, 400)],
      quod: [favorableQuod(A, CNPJ_A), favorableQuod(D, CNPJ_D)],
      ieptb: [favorableIeptb(A, CNPJ_A), favorableIeptb(D, CNPJ_D)],
    });
    const limits = { maxCatalogRows: 1 };
    const page = await loadPortfolioCredit(
      openDb as never,
      [
        { id: A, taxId: CNPJ_A, nomusExternalPersonId: 100, cnpjRisk: { score: 80, verdict: null } },
        { id: D, taxId: CNPJ_D, nomusExternalPersonId: 400, cnpjRisk: { score: 80, verdict: null } },
      ],
      NOW,
      limits
    );
    const detail = await readCommercialCreditDecision(openDb as never, {
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      cadastral: { score: 80, verdict: null },
      now: NOW,
      relationLimits: limits,
      externalProtestQuery: { env: {} },
    });
    assert.equal(page.get(A)?.decision.customerStatus, "EM_ANALISE");
    assert.equal(page.get(D)?.decision.customerStatus, "EM_ANALISE");
    assert.equal(detail.decision.customerStatus, "EM_ANALISE");
    assert.equal(detail.decision.allowed, false);

    const filialDb = createDb({
      customers: [customer(A, CNPJ_A, 100), customer(B, CNPJ_B, 200)],
      titles: [overdueTitle(200, CNPJ_B, 9)],
      quod: [favorableQuod(A, CNPJ_A), favorableQuod(B, CNPJ_B)],
      ieptb: [favorableIeptb(A, CNPJ_A), favorableIeptb(B, CNPJ_B)],
    });
    const batch = await loadPortfolioCredit(
      filialDb as never,
      [{ id: A, taxId: CNPJ_A, nomusExternalPersonId: 100, cnpjRisk: { score: 100, verdict: null } }],
      NOW,
      limits
    );
    const filialDetail = await readCommercialCreditDecision(filialDb as never, {
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      cadastral: { score: 100, verdict: null },
      now: NOW,
      relationLimits: limits,
      externalProtestQuery: { env: {} },
    });
    assert.equal(batch.get(A)?.decision.customerStatus, "BLOQUEADO");
    assert.equal(batch.get(A)?.decision.reason, "RELATED_PARTY_DELINQUENT");
    assert.equal(filialDetail.decision.customerStatus, "BLOQUEADO");
    assert.equal(filialDetail.decision.reason, "RELATED_PARTY_DELINQUENT");
    assert.equal(filialDetail.decision.reasons.includes("RELATED_PARTY_UNVERIFIED"), true);

    const draft = await assertCommercialCreditAllows(filialDb as never, {
      customerId: A,
      enforcement: "DRAFT",
      paymentTerms: "30",
      cadastral: { score: 100, verdict: null },
      now: NOW,
    });
    assert.equal(draft.customerStatus, "BLOQUEADO");
    assert.equal(draft.allowed, true);
    await assert.rejects(
      () => assertCommercialCreditAllows(filialDb as never, {
        customerId: A,
        enforcement: "CREDIT_GRANT",
        paymentTerms: "30",
        cadastral: { score: 100, verdict: null },
        now: NOW,
      }),
      (error: unknown) => error instanceof CommercialCreditDeniedError && error.reason === "RELATED_PARTY_DELINQUENT"
    );
  });
});
