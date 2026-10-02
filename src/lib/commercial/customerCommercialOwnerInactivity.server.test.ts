import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "path";
import {
  applyCommercialOwnerInactivity,
  formatPortfolioInactivityPreview,
  previewCommercialOwnerInactivity,
} from "./customerCommercialOwnerInactivity.server.js";
import { PORTFOLIO_INACTIVITY_REASON } from "./customerCommercialOwnerInactivity.js";

const CUSTOMER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTOMER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REF = new Date("2026-08-30T15:00:00.000Z");
const LAST_PV = new Date("2026-06-01T15:00:00.000Z");
/** Início da atribuição a 89, 90 e 91 dias civis de REF (30/08/2026). */
const START_89 = new Date("2026-06-02T15:00:00.000Z");
const START_90 = new Date("2026-06-01T15:00:00.000Z");
const START_91 = new Date("2026-05-31T15:00:00.000Z");

type Owner = {
  id: string;
  customerId: string;
  isActive: boolean;
  sellerIdentityKey: string;
  sellerCanonicalName: string;
  createdAt: Date;
  assignmentStartedAt: Date;
  endedAt: Date | null;
  endReason: string | null;
  blockAutoAssignUntilManual: boolean;
  notes: string | null;
};

type NfeLink = {
  salesOrderId: string;
  nfeExternalId: number;
  nfeNumber: string | null;
  nfeStatus: number | null;
  dataProcessamento: Date | null;
  nomusNfeId?: string | null;
};

type Nfe = {
  id: string;
  externalId: number;
  numero: string | null;
  status: number | null;
  xmlDhEmi: Date | null;
  dataProcessamento: Date | null;
  xmlCancelamento: string | null;
};

type StockDoc = {
  id: string;
  idNfe: number | null;
  isCancelled: boolean;
  statusRaw: string | null;
  tipoDocumentoEstoque: string | null;
  dataDocumento: Date | null;
};

function validInvoiceSeed(orderId: string, iso = "2026-06-01", nfeExternalId = 111222) {
  const at = new Date(`${iso}T15:00:00.000Z`);
  return {
    nfeLinks: [
      {
        salesOrderId: orderId,
        nfeExternalId,
        nfeNumber: String(nfeExternalId),
        nfeStatus: 4,
        dataProcessamento: at,
        nomusNfeId: `nfe-${nfeExternalId}`,
      },
    ] satisfies NfeLink[],
    nfes: [
      {
        id: `nfe-${nfeExternalId}`,
        externalId: nfeExternalId,
        numero: String(nfeExternalId),
        status: 4,
        xmlDhEmi: at,
        dataProcessamento: at,
        xmlCancelamento: null,
      },
    ] satisfies Nfe[],
    stockDocuments: [
      {
        id: `st-${nfeExternalId}`,
        idNfe: nfeExternalId,
        isCancelled: false,
        statusRaw: "emitido",
        tipoDocumentoEstoque: "saida",
        dataDocumento: at,
      },
    ] satisfies StockDoc[],
  };
}

