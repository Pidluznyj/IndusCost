import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { foldAscii, maskCpf, maskEmail, maskPhone, normalizeEmailLoose } from "./canonicalPerson.ts";
import {
  accentSearchPrefix,
  mapResolveItemToLegacyHit,
  resolvePersonLinkFlagsForTest,
  scorePersonResolveForTest,
  type PersonResolveItem,
  resolvePeopleSearch,
} from "./canonicalPersonSearch.server.ts";

describe("canonicalPersonSearch — normalização e máscaras", () => {
  it("fold acento e prefixo de busca", () => {
    assert.equal(foldAscii("José Maria"), "jose maria");
    assert.equal(accentSearchPrefix("jose"), "jose");
    assert.equal(accentSearchPrefix("jo"), "jo");
  });

  it("e-mail normalizado e máscaras PII", () => {
    assert.equal(normalizeEmailLoose("  A@B.COM "), "a@b.com");
    assert.ok(maskEmail("joao@empresa.com")?.includes("***"));
    assert.ok(maskCpf("12345678909")?.includes("***"));
    assert.ok(maskPhone("11988887777")?.endsWith("7777"));
  });
});

describe("canonicalPersonSearch — flags de vínculo", () => {
  it("legado sem personId pode vincular", () => {
    const f = resolvePersonLinkFlagsForTest({ personId: null });
    assert.equal(f.linkStatus, "legacy_unlinked");
    assert.equal(f.podeVincular, true);
    assert.equal(f.motivoBloqueio, null);
  });

  it("já vinculado à canônica", () => {
    const f = resolvePersonLinkFlagsForTest({ personId: "p-1" });
    assert.equal(f.linkStatus, "canonical_linked");
    assert.equal(f.podeVincular, true);
  });

  it("conflito: e-mail de outra pessoa", () => {
    const f = resolvePersonLinkFlagsForTest({
      personId: null,
      conflictSameEmailOtherPerson: true,
    });
    assert.equal(f.linkStatus, "conflict");
    assert.equal(f.podeVincular, false);
    assert.ok(f.motivoBloqueio);
  });

  it("conflito: person já tem outro colaborador (contexto de vínculo)", () => {
    const f = resolvePersonLinkFlagsForTest({
      personId: "p-1",
      alreadyHasEmployee: true,
      selfEmployeeId: "emp-self",
      sourceEmployeeId: "emp-other",
    });
    assert.equal(f.linkStatus, "conflict");
    assert.equal(f.podeVincular, false);
  });

  it("busca sem contexto de vínculo: person com colaborador fica linked", () => {
    const f = resolvePersonLinkFlagsForTest({
      personId: "p-1",
      alreadyHasEmployee: true,
      selfEmployeeId: null,
      sourceEmployeeId: "emp-other",
    });
    assert.equal(f.linkStatus, "canonical_linked");
    assert.equal(f.podeVincular, true);
  });

  it("mesmo colaborador em edição não conflita", () => {
    const f = resolvePersonLinkFlagsForTest({
      personId: "p-1",
      alreadyHasEmployee: true,
      selfEmployeeId: "emp-1",
      sourceEmployeeId: "emp-1",
    });
    assert.equal(f.linkStatus, "canonical_linked");
    assert.equal(f.podeVincular, true);
  });
});

describe("canonicalPersonSearch — score e DTO legado", () => {
  it("CPF/e-mail pontuam acima de nome", () => {
    assert.ok(scorePersonResolveForTest("cpf", "legacy_unlinked") > scorePersonResolveForTest("name", "legacy_unlinked"));
    assert.ok(scorePersonResolveForTest("email", "legacy_unlinked") > scorePersonResolveForTest("name", "legacy_unlinked"));
  });

  it("mapResolveItemToLegacyHit não expoe campos Nomus", () => {
    const item: PersonResolveItem = {
      key: "employee:e1",
      displayName: "Ana",
      socialName: null,
      email: null,
      emailMasked: "a***@x.com",
      phoneMasked: null,
      cpfMasked: null,
      cpf: null,
      origin: "Colaborador",
      sourceKind: "employee",
      sourceEntityId: "e1",
      roles: ["Colaborador"],
      status: "ACTIVE",
      personId: null,
      linkStatus: "legacy_unlinked",
      podeVincular: true,
      motivoBloqueio: null,
      matchReason: "name",
      score: 30,
    };
    const hit = mapResolveItemToLegacyHit(item);
    assert.equal(hit.sourceId, "e1");
    assert.equal(hit.podeVincular, true);
    assert.ok(!("nomusPersonId" in hit));
  });
});

