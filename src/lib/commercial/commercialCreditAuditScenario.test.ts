/**
 * Cenário de auditoria do crédito comercial com dados sintéticos.
 * Não abre banco, não grava título e não consulta API paga.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerCnpjCreditSections } from "@/src/components/customers/CustomerCnpjCreditSections";
import { CustomerCreditOperationSummaryView } from "@/src/components/customers/CustomerCreditOperationCard";
import {
  CommercialCreditDeniedError,
  decideCommercialCredit,
  resolveCommercialCreditExceptionPermission,
} from "./commercialCreditDecision.js";
import {
  assertCommercialCreditAllows,
  readCommercialCreditDecision,
} from "./commercialCreditDecision.server.js";
import { buildCommercialCreditIntelligenceView } from "./commercialCreditIntelligenceView.js";
import { createCommercialCreditOccurrence } from "./commercialCreditOccurrence.server.js";
import { occurrenceBlocksCredit } from "./commercialCreditOccurrence.js";
import { buildCommercialCreditOperationSummary } from "./commercialCreditOperation.js";
import { analyzeCorporateRelations, type CorporateMembershipDraft } from "./corporateRelation.js";
import {
  analyzeCommercialDelinquency,
  type CommercialDelinquencySyncRunStatus,
} from "./customerDelinquencyAnalysis.js";
import { buildNomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";
import { classifyExternalProtestCredit } from "./externalProtest/externalProtestProvider.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const ACTOR = "55555555-5555-4555-8555-555555555555";
const CNPJ = "11444777000161";
const TODAY = new Date(2026, 9, 19, 10, 0, 0);
const SYNCED = new Date(2026, 9, 19, 9, 0, 0);

function title(partial: Record<string, unknown>) {
  return {
    externalId: 7,
    personId: 100,
    personCnpj: CNPJ,
    description: "Boleto",
    dueDate: new Date(2026, 9, 15),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    sourceInvoiceId: 50,
    sourceInvoiceNumber: "100",
    suspendCollection: false,
    nomusStatus: false,
    syncedAt: SYNCED,
    sourcePresenceStatus: "PRESENT",
    rawPayload: { id: 7 },
    ...partial,
  };
}

function book(
  titles: ReturnType<typeof title>[],
  run: { status: CommercialDelinquencySyncRunStatus; payloadComplete: boolean } | null = {
    status: "SUCCESS",
    payloadComplete: true,
  }
) {
  return analyzeCommercialDelinquency({
    customerId: CUSTOMER,
    taxId: CNPJ,
    nomusExternalPersonId: 100,
    salesOrderExternalCustomerIds: [],
    peerCustomerIdsWithSameCnpj: [],
    titles,
    syncCutoff: run?.status === "SUCCESS" ? buildNomusArReportSyncCutoff(SYNCED) : null,
    latestRunStatus: run?.status ?? null,
    payloadComplete: run?.payloadComplete ?? null,
    referenceDate: TODAY,
  });
}

describe("auditoria — cliente 91 com boleto D+4 e protesto pendente", () => {
  it("bloqueia prazo no backend, mostra o status crítico e audita a ocorrência", async () => {
    const delinquency = book([title({})]);
    assert.equal(delinquency.status, "OVERDUE");
    assert.equal(delinquency.maxDaysOverdue, 4);
    assert.equal(delinquency.overdueAmount, 1000);

    const occurrences: Array<Record<string, unknown>> = [];
    const audits: Array<Record<string, unknown>> = [];
    const evaluations: Array<Record<string, unknown>> = [];
    const db = {
      customer: {
        findUnique: async () => ({ id: CUSTOMER, taxId: CNPJ, nomusExternalPersonId: 100, companyName: "Alpha" }),
        findMany: async () => [{ id: CUSTOMER, taxId: CNPJ, companyName: "Alpha" }],
      },
      salesOrder: { findMany: async () => [] },
      nomusAccountsReceivable: {
        aggregate: async () => ({ _max: { syncedAt: SYNCED } }),
        findMany: async () => [
          {
            personName: "Cliente",
            companyName: "Lazarios",
            description: "Boleto",
            comments: null,
            paymentMethodName: "Boleto",
            bankAccountName: null,
            suspendCollection: false,
            status: false,
            sourcePresenceStatus: "PRESENT",
            rawPayload: { id: 7 },
            ...title({}),
          },
        ],
        findFirst: async () => ({ externalId: 7 }),
      },
      nomusSourceSyncRun: {
        findFirst: async () => ({ status: "SUCCESS", payloadComplete: true, startedAt: SYNCED }),
      },
      customerCorporateLink: { findMany: async () => [] },
      commercialExternalProtest: { findMany: async () => [] },
      commercialCreditException: { findMany: async () => [] },
      commercialCreditOccurrence: {
        findMany: async () => occurrences,
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          occurrences.push(data);
          return data;
        },
      },
      commercialCreditOccurrenceEvidence: { create: async ({ data }: { data: Record<string, unknown> }) => data },
      commercialCorporateMembership: { findMany: async () => [], findFirst: async () => null },
      customerCnpjLookup: {
        findFirst: async () => ({ normalizedSummary: { riskScore: 91, riskVerdict: "VENDA LIBERADA" }, fetchedAt: SYNCED }),
      },
      commercialCreditEvaluation: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          evaluations.push(data);
          return data;
        },
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    };

    const occurrence = await createCommercialCreditOccurrence(db as never, {
      customerId: CUSTOMER,
      kind: "PROTEST_CONFIRMED",
      titleExternalId: 7,
      occurredAt: TODAY,
      justification: "Protesto confirmado do boleto sintético, ainda pendente.",
      actor: { id: ACTOR, role: "ADMIN", assignedPermissions: ["commercial.credit.exception.grant"] },
      now: TODAY,
      auditWriter: async (entry) => {
        audits.push(entry);
      },
    });
    assert.equal(occurrence.status, "CONFIRMED_PENDING");
    assert.equal(audits.some((entry) => entry.entityType === "CommercialCreditOccurrence"), true);
    assert.equal(JSON.stringify(audits).includes("1000"), false);

    const read = await readCommercialCreditDecision(db as never, {
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      cadastral: { score: 91, verdict: "VENDA LIBERADA" },
      now: TODAY,
    });
    assert.equal(read.decision.customerStatus, "BLOQUEIO_CRITICO");
    assert.equal(read.decision.reason, "INTERNAL_PROTEST");
    assert.equal(read.decision.evidence.cadastralScore, 91);
    assert.equal(read.decision.cadastralIgnored, true);
    assert.equal(read.decision.allowed, false);

    await assert.rejects(
      () =>
        assertCommercialCreditAllows(db as never, {
          customerId: CUSTOMER,
          enforcement: "CREDIT_GRANT",
          paymentTerms: "30",
          cadastral: { score: 91, verdict: "VENDA LIBERADA" },
          now: TODAY,
          audit: { entityId: CUSTOMER, action: "GENERATE_SALES_ORDER", performedBy: ACTOR },
          auditWriter: async (entry) => {
            audits.push(entry);
          },
        }),
      (error: unknown) => error instanceof CommercialCreditDeniedError && error.status === "BLOQUEIO_CRITICO"
    );
    assert.equal(evaluations.length >= 1, true);
    assert.equal(audits.some((entry) => entry.action === "GENERATE_SALES_ORDER"), true);
    assert.equal(JSON.stringify(evaluations).includes("balanceReceivable"), false);

    const cash = await assertCommercialCreditAllows(db as never, {
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "À vista",
      now: TODAY,
    });
    assert.equal(cash.allowed, true);
    assert.equal(cash.customerStatus, "BLOQUEIO_CRITICO");

    const view = buildCommercialCreditIntelligenceView({
      decision: read.decision,
      delinquency: read.delinquency,
      externalProtest: read.externalProtest,
      revealFinancial: true,
      occurrenceLines: ["Protesto confirmado pendente"],
    });
    assert.equal(view.cadastralScoreLabel, "91/100");
    assert.equal(view.customerStatus, "BLOQUEIO_CRITICO");
    assert.equal(view.cadastralAuthorizesCredit, false);
    const modal = renderToStaticMarkup(
      React.createElement(CustomerCnpjCreditSections, {
        credit: view,
        loading: false,
        error: null,
        sources: [],
      })
    );
    assert.match(modal, /CRÉDITO BLOQUEADO/);
    assert.match(modal, /Status comercial: BLOQUEIO_CRITICO/);
    assert.match(modal, /91\/100/);
    const crm = renderToStaticMarkup(
      React.createElement(CustomerCreditOperationSummaryView, {
        summary: buildCommercialCreditOperationSummary(view),
      })
    );
    assert.match(crm, /Status comercial: BLOQUEIO_CRITICO/);
    assert.match(crm, /Score cadastral/);

    const server = readFileSync(join(root, "server.ts"), "utf8");
    const salesSync = readFileSync(join(root, "scripts/nomusSalesOrdersSyncV1.ts"), "utf8");
    assert.equal(server.split("salesOrder.create(").length - 1, 1);
    const generate = server.slice(server.indexOf('app.post("/api/proposals/:id/generate-sales-order"'));
    assert.ok(generate.indexOf("assertCommercialCreditAllows") < generate.indexOf("salesOrder.create"));
    assert.ok(salesSync.indexOf("assertExistingNomusObligationMirror") < salesSync.indexOf("salesOrder.create("));
    assert.equal(server.includes("CommercialCreditBypassError"), false);
  });
});

describe("auditoria — demais situações sintéticas", () => {
  it("regular, quitado, parcial, protesto cancelado, sócio, API e financeiro", () => {
    const regular = book([title({ dueDate: new Date(2026, 9, 25) })]);
    assert.equal(regular.status, "REGULAR");
    const regularDecision = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: regular,
      cadastral: { score: 91, verdict: "VENDA LIBERADA" },
      now: TODAY,
    });
    assert.equal(regularDecision.status, "LIBERADO");

    const settled = book([
      title({ settlementDate: new Date(2026, 9, 18), amountReceived: 1000, balanceReceivable: 0 }),
    ]);
    assert.equal(settled.status, "REGULAR");
    assert.equal(settled.overdueAmount, 0);

    const partial = book([title({ amountReceived: 400, balanceReceivable: 600 })]);
    assert.equal(partial.status, "OVERDUE");
    assert.equal(partial.overdueAmount, 600);

    assert.equal(
      occurrenceBlocksCredit({ kind: "PROTEST_WITHDRAWN", status: "CLOSED", closedAt: TODAY }),
      false
    );
    const withdrawn = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: regular,
      confirmedPendingProtest: false,
      now: TODAY,
    });
    assert.equal(withdrawn.customerStatus, "LIBERADO");

    const shared = analyzeCorporateRelations({
      now: TODAY,
      parties: [
        { customerId: CUSTOMER, cnpj: CNPJ, companyName: "Alpha", registryKind: "CUSTOMER" },
        { customerId: "22222222-2222-4222-8222-222222222222", cnpj: "14055501000180", companyName: "Beta", registryKind: "CUSTOMER" },
      ],
      memberships: [
        membership(CNPJ, "00000000000191"),
        membership("14055501000180", "00000000000191"),
      ],
    });
    assert.equal(shared.relations.length, 2);
    const related = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: regular,
      relatedParties: [{ customerId: "22222222-2222-4222-8222-222222222222", delinquency: partial }],
      now: TODAY,
    });
    assert.equal(related.customerStatus, "BLOQUEADO");
    assert.equal(related.reason, "RELATED_PARTY_DELINQUENT");
    assert.notEqual(related.customerStatus, "BLOQUEIO_CRITICO");

    const homonym = analyzeCorporateRelations({
      now: TODAY,
      parties: [
        { customerId: CUSTOMER, cnpj: CNPJ, companyName: "Alpha", registryKind: "CUSTOMER" },
        { customerId: "22222222-2222-4222-8222-222222222222", cnpj: "14055501000180", companyName: "Beta", registryKind: "CUSTOMER" },
      ],
      memberships: [
        membership(CNPJ, null, "JOAO DA SILVA"),
        membership("14055501000180", null, "JOAO DA SILVA"),
      ],
    });
    assert.equal(homonym.relations.length, 0);

    const unavailable = classifyExternalProtestCredit({
      enabled: true,
      executionStatus: "UNAVAILABLE",
      protestSituation: "NONE_FOUND",
      consultedAt: TODAY,
      validUntil: new Date(2026, 9, 20),
      now: TODAY,
    });
    assert.equal(unavailable.reliableClear, false);
    assert.notEqual(unavailable.protestSituation, "NONE_FOUND");
    const unavailableDecision = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: regular,
      externalProtestReview: "UNAVAILABLE",
      now: TODAY,
    });
    assert.equal(unavailableDecision.customerStatus, "EM_ANALISE");

    const stale = book([title({ syncedAt: new Date(2026, 9, 17) })], { status: "SUCCESS", payloadComplete: true });
    assert.equal(stale.status, "UNKNOWN");
    const staleDecision = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: stale,
      now: TODAY,
    });
    assert.equal(staleDecision.customerStatus, "EM_ANALISE");
    assert.notEqual(staleDecision.status, "LIBERADO");

    const seller = resolveCommercialCreditExceptionPermission({ role: "SELLER", assignedPermissions: [] });
    assert.equal(seller.ok, false);
    const expired = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: partial,
      exceptions: [
        {
          id: "exc",
          scope: "OVERDUE",
          expiresAt: new Date(2026, 9, 1),
          revokedAt: null,
        },
      ],
      now: TODAY,
    });
    assert.equal(expired.customerStatus, "BLOQUEADO");
  });

  it("as migrations de crédito só acrescentam estrutura", () => {
    const dir = join(root, "prisma/migrations");
    const names = readdirSync(dir).filter((name) => name.startsWith("20261022"));
    assert.ok(names.length >= 5);
    for (const name of names) {
      const sql = readFileSync(join(dir, name, "migration.sql"), "utf8").toUpperCase();
      assert.equal(sql.includes("DROP TABLE"), false, name);
      assert.equal(sql.includes("DELETE FROM"), false, name);
      assert.equal(sql.includes("NOMUSACCOUNTSRECEIVABLE"), false, name);
      assert.equal(sql.includes("TRUNCATE"), false, name);
    }
  });
});

function membership(subjectCnpj: string, memberCnpj: string | null, nameKey: string | null = null): CorporateMembershipDraft {
  return {
    subjectCnpj,
    source: "brasilapi",
    consultedAt: new Date(2026, 9, 1),
    memberKind: "PARTNER",
    roleText: "Sócio",
    personKind: memberCnpj ? "PJ" : "PF",
    documentKind: memberCnpj ? "CNPJ" : "MASKED",
    memberCnpj,
    reliability: memberCnpj ? "HIGH" : "INSUFFICIENT",
    evidenceRef: `${subjectCnpj}:${memberCnpj ?? nameKey}`,
    identityKey: null,
    nameKey,
  };
}