function createFakePrisma(seed: {
  customers?: Array<{ id: string; companyName: string; taxId: string; nomusExternalPersonId: number | null }>;
  owners?: Owner[];
  orders?: Array<{ id: string; customerId: string; orderCode: string; issueDate: Date; status: string }>;
  nfeLinks?: NfeLink[];
  nfes?: Nfe[];
  stockDocuments?: StockDoc[];
  proposals?: Array<{
    id: string;
    customerId: string;
    status: string;
    expectedCloseDate: Date | null;
    nextActionAt: Date | null;
    updatedAt: Date;
    number?: number | null;
    externalProposalCode?: string | null;
  }>;
  contacts?: Array<{
    id: string;
    customerId: string;
    contactDate: Date | null;
    createdAt: Date;
    outcome: string | null;
    reason: string | null;
    nextActionType: string | null;
    nextActionAt: Date | null;
  }>;
  failReviewCreate?: boolean;
}) {
  const owners = [...(seed.owners ?? [])];
  const reviews: unknown[] = [];
  const audits: unknown[] = [];
  const writes = {
    ownerUpdate: 0,
    reviewCreate: 0,
    auditCreate: 0,
    orderUpdate: 0,
    commissionUpdate: 0,
    nfeUpdate: 0,
    stockUpdate: 0,
  };

  const prisma = {
    crmCustomerCommercialOwner: {
      findMany: async (args?: { where?: { isActive?: boolean } }) => {
        if (args?.where?.isActive != null) return owners.filter((row) => row.isActive === args.where!.isActive);
        return owners;
      },
      findUnique: async ({ where }: { where: { customerId: string } }) =>
        owners.find((row) => row.customerId === where.customerId) ?? null,
      update: async ({ where, data }: { where: { customerId: string }; data: Partial<Owner> }) => {
        writes.ownerUpdate += 1;
        const row = owners.find((item) => item.customerId === where.customerId);
        if (!row) throw new Error("missing owner");
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { customerId: string; isActive?: boolean };
        data: Partial<Owner>;
      }) => {
        const row = owners.find(
          (item) =>
            item.customerId === where.customerId &&
            (where.isActive == null || item.isActive === where.isActive)
        );
        if (!row) return { count: 0 };
        writes.ownerUpdate += 1;
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    customer: {
      findMany: async (args?: { where?: { id?: { in: string[] } } }) => {
        const all = seed.customers ?? [];
        if (args?.where?.id?.in) return all.filter((row) => args.where!.id!.in.includes(row.id));
        return all;
      },
    },
    salesOrder: {
      findMany: async ({ where }: { where: { customerId: { in: string[] }; status?: string } }) => {
        return (seed.orders ?? []).filter((row) => {
          if (!where.customerId.in.includes(row.customerId)) return false;
          if (where.status && row.status !== where.status) return false;
          return true;
        });
      },
      update: async () => {
        writes.orderUpdate += 1;
      },
    },
    salesOrderNfeLink: {
      findMany: async ({ where }: { where: { salesOrderId: { in: string[] } } }) =>
        (seed.nfeLinks ?? []).filter((row) => where.salesOrderId.in.includes(row.salesOrderId)),
    },
    nomusNfe: {
      findMany: async ({ where }: { where: { externalId: { in: number[] } } }) =>
        (seed.nfes ?? []).filter((row) => where.externalId.in.includes(row.externalId)),
      update: async () => {
        writes.nfeUpdate += 1;
      },
    },
    nomusStockDocument: {
      findMany: async ({ where }: { where: { idNfe: { in: number[] } } }) =>
        (seed.stockDocuments ?? []).filter((row) => row.idNfe != null && where.idNfe.in.includes(row.idNfe)),
      update: async () => {
        writes.stockUpdate += 1;
      },
    },
    proposal: {
      findMany: async ({ where }: { where: { customerId: { in: string[] } } }) =>
        (seed.proposals ?? []).filter((row) => where.customerId.in.includes(row.customerId)),
    },
    commercialActivity: {
      findMany: async ({ where }: { where: { customerId: { in: string[] } } }) =>
        (seed.contacts ?? []).filter((row) => where.customerId.in.includes(row.customerId)),
    },
    crmCustomerPortfolioReview: {
      create: async ({ data }: { data: unknown }) => {
        writes.reviewCreate += 1;
        if (seed.failReviewCreate) throw new Error("review failed");
        reviews.push(data);
        return data;
      },
    },
    commercialAuditLog: {
      create: async ({ data }: { data: unknown }) => {
        writes.auditCreate += 1;
        audits.push(data);
        return data;
      },
    },
    commissionOrderSnapshot: { update: async () => { writes.commissionUpdate += 1; } },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };

  return { prisma: prisma as never, owners, reviews, audits, writes, raw: prisma };
}

const maria: Owner = {
  id: "own-1",
  customerId: CUSTOMER_A,
  isActive: true,
  sellerIdentityKey: "maria",
  sellerCanonicalName: "Maria",
  createdAt: new Date("2026-01-01T15:00:00.000Z"),
  assignmentStartedAt: new Date("2026-01-01T15:00:00.000Z"),
  endedAt: null,
  endReason: null,
  blockAutoAssignUntilManual: false,
  notes: null,
};

describe("apply/preview da revisão de carteira", () => {
  const invoiceA = validInvoiceSeed("so-1");

  it("preview não escreve banco", async () => {
    const fake = createFakePrisma({
      customers: [{ id: CUSTOMER_A, companyName: "Cliente A", taxId: "1", nomusExternalPersonId: 10 }],
      owners: [maria],
      orders: [{ id: "so-1", customerId: CUSTOMER_A, orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" }],
      ...invoiceA,
    });
    const preview = await previewCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(preview.removalEligible, 1);
    assert.equal(fake.writes.ownerUpdate, 0);
    assert.equal(fake.writes.reviewCreate, 0);
    assert.equal(fake.writes.auditCreate, 0);
  });

  it("preview de preservação expõe evidência da proposta sem mudar KEEP_OWNER", async () => {
    const fake = createFakePrisma({
      customers: [{ id: CUSTOMER_A, companyName: "Cliente A", taxId: "1", nomusExternalPersonId: 10 }],
      owners: [maria],
      orders: [{ id: "so-1", customerId: CUSTOMER_A, orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" }],
      ...invoiceA,
      proposals: [
        {
          id: "p1",
          customerId: CUSTOMER_A,
          status: "SENT",
          number: 4412,
          externalProposalCode: "PP-4412",
          expectedCloseDate: new Date("2026-09-15T15:00:00.000Z"),
          nextActionAt: new Date("2026-09-10T15:00:00.000Z"),
          updatedAt: new Date("2026-08-18T15:00:00.000Z"),
        },
      ],
    });
    const preview = await previewCommercialOwnerInactivity(REF, fake.prisma);
    const row = preview.rows.find((item) => item.customerId === CUSTOMER_A);
    assert.equal(row?.proposedAction, "KEEP_OWNER");
    assert.equal(row?.lastValidInvoiceNumber, "111222");
    assert.equal(row?.lastValidInvoiceDate, "2026-06-01");
    assert.equal(row?.daysSinceLastValidInvoice, 90);
    assert.equal(row?.crmEvidenceType, "ACTIVE_PROPOSAL");
    assert.equal(row?.evidenceType, "ACTIVE_PROPOSAL");
    assert.equal(row?.evidenceId, "p1");
    assert.equal(row?.evidenceStatus, "SENT");
    assert.equal(row?.evidenceCode, "PP-4412");
    assert.equal(row?.evidenceDate, "2026-09-15");
    assert.equal(row?.evidenceDateSource, "expectedCloseDate");
    assert.equal(row?.evidenceAgeDays, 12);
    assert.equal(row?.nextStepDate, "2026-09-10");
    assert.match(row?.preservationReason ?? "", /PP-4412/);
    assert.equal(fake.writes.ownerUpdate, 0);
    assert.equal(fake.writes.reviewCreate, 0);
    const text = formatPortfolioInactivityPreview(preview);
    assert.match(text, /evidenceType=ACTIVE_PROPOSAL/);
    assert.match(text, /evidenceStatus=SENT/);
    assert.match(text, /preservationReason=/);
  });

  it("apply remove, grava histórico e deixa o cliente sem responsável ativo", async () => {
    const fake = createFakePrisma({
      customers: [{ id: CUSTOMER_A, companyName: "Cliente A", taxId: "1", nomusExternalPersonId: 10 }],
      owners: [{ ...maria }],
      orders: [{ id: "so-1", customerId: CUSTOMER_A, orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" }],
      ...invoiceA,
    });
    const first = await applyCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(first.removed, 1);
    assert.equal(fake.owners[0]?.isActive, false);
    assert.equal(fake.owners[0]?.endReason, PORTFOLIO_INACTIVITY_REASON);
    assert.equal(fake.owners[0]?.blockAutoAssignUntilManual, true);
    assert.equal(fake.reviews.length, 1);
    assert.equal((fake.reviews[0] as { action: string }).action, "REMOVE_OWNER");
    assert.equal(fake.owners[0]?.createdAt.toISOString(), "2026-01-01T15:00:00.000Z");

    const second = await applyCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(second.removed, 0);
    assert.equal(second.results[0]?.action ?? "NO_CHANGE", "NO_CHANGE");
    assert.equal(fake.reviews.length, 1);
  });

  it("apply duplicado é idempotente para quem já está sem responsável", async () => {
    const fake = createFakePrisma({
      customers: [{ id: CUSTOMER_A, companyName: "Cliente A", taxId: "1", nomusExternalPersonId: 10 }],
      owners: [
        {
          ...maria,
          isActive: false,
          endedAt: REF,
          endReason: PORTFOLIO_INACTIVITY_REASON,
          blockAutoAssignUntilManual: true,
        },
      ],
      orders: [{ id: "so-1", customerId: CUSTOMER_A, orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" }],
      ...invoiceA,
    });
    const result = await applyCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(result.removed, 0);
    assert.equal(fake.writes.ownerUpdate, 0);
    assert.equal(fake.writes.reviewCreate, 0);
  });

  it("falha na auditoria não deixa owner removido sem histórico", async () => {
    const fake = createFakePrisma({
      customers: [{ id: CUSTOMER_A, companyName: "Cliente A", taxId: "1", nomusExternalPersonId: 10 }],
      owners: [{ ...maria }],
      orders: [{ id: "so-1", customerId: CUSTOMER_A, orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" }],
      ...invoiceA,
      failReviewCreate: true,
    });
    fake.raw.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = { ...fake.owners[0]! };
      try {
        return await fn(fake.prisma);
      } catch (error) {
        Object.assign(fake.owners[0]!, snapshot);
        throw error;
      }
    };
    await assert.rejects(() => applyCommercialOwnerInactivity(REF, fake.prisma));
    assert.equal(fake.owners[0]?.isActive, true);
    assert.equal(fake.reviews.length, 0);
  });

  it("não altera pedido nem comissão histórica", async () => {
    const fake = createFakePrisma({
      customers: [{ id: CUSTOMER_A, companyName: "Cliente A", taxId: "1", nomusExternalPersonId: 10 }],
      owners: [{ ...maria }],
      orders: [{ id: "so-1", customerId: CUSTOMER_A, orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" }],
      ...invoiceA,
    });
    await applyCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(fake.writes.orderUpdate, 0);
    assert.equal(fake.writes.commissionUpdate, 0);
    assert.equal(fake.writes.nfeUpdate, 0);
    assert.equal(fake.writes.stockUpdate, 0);
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/commercial/customerCommercialOwnerInactivity.server.ts"),
      "utf8"
    );
    assert.doesNotMatch(source, /salesOrder\.update|commissionOrderSnapshot|nomusSellerName\s*=|nomusNfe\.update|nomusStockDocument\.update/);
  });

  it("cliente nunca faturado dentro da carência (89 dias da atribuição) não é removido no apply", async () => {
    const fake = createFakePrisma({
      customers: [{ id: CUSTOMER_B, companyName: "Cliente B", taxId: "2", nomusExternalPersonId: 11 }],
      owners: [{ ...maria, customerId: CUSTOMER_B, id: "own-2", assignmentStartedAt: START_89 }],
    });
    const result = await applyCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(result.removed, 0);
    assert.equal(result.unchanged, 1);
    assert.equal(result.neverApproved, 1);
    assert.equal(result.neverInvoiced, 1);
    assert.equal(result.neverInvoicedWithinGrace, 1);
    assert.equal(result.neverInvoicedReviewDue, 0);
    assert.deepEqual(result.results[0], { customerId: CUSTOMER_B, action: "NO_CHANGE", reasonCode: "NEVER_INVOICED_WITHIN_GRACE" });
    assert.equal(fake.owners[0]?.isActive, true);
    assert.equal(fake.writes.reviewCreate, 0);
  });

  it("PV SENT_TO_NOMUS sem NF válida não reinicia nada: segue nunca faturado, contado da atribuição", async () => {
    const seed = {
      customers: [{ id: CUSTOMER_A, companyName: "Cliente A", taxId: "1", nomusExternalPersonId: 10 }],
      orders: [{ id: "so-1", customerId: CUSTOMER_A, orderCode: "PD 02710", issueDate: new Date("2026-08-25T15:00:00.000Z"), status: "SENT_TO_NOMUS" }],
    };
    const within = createFakePrisma({ ...seed, owners: [{ ...maria, assignmentStartedAt: START_89 }] });
    const preview = await previewCommercialOwnerInactivity(REF, within.prisma);
    assert.equal(preview.neverInvoiced, 1);
    assert.equal(preview.neverInvoicedWithinGrace, 1);
    assert.equal(preview.removalEligible, 0);
    assert.equal((await applyCommercialOwnerInactivity(REF, within.prisma)).removed, 0);
    assert.equal(within.owners[0]?.isActive, true);
    // PV recente sem NF não protege: vencidos os 90 dias da atribuição, sem CRM válido, remove.
    const due = createFakePrisma({ ...seed, owners: [{ ...maria, assignmentStartedAt: START_90 }] });
    const apply = await applyCommercialOwnerInactivity(REF, due.prisma);
    assert.equal(apply.removed, 1);
    assert.equal(due.owners[0]?.isActive, false);
  });

  it("auditoria da remoção registra a NF válida, não o último PV aprovado", async () => {
    const fake = createFakePrisma({
      customers: [{ id: CUSTOMER_A, companyName: "Cliente A", taxId: "1", nomusExternalPersonId: 10 }],
      owners: [{ ...maria }],
      orders: [{ id: "so-1", customerId: CUSTOMER_A, orderCode: "PD 02100", issueDate: LAST_PV, status: "SENT_TO_NOMUS" }],
      ...invoiceA,
    });
    await applyCommercialOwnerInactivity(REF, fake.prisma);
    const review = fake.reviews[0] as { payload: Record<string, unknown> };
    assert.equal(review.payload.lastValidInvoiceNumber, "111222");
    assert.equal(review.payload.lastValidInvoiceDate, "2026-06-01");
    assert.equal(review.payload.lastInvoicedSalesOrderId, "so-1");
    assert.equal(review.payload.daysSinceLastValidInvoice, 90);
    assert.equal(review.payload.invoiceDateSource, "NFE_XML_DH_EMI");
    assert.equal(review.payload.clockSource, "lastValidInvoiceDate");
    assert.equal(Object.prototype.hasOwnProperty.call(review.payload, "lastApprovedIssueDate"), false);
  });

  it("DATA_ANOMALY não remove o responsável", async () => {
    const fake = createFakePrisma({
      customers: [{ id: CUSTOMER_A, companyName: "Cliente A", taxId: "1", nomusExternalPersonId: 10 }],
      owners: [{ ...maria }],
      orders: [{ id: "so-1", customerId: CUSTOMER_A, orderCode: "PD 02710", issueDate: LAST_PV, status: "SENT_TO_NOMUS" }],
      nfeLinks: [
        {
          salesOrderId: "so-1",
          nfeExternalId: 7650,
          nfeNumber: "7650",
          nfeStatus: 4,
          dataProcessamento: null,
          nomusNfeId: "nfe-7650",
        },
      ],
      nfes: [
        {
          id: "nfe-7650",
          externalId: 7650,
          numero: "7650",
          status: 4,
          xmlDhEmi: null,
          dataProcessamento: null,
          xmlCancelamento: null,
        },
      ],
    });
    const preview = await previewCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(preview.dataAnomaly, 1);
    assert.equal(preview.removalEligible, 0);
    const apply = await applyCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(apply.removed, 0);
    assert.equal(apply.dataAnomaly, 1);
    assert.equal(fake.owners[0]?.isActive, true);
  });
});

describe("revisão de carteira — cliente nunca faturado conta do início da atribuição", () => {
  const customerB = { id: CUSTOMER_B, companyName: "Cliente B", taxId: "2", nomusExternalPersonId: 11 };
  const ownerB = (assignmentStartedAt: Date, overrides: Partial<Owner> = {}): Owner => ({
    ...maria,
    id: "own-2",
    customerId: CUSTOMER_B,
    assignmentStartedAt,
    ...overrides,
  });
  const validProposal = {
    id: "p1",
    customerId: CUSTOMER_B,
    status: "SENT",
    number: 4412,
    externalProposalCode: "PP-4412",
    expectedCloseDate: new Date("2026-09-15T15:00:00.000Z"),
    nextActionAt: new Date("2026-09-10T15:00:00.000Z"),
    updatedAt: new Date("2026-08-18T15:00:00.000Z"),
  };

  it("casos 2 e 3: 90 e 91 dias sem CRM → remove, bloqueia autoatribuição e audita o relógio da atribuição", async () => {
    for (const [start, days] of [
      [START_90, 90],
      [START_91, 91],
    ] as const) {
      const fake = createFakePrisma({ customers: [customerB], owners: [ownerB(start)] });
      const result = await applyCommercialOwnerInactivity(REF, fake.prisma);
      assert.equal(result.removed, 1);
      assert.equal(result.neverInvoiced, 1);
      assert.equal(result.neverInvoicedReviewDue, 1);
      assert.deepEqual(result.results[0], { customerId: CUSTOMER_B, action: "REMOVE_OWNER", reasonCode: PORTFOLIO_INACTIVITY_REASON });
      const owner = fake.owners[0]!;
      assert.equal(owner.isActive, false);
      assert.equal(owner.blockAutoAssignUntilManual, true);
      assert.equal(owner.endReason, PORTFOLIO_INACTIVITY_REASON);
      assert.equal(owner.endedAt?.toISOString(), REF.toISOString());
      // A baixa não reescreve o início do ciclo encerrado.
      assert.equal(owner.assignmentStartedAt.toISOString(), start.toISOString());
      const review = fake.reviews[0] as Record<string, unknown> & { payload: Record<string, unknown> };
      assert.equal(review.action, "REMOVE_OWNER");
      assert.equal(review.reasonCode, PORTFOLIO_INACTIVITY_REASON);
      assert.equal((review.ownerStartedAt as Date).toISOString(), start.toISOString());
      // Colunas legadas de NF ficam nulas: não recebem "dias desde a atribuição".
      assert.equal(review.daysSinceLastApprovedOrder, null);
      assert.equal(review.lastApprovedIssueDate, null);
      assert.equal(review.lastApprovedSalesOrderId, null);
      assert.equal(review.payload.inactivityClockSource, "ASSIGNMENT_START");
      assert.equal(review.payload.inactivityClockDate, start.toISOString().slice(0, 10));
      assert.equal(review.payload.assignmentStartedAt, start.toISOString());
      assert.equal(review.payload.daysSinceInactivityClock, days);
      assert.equal(review.payload.lastValidInvoiceDate, null);
      assert.equal(review.payload.daysSinceLastValidInvoice, null);
      assert.equal(review.payload.neverInvoiced, true);
      assert.equal(review.payload.inactivityBasis, "NO_FIRST_VALID_INVOICE_SINCE_ASSIGNMENT_START");
      assert.equal(review.payload.clockSource, "assignmentStartedAt");
      assert.equal((fake.audits[0] as { action: string }).action, PORTFOLIO_INACTIVITY_REASON);
    }
  });

  it("caso 4 / exemplo D: ≥ 90 dias com CRM válido → KEEP_OWNER, registra PORTFOLIO_REVIEW_PRESERVED", async () => {
    const start = new Date("2026-05-12T15:00:00.000Z");
    const fake = createFakePrisma({ customers: [customerB], owners: [ownerB(start)], proposals: [validProposal] });
    const preview = await previewCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(preview.preservedByCrm, 1);
    assert.equal(preview.neverInvoicedReviewDue, 1);
    assert.equal(preview.removalEligible, 0);
    const result = await applyCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(result.removed, 0);
    assert.equal(result.preserved, 1);
    assert.deepEqual(result.results[0], { customerId: CUSTOMER_B, action: "KEEP_OWNER", reasonCode: "PORTFOLIO_REVIEW_PRESERVED" });
    assert.equal(fake.owners[0]?.isActive, true);
    assert.equal(fake.owners[0]?.blockAutoAssignUntilManual, false);
    const review = fake.reviews[0] as Record<string, unknown> & { payload: Record<string, unknown> };
    assert.equal(review.action, "KEEP_OWNER");
    assert.equal(review.reasonCode, "PORTFOLIO_REVIEW_PRESERVED");
    assert.equal(review.crmValid, true);
    assert.ok(review.nextReviewDate);
    assert.equal(review.daysSinceLastApprovedOrder, null);
    assert.equal(review.payload.inactivityClockSource, "ASSIGNMENT_START");
    assert.equal(review.payload.daysSinceInactivityClock, 110);
    assert.equal(review.payload.neverInvoiced, true);
    assert.equal((fake.audits[0] as { action: string }).action, "PORTFOLIO_REVIEW_PRESERVED");
  });

  it("caso 5: ≥ 90 dias só com anotação genérica → remove", async () => {
    const fake = createFakePrisma({
      customers: [customerB],
      owners: [ownerB(START_91)],
      contacts: [
        {
          id: "c1",
          customerId: CUSTOMER_B,
          contactDate: new Date("2026-08-20T15:00:00.000Z"),
          createdAt: new Date("2026-08-20T15:00:00.000Z"),
          outcome: "RELATIONSHIP_MAINTAINED",
          reason: "RELATIONSHIP",
          nextActionType: "NONE",
          nextActionAt: null,
        },
      ],
    });
    const result = await applyCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(result.removed, 1);
    assert.equal(fake.owners[0]?.isActive, false);
    const review = fake.reviews[0] as { crmValid: boolean; payload: Record<string, unknown> };
    assert.equal(review.crmValid, false);
    assert.equal(review.payload.crmValid, false);
  });

  it("caso 8 / exemplo B: NF válida antiga + responsável recém-atribuído → revisão pela NF, sem novo prazo", async () => {
    const recent = new Date("2026-08-20T15:00:00.000Z");
    const fake = createFakePrisma({
      customers: [{ id: CUSTOMER_A, companyName: "Cliente A", taxId: "1", nomusExternalPersonId: 10 }],
      owners: [{ ...maria, createdAt: recent, assignmentStartedAt: recent }],
      orders: [{ id: "so-1", customerId: CUSTOMER_A, orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" }],
      ...validInvoiceSeed("so-1", "2026-05-02"),
    });
    const preview = await previewCommercialOwnerInactivity(REF, fake.prisma);
    const row = preview.rows[0]!;
    assert.equal(row.inactivityClockSource, "LAST_VALID_INVOICE");
    assert.equal(row.inactivityClockDate, "2026-05-02");
    assert.equal(row.daysSinceInactivityClock, 120);
    assert.equal(row.assignmentStartedAt, "2026-08-20");
    assert.equal(row.neverInvoiced, false);
    assert.equal(row.action, "REMOVE_OWNER");
    assert.equal(preview.neverInvoiced, 0);
    const result = await applyCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(result.removed, 1);
    const review = fake.reviews[0] as Record<string, unknown> & { payload: Record<string, unknown> };
    assert.equal(review.daysSinceLastApprovedOrder, 120);
    assert.equal(review.payload.inactivityClockSource, "LAST_VALID_INVOICE");
    assert.equal(review.payload.inactivityBasis, "NO_VALID_INVOICE_SINCE_LAST_VALID_INVOICE");
    assert.equal(review.payload.neverInvoiced, false);
    assert.equal(review.payload.lastValidInvoiceDate, "2026-05-02");
    assert.equal(review.payload.assignmentStartedAt, recent.toISOString());
    assert.equal(review.payload.clockSource, "lastValidInvoiceDate");
  });

  it("caso 18: execução repetida depois da remoção é idempotente (NO_CHANGE)", async () => {
    const fake = createFakePrisma({ customers: [customerB], owners: [ownerB(START_91)] });
    const first = await applyCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(first.removed, 1);
    const writesAfterFirst = { ...fake.writes };
    const second = await applyCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(second.removed, 0);
    assert.equal(second.preserved, 0);
    assert.equal(second.results.length, 0);
    assert.deepEqual(fake.writes, writesAfterFirst);
    assert.equal(fake.reviews.length, 1);
    const preview = await previewCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(preview.alreadyUnassigned, 1);
    assert.equal(preview.removalEligible, 0);
    assert.equal(preview.neverInvoiced, 0);
  });

  it("troca real de responsável durante a execução não baixa o novo ciclo", async () => {
    const fake = createFakePrisma({ customers: [customerB], owners: [ownerB(START_91)] });
    const reassignedAt = new Date("2026-08-30T14:59:00.000Z");
    const originalFindUnique = fake.raw.crmCustomerCommercialOwner.findUnique;
    fake.raw.crmCustomerCommercialOwner.findUnique = async (args: { where: { customerId: string } }) => {
      // Simula o supervisor trocando o responsável entre a leitura da carteira e a transação
      // (cópia: a linha lida pelo apply não é a mesma instância que o banco devolve depois).
      const current = await originalFindUnique(args);
      return current
        ? { ...current, sellerIdentityKey: "joao", sellerCanonicalName: "João", assignmentStartedAt: reassignedAt }
        : null;
    };
    const result = await applyCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(result.removed, 0);
    assert.equal(result.results[0]?.action, "NO_CHANGE");
    assert.equal(fake.owners[0]?.isActive, true);
    assert.equal(fake.reviews.length, 0);
  });

  it("preview separa os grupos e mostra o relógio de cada linha", async () => {
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const fake = createFakePrisma({
      customers: [
        { id: CUSTOMER_A, companyName: "Com NF recente", taxId: "1", nomusExternalPersonId: 10 },
        customerB,
        { id: C, companyName: "Nunca faturado na carência", taxId: "3", nomusExternalPersonId: 12 },
        { id: D, companyName: "Sem responsável", taxId: "4", nomusExternalPersonId: 13 },
      ],
      owners: [
        { ...maria },
        ownerB(new Date("2026-05-08T15:00:00.000Z")),
        ownerB(new Date("2026-08-10T15:00:00.000Z"), { id: "own-3", customerId: C }),
      ],
      orders: [{ id: "so-1", customerId: CUSTOMER_A, orderCode: "PV-1", issueDate: LAST_PV, status: "SENT_TO_NOMUS" }],
      ...validInvoiceSeed("so-1", "2026-08-01"),
    });
    const preview = await previewCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(preview.customersWithActiveOwner, 3);
    assert.equal(preview.withinActivityWindow, 1);
    assert.equal(preview.neverInvoicedWithinGrace, 1);
    assert.equal(preview.neverInvoicedReviewDue, 1);
    assert.equal(preview.neverInvoiced, 2);
    assert.equal(preview.neverApprovedSalesOrder, 2);
    assert.equal(preview.inReview, 1);
    assert.equal(preview.removalEligible, 1);
    assert.equal(preview.dataAnomaly, 0);
    assert.equal(preview.alreadyUnassigned, 1);
    const byId = new Map(preview.rows.map((row) => [row.customerId, row]));
    assert.equal(byId.get(CUSTOMER_B)?.inactivityClockSource, "ASSIGNMENT_START");
    assert.equal(byId.get(CUSTOMER_B)?.inactivityClockDate, "2026-05-08");
    assert.equal(byId.get(CUSTOMER_B)?.daysSinceInactivityClock, 114);
    assert.equal(byId.get(CUSTOMER_B)?.daysSinceLastValidInvoice, null);
    assert.equal(byId.get(CUSTOMER_B)?.action, "REMOVE_OWNER");
    assert.equal(byId.get(C)?.action, "KEEP_ACTIVE");
    assert.equal(byId.get(C)?.status, "NEVER_INVOICED_WITHIN_GRACE");
    assert.equal(byId.has(D), false);
    const text = formatPortfolioInactivityPreview(preview);
    assert.match(text, /abaixo de 90 dias por NF válida=1/);
    assert.match(text, /nunca faturados dentro da carência \(90 dias da atribuição\)=1/);
    assert.match(text, /nunca faturados vencidos \(em revisão\)=1/);
    assert.match(text, /identidade ativos=3\/3/);
    assert.match(text, /clockSource=ASSIGNMENT_START \| clockDate=2026-05-08 \| dias=114/);
    assert.match(text, /clockSource=LAST_VALID_INVOICE \| clockDate=2026-08-01 \| dias=29/);
    assert.equal(fake.writes.ownerUpdate + fake.writes.reviewCreate + fake.writes.auditCreate, 0);
  });

  it("apply não tem mais atalho que pula nunca faturado", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/commercial/customerCommercialOwnerInactivity.server.ts"),
      "utf8"
    );
    assert.doesNotMatch(source, /reasonCode: NEVER_INVOICED,/);
    assert.doesNotMatch(source, /decision\.status === "NEVER_INVOICED"/);
  });
});
