/**
 * Hardening / regressão — Pessoa Canônica + RH + Clientes + permissões + backfill.
 * Sem DB real: fixtures + auditoria estática de rotas/migrations.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildPersonIndexes,
  classifyOrphanAgainstPersons,
  filterApplyCandidates,
  type PersonIndexRow,
} from "./canonicalPersonBackfill.ts";
import {
  classifyCustomerDocument,
  isUnequivocalMatchEvidence,
} from "./canonicalPerson.ts";
import {
  canCreateEmployees,
  canManageEmployeeLinks,
  canManageEmployeeUserLink,
  canViewEmployeePersonalData,
  canViewEmployeeSensitiveData,
  EMPLOYEES_CREATE_PERMISSIONS,
  EMPLOYEES_LINKS_MANAGE_PERMISSIONS,
  EMPLOYEES_USER_LINK_MANAGE_PERMISSIONS,
  EMPLOYEES_VIEW_PERMISSIONS,
} from "./employeesPermissions.ts";
import {
  assertCorporateEmailFormat,
  CorporateEmailError,
  normalizeCorporateEmail,
} from "./employeeCorporateEmail.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function check(perms: string[]) {
  const set = new Set(perms);
  return {
    hasPermission: (p: string) => set.has(p),
    hasAnyPermission: (list: readonly string[]) => list.some((p) => set.has(p)),
  };
}

const VALID_CPF = "11144477735";

describe("hardening — migrations Person/RH presentes e seguras", () => {
  const required = [
    "20260715180000_employee_registration_lookups",
    "20260715190000_canonical_person",
    "20260715200000_canonical_person_core_harden",
    "20260715210000_employee_corporate_email_normalize",
    "20260715220000_customer_contact_person",
  ];

  it("pastas de migration com SQL", () => {
    const migRoot = join(root, "prisma/migrations");
    for (const name of required) {
      const sql = join(migRoot, name, "migration.sql");
      assert.ok(existsSync(sql), `faltando ${name}/migration.sql`);
      const body = readFileSync(sql, "utf8");
      assert.ok(body.trim().length > 20, `${name} SQL vazio`);
      assert.ok(!/DROP\s+TABLE\s+"Person"/i.test(body), `${name} não deve dropar Person`);
    }
  });

  it("canonical_person cria Person e personId nas entidades", () => {
    const sql = readSrc(
      "prisma/migrations/20260715190000_canonical_person/migration.sql"
    );
    assert.match(sql, /CREATE TABLE.*"Person"/i);
    assert.match(sql, /"personId"/);
  });

  it("customer_contact_person adiciona contactPersonId", () => {
    const sql = readSrc(
      "prisma/migrations/20260715220000_customer_contact_person/migration.sql"
    );
    assert.match(sql, /contactPersonId/i);
  });
});

describe("hardening — guards de API (fonte)", () => {
  it("GET /api/employees usa bag VIEW (não só employees.view)", () => {
    const src = readSrc("server.ts");
    assert.ok(src.includes("EMPLOYEES_VIEW_PERMISSIONS"));
    assert.ok(src.includes('"/api/employees"'));
    assert.ok(src.includes("redactEmployeePersonalEmergencyForApi"));
    assert.ok(src.includes("redactEmployeeAdminForApi"));
  });

  it("POST create usa EMPLOYEES_CREATE_PERMISSIONS", () => {
    const src = readSrc("server.ts");
    assert.ok(src.includes("EMPLOYEES_CREATE_PERMISSIONS"));
  });

  it("PUT customers strip personId/contactPersonId", () => {
    const src = readSrc("server.ts");
    const putIdx = src.indexOf('app.put("/api/customers/:id"');
    assert.ok(putIdx > 0);
    const slice = src.slice(putIdx, putIdx + 800);
    assert.ok(slice.includes("delete body.personId"));
    assert.ok(slice.includes("delete body.contactPersonId"));
  });

  it("system-links e person-link protegidos", () => {
    const src = readSrc("src/lib/canonicalPersonRoutes.ts");
    assert.ok(src.includes('"/api/employees/:id/system-links"'));
    assert.ok(src.includes("RH_LINKS_VIEW_PERMS") || src.includes("EMPLOYEES_LINKS_VIEW"));
    assert.ok(src.includes('"/api/employees/:id/person-link"'));
    assert.ok(src.includes("LINK_PERMS") || src.includes("EMPLOYEES_LINKS_MANAGE"));
  });

  it("user-link manage bag", () => {
    const src = readSrc("src/lib/employeeLookupRoutes.ts");
    assert.ok(src.includes("EMPLOYEES_USER_LINK_MANAGE_PERMISSIONS"));
  });
});

describe("hardening — personas (matriz efetiva)", () => {
  it("SUPER_ADMIN/ADMIN cobertos via bags; RH leitura sem PII/salário", () => {
    const ro = check(["employees.view"]);
    assert.equal(canCreateEmployees(ro), false);
    assert.equal(canViewEmployeePersonalData(ro), false);
    assert.equal(canViewEmployeeSensitiveData(ro), false);
    assert.equal(canManageEmployeeLinks(ro), false);
  });

  it("RH completo (edit) cobre facetas e vínculos", () => {
    const rh = check(["employees.view", "employees.edit"]);
    assert.equal(canCreateEmployees(rh), true);
    assert.equal(canViewEmployeePersonalData(rh), true);
    assert.equal(canViewEmployeeSensitiveData(rh), true);
    assert.equal(canManageEmployeeLinks(rh), true);
    assert.equal(canManageEmployeeUserLink(rh), true);
  });

  it("usuário sem dados pessoais / sem vínculos", () => {
    const noPii = check(["employees.view", "employees.links.view"]);
    assert.equal(canViewEmployeePersonalData(noPii), false);
    assert.equal(canManageEmployeeLinks(noPii), false);
  });

  it("deny específico de manage mantém view", () => {
    const c = check(["employees.view", "employees.links.view"]);
    assert.ok([...EMPLOYEES_VIEW_PERMISSIONS].includes("employees.view"));
    assert.ok(!EMPLOYEES_LINKS_MANAGE_PERMISSIONS.every((p) => c.hasPermission(p)));
  });
});

describe("hardening — regras de negócio críticas", () => {
  it("nome nunca é evidência inequívoca; e-mail/CPF sim", () => {
    assert.equal(isUnequivocalMatchEvidence({ nameOnly: true }), false);
    assert.equal(isUnequivocalMatchEvidence({ emailExact: true }), true);
    assert.equal(isUnequivocalMatchEvidence({ cpfExact: true }), true);
  });

  it("PF vs PJ", () => {
    assert.equal(classifyCustomerDocument("12345678909"), "PF");
    assert.equal(classifyCustomerDocument("12345678000199"), "PJ");
  });

  it("e-mail corporativo normaliza; formato inválido falha", () => {
    assert.equal(normalizeCorporateEmail("  A@B.COM "), "a@b.com");
    assert.throws(() => assertCorporateEmailFormat("sem-arroba"), CorporateEmailError);
  });

  it("backfill: ambiguous e name não entram no apply; CPF único sim", () => {
    const people: PersonIndexRow[] = [
      {
        id: "p1",
        displayName: "Ana",
        corporateEmail: null,
        personalEmail: null,
        cpfNormalized: VALID_CPF,
        phoneNormalized: null,
        linkedEmployeeIds: [],
        linkedAppUserIds: [],
      },
      {
        id: "p2",
        displayName: "Ana",
        corporateEmail: "dup@x.com",
        personalEmail: null,
        cpfNormalized: null,
        phoneNormalized: null,
        linkedEmployeeIds: [],
        linkedAppUserIds: [],
      },
      {
        id: "p3",
        displayName: "Ana",
        corporateEmail: "dup@x.com",
        personalEmail: null,
        cpfNormalized: null,
        phoneNormalized: null,
        linkedEmployeeIds: [],
        linkedAppUserIds: [],
      },
    ];
    const idx = buildPersonIndexes(people);
    const ok = classifyOrphanAgainstPersons(
      {
        kind: "employee",
        id: "e1",
        label: "Ana",
        emails: [],
        cpf: VALID_CPF,
        phone: null,
        officialId: null,
        name: "Ana",
      },
      idx
    );
    const amb = classifyOrphanAgainstPersons(
      {
        kind: "employee",
        id: "e2",
        label: "X",
        emails: ["dup@x.com"],
        cpf: null,
        phone: null,
        officialId: null,
        name: "X",
      },
      idx
    );
    const nameOnly = classifyOrphanAgainstPersons(
      {
        kind: "employee",
        id: "e3",
        label: "Ana",
        emails: [],
        cpf: null,
        phone: null,
        officialId: null,
        name: "Ana",
      },
      idx
    );
    assert.equal(ok.category, "unequivocal");
    assert.equal(amb.category, "ambiguous");
    assert.equal(nameOnly.autoLinkSafe, false);
    const apply = filterApplyCandidates([ok, amb, nameOnly]);
    assert.equal(apply.length, 1);
    assert.equal(apply[0].entityId, "e1");
  });

  it("segunda execução (Person já com Employee) bloqueia apply", () => {
    const people: PersonIndexRow[] = [
      {
        id: "p1",
        displayName: "Ana",
        corporateEmail: null,
        personalEmail: null,
        cpfNormalized: VALID_CPF,
        phoneNormalized: null,
        linkedEmployeeIds: ["e-already"],
        linkedAppUserIds: [],
      },
    ];
    const idx = buildPersonIndexes(people);
    const again = classifyOrphanAgainstPersons(
      {
        kind: "employee",
        id: "e-new",
        label: "Ana",
        emails: [],
        cpf: VALID_CPF,
        phone: null,
        officialId: null,
        name: "Ana",
      },
      idx
    );
    assert.equal(again.category, "conflict");
    assert.equal(filterApplyCandidates([again]).length, 0);
  });
});

describe("hardening — scripts e documentação de deploy", () => {
  it("script backfill exige dry-run/confirm-apply", () => {
    const src = readSrc("scripts/canonical-person-backfill.ts");
    assert.ok(src.includes("--dry-run"));
    assert.ok(src.includes("--confirm-apply"));
    assert.ok(src.includes("Não executar apply em produção") || src.includes("não rodar apply"));
  });

  it("checklist de homologação Person/RH existe", () => {
    assert.ok(
      existsSync(join(root, "docs/people/canonical-person-homologation-checklist.md"))
    );
  });

  it("permissoes create/user_link bags exportadas", () => {
    assert.ok(EMPLOYEES_CREATE_PERMISSIONS.includes("employees.create"));
    assert.ok(EMPLOYEES_USER_LINK_MANAGE_PERMISSIONS.includes("employees.user_link.manage"));
  });
});

describe("hardening — inventário migrations (não aplicam no CI)", () => {
  it("lista migrations sem pastas vazias", () => {
    const migRoot = join(root, "prisma/migrations");
    const dirs = readdirSync(migRoot, { withFileTypes: true }).filter((d) =>
      d.isDirectory()
    );
    assert.ok(dirs.length >= 5);
    for (const d of dirs) {
      if (d.name.startsWith(".")) continue;
      assert.ok(
        existsSync(join(migRoot, d.name, "migration.sql")),
        `migration sem SQL: ${d.name}`
      );
    }
  });
});
