/**
 * QSA liga CNPJ completo e CPF válido pelo hash.
 * Nome igual fica pendente. Documento mascarado e CPF inválido não ligam.
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
  corporateIdentityKey,
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
    identityKey: null,
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
    assert.match(persisted[1]?.displayName ?? "", /PESSOA OCULTA/);
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
    assert.equal(corporateIdentityKey("11111111111"), null);
    assert.ok(cpf[0]?.identityKey?.startsWith("cpf:"));
    assert.equal(JSON.stringify(cpf).includes("12345678909"), false);
  });

  it("CPF válido liga pelo hash e não grava o documento", () => {
    const digits = "52998224725";
    const key = corporateIdentityKey(digits);
    assert.ok(key?.startsWith("cpf:"));
    assert.equal(key?.includes(digits), false);
    const left = extractBrasilApiMemberships(
      { cnpj: CNPJ_A, qsa: [{ nome_socio: "PESSOA OCULTA", qualificacao_socio: "Administrador", cnpj_cpf_do_socio: digits }] },
      FRESH
    );
    const right = extractBrasilApiMemberships(
      { cnpj: CNPJ_B, qsa: [{ nome_socio: "PESSOA OCULTA", qualificacao_socio: "Administrador", cnpj_cpf_do_socio: digits }] },
      FRESH
    );
    assert.equal(JSON.stringify([...left, ...right]).includes(digits), false);
    assert.equal(left[0]?.identityKey, right[0]?.identityKey);
    const report = analyzeCorporateRelations({
      now: NOW,
      parties: [party(A, CNPJ_A, "Alpha"), party(B, CNPJ_B, "Beta")],
      memberships: [...left, ...right],
    });
    const fromA = report.relations.filter((relation) => relation.subjectCustomerId === A);
    assert.equal(fromA.length, 1);
    assert.equal(fromA[0]?.basis, "SHARED_CPF");
    assert.equal(fromA[0]?.relatedCustomerId, B);
    assert.equal(JSON.stringify(fromA).includes(digits), false);
    assert.equal(report.candidates.length, 0);
  });

  it("nome igual fica pendente e não puxa o grupo confirmado da outra ponta", () => {
    const report = analyzeCorporateRelations({
      now: NOW,
      parties: [party(A, CNPJ_A, "Alpha"), party(B, CNPJ_B, "Beta"), party(C, CNPJ_C, "Gama")],
      memberships: [
        row({ subjectCnpj: CNPJ_A, memberCnpj: null, reliability: "INSUFFICIENT", documentKind: "MASKED", nameKey: "JOAO DA SILVA" }),
        row({ subjectCnpj: CNPJ_B, memberCnpj: null, reliability: "INSUFFICIENT", documentKind: "MASKED", nameKey: "JOAO DA SILVA" }),
        row({ subjectCnpj: CNPJ_B, memberCnpj: "00000000000191" }),
        row({ subjectCnpj: CNPJ_C, memberCnpj: "00000000000191" }),
      ],
    });
    const confirmedFromA = report.relations.filter((relation) => relation.subjectCustomerId === A);
    assert.equal(confirmedFromA.length, 0);
    const pendingFromA = report.candidates.filter((candidate) => candidate.subjectCustomerId === A);
    assert.equal(pendingFromA.length, 1);
    assert.equal(pendingFromA[0]?.status, "PENDING_REVIEW");
    assert.equal(pendingFromA[0]?.relatedCustomerId, B);
    assert.match(pendingFromA[0]?.evidenceLabel ?? "", /JOAO DA SILVA/);
    assert.equal(JSON.stringify(pendingFromA).includes("52998224725"), false);
    const confirmedFromB = report.relations.filter((relation) => relation.subjectCustomerId === B && relation.basis === "SHARED_CNPJ");
    assert.equal(confirmedFromB[0]?.relatedCustomerId, C);
  });

  it("cadeia confirmada de três empresas alcança a ponta indireta", () => {
    const report = analyzeCorporateRelations({
      now: NOW,
      parties: [party(A, CNPJ_A, "Alpha"), party(B, CNPJ_B, "Beta"), party(C, CNPJ_C, "Gama")],
      memberships: [
        row({ subjectCnpj: CNPJ_A, memberCnpj: "11111111000191" }),
        row({ subjectCnpj: CNPJ_B, memberCnpj: "11111111000191" }),
        row({ subjectCnpj: CNPJ_B, memberCnpj: "22222222000191" }),
        row({ subjectCnpj: CNPJ_C, memberCnpj: "22222222000191" }),
      ],
    });
    const fromA = report.relations.filter((relation) => relation.subjectCustomerId === A);
    const related = fromA.map((relation) => relation.relatedCustomerId).sort();
    assert.deepEqual(related, [B, C].sort());
    assert.equal(fromA.find((relation) => relation.relatedCustomerId === C)?.basis, "TRANSITIVE");
    assert.equal(fromA.find((relation) => relation.relatedCustomerId === B)?.basis, "SHARED_CNPJ");
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
      { id: B, taxId: CNPJ_C, companyName: "Beta", nomusExternalPersonId: 200, status: "LEAD" },
    ];
    const titles = [
      { externalId: 1, personId: 100, personCnpj: CNPJ_A, dueDate: new Date(2026, 9, 25), amountReceivable: 100, amountReceived: 0, balanceReceivable: 100, syncedAt: SYNCED },
      { externalId: 2, personId: 200, personCnpj: CNPJ_C, dueDate: new Date(2026, 9, 10), amountReceivable: 400, amountReceived: 0, balanceReceivable: 400, syncedAt: SYNCED },
    ];
    const memberships = [row({ subjectCnpj: CNPJ_A, memberCnpj: CNPJ_C })];
    const occurrences: Array<Record<string, unknown>> = [];
    const db = {
      customer: {
        findUnique: async ({ where }: { where: { id: string } }) => customers.find((item) => item.id === where.id) ?? null,
        findMany: async (args?: {
          where?: {
            taxId?: { in?: string[] };
            id?: { in?: string[] };
            OR?: Array<{ taxId?: { startsWith?: string } }>;
          };
          skip?: number;
          take?: number;
        }) => {
          const where = args?.where;
          let rows = customers;
          if (where?.taxId?.in) rows = rows.filter((item) => where.taxId?.in?.includes(item.taxId));
          if (where?.id?.in) rows = rows.filter((item) => where.id?.in?.includes(item.id));
          const prefixes = (where?.OR ?? [])
            .map((item) => item.taxId?.startsWith)
            .filter((value): value is string => Boolean(value));
          if (prefixes.length > 0) rows = rows.filter((item) => prefixes.some((prefix) => item.taxId.startsWith(prefix)));
          const skip = args?.skip ?? 0;
          const take = args?.take ?? rows.length;
          return rows.slice(skip, skip + take);
        },
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
    assert.equal(related.decision.customerStatus, "BLOQUEADO");
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
        relatedCustomerId: B,
        source: "brasilapi",
        consultedAt: FRESH.toISOString(),
        basis: "DIRECT_CNPJ",
      },
      "Inadimplente"
    );
    assert.match(shown.relatedCompany, /14\.055\.501\/0001-80/);
  });
});
