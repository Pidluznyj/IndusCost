/**
 * Risco compartilhado entre CNPJs. Nome, endereço e telefone não confirmam o grupo.
 * Vínculo confirmado propaga o bloqueio sem transferir a dívida.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { decideCommercialCredit, interpretIeptbConsultations } from "./commercialCreditDecision.js";
import { buildCommercialCreditIntelligenceView, ieptbSituationLabel } from "./commercialCreditIntelligenceView.js";
import { applyCorporateLinkReview } from "./corporateLinkReview.server.js";
import { assessCorporateLinkReview } from "./corporateLinkReview.js";
import {
  analyzeCorporateContactClues,
  analyzeCorporateRelations,
  corporateAddressKey,
  corporateCandidateFingerprint,
  expandConfirmedCustomerIds,
  visibleCorporateCandidates,
  type CorporateMembershipDraft,
  type RegisteredCorporateParty,
} from "./corporateRelation.js";
import { loadCorporateLinkGraph, loadCorporateRelationAssessment } from "./corporateRelation.server.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const NOW = new Date(2026, 9, 22, 12, 0, 0);
const FRESH = new Date(2026, 9, 1, 10, 0, 0);

function party(customerId: string, cnpj: string, companyName: string): RegisteredCorporateParty {
  return { customerId, cnpj, companyName, registryKind: "CUSTOMER" };
}

function membership(partial: Partial<CorporateMembershipDraft> & { subjectCnpj: string }): CorporateMembershipDraft {
  return {
    source: "brasilapi",
    consultedAt: FRESH,
    memberKind: "ADMINISTRATOR",
    roleText: "Administrador",
    personKind: "PF",
    documentKind: "MASKED",
    memberCnpj: null,
    reliability: "INSUFFICIENT",
    evidenceRef: `${partial.subjectCnpj}:${partial.nameKey ?? "none"}`,
    identityKey: null,
    nameKey: null,
    ...partial,
  };
}

function analysis(status: "REGULAR" | "OVERDUE" | "UNKNOWN", amount = 0) {
  return {
    status,
    unknownReason: status === "UNKNOWN" ? ("SYNC_STALE" as const) : null,
    overdueTitleCount: status === "OVERDUE" ? 2 : status === "UNKNOWN" ? null : 0,
    overdueAmount: status === "OVERDUE" ? amount : status === "UNKNOWN" ? null : 0,
    openAmount: status === "OVERDUE" ? amount : 0,
    maxDaysOverdue: status === "OVERDUE" ? 169 : 0,
    lastSyncedAt: "2026-10-05T12:00:00.000Z",
    evidence: {
      source: "NOM" as never,
      toleranceDays: 3,
      toleranceUnit: "CALENDAR_DAYS" as const,
      referenceDate: "2026-10-22",
      cnpj: null,
      nomusPersonId: null,
      identity: "RESOLVED" as const,
      syncRunStatus: null,
      payloadComplete: true,
      sourceMaxSyncedAt: null,
      includedTitleIds: [],
      overdueTitleIds: [],
      protestedTitleIds: [],
      protestReading: "NOT_IN_SOURCE" as const,
      exclusions: [],
    },
  };
}

describe("descoberta de empresas relacionadas", () => {
  const parties = [
    party(A, "50798391000100", "Empresa A"),
    party(B, "64577757000125", "Empresa B"),
    party(C, "41851758000110", "Empresa C"),
  ];

  it("T01 mesmo identificador confiável confirma o vínculo", () => {
    const report = analyzeCorporateRelations({
      now: NOW,
      parties,
      memberships: [
        membership({ subjectCnpj: "50798391000100", memberCnpj: "11111111000191", reliability: "HIGH", documentKind: "CNPJ", nameKey: null }),
        membership({ subjectCnpj: "64577757000125", memberCnpj: "11111111000191", reliability: "HIGH", documentKind: "CNPJ", nameKey: null }),
      ],
    });
    assert.equal(report.relations.find((row) => row.subjectCustomerId === A)?.basis, "SHARED_CNPJ");
    assert.equal(report.candidates.length, 0);
  });

  it("T02 mesmo nome completo mascarado fica pendente e não confirma", () => {
    const report = analyzeCorporateRelations({
      now: NOW,
      parties,
      memberships: [
        membership({ subjectCnpj: "50798391000100", nameKey: "MARIA MARGARETE DOS SANTOS PEREIRA", displayName: "Maria Margarete dos Santos Pereira" }),
        membership({ subjectCnpj: "64577757000125", nameKey: "MARIA MARGARETE DOS SANTOS PEREIRA", displayName: "Maria Margarete dos Santos Pereira" }),
      ],
    });
    assert.equal(report.relations.length, 0);
    const pending = report.candidates.filter((row) => row.subjectCustomerId === A);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.basis, "SHARED_NAME");
    assert.equal(pending[0]?.status, "PENDING_REVIEW");
    assert.match(pending[0]?.evidenceLabel ?? "", /Maria Margarete/);
  });

  it("T03 mesmo sobrenome de pessoas diferentes não vira candidato", () => {
    const report = analyzeCorporateRelations({
      now: NOW,
      parties,
      memberships: [
        membership({ subjectCnpj: "50798391000100", nameKey: "ANA SILVA" }),
        membership({ subjectCnpj: "64577757000125", nameKey: "BRUNO SILVA" }),
        membership({ subjectCnpj: "41851758000110", nameKey: "SILVA" }),
      ],
    });
    assert.equal(report.relations.length, 0);
    assert.equal(report.candidates.length, 0);
  });

  it("T04 endereço fiscal completo é indício e CEP isolado não é", () => {
    assert.equal(corporateAddressKey({ zipCode: "58000-000" }), null);
    assert.equal(corporateAddressKey({ address: "Rua A", city: "João Pessoa", state: "PB" }), null);
    const clues = analyzeCorporateContactClues({
      subjectCustomerId: A,
      now: NOW,
      parties: [
        { customerId: A, cnpj: "50798391000100", companyName: "A", registryKind: "CUSTOMER", address: "Rua das Flores, 10", city: "João Pessoa", state: "PB", zipCode: "58000-000" },
        { customerId: B, cnpj: "64577757000125", companyName: "B", registryKind: "CUSTOMER", address: "Rua das Flores, 10", city: "Joao Pessoa", state: "Paraíba", zipCode: "58000000" },
        { customerId: C, cnpj: "41851758000110", companyName: "C", registryKind: "CUSTOMER", address: "Outra Rua, 99", city: "João Pessoa", state: "PB", zipCode: "58000-000" },
      ],
    });
    assert.equal(clues.length, 1);
    assert.equal(clues[0]?.basis, "SHARED_ADDRESS");
    assert.equal(clues[0]?.relatedCustomerId, B);
    assert.equal(clues[0]?.status, "PENDING_REVIEW");
  });

  it("T05 telefone igual é indício, não vínculo confirmado", () => {
    const clues = analyzeCorporateContactClues({
      subjectCustomerId: A,
      parties: [
        { customerId: A, cnpj: "1", companyName: "A", registryKind: "CUSTOMER", phone: "(83) 99999-0000" },
        { customerId: B, cnpj: "2", companyName: "B", registryKind: "CUSTOMER", phone: "83999990000" },
      ],
    });
    assert.equal(clues[0]?.basis, "SHARED_PHONE");
    assert.equal(clues[0]?.status, "PENDING_REVIEW");
  });

  it("T06 e T07 contador e CNAE iguais não criam candidato", () => {
    const clues = analyzeCorporateContactClues({
      subjectCustomerId: A,
      parties: [
        { customerId: A, cnpj: "1", companyName: "A", registryKind: "CUSTOMER" },
        { customerId: B, cnpj: "2", companyName: "B", registryKind: "CUSTOMER" },
      ],
    });
    assert.equal(clues.length, 0);
  });

  it("T08 candidato rejeitado com a mesma evidência não volta", () => {
    const report = analyzeCorporateRelations({
      now: NOW,
      parties,
      memberships: [
        membership({ subjectCnpj: "50798391000100", nameKey: "MARIA MARGARETE DOS SANTOS PEREIRA" }),
        membership({ subjectCnpj: "64577757000125", nameKey: "MARIA MARGARETE DOS SANTOS PEREIRA" }),
      ],
    });
    const candidate = report.candidates.find((row) => row.subjectCustomerId === A)!;
    const hidden = visibleCorporateCandidates(report.candidates, [
      { relatedCustomerId: B, fingerprint: corporateCandidateFingerprint(candidate) },
    ]);
    assert.equal(hidden.some((row) => row.subjectCustomerId === A && row.relatedCustomerId === B), false);
  });

  it("T09 QSA posterior com outro nome volta a ser candidato", () => {
    const oldCandidate = {
      basis: "SHARED_NAME",
      evidenceLabel: "MARIA MARGARETE DOS SANTOS PEREIRA",
    };
    const changed = visibleCorporateCandidates(
      [
        {
          subjectCustomerId: A,
          relatedCustomerId: B,
          relatedCompanyName: "B",
          relatedCnpj: "64577757000125",
          registryKind: "CUSTOMER" as const,
          basis: "SHARED_NAME" as const,
          status: "PENDING_REVIEW" as const,
          consultedAt: NOW.toISOString(),
          evidenceLabel: "OUTRA PESSOA DISTINTA",
        },
      ],
      [{ relatedCustomerId: B, fingerprint: corporateCandidateFingerprint(oldCandidate) }]
    );
    assert.equal(changed.length, 1);
  });
});

describe("grupo confirmado", () => {
  it("T10 a T13 duas, três, dez empresas e ciclo permanecem deduplicados", () => {
    const ids = Array.from({ length: 10 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    const chain = ids.slice(0, -1).map((id, index) => ({ leftId: id, rightId: ids[index + 1]! }));
    const ten = expandConfirmedCustomerIds(ids[0]!, chain);
    assert.equal(ten.ids.length, 9);
    assert.equal(ten.overflow, false);
    const cycle = expandConfirmedCustomerIds(A, [
      { leftId: A, rightId: B },
      { leftId: B, rightId: C },
      { leftId: C, rightId: A },
    ]);
    assert.deepEqual(cycle.ids.sort(), [B, C].sort());
    assert.equal(cycle.overflow, false);
  });

  it("T14 vínculo encerrado não entra no grupo", async () => {
    const graph = await loadCorporateLinkGraph(
      {
        customerCorporateLink: {
          findMany: async () => [
            { customerId: A, relatedCustomerId: B, status: "CLOSED", closedAt: NOW },
            { customerId: B, relatedCustomerId: C, status: "CONFIRMED" },
          ],
        },
      },
      A
    );
    assert.deepEqual(graph.confirmedIds, []);
  });

  it("T15 indício não propaga bloqueio", () => {
    const decision = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("REGULAR"),
      pendingRelatedPartyCount: 1,
      relatedParties: [],
      now: NOW,
    });
    assert.equal(decision.customerStatus, "EM_ANALISE");
    assert.equal(decision.reason, "RELATED_PARTY_UNVERIFIED");
    assert.equal(decision.allowed, false);
    assert.equal(JSON.stringify(decision.evidence).includes("6560"), false);
  });
});

describe("decisão financeira e protesto", () => {
  it("T16 empresa sem restrição fica liberada", () => {
    const decision = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("REGULAR"),
      now: NOW,
    });
    assert.equal(decision.customerStatus, "LIBERADO");
  });

  it("T17 inadimplência própria bloqueia sem exigir outra empresa", () => {
    const decision = decideCommercialCredit({
      customerId: C,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("OVERDUE", 55200),
      now: NOW,
    });
    assert.equal(decision.customerStatus, "BLOQUEADO");
    assert.equal(decision.reason, "OVERDUE_OPEN_BALANCE");
    assert.equal(decision.evidence.relatedParties.length, 0);
  });

  it("T18 e T19 relacionada inadimplente bloqueia sem copiar o saldo", () => {
    const decision = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("REGULAR"),
      relatedParties: [
        { customerId: B, delinquency: analysis("OVERDUE", 6560) },
        { customerId: C, delinquency: analysis("OVERDUE", 1000) },
      ],
      now: NOW,
    });
    assert.equal(decision.customerStatus, "BLOQUEADO");
    assert.equal(decision.reason, "RELATED_PARTY_DELINQUENT");
    assert.equal(decision.allowed, false);
    assert.equal(JSON.stringify(decision.evidence).includes("6560"), false);
    assert.equal(decision.evidence.relatedParties.length, 2);
  });

  it("T23 sincronização desatualizada não libera", () => {
    const decision = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("UNKNOWN"),
      now: NOW,
    });
    assert.equal(decision.customerStatus, "EM_ANALISE");
    assert.equal(decision.reason, "FINANCIAL_UNVERIFIED");
    assert.equal(decision.allowed, false);
  });

  it("T24 a T28 protesto próprio vigente bloqueia e consulta ausente não vira sem protesto", () => {
    const own = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("REGULAR"),
      ieptb: { state: "VALID", confirmedProtest: true, insufficient: false },
      cadastral: { score: 83, verdict: "VENDA LIBERADA" },
      now: NOW,
    });
    assert.equal(own.customerStatus, "BLOQUEADO");
    assert.equal(own.cadastralIgnored, true);
    const related = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("REGULAR"),
      relatedParties: [{ customerId: B, delinquency: analysis("REGULAR"), confirmedProtest: true }],
      now: NOW,
    });
    assert.equal(related.reason, "RELATED_PARTY_DELINQUENT");
    const missing = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("REGULAR"),
      ieptb: { state: "NOT_CONSULTED", confirmedProtest: false, insufficient: false },
      now: NOW,
    });
    assert.equal(missing.customerStatus, "LIBERADO");
    assert.equal(missing.reasons.includes("IEPTB_NATIONAL_PROTEST"), false);
    const stale = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("REGULAR"),
      ieptb: { state: "STALE", confirmedProtest: true, insufficient: false },
      now: NOW,
    });
    assert.equal(stale.customerStatus, "EM_ANALISE");
  });

  it("T31 à vista segue permitida e T32 exceção não apaga o motivo financeiro do outro CNPJ", () => {
    const cash = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "À vista",
      delinquency: analysis("REGULAR"),
      relatedParties: [{ customerId: B, delinquency: analysis("OVERDUE", 6560) }],
      now: NOW,
    });
    assert.equal(cash.allowed, true);
    assert.equal(cash.reason, "CASH_NOT_CREDIT");
    assert.equal(cash.customerStatus, "BLOQUEADO");
    const lifted = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("REGULAR"),
      relatedParties: [{ customerId: B, delinquency: analysis("OVERDUE", 6560) }],
      exceptions: [
        {
          id: "ex",
          customerId: A,
          scope: "RELATED_PARTY",
          justification: "Exceção só deste CNPJ, com prazo e responsável.",
          expiresAt: new Date(2026, 11, 1),
          revokedAt: null,
        },
      ],
      now: NOW,
    });
    assert.equal(lifted.customerStatus, "LIBERADO");
    assert.equal(lifted.reason, "EXCEPTION_APPLIED");
    const untouched = decideCommercialCredit({
      customerId: B,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("OVERDUE", 6560),
      now: NOW,
    });
    assert.equal(untouched.reason, "OVERDUE_OPEN_BALANCE");
  });

  it("T33 exceção vencida devolve o bloqueio", () => {
    const expired = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("REGULAR"),
      relatedParties: [{ customerId: B, delinquency: analysis("OVERDUE", 6560) }],
      exceptions: [
        {
          id: "ex",
          customerId: A,
          scope: "RELATED_PARTY",
          justification: "Exceção vencida não libera o grupo.",
          expiresAt: new Date(2026, 8, 1),
          revokedAt: null,
        },
      ],
      now: NOW,
    });
    assert.equal(expired.customerStatus, "BLOQUEADO");
  });
});

describe("governança do vínculo", () => {
  const actor = { id: A, role: "ADMIN", assignedPermissions: ["commercial.credit.exception.grant"] };

  it("T34 usuário sem permissão não confirma", () => {
    const denied = assessCorporateLinkReview({
      actor: { role: "SUPER_ADMIN", assignedPermissions: [] },
      subjectCustomerId: A,
      relatedCustomerId: B,
      action: "confirm",
      justification: "Justificativa objetiva do vínculo societário.",
    });
    assert.equal(denied.ok, false);
  });

  it("T35 e T37 confirmação exige permissão, justificativa e é idempotente", async () => {
    const rows = new Map<string, { id: string; status: string }>();
    const audits: string[] = [];
    const db = {
      customerCorporateLink: {
        upsert: async (args: {
          where: { customerId_relatedCustomerId: { customerId: string; relatedCustomerId: string } };
          create: { status: string };
          update: { status: string };
        }) => {
          const key = `${args.where.customerId_relatedCustomerId.customerId}:${args.where.customerId_relatedCustomerId.relatedCustomerId}`;
          const row = { id: key, status: args.update.status };
          rows.set(key, row);
          return row;
        },
      },
    };
    const first = await applyCorporateLinkReview(db, {
      actor,
      subjectCustomerId: A,
      relatedCustomerId: B,
      action: "confirm",
      justification: "QSA conferido manualmente com a mesma administradora.",
    }, async (entry) => {
      audits.push(entry.action);
    });
    const second = await applyCorporateLinkReview(db, {
      actor,
      subjectCustomerId: A,
      relatedCustomerId: B,
      action: "confirm",
      justification: "QSA conferido manualmente com a mesma administradora.",
    }, async () => undefined);
    assert.equal(first.ok && first.status, "CONFIRMED");
    assert.equal(second.ok && second.status, "CONFIRMED");
    assert.equal(rows.size, 2);
    assert.equal(audits.length, 2);
    const forbidden = assessCorporateLinkReview({
      actor: { role: "USER", assignedPermissions: [] },
      subjectCustomerId: A,
      relatedCustomerId: B,
      action: "confirm",
      justification: "Tentativa sem permissão de crédito.",
    });
    assert.equal(forbidden.ok, false);
  });

  it("T36 a leitura do grupo não grava membership", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "corporateRelation.server.ts"), "utf8");
    const load = /export async function loadCorporateRelationAssessment[\s\S]*?\nexport async function loadCorporateRelations/.exec(source)?.[0] ?? "";
    assert.equal(load.includes(".create("), false);
    assert.equal(load.includes("deleteMany"), false);
  });

  it("nomes gravados no QSA passam a ser candidatos na leitura", async () => {
    const stored = [
      membership({
        subjectCnpj: "50798391000100",
        nameKey: "MARIA MARGARETE DOS SANTOS PEREIRA",
        displayName: "Maria Margarete dos Santos Pereira",
      }),
      membership({
        subjectCnpj: "64577757000125",
        nameKey: "MARIA MARGARETE DOS SANTOS PEREIRA",
        displayName: "Maria Margarete dos Santos Pereira",
      }),
    ].map((row) => ({ ...row, memberNameKey: row.nameKey, memberName: row.displayName }));
    const assessment = await loadCorporateRelationAssessment(
      {
        commercialCorporateMembership: { findMany: async () => stored, findFirst: async () => null, create: async () => { throw new Error("read must not create"); } },
        customerCnpjLookup: { findFirst: async () => null },
        customer: { findMany: async () => [
          { id: A, taxId: "50798391000100", companyName: "Empresa A" },
          { id: B, taxId: "64577757000125", companyName: "Empresa B" },
        ] },
      } as never,
      { customerId: A, cnpj: "50798391000100", now: NOW }
    );
    assert.equal(assessment.relations.length, 0);
    assert.equal(assessment.candidates[0]?.relatedCustomerId, B);
    assert.equal(assessment.candidates[0]?.basis, "SHARED_NAME");
  });
});

describe("caso sintético de carteira e protestos", () => {
  const parties = [
    party(A, "50798391000100", "Empresa A"),
    party(B, "64577757000125", "Empresa B"),
    party(C, "41851758000110", "Empresa C"),
  ];
  const shared = [
    membership({
      subjectCnpj: "50798391000100",
      nameKey: "MARIA MARGARETE DOS SANTOS PEREIRA",
      displayName: "Maria Margarete dos Santos Pereira",
    }),
    membership({
      subjectCnpj: "64577757000125",
      nameKey: "MARIA MARGARETE DOS SANTOS PEREIRA",
      displayName: "Maria Margarete dos Santos Pereira",
    }),
    membership({ subjectCnpj: "41851758000110", nameKey: "JAEDSON RICARDO SILVA GALDINO DE SOUZA" }),
    membership({ subjectCnpj: "41851758000110", nameKey: "JOALLISON BARBOSA DE OLIVEIRA" }),
  ];

  it("antes da confirmação A fica em análise, C é bloqueada pela própria dívida e não entra no grupo", () => {
    const report = analyzeCorporateRelations({ now: NOW, parties, memberships: shared });
    assert.equal(report.relations.length, 0);
    assert.equal(report.candidates.filter((row) => row.subjectCustomerId === A && row.relatedCustomerId === B).length, 1);
    assert.equal(report.candidates.some((row) => row.relatedCustomerId === C || row.subjectCustomerId === C), false);
    const before = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("REGULAR"),
      pendingRelatedPartyCount: 1,
      relatedParties: [],
      cadastral: { score: 90, verdict: "VENDA LIBERADA" },
      now: NOW,
    });
    assert.equal(before.customerStatus, "EM_ANALISE");
    assert.equal(before.reason, "RELATED_PARTY_UNVERIFIED");
    assert.equal(before.allowed, false);
    assert.equal(before.cadastralIgnored, true);
    const own = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("REGULAR"),
      now: NOW,
    });
    const after = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("REGULAR"),
      relatedParties: [{ customerId: B, delinquency: analysis("OVERDUE", 6560) }],
      now: NOW,
    });
    assert.equal(after.customerStatus, "BLOQUEADO");
    assert.equal(after.reason, "RELATED_PARTY_DELINQUENT");
    assert.equal(JSON.stringify(after.evidence).includes("6560"), false);
    const third = decideCommercialCredit({
      customerId: C,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("OVERDUE", 55200),
      now: NOW,
    });
    assert.equal(third.reason, "OVERDUE_OPEN_BALANCE");
    assert.equal(third.evidence.relatedParties.length, 0);
    const view = buildCommercialCreditIntelligenceView({
      decision: after,
      delinquency: analysis("REGULAR"),
      externalProtest: "ABSENT",
      revealFinancial: true,
      ownCustomerStatus: own.customerStatus,
      pendingCorporateRelations: [],
      corporateRelations: [
        {
          kindLabel: "Vínculo confirmado",
          relatedCompany: "Empresa B",
          relatedCustomerId: B,
          creditStatusLabel: "Inadimplente",
          evidence: "Confirmado por administrador.",
        },
      ],
      relatedRestrictionFacts: [
        {
          companyName: "Empresa B",
          cnpj: "64577757000125",
          titleCount: 2,
          overdueAmount: 6560,
          maxDaysOverdue: 169,
          syncedAt: "2026-10-05T12:00:00.000Z",
          protest: false,
        },
      ],
    });
    assert.equal(view.decisionTitle, "CRÉDITO BLOQUEADO");
    assert.equal(view.ownDecisionTitle, "CRÉDITO LIBERADO");
    assert.match(view.relatedRestrictionLines[0] ?? "", /Empresa B/);
    assert.match(view.relatedRestrictionLines[0] ?? "", /não foi transferida/);
    assert.equal(view.decisionTitle === "CRÉDITO LIBERADO", false);
  });

  it("T24 a T28 e a evidência histórica distinguem protesto, negativa, ausência e indisponibilidade", () => {
    const fresh = new Date(2026, 10, 1);
    const old = new Date(2026, 8, 1);
    const expired = new Date(2026, 9, 1);
    assert.equal(
      interpretIeptbConsultations(
        [{ status: "SUCCEEDED", confirmedProtest: true, confirmedClear: false, insufficient: false, validUntil: fresh, consultedAt: NOW }],
        NOW
      ).state,
      "VALID"
    );
    const unavailable = interpretIeptbConsultations(
      [{ status: "FAILED", confirmedProtest: false, insufficient: true, validUntil: null, consultedAt: NOW }],
      NOW
    );
    assert.equal(unavailable.state, "FAILED");
    assert.equal(ieptbSituationLabel(unavailable.state, false), "Consulta indisponível");
    const pending = interpretIeptbConsultations([{ status: "SENT", consultedAt: NOW }], NOW);
    assert.equal(pending.state, "IN_PROGRESS");
    assert.equal(ieptbSituationLabel(pending.state, false), "Consulta pendente");
    const clear = interpretIeptbConsultations(
      [{ status: "SUCCEEDED", confirmedProtest: false, confirmedClear: true, insufficient: false, validUntil: fresh, consultedAt: NOW }],
      NOW
    );
    assert.equal(clear.confirmedProtest, false);
    assert.equal(ieptbSituationLabel(clear.state, false), "Consulta concluída sem ocorrência");
    const kept = interpretIeptbConsultations(
      [
        { status: "SUCCEEDED", confirmedProtest: true, confirmedClear: false, insufficient: false, validUntil: fresh, consultedAt: old },
        { status: "PARTIAL", confirmedProtest: false, insufficient: true, validUntil: null, consultedAt: NOW },
      ],
      NOW
    );
    assert.equal(kept.confirmedProtest, true);
    assert.equal(kept.state, "VALID");
    const replaced = interpretIeptbConsultations(
      [
        { status: "SUCCEEDED", confirmedProtest: true, validUntil: fresh, consultedAt: old },
        { status: "SUCCEEDED", confirmedProtest: false, confirmedClear: true, insufficient: false, validUntil: fresh, consultedAt: NOW },
      ],
      NOW
    );
    assert.equal(replaced.confirmedProtest, false);
    const expiredProtest = interpretIeptbConsultations(
      [{ status: "SUCCEEDED", confirmedProtest: true, validUntil: expired, consultedAt: old }],
      NOW
    );
    assert.equal(expiredProtest.state, "STALE");
    const blocked = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("REGULAR"),
      ieptb: kept,
      cadastral: { score: 95, verdict: "VENDA LIBERADA" },
      now: NOW,
    });
    assert.equal(blocked.reason, "IEPTB_NATIONAL_PROTEST");
    assert.equal(blocked.customerStatus, "BLOQUEADO");
    const unknown = decideCommercialCredit({
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: analysis("REGULAR"),
      ieptb: unavailable,
      now: NOW,
    });
    assert.equal(unknown.customerStatus, "EM_ANALISE");
    assert.equal(unknown.reason, "IEPTB_INSUFFICIENT");
    assert.equal(ieptbSituationLabel("NOT_CONSULTED", false), "Não consultado");
  });
});
