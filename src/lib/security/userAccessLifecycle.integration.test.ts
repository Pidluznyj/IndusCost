/**
 * Integração com PostgreSQL local (E1/E3/E4): desligamento revoga acesso, inativação
 * preserva histórico e a Pessoa do colaborador se propaga à conta ligada.
 * Só roda com PEOPLE_PG_TEST_URL apontando para um banco local descartável.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  deactivateUserAccess,
  reactivateUserAccess,
  revokeAccessOnEmployeeTermination,
} from "@/src/lib/security/userAccessLifecycle.server";
import { propagateEmployeePersonToLinkedUser } from "@/src/lib/canonicalPersonSync.server";
import { SECURITY_AUDIT_EVENTS } from "@/src/lib/auth/securityAudit.server";

const url = process.env.PEOPLE_PG_TEST_URL ?? "";
const isLocal = /@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const skip = !url ? "PEOPLE_PG_TEST_URL não definida" : !isLocal ? "URL não é local: recusado" : false;

const TAG = `p360-lifecycle-${Date.now()}`;
// Ator real do PUT do colaborador: a propagação passa pela política de identidade de conta.
const hrActor = { id: null as string | null, role: "VIEWER", elevated: false };

describe("ciclo de vida do acesso em PostgreSQL local (E1/E3/E4)", { skip }, () => {
  let prisma: PrismaClient;
  let roleId = "";
  const created = { employees: [] as string[], users: [] as string[], people: [] as string[] };

  before(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const role = await prisma.role.upsert({ where: { name: `${TAG} cargo` }, create: { name: `${TAG} cargo`, baseSalary: 0 }, update: {} });
    roleId = role.id;
    hrActor.id = (await prisma.appUser.create({ data: { name: "Ator de teste", email: `${TAG}-ator@local.test`.toLowerCase(), passwordHash: "x", role: "VIEWER", isActive: true } })).id;
    created.users.push(hrActor.id);
  });

  after(async () => {
    await prisma.securityAuditLog.deleteMany({ where: { targetUserId: { in: created.users } } });
    await prisma.appSession.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.appUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
    await prisma.person.deleteMany({ where: { id: { in: created.people } } });
    await prisma.role.deleteMany({ where: { id: roleId } });
    await prisma.$disconnect();
  });

  async function person(name: string) {
    const p = await prisma.person.create({ data: { displayName: `${TAG} ${name}`, origin: "MANUAL" } });
    created.people.push(p.id);
    return p;
  }
  async function employee(name: string, personId: string | null) {
    const e = await prisma.employee.create({
      data: { name: `${TAG} ${name}`, roleId, department: "Teste", costCenter: "CC", classification: "MOD", salary: 0, monthlyHours: 220, status: "ACTIVE", admissionDate: new Date("2024-01-01"), personId },
    });
    created.employees.push(e.id);
    return e;
  }
  async function user(name: string, employeeId: string | null, personId: string | null, sessions = 1) {
    const u = await prisma.appUser.create({
      data: { name: `${TAG} ${name}`, email: `${TAG}-${name}@local.test`.toLowerCase(), passwordHash: "x", role: "VIEWER", employeeId, personId, isActive: true },
    });
    created.users.push(u.id);
    for (let i = 0; i < sessions; i += 1) {
      await prisma.appSession.create({ data: { userId: u.id, tokenHash: `${TAG}-${name}-${i}`, expiresAt: new Date(Date.now() + 3600_000), permissionsVersionAtIssue: 0 } });
    }
    return u;
  }

  it("E1: desligar com a flag ligada inativa a conta ligada, revoga sessões e audita", async () => {
    const p = await person("A");
    const e = await employee("A", p.id);
    const u = await user("a", e.id, p.id, 2);
    const decision = await prisma.$transaction((tx) =>
      revokeAccessOnEmployeeTermination(tx, { employeeId: e.id, previousStatus: "ACTIVE", nextStatus: "INACTIVE", terminationDate: new Date(), actorUserId: null, enabled: true })
    );
    assert.deepEqual(decision, { action: "DEACTIVATE", userId: u.id });
    const after1 = await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } });
    assert.equal(after1.isActive, false);
    assert.equal(await prisma.appSession.count({ where: { userId: u.id, revokedAt: null } }), 0);
    const audit = await prisma.securityAuditLog.findFirst({ where: { targetUserId: u.id, eventType: SECURITY_AUDIT_EVENTS.USER_DEACTIVATED_BY_TERMINATION } });
    assert.ok(audit, "evento de segurança gravado");
    assert.equal((audit!.metadata as { revokedSessions: number }).revokedSessions, 2);
    // Pessoa e colaborador intactos
    assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: p.id } })).status, "ACTIVE");
    assert.equal((await prisma.appUser.count({ where: { id: u.id } })), 1, "conta não é apagada");
  });

  it("E1: com a flag desligada nada muda; sem conta ligada nada muda", async () => {
    const e = await employee("B", null);
    const u = await user("b", e.id, null);
    const off = await prisma.$transaction((tx) =>
      revokeAccessOnEmployeeTermination(tx, { employeeId: e.id, previousStatus: "ACTIVE", nextStatus: "INACTIVE", terminationDate: new Date(), actorUserId: null, enabled: false })
    );
    assert.deepEqual(off, { action: "SKIP", reason: "FLAG_DISABLED" });
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } })).isActive, true);
    const e2 = await employee("C", null);
    const none = await prisma.$transaction((tx) =>
      revokeAccessOnEmployeeTermination(tx, { employeeId: e2.id, previousStatus: "ACTIVE", nextStatus: "INACTIVE", terminationDate: new Date(), actorUserId: null, enabled: true })
    );
    assert.deepEqual(none, { action: "SKIP", reason: "NO_LINKED_USER" });
  });

  it("E1: conta com mesmo e-mail mas sem employeeId NÃO é tocada (nunca por semelhança)", async () => {
    const e = await employee("D", null);
    const stranger = await user("d", null, null);
    await prisma.employee.update({ where: { id: e.id }, data: { corporateEmail: stranger.email } });
    const d = await prisma.$transaction((tx) =>
      revokeAccessOnEmployeeTermination(tx, { employeeId: e.id, previousStatus: "ACTIVE", nextStatus: "INACTIVE", terminationDate: new Date(), actorUserId: null, enabled: true })
    );
    assert.deepEqual(d, { action: "SKIP", reason: "NO_LINKED_USER" });
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: stranger.id } })).isActive, true);
  });

  it("E3: inativar preserva a conta e os logs; reativar é explícito e auditado", async () => {
    const u = await user("e", null, null, 1);
    await prisma.$transaction((tx) =>
      deactivateUserAccess(tx, { userId: u.id, actorUserId: null, eventType: SECURITY_AUDIT_EVENTS.USER_DELETE_REQUEST_CONVERTED, metadata: { source: "ADMIN_DELETE_REQUEST" } })
    );
    const row = await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } });
    assert.equal(row.isActive, false);
    const logs = await prisma.securityAuditLog.findMany({ where: { targetUserId: u.id } });
    assert.ok(logs.some((l) => l.eventType === SECURITY_AUDIT_EVENTS.USER_DELETE_REQUEST_CONVERTED));
    assert.ok(logs.every((l) => l.targetUserId === u.id), "FK do alvo preservada");
    await prisma.$transaction((tx) => reactivateUserAccess(tx, { userId: u.id, actorUserId: null }));
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } })).isActive, true);
    assert.ok((await prisma.securityAuditLog.findMany({ where: { targetUserId: u.id } })).some((l) => l.eventType === SECURITY_AUDIT_EVENTS.USER_REACTIVATED));
  });

  it("E4: a Pessoa do colaborador se propaga à conta sem Pessoa; nunca sobrescreve outra Pessoa", async () => {
    const pA = await person("F-A");
    const pB = await person("F-B");
    const e = await employee("F", pA.id);
    const u = await user("f", e.id, null);
    const r1 = await prisma.$transaction((tx) => propagateEmployeePersonToLinkedUser(tx, { employeeId: e.id, personId: pA.id, previousPersonId: null, actor: hrActor, canManageAccountIdentity: true }));
    assert.deepEqual(r1, { outcome: "PROPAGATED", userId: u.id, fromPersonId: null });
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } })).personId, pA.id);
    const r2 = await prisma.$transaction((tx) => propagateEmployeePersonToLinkedUser(tx, { employeeId: e.id, personId: pA.id, previousPersonId: pA.id, actor: hrActor, canManageAccountIdentity: true }));
    assert.deepEqual(r2, { outcome: "ALREADY_SAME" });
    // Conta aponta para B; colaborador muda para A sem passar por B: conflito, não sobrescreve.
    await prisma.appUser.update({ where: { id: u.id }, data: { personId: pB.id } });
    const r3 = await prisma.$transaction((tx) => propagateEmployeePersonToLinkedUser(tx, { employeeId: e.id, personId: pA.id, previousPersonId: null, actor: hrActor, canManageAccountIdentity: true }));
    assert.deepEqual(r3, { outcome: "USER_HAS_OTHER_PERSON", userId: u.id, userPersonId: pB.id });
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } })).personId, pB.id);
    // Colaborador trocou de B para A: a conta que tinha B acompanha.
    const r4 = await prisma.$transaction((tx) => propagateEmployeePersonToLinkedUser(tx, { employeeId: e.id, personId: pA.id, previousPersonId: pB.id, actor: hrActor, canManageAccountIdentity: true }));
    assert.deepEqual(r4, { outcome: "PROPAGATED", userId: u.id, fromPersonId: pB.id });
    const audits = await prisma.securityAuditLog.findMany({ where: { targetUserId: u.id, eventType: "USER_IDENTITY_LINKED" } });
    assert.equal(audits.length, 2, "cada propagação efetiva fica auditada");
    assert.ok(audits.every((a) => a.actorUserId === hrActor.id && (a.metadata as { source?: string }).source === "EMPLOYEE_PERSON_PROPAGATION"));
    // Sem permissão de vínculo com usuário, sem ator (rotina sem autoridade sobre contas) ou na própria conta: não propaga.
    await prisma.appUser.update({ where: { id: u.id }, data: { personId: null } });
    assert.deepEqual(await prisma.$transaction((tx) => propagateEmployeePersonToLinkedUser(tx, { employeeId: e.id, personId: pA.id, previousPersonId: null, actor: hrActor })), { outcome: "ACCOUNT_IDENTITY_DENIED", userId: u.id, code: "ACCOUNT_LINK_PERMISSION_REQUIRED" });
    assert.deepEqual(await prisma.$transaction((tx) => propagateEmployeePersonToLinkedUser(tx, { employeeId: e.id, personId: pA.id, previousPersonId: null, canManageAccountIdentity: true })), { outcome: "ACCOUNT_IDENTITY_DENIED", userId: u.id, code: "ACTOR_REQUIRED" });
    assert.deepEqual(await prisma.$transaction((tx) => propagateEmployeePersonToLinkedUser(tx, { employeeId: e.id, personId: pA.id, previousPersonId: null, actor: { id: u.id, role: "VIEWER", elevated: false }, canManageAccountIdentity: true })), { outcome: "ACCOUNT_IDENTITY_DENIED", userId: u.id, code: "SELF_LINK_FORBIDDEN" });
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } })).personId, null);
  });

  it("E4: Pessoa já usada por outra conta não é duplicada na propagação (unicidade preservada)", async () => {
    const p = await person("G");
    const e = await employee("G", p.id);
    const other = await user("g-other", null, p.id);
    const u = await user("g", e.id, null);
    const r = await prisma.$transaction((tx) => propagateEmployeePersonToLinkedUser(tx, { employeeId: e.id, personId: p.id, previousPersonId: null, actor: hrActor, canManageAccountIdentity: true }));
    assert.deepEqual(r, { outcome: "PERSON_HELD_BY_OTHER_USER", userId: u.id, otherUserId: other.id });
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } })).personId, null);
  });
});
