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

type Owner = {
  id: string;
  customerId: string;
  isActive: boolean;
  sellerIdentityKey: string;
  sellerCanonicalName: string;
  createdAt: Date;
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

  it("cliente sem PV aprovado não é removido no apply", async () => {
    const fake = createFakePrisma({
      customers: [{ id: CUSTOMER_B, companyName: "Cliente B", taxId: "2", nomusExternalPersonId: 11 }],
      owners: [{ ...maria, customerId: CUSTOMER_B, id: "own-2" }],
    });
    const result = await applyCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(result.removed, 0);
    assert.equal(result.neverApproved, 1);
    assert.equal(result.neverInvoiced, 1);
    assert.equal(fake.owners[0]?.isActive, true);
  });

  it("PV SENT_TO_NOMUS sem NF válida não remove e classifica NEVER_INVOICED", async () => {
    const fake = createFakePrisma({
      customers: [{ id: CUSTOMER_A, companyName: "Cliente A", taxId: "1", nomusExternalPersonId: 10 }],
      owners: [{ ...maria }],
      orders: [{ id: "so-1", customerId: CUSTOMER_A, orderCode: "PD 02710", issueDate: LAST_PV, status: "SENT_TO_NOMUS" }],
    });
    const preview = await previewCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(preview.neverInvoiced, 1);
    assert.equal(preview.removalEligible, 0);
    const apply = await applyCommercialOwnerInactivity(REF, fake.prisma);
    assert.equal(apply.removed, 0);
    assert.equal(apply.neverInvoiced, 1);
    assert.equal(fake.owners[0]?.isActive, true);
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
    assert.equal(review.payload.clockSource, "lastValidInvoiceDate");
    assert.equal(Object.prototype.hasOwnProperty.call(review.payload, "lastApprovedIssueDate"), false);
  });
});
