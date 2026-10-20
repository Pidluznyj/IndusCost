/**
 * QSA liga CNPJ completo. Nome, CPF e documento mascarado não ligam.
 * Não abre banco e não grava título.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { readCommercialCreditDecision } from "./commercialCreditDecision.server.js";
import {
  analyzeCorporateRelations,
  classifyCorporateRole,
  extractBrasilApiMemberships,
  extractMembershipsFromLookup,
  extractPublicaMemberships,
  type CorporateMembershipDraft,
  type RegisteredCorporateParty,
} from "./corporateRelation.js";
import { appendCorporateMemberships, presentCorporateRelation } from "./corporateRelation.server.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const CNPJ_A = "11444777000161";
const CNPJ_B = "14055501000180";
const CNPJ_C = "00000000000191";
const NOW = new Date(2026, 9, 19, 10, 0, 0);
const SYNCED = new Date(2026, 9, 19, 9, 0, 0);
const FRESH = new Date(2026, 9, 1, 10, 0, 0);
const STALE = new Date(2026, 5, 1, 10, 0, 0);

function party(customerId: string, cnpj: string, companyName: string, registryKind: "CUSTOMER" | "LEAD" = "CUSTOMER"): RegisteredCorporateParty {
  return { customerId, cnpj, companyName, registryKind };
}

function row(partial: Partial<CorporateMembershipDraft> & Pick<CorporateMembershipDraft, "subjectCnpj" | "memberCnpj">): CorporateMembershipDraft {
  return {
    source: "brasilapi",
    consultedAt: FRESH,
    memberKind: "PARTNER",
    roleText: "Sócio",
    personKind: "PJ",
    documentKind: partial.memberCnpj ? "CNPJ" : "ABSENT",
    reliability: partial.memberCnpj ? "HIGH" : "INSUFFICIENT",
    evidenceRef: `${partial.subjectCnpj}:${partial.memberCnpj ?? "none"}:${partial.source ?? "brasilapi"}`,
    nameKey: null,
    ...partial,
  };
}

describe("vínculos societários", () => {
  it("liga sócios, administradores e representantes pelo texto real", () => {
    assert.equal(classifyCorporateRole("Sócio-Administrador"), "PARTNER");
    assert.equal(classifyCorporateRole("Administrador"), "ADMINISTRATOR");
    assert.equal(classifyCorporateRole("Representante legal"), "REPRESENTATIVE");
    const rows = extractBrasilApiMemberships(
      {
        cnpj: CNPJ_A,
        qsa: [
          {
            nome_socio: "EMPRESA B",
            qualificacao_socio: "Sócio",
            identificador_de_socio: 1,
            cnpj_cpf_do_socio: CNPJ_B,
            nome_representante_legal: "PESSOA OCULTA",
            cpf_representante_legal: "***123456**",
          },
        ],
      },
      FRESH
    );
    assert.equal(rows[0]?.memberKind, "PARTNER");
    assert.equal(rows[0]?.memberCnpj, CNPJ_B);
    assert.equal(rows[0]?.reliability, "HIGH");
    assert.equal(rows[1]?.memberKind, "REPRESENTATIVE");
    assert.equal(rows[1]?.documentKind, "MASKED");
    assert.equal(rows[1]?.memberCnpj, null);
    const persisted = rows.map(({ nameKey: _nameKey, ...rest }) => rest);
    assert.equal(JSON.stringify(persisted).includes("PESSOA OCULTA"), false);
    assert.equal(JSON.stringify(persisted).includes("123456"), false);
  });

  it("reconhece sócio em comum e vários CNPJs", () => {
    const shared = analyzeCorporateRelations({
      now: NOW,
      parties: [party(A, CNPJ_A, "Alpha"), party(B, CNPJ_B, "Beta")],
      memberships: [
        row({ subjectCnpj: CNPJ_A, memberCnpj: CNPJ_C }),
        row({ subjectCnpj: CNPJ_B, memberCnpj: CNPJ_C, source: "publica.cnpj.ws" }),
      ],
    });
    assert.equal(shared.relations.length, 2);
    assert.ok(shared.relations.every((relation) => relation.basis === "SHARED_CNPJ"));
    assert.equal(shared.writes, "NONE");

    const multiple = analyzeCorporateRelations({
      now: NOW,
      parties: [party(A, CNPJ_A, "Alpha"), party(B, CNPJ_B, "Beta"), party(C, CNPJ_C, "Gama")],
      memberships: [row({ subjectCnpj: CNPJ_A, memberCnpj: CNPJ_B }), row({ subjectCnpj: CNPJ_A, memberCnpj: CNPJ_C })],
    });
    const fromA = multiple.relations.filter((relation) => relation.subjectCustomerId === A && relation.basis === "DIRECT_CNPJ");
    assert.deepEqual(fromA.map((relation) => relation.relatedCustomerId).sort(), [B, C].sort());
  });

  it("não liga empresa sem QSA, homônimo, documento mascarado, consulta velha ou ausência de prova", () => {
    const empty = extractMembershipsFromLookup({ sources: { brasilapi: { cnpj: CNPJ_A, qsa: [] } } }, FRESH);
    const noQsa = analyzeCorporateRelations({
      now: NOW,
      subjectCnpjs: [CNPJ_A],
      parties: [party(A, CNPJ_A, "Alpha"), party(B, CNPJ_B, "Beta")],
      memberships: empty,
    });
    assert.equal(noQsa.relations.length, 0);
    assert.equal(noQsa.withoutQsa, 1);

    const homonyms = analyzeCorporateRelations({
      now: NOW,
      parties: [party(A, CNPJ_A, "Alpha"), party(B, CNPJ_B, "Beta")],
      memberships: [
        row({ subjectCnpj: CNPJ_A, memberCnpj: null, reliability: "INSUFFICIENT", documentKind: "MASKED", nameKey: "JOAO DA SILVA" }),
        row({ subjectCnpj: CNPJ_B, memberCnpj: null, reliability: "INSUFFICIENT", documentKind: "MASKED", nameKey: "JOAO DA SILVA" }),
      ],
    });
    assert.equal(homonyms.relations.length, 0);
    assert.equal(homonyms.homonymIgnored, 1);

    const masked = extractPublicaMemberships(
      { cnpj: CNPJ_A, socios: [{ nome: "MESMO NOME", tipo: "Pessoa Física", cpf_cnpj_socio: "***.456.789-**", qualificacao_socio: { descricao: "Sócio" } }] },
      FRESH
    );
    assert.equal(masked[0]?.documentKind, "MASKED");
    const unproved = analyzeCorporateRelations({
      now: NOW,
      parties: [party(A, CNPJ_A, "Alpha"), party(B, CNPJ_B, "Beta", "LEAD")],
      memberships: masked,
    });
    assert.equal(unproved.relations.length, 0);
    assert.ok(unproved.insufficient > 0);

    const stale = analyzeCorporateRelations({
      now: NOW,
      parties: [party(A, CNPJ_A, "Alpha"), party(B, CNPJ_B, "Beta")],
      memberships: [row({ subjectCnpj: CNPJ_A, memberCnpj: CNPJ_B, consultedAt: STALE })],
    });
    assert.equal(stale.relations.length, 0);
    assert.equal(stale.stale, 1);

    const cpf = extractBrasilApiMemberships(
      { cnpj: CNPJ_A, qsa: [{ nome_socio: "PESSOA", qualificacao_socio: "Sócio", cnpj_cpf_do_socio: "12345678909" }] },
      FRESH
    );
    assert.equal(cpf[0]?.documentKind, "CPF_WITHHELD");
    assert.equal(cpf[0]?.memberCnpj, null);
    assert.equal(JSON.stringify(cpf).includes("12345678909"), false);
  });

  it("inclui a consulta uma vez e não apaga o histórico", async () => {
    const stored: CorporateMembershipDraft[] = [];
    const db = {
      commercialCorporateMembership: {
        findMany: async () => stored,
        findFirst: async ({ where }: { where: { evidenceRef: string } }) =>
          stored.find((item) => item.evidenceRef === where.evidenceRef) ?? null,
        create: async ({ data }: { data: CorporateMembershipDraft }) => {
          stored.push(data);
          return data;
        },
      },
      customerCnpjLookup: { findFirst: async () => null },
      customer: { findMany: async () => [] },
    };
    const membership = row({ subjectCnpj: CNPJ_A, memberCnpj: CNPJ_B });
    const first = await appendCorporateMemberships(db as never, { customerId: A, memberships: [membership] });
    const second = await appendCorporateMemberships(db as never, { customerId: A, memberships: [membership] });
    assert.deepEqual(first, { inserted: 1, skipped: 0, deleted: 0 });
    assert.deepEqual(second, { inserted: 0, skipped: 1, deleted: 0 });
    assert.equal(stored.length, 1);
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "corporateRelation.server.ts"), "utf8");
    assert.equal(source.includes("deleteMany"), false);
    assert.equal(source.includes("updateMany"), false);
    assert.equal(source.includes(".delete("), false);
  });

  it("gera análise pelo vínculo e mantém bloqueio crítico só na restrição própria", async () => {
    const customers = [
      { id: A, taxId: CNPJ_A, companyName: "Alpha", nomusExternalPersonId: 100, status: "ACTIVE" },
      { id: B, taxId: CNPJ_B, companyName: "Beta", nomusExternalPersonId: 200, status: "LEAD" },
    ];
    const titles = [
      { externalId: 1, personId: 100, personCnpj: CNPJ_A, dueDate: new Date(2026, 9, 25), amountReceivable: 100, amountReceived: 0, balanceReceivable: 100, syncedAt: SYNCED },
      { externalId: 2, personId: 200, personCnpj: CNPJ_B, dueDate: new Date(2026, 9, 10), amountReceivable: 400, amountReceived: 0, balanceReceivable: 400, syncedAt: SYNCED },
    ];
    const memberships = [row({ subjectCnpj: CNPJ_A, memberCnpj: CNPJ_B })];
    const occurrences: Array<Record<string, unknown>> = [];
    const db = {
      customer: {
        findUnique: async ({ where }: { where: { id: string } }) => customers.find((item) => item.id === where.id) ?? null,
        findMany: async ({ where }: { where: { taxId: { in: string[] } } }) =>
          customers.filter((item) => where.taxId.in.includes(item.taxId)),
      },
      salesOrder: { findMany: async () => [] },
      nomusAccountsReceivable: {
        aggregate: async () => ({ _max: { syncedAt: SYNCED } }),
        findMany: async ({ where }: { where: { personId: number } }) =>
          titles
            .filter((title) => title.personId === where.personId)
            .map((title) => ({
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
              rawPayload: { id: title.externalId },
              ...title,
            })),
      },
      nomusSourceSyncRun: { findFirst: async () => ({ status: "SUCCESS", payloadComplete: true, startedAt: SYNCED }) },
      customerCorporateLink: { findMany: async () => [] },
      commercialExternalProtest: { findMany: async () => [] },
      commercialCreditException: { findMany: async () => [] },
      commercialCreditOccurrence: { findMany: async () => occurrences },
      commercialCorporateMembership: {
        findMany: async () => memberships,
        findFirst: async () => null,
      },
      customerCnpjLookup: { findFirst: async () => null },
    };

    const related = await readCommercialCreditDecision(db as never, {
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      now: NOW,
    });
    assert.equal(related.decision.customerStatus, "EM_ANALISE");
    assert.equal(related.decision.reason, "RELATED_PARTY_DELINQUENT");
    assert.notEqual(related.decision.customerStatus, "BLOQUEIO_CRITICO");
    assert.equal(related.corporateRelations.length, 1);
    assert.match(related.corporateRelations[0]?.relatedCompany ?? "", /Lead · Beta/);
    assert.equal(related.corporateRelations[0]?.creditStatusLabel, "Inadimplente");
    assert.match(related.corporateRelations[0]?.evidence ?? "", /Não transfere dívida/);
    assert.equal(JSON.stringify(related.corporateRelations).includes("400"), false);

    occurrences.push({
      id: "occ",
      kind: "PROTEST_CONFIRMED",
      status: "CONFIRMED_PENDING",
      origin: "MANUAL",
      occurredAt: NOW,
      titleExternalId: 1,
      responsibleUserId: A,
      justification: "Protesto próprio confirmado.",
      closedAt: null,
    });
    const own = await readCommercialCreditDecision(db as never, {
      customerId: A,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      now: NOW,
    });
    assert.equal(own.decision.customerStatus, "BLOQUEIO_CRITICO");
    assert.equal(own.decision.reason, "INTERNAL_PROTEST");

    const shown = presentCorporateRelation(
      {
        memberKind: "PARTNER",
        registryKind: "LEAD",
        relatedCompanyName: "Beta",
        relatedCnpj: CNPJ_B,
        source: "brasilapi",
        consultedAt: FRESH.toISOString(),
        basis: "DIRECT_CNPJ",
      },
      "Inadimplente"
    );
    assert.match(shown.relatedCompany, /14\.055\.501\/0001-80/);
  });
});