function emptyFindMany() {
  return Promise.resolve([]);
}

describe("canonicalPersonSearch — resolvePeopleSearch (mock)", () => {
  it("q curta retorna vazio sem consultar fontes", async () => {
    let called = 0;
    const prisma = {
      person: { findMany: async () => {
        called += 1;
        return [];
      } },
    } as never;
    const r = await resolvePeopleSearch(prisma, { q: "a", canViewPii: false });
    assert.equal(r.items.length, 0);
    assert.equal(r.meta.total, 0);
    assert.equal(called, 0);
  });

  it("CPF sem permissão não busca por CPF e mascara PII", async () => {
    const personRows = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        displayName: "José Silva",
        socialName: "Zé",
        corporateEmail: "jose@empresa.com",
        personalEmail: null,
        cpfNormalized: "12345678909",
        phoneNormalized: "11999998888",
        status: "ACTIVE",
        employees: [{ id: "e1", status: "ACTIVE" }],
        appUsers: [],
        commissionPeople: [],
        fleetDrivers: [],
        customers: [],
      },
    ];
    const prisma = {
      person: {
        findMany: async (args: { where?: { AND?: Array<{ OR?: unknown[] }> } }) => {
          const and = args.where?.AND ?? [];
          const orBlock = and.find((x) => x && typeof x === "object" && "OR" in x) as
            | { OR?: Array<Record<string, unknown>> }
            | undefined;
          const ors = orBlock?.OR ?? [];
          const hasCpf = ors.some((c) => "cpfNormalized" in c);
          assert.equal(hasCpf, false, "sem PII não deve filtrar por CPF");
          return personRows;
        },
      },
      employee: { findMany: emptyFindMany },
      appUser: { findMany: emptyFindMany },
      commissionPerson: { findMany: emptyFindMany },
      fleetDriver: { findMany: emptyFindMany },
      customer: { findMany: emptyFindMany },
    } as never;

    const r = await resolvePeopleSearch(prisma, {
      q: "José",
      canViewPii: false,
      page: 1,
      limit: 10,
    });
    assert.equal(r.items.length, 1);
    const row = r.items[0]!;
    assert.equal(row.email, null);
    assert.equal(row.cpf, null);
    assert.ok(row.emailMasked?.includes("***"));
    assert.ok(row.cpfMasked?.includes("***"));
    assert.equal(row.linkStatus, "canonical_linked");
    assert.ok(row.roles.includes("Colaborador"));
  });

  it("com PII busca CPF e retorna cpf/e-mail", async () => {
    const prisma = {
      person: {
        findMany: async (args: { where?: { AND?: Array<{ OR?: unknown[] }> } }) => {
          const and = args.where?.AND ?? [];
          const orBlock = and.find((x) => x && typeof x === "object" && "OR" in x) as
            | { OR?: Array<Record<string, unknown>> }
            | undefined;
          const ors = orBlock?.OR ?? [];
          const hasCpf = ors.some((c) => "cpfNormalized" in c);
          assert.equal(hasCpf, true);
          return [
            {
              id: "22222222-2222-4222-8222-222222222222",
              displayName: "Ana",
              socialName: null,
              corporateEmail: "ana@x.com",
              personalEmail: null,
              cpfNormalized: "12345678909",
              phoneNormalized: null,
              status: "ACTIVE",
              employees: [],
              appUsers: [],
              commissionPeople: [],
              fleetDrivers: [],
              customers: [],
            },
          ];
        },
      },
      employee: { findMany: emptyFindMany },
      appUser: { findMany: emptyFindMany },
      commissionPerson: { findMany: emptyFindMany },
      fleetDriver: { findMany: emptyFindMany },
      customer: { findMany: emptyFindMany },
    } as never;

    const r = await resolvePeopleSearch(prisma, {
      q: "123.456.789-09",
      canViewPii: true,
    });
    assert.equal(r.items[0]?.cpf, "12345678909");
    assert.equal(r.items[0]?.email, "ana@x.com");
    assert.equal(r.items[0]?.matchReason, "cpf");
  });

  it("paginação limita resultados", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      id: `33333333-3333-4333-8333-33333333333${i}`,
      displayName: `Pessoa ${i}`,
      socialName: null,
      corporateEmail: null,
      personalEmail: null,
      cpfNormalized: null,
      phoneNormalized: null,
      status: "ACTIVE",
      employees: [],
      appUsers: [],
      commissionPeople: [],
      fleetDrivers: [],
      customers: [],
    }));
    const prisma = {
      person: { findMany: async () => many },
      employee: { findMany: emptyFindMany },
      appUser: { findMany: emptyFindMany },
      commissionPerson: { findMany: emptyFindMany },
      fleetDriver: { findMany: emptyFindMany },
      customer: { findMany: emptyFindMany },
    } as never;

    const page1 = await resolvePeopleSearch(prisma, {
      q: "Pessoa",
      canViewPii: false,
      page: 1,
      limit: 2,
    });
    assert.equal(page1.items.length, 2);
    assert.equal(page1.meta.total, 5);
    assert.equal(page1.meta.totalPages, 3);

    const page2 = await resolvePeopleSearch(prisma, {
      q: "Pessoa",
      canViewPii: false,
      page: 2,
      limit: 2,
    });
    assert.equal(page2.items.length, 2);
    assert.notEqual(page2.items[0]?.key, page1.items[0]?.key);
  });

  it("registro legado sem vínculo", async () => {
    const prisma = {
      person: { findMany: emptyFindMany },
      employee: {
        findMany: async () => [
          {
            id: "emp-leg",
            name: "Legado",
            socialName: null,
            corporateEmail: "leg@x.com",
            personalEmail: null,
            phone: null,
            cpf: null,
            status: "ACTIVE",
            personId: null,
          },
        ],
      },
      appUser: { findMany: emptyFindMany },
      commissionPerson: { findMany: emptyFindMany },
      fleetDriver: { findMany: emptyFindMany },
      customer: { findMany: emptyFindMany },
    } as never;

    const r = await resolvePeopleSearch(prisma, { q: "Legado", canViewPii: true });
    const legacy = r.items.find((i) => i.key === "employee:emp-leg");
    assert.equal(legacy?.linkStatus, "legacy_unlinked");
    assert.equal(legacy?.podeVincular, true);
    assert.equal(legacy?.personId, null);
  });

  it("possível match AppUser com e-mail já em Person", async () => {
    const prisma = {
      person: {
        findMany: async (args: { where?: unknown; select?: unknown; include?: unknown }) => {
          if (args && typeof args === "object" && "select" in (args as object) && !("include" in (args as object))) {
            return [{ id: "p-existing", corporateEmail: "dup@x.com" }];
          }
          return [];
        },
      },
      employee: { findMany: emptyFindMany },
      appUser: {
        findMany: async () => [
          {
            id: "u1",
            name: "User Dup",
            email: "dup@x.com",
            isActive: true,
            personId: null,
            employeeId: null,
          },
        ],
      },
      commissionPerson: { findMany: emptyFindMany },
      fleetDriver: { findMany: emptyFindMany },
      customer: { findMany: emptyFindMany },
    } as never;

    const r = await resolvePeopleSearch(prisma, { q: "User", canViewPii: true });
    const user = r.items.find((i) => i.key === "app_user:u1");
    assert.equal(user?.linkStatus, "possible_match");
    assert.ok(user?.motivoBloqueio);
  });

  it("inativo excluído por padrão", async () => {
    let personWhere: unknown;
    const prisma = {
      person: {
        findMany: async (args: { where?: unknown }) => {
          personWhere = args.where;
          return [];
        },
      },
      employee: { findMany: emptyFindMany },
      appUser: { findMany: emptyFindMany },
      commissionPerson: { findMany: emptyFindMany },
      fleetDriver: { findMany: emptyFindMany },
      customer: { findMany: emptyFindMany },
    } as never;

    await resolvePeopleSearch(prisma, { q: "xx", canViewPii: false });
    const serialized = JSON.stringify(personWhere);
    assert.ok(serialized.includes("ACTIVE"));
  });
});
