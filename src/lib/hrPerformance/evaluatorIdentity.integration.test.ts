/**
 * Identidade operacional dos avaliadores em PostgreSQL local (dados sintéticos).
 * Reproduz o caso da conta SUPER_ADMIN legada: ativa, com personId certo e employeeId nulo.
 * Só roda com PEOPLE_PG_TEST_URL local e nunca em teste_bi*.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { CanonicalPersonError } from "@/src/lib/canonicalPerson";
import { loadEvaluatorIdentities, loadLinkedEvaluatorIds } from "@/src/lib/hrPerformance/evaluatorIdentity.server";
import { attachAccountToPerson } from "@/src/lib/people/personLinkOps.server";
import { findPendingLinksForPerson, listPeople } from "@/src/lib/people/personProfile.server";

const url = process.env.PEOPLE_PG_TEST_URL ?? "";
const isLocal = /@(127\.0\.0\.1|localhost)(:\d+)?\/(?!teste_bi)/.test(url);
const skip = !url ? "PEOPLE_PG_TEST_URL não definida" : !isLocal ? "URL não é local/descartável: recusado" : false;
const TAG = `eval-id-${Date.now()}`;
const saElevated = { id: null as string | null, name: "SA teste", role: "SUPER_ADMIN", elevated: true };
const hrEditor = { id: null as string | null, name: "RH teste", role: "VIEWER", elevated: false };

describe("identidade dos avaliadores (PostgreSQL local)", { skip }, () => {
  let prisma: PrismaClient;
  let roleId = "";
  const ids = { people: [] as string[], employees: [] as string[], users: [] as string[] };

  before(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    roleId = (await prisma.role.upsert({ where: { name: `${TAG} cargo` }, create: { name: `${TAG} cargo`, baseSalary: 0 }, update: {} })).id;
    // Atores reais: a política de identidade de conta recusa operação sem usuário identificado.
    saElevated.id = (await prisma.appUser.create({ data: { name: "Ator de teste", email: `${TAG}-ator-saelevated@local.test`.toLowerCase(), passwordHash: "x", role: "SUPER_ADMIN", isActive: true } })).id;
    ids.users.push(saElevated.id);
    hrEditor.id = (await prisma.appUser.create({ data: { name: "Ator de teste", email: `${TAG}-ator-hreditor@local.test`.toLowerCase(), passwordHash: "x", role: "VIEWER", isActive: true } })).id;
    ids.users.push(hrEditor.id);
  });
  after(async () => {
    await prisma.personLinkEvent.deleteMany({ where: { OR: [{ personId: { in: ids.people } }, { fromPersonId: { in: ids.people } }, { toPersonId: { in: ids.people } }] } });
    await prisma.securityAuditLog.deleteMany({ where: { targetUserId: { in: ids.users } } });
    await prisma.appSession.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.appUser.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.employee.deleteMany({ where: { id: { in: ids.employees } } });
    await prisma.person.updateMany({ where: { id: { in: ids.people } }, data: { mergedIntoPersonId: null } });
    await prisma.person.deleteMany({ where: { id: { in: ids.people } } });
    await prisma.role.deleteMany({ where: { id: roleId } });
    await prisma.$disconnect();
  });

  const person = async (name: string, extra: Record<string, unknown> = {}) => {
    const p = await prisma.person.create({ data: { displayName: `${TAG} ${name}`, origin: "MANUAL", ...extra } });
    ids.people.push(p.id);
    return p;
  };
  const employee = async (name: string, personId: string | null) => {
    const e = await prisma.employee.create({ data: { name: `${TAG} ${name}`, roleId, department: "T", costCenter: "CC", classification: "MOD", salary: 0, monthlyHours: 220, status: "ACTIVE", admissionDate: new Date("2024-01-01"), personId } });
    ids.employees.push(e.id);
    return e;
  };
  const account = async (name: string, data: Record<string, unknown>) => {
    const u = await prisma.appUser.create({ data: { name: `${TAG} ${name}`, email: `${TAG}-${name}@local.test`.toLowerCase(), passwordHash: `hash-${name}`, role: "VIEWER", isActive: true, permissions: ["x.view"], ...data } });
    ids.users.push(u.id);
    return u;
  };

  it("conta SUPER_ADMIN legada com personId e sem employeeId → ACCOUNT_NOT_LINKED; regularização autorizada → LINKED; conta intacta; idempotente", async () => {
    const p = await person("Avaliador A");
    const e = await employee("Avaliador A colab", p.id);
    const u = await account("avaliador-a", { role: "SUPER_ADMIN", personId: p.id, permissions: [] });
    await prisma.appSession.create({ data: { userId: u.id, tokenHash: `${TAG}-s1`, expiresAt: new Date(Date.now() + 3600_000), permissionsVersionAtIssue: 0 } });
    const beforeRow = await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } });

    const before = (await loadEvaluatorIdentities(prisma, [e.id])).get(e.id)!;
    assert.deepEqual([before.status, before.accountId, before.personId], ["ACCOUNT_NOT_LINKED", u.id, p.id]);
    assert.equal((await loadLinkedEvaluatorIds(prisma, [e.id])).has(e.id), false, "prontidão continua bloqueada antes da regularização");
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } })).employeeId, null, "consulta não grava vínculo");

    const pending = await findPendingLinksForPerson(prisma, p.id);
    assert.ok(pending.some((x) => x.kind === "app_user" && x.entityId === u.id && x.evidence === "ACCOUNT_WITHOUT_EMPLOYEE"), "Pessoas 360° mostra a pendência");
    const listed = await listPeople(prisma, { q: TAG, pending: "mismatch", canViewPii: false, limit: 100 });
    assert.ok(listed.items.find((r) => r.id === p.id)?.flags.includes("USER_WITHOUT_EMPLOYEE_LINK"), "o filtro 'Conta × colaborador divergentes' acha a conta sem vínculo");

    await assert.rejects(
      attachAccountToPerson(prisma, { targetPersonId: p.id, appUserId: u.id, expected: { personId: p.id, employeeId: null }, confirmEmailMismatch: true, reason: "editor de RH tentando", actor: hrEditor }),
      (err: unknown) => err instanceof CanonicalPersonError && err.code === "SUPER_ADMIN_REQUIRED"
    );
    const r = await attachAccountToPerson(prisma, { targetPersonId: p.id, appUserId: u.id, expected: { personId: p.id, employeeId: null }, confirmEmailMismatch: true, reason: "regularizar avaliador legado", actor: saElevated });
    assert.equal(r!.kind, "LINK");
    assert.equal(r!.fromPersonId, null);
    assert.equal(r!.employeeId, e.id);

    const after = (await loadEvaluatorIdentities(prisma, [e.id])).get(e.id)!;
    assert.equal(after.status, "LINKED");
    assert.equal((await loadLinkedEvaluatorIds(prisma, [e.id])).has(e.id), true, "prontidão reconhece depois");
    const afterRow = await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } });
    assert.equal(afterRow.employeeId, e.id, "o mesmo campo que loadScope lê (authUser.employeeId)");
    for (const k of ["id", "email", "passwordHash", "role", "permissions", "permissionsVersion", "accessProfileId", "isActive", "mustChangePassword", "personId"] as const) {
      assert.deepEqual(afterRow[k], beforeRow[k], `campo ${k} preservado`);
    }
    assert.equal(await prisma.appSession.count({ where: { userId: u.id, revokedAt: null } }), 1, "sessão preservada");
    assert.equal(await prisma.securityAuditLog.count({ where: { targetUserId: u.id, eventType: "USER_IDENTITY_LINKED" } }), 1, "auditado");
    assert.ok(!(await findPendingLinksForPerson(prisma, p.id)).some((x) => x.evidence === "ACCOUNT_WITHOUT_EMPLOYEE"), "pendência some");
    await assert.rejects(
      attachAccountToPerson(prisma, { targetPersonId: p.id, appUserId: u.id, expected: { personId: p.id, employeeId: null }, confirmEmailMismatch: true, reason: "de novo", actor: saElevated }),
      (err: unknown) => err instanceof CanonicalPersonError && (err.code === "STALE" || err.code === "SAME"),
      "repetir não grava de novo"
    );
  });

  it("casos 3–7: inativa, sem conta, conta de outro colaborador, Pessoa com dois colaboradores, Pessoa unificada — nada utilizável, nada gravado", async () => {
    const p3 = await person("Inativa");
    const e3 = await employee("Inativa colab", p3.id);
    await account("inativa", { personId: p3.id, isActive: false });
    const p4 = await person("SemConta");
    const e4 = await employee("SemConta colab", p4.id);
    const e4b = await employee("SemPessoa colab", null);
    const p5 = await person("Outro");
    const e5 = await employee("Outro colab", p5.id);
    const e5other = await employee("Outro colab 2", null);
    await account("outro", { personId: p5.id, employeeId: e5other.id });
    // "Pessoa com dois colaboradores" é impossível no banco (Employee.personId é único): fica só no teste puro.
    const winner = await person("Vencedora");
    const p7 = await person("Unificada", { status: "MERGED", mergedIntoPersonId: winner.id });
    const e7 = await employee("Unificada colab", p7.id);
    const direct = await employee("Direto colab", null);
    await account("direto", { employeeId: direct.id });

    const map = await loadEvaluatorIdentities(prisma, [e3.id, e4.id, e4b.id, e5.id, e7.id, direct.id]);
    assert.deepEqual(
      [e3, e4, e4b, e5, e7, direct].map((x) => map.get(x.id)!.status),
      ["ACCOUNT_INACTIVE", "NO_ACCOUNT", "NO_ACCOUNT", "IDENTITY_CONFLICT", "PERSON_NOT_ACTIVE", "LINKED"]
    );
    assert.deepEqual([...(await loadLinkedEvaluatorIds(prisma, [e3.id, e4.id, e5.id, e7.id, direct.id]))], [direct.id], "só o vínculo direto ativo conta");
    assert.equal(await prisma.appUser.count({ where: { name: { startsWith: TAG } } }), 4, "nenhuma conta criada além das do roteiro");
  });
});
