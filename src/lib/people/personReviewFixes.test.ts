/**
 * Correções da revisão adversarial do cadastro mestre (Pessoas 360°).
 * Cada caso reproduz o cenário apontado e fixa o comportamento corrigido.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { linkEmployeeToAppUser, unlinkEmployeeFromAppUser } from "@/src/lib/employeeUserLink.server.ts";
import { propagateEmployeePersonToLinkedUser } from "@/src/lib/canonicalPersonSync.server.ts";
import { createAppUserAccount } from "@/src/lib/adminUserCreation.server.ts";
import { decideAttachAccount } from "./personAccountLink.ts";
import { planDriverEnable } from "./personDriverEnable.ts";
import { planPersonMerge, type IdentityForMerge } from "./personLinkOps.ts";
import { decidePersonStatusChange } from "./personMaster.ts";

const P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const hrEditor = { id: "rh", role: "VIEWER", elevated: false };
const saElevated = { id: "sa", role: "SUPER_ADMIN", elevated: true };

describe("#12 RH não altera vínculo de conta SUPER_ADMIN pelas rotas antigas", () => {
  const txFor = (writes: unknown[]) => ({
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $executeRaw: async () => 0,
        employee: { findUnique: async () => ({ id: "e1", corporateEmail: "sa@x.com", personId: P, appUser: null }) },
        person: { findUnique: async () => ({ status: "ACTIVE" }) },
        appUser: {
          // Mesma Pessoa canônica nos dois lados: única evidência aceita pela rota do RH.
          findFirst: async () => ({ id: "u-sa", employeeId: null, personId: P, email: "sa@x.com", role: "SUPER_ADMIN" }),
          updateMany: async (args: unknown) => {
            writes.push(args);
            return { count: 1 };
          },
          findUnique: async () => ({ id: "u-sa", email: "sa@x.com", isActive: true, role: "SUPER_ADMIN", name: "SA" }),
        },
        securityAuditLog: { create: async () => ({}) },
      }),
  });
  it("link-user: editor de RH recebe 403 e nada é gravado; SUPER_ADMIN elevado vincula", async () => {
    const writes: unknown[] = [];
    await assert.rejects(linkEmployeeToAppUser(txFor(writes) as never, "e1", { actorUserId: "rh", actor: hrEditor }), (e: { code: string; status: number }) => e.code === "SUPER_ADMIN_REQUIRED" && e.status === 403);
    await assert.rejects(linkEmployeeToAppUser(txFor(writes) as never, "e1", { actorUserId: "rh" }), (e: { code: string }) => e.code === "SUPER_ADMIN_REQUIRED", "sem ator: fail-closed");
    assert.equal(writes.length, 0);
    const ok = await linkEmployeeToAppUser(txFor(writes) as never, "e1", { actorUserId: "sa", actor: saElevated });
    assert.equal(ok.appUser.id, "u-sa");
    assert.equal(writes.length, 1);
  });
  it("unlink-user: conta SUPER_ADMIN exige SUPER_ADMIN elevado", async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ employee: { findUnique: async () => ({ id: "e1", appUser: { id: "u-sa", email: "sa@x.com", role: "SUPER_ADMIN", employeeId: "e1" } }) }, appUser: { update: async () => ({}) } }),
    };
    await assert.rejects(unlinkEmployeeFromAppUser(prisma as never, "e1", { actor: { id: "sa", role: "SUPER_ADMIN", elevated: false } }), (e: { code: string }) => e.code === "ADMIN_ELEVATION_REQUIRED");
  });
});

describe("#13/#19 propagação E4 não alcança conta SUPER_ADMIN sem elevação nem copia Pessoa inativa", () => {
  const tx = (role: string, personStatus: string, writes: unknown[]) => ({
    $executeRaw: async () => 0,
    appUser: {
      findUnique: async (args: { where: { employeeId?: string; personId?: string } }) => (args.where.employeeId ? { id: "u1", personId: null, role } : null),
      update: async (args: unknown) => {
        writes.push(args);
        return {};
      },
    },
    person: { findUnique: async () => ({ status: personStatus }) },
  });
  it("SUPER_ADMIN sem step-up: não propaga (pendência explícita)", async () => {
    const writes: unknown[] = [];
    const r = await propagateEmployeePersonToLinkedUser(tx("SUPER_ADMIN", "ACTIVE", writes) as never, { employeeId: "e1", personId: P, previousPersonId: null, actor: hrEditor, canManageAccountIdentity: true });
    assert.deepEqual(r, { outcome: "ACCOUNT_IDENTITY_DENIED", userId: "u1", code: "SUPER_ADMIN_REQUIRED" });
    assert.equal(writes.length, 0);
  });
  it("propagação: sem permissão de vínculo com usuário, sem ator ou na própria conta (editor de RH mudando a Pessoa do próprio colaborador) → não propaga", async () => {
    const writes: unknown[] = [];
    // Sem a permissão efetiva de vínculo com usuário (ex.: deny explícito), a conta de outra pessoa não muda.
    assert.deepEqual(await propagateEmployeePersonToLinkedUser(tx("VIEWER", "ACTIVE", writes) as never, { employeeId: "e1", personId: P, previousPersonId: null, actor: hrEditor }), { outcome: "ACCOUNT_IDENTITY_DENIED", userId: "u1", code: "ACCOUNT_LINK_PERMISSION_REQUIRED" });
    assert.deepEqual(await propagateEmployeePersonToLinkedUser(tx("VIEWER", "ACTIVE", writes) as never, { employeeId: "e1", personId: P, previousPersonId: null, canManageAccountIdentity: true }), { outcome: "ACCOUNT_IDENTITY_DENIED", userId: "u1", code: "ACTOR_REQUIRED" });
    assert.deepEqual(await propagateEmployeePersonToLinkedUser(tx("VIEWER", "ACTIVE", writes) as never, { employeeId: "e1", personId: P, previousPersonId: null, actor: { id: "u1", role: "VIEWER", elevated: false }, canManageAccountIdentity: true }), { outcome: "ACCOUNT_IDENTITY_DENIED", userId: "u1", code: "SELF_LINK_FORBIDDEN" });
    assert.equal(writes.length, 0);
  });
  it("Pessoa INACTIVE: não propaga; conta comum com Pessoa ativa: propaga", async () => {
    const writes: unknown[] = [];
    assert.equal((await propagateEmployeePersonToLinkedUser(tx("VIEWER", "INACTIVE", writes) as never, { employeeId: "e1", personId: P, previousPersonId: null, actor: hrEditor, canManageAccountIdentity: true })).outcome, "PERSON_NOT_ACTIVE");
    assert.equal(writes.length, 0);
    assert.equal((await propagateEmployeePersonToLinkedUser(tx("VIEWER", "ACTIVE", writes) as never, { employeeId: "e1", personId: P, previousPersonId: null, actor: hrEditor, canManageAccountIdentity: true })).outcome, "PROPAGATED");
    assert.equal(writes.length, 1);
  });
});

describe("#14/#17/#9/#10 criação de conta", () => {
  const input = { password: "SenhaForte#2026", actor: { id: "a", role: "ADMIN" }, origin: { ipAddress: null, userAgent: null } };
  it("pelo colaborador: Pessoa do colaborador INACTIVE/MERGED → 409 (nunca cria conta ligada a ela)", async () => {
    for (const [status, code] of [["INACTIVE", "PERSON_INACTIVE"], ["MERGED", "PERSON_MERGED"]]) {
      const prisma = {
        employee: { findUnique: async () => ({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", name: "Ana", socialName: null, personalEmail: null, corporateEmail: "ana@x.com", department: "TI", status: "ACTIVE", personId: P }) },
        appUser: { findUnique: async () => null },
        person: { findUnique: async () => ({ status }) },
      };
      await assert.rejects(createAppUserAccount({ prisma: prisma as never, hashPassword: async () => "h" }, { ...input, source: { kind: "employee", employeeId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }, creationSource: "USER_CREATION" }), (e: { code: string }) => e.code === code, code);
    }
  });
  it("pela Pessoa: id inválido → 400; Pessoa com dois colaboradores → 409", async () => {
    await assert.rejects(createAppUserAccount({ prisma: {} as never, hashPassword: async () => "h" }, { ...input, source: { kind: "person", personId: "abc" }, creationSource: "PERSON_ENABLE_ACCESS" }), (e: { code: string; status: number }) => e.code === "INVALID_PERSON_ID" && e.status === 400);
    const emp = { name: "Ana", socialName: null, personalEmail: null, corporateEmail: null, department: "TI", status: "ACTIVE", personId: P, appUser: null };
    const prisma = { person: { findUnique: async () => ({ id: P, displayName: "Ana", socialName: null, corporateEmail: "ana@x.com", personalEmail: null, status: "ACTIVE", employees: [{ id: "e1", ...emp }, { id: "e2", ...emp }] }) } };
    await assert.rejects(createAppUserAccount({ prisma: prisma as never, hashPassword: async () => "h" }, { ...input, source: { kind: "person", personId: P }, creationSource: "PERSON_ENABLE_ACCESS" }), (e: { code: string }) => e.code === "PERSON_HAS_MULTIPLE_EMPLOYEES");
  });
});

describe("#18/#21 regularizar conta", () => {
  const base = {
    account: { id: "u1", role: "VIEWER", personId: null as string | null, employeeId: "e2", isActive: true, email: "x@x.com" },
    expected: {},
    target: { id: P, status: "ACTIVE", userIds: [] as string[], employeeIds: ["e1"] },
    employee: { id: "e2", status: "ACTIVE", personId: null as string | null, appUserId: "u1", corporateEmail: "x@x.com" },
    emailMismatch: false,
    confirmEmailMismatch: false,
    actor: hrEditor,
  };
  it("colaborador sem Pessoa + Pessoa de destino já com outro colaborador → TARGET_HAS_EMPLOYEE (a prévia já recusa)", () => {
    const r = decideAttachAccount(base);
    assert.equal("code" in r ? r.code : null, "TARGET_HAS_EMPLOYEE");
  });
  it("conta já na Pessoa e só o colaborador muda → LINK sem fromPersonId", () => {
    const r = decideAttachAccount({ ...base, account: { ...base.account, personId: P }, target: { ...base.target, userIds: ["u1"], employeeIds: [] } });
    assert.equal(r.ok, true);
    assert.equal("kind" in r ? r.kind : null, "LINK");
    assert.equal("fromPersonId" in r ? r.fromPersonId : "x", null);
  });
});

describe("#20 motorista inativo de OUTRA Pessoa não é movido em silêncio", () => {
  it("REACTIVATE só para inativo sem Pessoa ou da própria Pessoa; inativo de outra Pessoa → CONFLICT", () => {
    const person = { id: P, status: "ACTIVE", cpfNormalized: "52998224725" };
    const r = planDriverEnable({ person, duplicatePersonCount: 0, drivers: [{ id: "d1", name: "M", status: "INACTIVE", personId: OTHER, cpf: "52998224725" }] });
    assert.equal(r.action, "CONFLICT");
    assert.ok(r.blockers.some((b) => b.code === "OTHER_PERSON_LINKED"));
    assert.equal(planDriverEnable({ person, duplicatePersonCount: 0, drivers: [{ id: "d1", name: "M", status: "INACTIVE", personId: P, cpf: "52998224725" }] }).action, "REACTIVATE");
  });
});

describe("#23 unificação não usa Pessoa inativa como vencedora; #8 comissionável ativo conta como vínculo", () => {
  it("WINNER_INACTIVE bloqueia", () => {
    const id = (over: Partial<IdentityForMerge>): IdentityForMerge => ({ id: P, displayName: "A", status: "ACTIVE", cpfNormalized: null, corporateEmail: null, employeeIds: [], activeUserIds: [], inactiveUserIds: [], fleetDriverIds: [], commissionPersonIds: [], customerIdentityIds: [], customerContactIds: [], ...over });
    const plan = planPersonMerge(id({ status: "INACTIVE" }), id({ id: OTHER }));
    assert.ok(plan.blockers.some((b) => b.code === "WINNER_INACTIVE"));
  });
  it("inativar com comissionável ativo → PERSON_HAS_ACTIVE_LINKS", () => {
    const r = decidePersonStatusChange({ currentStatus: "ACTIVE", nextStatus: "INACTIVE", activeLinks: { activeUsers: 0, activeEmployees: 0, activeDrivers: 0, activeCommissionPeople: 1 } });
    assert.equal("code" in r ? r.code : null, "PERSON_HAS_ACTIVE_LINKS");
  });
});
