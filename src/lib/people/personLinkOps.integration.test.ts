/**
 * Pessoas 360° v1.1 em PostgreSQL local: corrigir vínculo (caso real do SUPER_ADMIN com duas
 * Pessoas), desvincular, unificar, reverter e concorrência (estado esperado / unicidade).
 * Só roda com PEOPLE_PG_TEST_URL local.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { CanonicalPersonError } from "@/src/lib/canonicalPerson";
import { executePersonMerge, previewPersonMerge, previewRelink, relinkEntity, revertPersonMerge, unlinkEntity } from "@/src/lib/people/personLinkOps.server";
import { findPendingLinksForPerson } from "@/src/lib/people/personProfile.server";

const url = process.env.PEOPLE_PG_TEST_URL ?? "";
const isLocal = /@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const skip = !url ? "PEOPLE_PG_TEST_URL não definida" : !isLocal ? "URL não é local: recusado" : false;
const TAG = `p360-ops-${Date.now()}`;
const actor = { id: null, name: "teste" };

describe("Pessoas 360° v1.1 — operações em PostgreSQL local", { skip }, () => {
  let prisma: PrismaClient;
  let roleId = "";
  const ids = { people: [] as string[], employees: [] as string[], users: [] as string[], drivers: [] as string[] };

  before(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const role = await prisma.role.upsert({ where: { name: `${TAG} cargo` }, create: { name: `${TAG} cargo`, baseSalary: 0 }, update: {} });
    roleId = role.id;
  });
  after(async () => {
    await prisma.personLinkEvent.deleteMany({ where: { OR: [{ personId: { in: ids.people } }, { fromPersonId: { in: ids.people } }, { toPersonId: { in: ids.people } }] } });
    await prisma.appUser.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.fleetDriver.deleteMany({ where: { id: { in: ids.drivers } } });
    await prisma.employee.deleteMany({ where: { id: { in: ids.employees } } });
    await prisma.person.updateMany({ where: { id: { in: ids.people } }, data: { mergedIntoPersonId: null } });
    await prisma.person.deleteMany({ where: { id: { in: ids.people } } });
    await prisma.role.deleteMany({ where: { id: roleId } });
    await prisma.$disconnect();
  });

  async function person(name: string, extra: Record<string, unknown> = {}) {
    const p = await prisma.person.create({ data: { displayName: `${TAG} ${name}`, origin: "MANUAL", ...extra } });
    ids.people.push(p.id);
    return p;
  }
  async function employee(name: string, personId: string | null, cpf?: string) {
    const e = await prisma.employee.create({ data: { name: `${TAG} ${name}`, roleId, department: "T", costCenter: "CC", classification: "MOD", salary: 0, monthlyHours: 220, status: "ACTIVE", admissionDate: new Date("2024-01-01"), personId, cpf: cpf ?? null } });
    ids.employees.push(e.id);
    return e;
  }
  async function user(name: string, employeeId: string | null, personId: string | null) {
    const u = await prisma.appUser.create({ data: { name: `${TAG} ${name}`, email: `${TAG}-${name}@local.test`.toLowerCase(), passwordHash: "x", role: "SUPER_ADMIN", employeeId, personId, isActive: true, permissions: ["x"] } });
    ids.users.push(u.id);
    return u;
  }

  it("caso real: conta na Pessoa B, colaborador+CPF na Pessoa A → detectar, prever, corrigir, auditar e reverter", async () => {
    const A = await person("Paulo A", { cpfNormalized: "52998224725" });
    const B = await person("Paulo B", { origin: "APP_USER" });
    const e = await employee("Paulo", A.id, "52998224725");
    const u = await user("paulo", e.id, B.id);

    const pending = await findPendingLinksForPerson(prisma, A.id);
    const conflict = pending.find((p) => p.kind === "app_user" && p.entityId === u.id);
    assert.equal(conflict?.severity, "CONFLICT");
    assert.equal(conflict?.currentPersonId, B.id);

    const preview = await previewRelink(prisma, { targetPersonId: A.id, entityKind: "app_user", entityId: u.id });
    assert.equal(preview.decision.ok, true);
    assert.equal(preview.currentPerson?.id, B.id);
    assert.equal(preview.expectedCurrentPersonId, B.id);
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } })).personId, B.id, "prévia não grava");

    const done = await relinkEntity(prisma, { targetPersonId: A.id, entityKind: "app_user", entityId: u.id, expectedCurrentPersonId: B.id, reason: "Correção do caso real", actor });
    assert.equal(done!.kind, "RELINK");
    const after1 = await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } });
    assert.equal(after1.personId, A.id);
    assert.equal(after1.employeeId, e.id, "employeeId preservado");
    assert.equal(after1.role, "SUPER_ADMIN", "papel preservado");
    assert.deepEqual(after1.permissions, ["x"], "permissões preservadas");
    const ev = await prisma.personLinkEvent.findUniqueOrThrow({ where: { id: done!.eventId } });
    assert.equal(ev.eventKind, "RELINKED");
    assert.equal(ev.fromPersonId, B.id);
    assert.equal(ev.reversible, true);
    assert.equal(await prisma.person.count({ where: { id: B.id } }), 1, "B não é apagada");
    assert.equal((await findPendingLinksForPerson(prisma, A.id)).filter((p) => p.kind === "app_user").length, 0, "pendência resolvida");

    // Reverter a correção = religar para B (vínculo de volta), com estado esperado.
    const back = await relinkEntity(prisma, { targetPersonId: B.id, entityKind: "app_user", entityId: u.id, expectedCurrentPersonId: A.id, reason: "Reversão de teste", actor });
    assert.equal(back!.fromPersonId, A.id);
  });

  it("estado esperado desatualizado → STALE 409, nada muda", async () => {
    const A = await person("Stale A");
    const B = await person("Stale B");
    const d = await prisma.fleetDriver.create({ data: { name: `${TAG} motorista`, cpf: "11144477735", status: "AUTHORIZED", personId: A.id } });
    ids.drivers.push(d.id);
    await assert.rejects(
      () => relinkEntity(prisma, { targetPersonId: B.id, entityKind: "fleet_driver", entityId: d.id, expectedCurrentPersonId: null, reason: "teste stale", actor }),
      (err: unknown) => err instanceof CanonicalPersonError && err.code === "STALE" && err.status === 409
    );
    assert.equal((await prisma.fleetDriver.findUniqueOrThrow({ where: { id: d.id } })).personId, A.id);
  });

  it("duas operações simultâneas na mesma conta: uma vence, a outra recebe conflito", async () => {
    const A = await person("Race A");
    const B = await person("Race B");
    const u = await user("race", null, null);
    const results = await Promise.allSettled([
      relinkEntity(prisma, { targetPersonId: A.id, entityKind: "app_user", entityId: u.id, expectedCurrentPersonId: null, reason: "corrida A", actor }),
      relinkEntity(prisma, { targetPersonId: B.id, entityKind: "app_user", entityId: u.id, expectedCurrentPersonId: null, reason: "corrida B", actor }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const conflicts = results.filter((r) => r.status === "rejected" && r.reason instanceof CanonicalPersonError && (r.reason.code === "STALE" || r.reason.code === "UNIQUE_CONFLICT")).length;
    assert.equal(ok, 1);
    assert.equal(conflicts, 1);
    const final = await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } });
    assert.ok(final.personId === A.id || final.personId === B.id);
  });

  it("unicidade: duas contas não podem apontar para a mesma Pessoa", async () => {
    const A = await person("Uniq A");
    const u1 = await user("uniq1", null, A.id);
    const u2 = await user("uniq2", null, null);
    await assert.rejects(
      () => relinkEntity(prisma, { targetPersonId: A.id, entityKind: "app_user", entityId: u2.id, expectedCurrentPersonId: null, reason: "teste unicidade", actor }),
      (err: unknown) => err instanceof CanonicalPersonError && err.code === "TARGET_HAS_USER"
    );
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u1.id } })).personId, A.id);
  });

  it("desvincular exige motivo, grava evento e não apaga nada", async () => {
    const A = await person("Unlink A");
    const e = await employee("Unlink", A.id);
    await assert.rejects(() => unlinkEntity(prisma, { personId: A.id, entityKind: "employee", entityId: e.id, reason: "", actor }), /justificativa/);
    const r = await unlinkEntity(prisma, { personId: A.id, entityKind: "employee", entityId: e.id, reason: "teste desvincular", actor });
    assert.ok(r.eventId);
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: e.id } })).personId, null);
    assert.equal(await prisma.person.count({ where: { id: A.id } }), 1);
  });

  it("unificação: prévia, bloqueio por CPF divergente, execução, pessoa absorvida MERGED, reversão", async () => {
    const W = await person("Merge W", { cpfNormalized: "52998224725" });
    const L = await person("Merge L", { corporateEmail: `${TAG}-merge@local.test` });
    const other = await person("Merge X", { cpfNormalized: "11144477735" });
    const e = await employee("MergeEmp", W.id, "52998224725");
    const u = await user("merge", e.id, L.id);
    const d = await prisma.fleetDriver.create({ data: { name: `${TAG} merge motorista`, cpf: "52998224725", status: "AUTHORIZED", personId: L.id } });
    ids.drivers.push(d.id);

    const blocked = await previewPersonMerge(prisma, { winnerId: W.id, loserId: other.id });
    assert.ok(blocked.plan.blockers.some((b) => b.code === "CPF_DIVERGENT"));
    await assert.rejects(
      () => executePersonMerge(prisma, { winnerId: W.id, loserId: other.id, reason: "teste bloqueio", actor }),
      (err: unknown) => err instanceof CanonicalPersonError && err.code === "MERGE_BLOCKED"
    );

    const preview = await previewPersonMerge(prisma, { winnerId: W.id, loserId: L.id });
    assert.deepEqual(preview.plan.blockers, []);
    assert.equal(preview.plan.moves.length, 2, "conta + motorista");
    assert.deepEqual(preview.plan.fillFromLoser, ["corporateEmail"]);
    assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: L.id } })).status, "ACTIVE", "prévia não grava");

    const done = await executePersonMerge(prisma, { winnerId: W.id, loserId: L.id, reason: "unificação de teste", actor, expectedMoveCount: 2 });
    assert.equal(done!.moved, 2);
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } })).personId, W.id);
    assert.equal((await prisma.fleetDriver.findUniqueOrThrow({ where: { id: d.id } })).personId, W.id);
    const loser = await prisma.person.findUniqueOrThrow({ where: { id: L.id } });
    assert.equal(loser.status, "MERGED");
    assert.equal(loser.mergedIntoPersonId, W.id);
    assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: W.id } })).corporateEmail, `${TAG}-merge@local.test`);
    // Pessoa MERGED não pode ser alvo
    await assert.rejects(
      () => relinkEntity(prisma, { targetPersonId: L.id, entityKind: "fleet_driver", entityId: d.id, expectedCurrentPersonId: W.id, reason: "alvo merged", actor }),
      (err: unknown) => err instanceof CanonicalPersonError && err.code === "TARGET_MERGED"
    );
    // Repetir a unificação é bloqueado (LOSER_MERGED)
    await assert.rejects(() => executePersonMerge(prisma, { winnerId: W.id, loserId: L.id, reason: "repetida", actor }), (err: unknown) => err instanceof CanonicalPersonError && err.code === "MERGE_BLOCKED");

    const reverted = await revertPersonMerge(prisma, { eventId: done!.eventId, reason: "reversão de teste", actor });
    assert.equal(reverted!.restored, 2);
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } })).personId, L.id);
    assert.equal((await prisma.fleetDriver.findUniqueOrThrow({ where: { id: d.id } })).personId, L.id);
    const loser2 = await prisma.person.findUniqueOrThrow({ where: { id: L.id } });
    assert.equal(loser2.status, "ACTIVE");
    assert.equal(loser2.mergedIntoPersonId, null);
    assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: W.id } })).corporateEmail, null, "preenchimento desfeito");
    const original = await prisma.personLinkEvent.findUniqueOrThrow({ where: { id: done!.eventId } });
    assert.ok(original.revertedAt);
    await assert.rejects(() => revertPersonMerge(prisma, { eventId: done!.eventId, reason: "de novo", actor }), (err: unknown) => err instanceof CanonicalPersonError && err.code === "ALREADY_REVERTED");
  });

  it("unificação com duas contas ativas é bloqueada (cardinalidade)", async () => {
    const W = await person("Two W");
    const L = await person("Two L");
    await user("twoW", null, W.id);
    await user("twoL", null, L.id);
    const preview = await previewPersonMerge(prisma, { winnerId: W.id, loserId: L.id });
    assert.ok(preview.plan.blockers.some((b) => b.code === "TWO_ACTIVE_USERS"));
  });
});
