import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizePersonRow } from "@/src/lib/people/personProfile.server";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Paula Pidluznyj",
  socialName: "Paula",
  status: "ACTIVE",
  origin: "EMPLOYEE",
  cpfNormalized: "52998224725",
  corporateEmail: "p@x.test",
  personalEmail: null,
  phoneNormalized: null,
  createdAt: new Date("2026-07-15"),
  updatedAt: new Date("2026-10-20"),
  mergedIntoPersonId: null,
  employees: [] as Array<{ id: string; status: string | null; appUser: { id: string; personId: string | null; isActive: boolean } | null; _count: { hrDocuments: number } }>,
  appUsers: [] as Array<{ id: string; isActive: boolean; employeeId: string | null }>,
  fleetDrivers: [] as Array<{ id: string; status: string }>,
  commissionPeople: [] as Array<{ id: string; active: boolean }>,
};

describe("Pessoas 360° — estados dos vínculos a partir da linha da Pessoa", () => {
  it("sem vínculos: tudo NOT_LINKED, flag NO_LINKS, nome social exibido e CPF mascarado", () => {
    const row = summarizePersonRow(base as never);
    assert.equal(row.displayName, "Paula");
    assert.equal(row.civilName, "Paula Pidluznyj");
    assert.equal(row.cpfMasked, "***.***.247-25");
    assert.deepEqual(row.links, { employee: "NOT_LINKED", appUser: "NOT_LINKED", fleetDriver: "NOT_LINKED", commissionPerson: "NOT_LINKED" });
    assert.ok(row.flags.includes("NO_LINKS"));
  });

  it("colaborador ativo com conta na mesma Pessoa: LINKED nos dois", () => {
    const row = summarizePersonRow({
      ...base,
      employees: [{ id: "e1", status: "ACTIVE", appUser: { id: "u1", personId: base.id, isActive: true }, _count: { hrDocuments: 2 } }],
      appUsers: [{ id: "u1", isActive: true, employeeId: "e1" }],
    } as never);
    assert.equal(row.links.employee, "LINKED");
    assert.equal(row.links.appUser, "LINKED");
    assert.equal(row.documentsCount, 2);
    assert.deepEqual(row.flags, []);
  });

  it("caso real: conta do colaborador aponta para OUTRA Pessoa → CONFLICT + flag", () => {
    const row = summarizePersonRow({
      ...base,
      employees: [{ id: "e1", status: "ACTIVE", appUser: { id: "u1", personId: "22222222-2222-4222-8222-222222222222", isActive: true }, _count: { hrDocuments: 0 } }],
    } as never);
    assert.equal(row.links.employee, "LINKED");
    assert.equal(row.links.appUser, "CONFLICT");
    assert.ok(row.flags.includes("USER_ON_OTHER_PERSON"));
  });

  it("conta do colaborador sem Pessoa → PENDING_REVIEW + flag", () => {
    const row = summarizePersonRow({
      ...base,
      employees: [{ id: "e1", status: "ACTIVE", appUser: { id: "u1", personId: null, isActive: true }, _count: { hrDocuments: 0 } }],
    } as never);
    assert.equal(row.links.appUser, "PENDING_REVIEW");
    assert.ok(row.flags.includes("USER_WITHOUT_PERSON"));
  });

  it("colaborador desligado e conta inativa: INACTIVE (vínculo existe, não ativo)", () => {
    const row = summarizePersonRow({
      ...base,
      employees: [{ id: "e1", status: "INACTIVE", appUser: { id: "u1", personId: base.id, isActive: false }, _count: { hrDocuments: 1 } }],
      appUsers: [{ id: "u1", isActive: false, employeeId: "e1" }],
      fleetDrivers: [{ id: "d1", status: "INACTIVE" }],
      commissionPeople: [{ id: "c1", active: false }],
    } as never);
    assert.deepEqual(row.links, { employee: "INACTIVE", appUser: "INACTIVE", fleetDriver: "INACTIVE", commissionPerson: "INACTIVE" });
  });

  it("Pessoa MERGED carrega a flag", () => {
    const row = summarizePersonRow({ ...base, status: "MERGED", mergedIntoPersonId: "33333333-3333-4333-8333-333333333333" } as never);
    assert.ok(row.flags.includes("MERGED"));
    assert.equal(row.status, "MERGED");
  });
});
