/**
 * Governança de Person em PostgreSQL local (CP3): nenhum caminho cria Pessoa duplicada,
 * a prévia não grava, a escrita acompanha a transação do colaborador e todo vínculo deixa evento.
 * Só roda com PEOPLE_PG_TEST_URL local.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  applyEmployeePersonLinkPlan,
  ensurePersonFromSource,
  planEmployeePersonLink,
  previewLinkEmployeeToPerson,
  unlinkEmployeeFromPerson,
} from "@/src/lib/canonicalPersonService.server";
import { CanonicalPersonError } from "@/src/lib/canonicalPerson";

const url = process.env.PEOPLE_PG_TEST_URL ?? "";
const isLocal = /@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const skip = !url ? "PEOPLE_PG_TEST_URL não definida" : !isLocal ? "URL não é local: recusado" : false;
const TAG = `p360-gov-${Date.now()}`;
const CPF_A = "52998224725"; // CPF válido de exemplo (gerador público), nunca de pessoa real
const CPF_B = "11144477735";

describe("governança de Person em PostgreSQL local (CP3)", { skip }, () => {
  let prisma: PrismaClient;
  let roleId = "";
  const ids = { employees: [] as string[], users: [] as string[], drivers: [] as string[], people: [] as string[], commission: [] as string[] };

  before(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const role = await prisma.role.upsert({ where: { name: `${TAG} cargo` }, create: { name: `${TAG} cargo`, baseSalary: 0 }, update: {} });
    roleId = role.id;
  });
  after(async () => {
    await prisma.personLinkEvent.deleteMany({ where: { personId: { in: ids.people } } });
    await prisma.appUser.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.fleetDriver.deleteMany({ where: { id: { in: ids.drivers } } });
    await prisma.commissionPerson.deleteMany({ where: { id: { in: ids.commission } } });
    await prisma.employee.deleteMany({ where: { id: { in: ids.employees } } });
    await prisma.person.deleteMany({ where: { id: { in: ids.people } } });
    await prisma.role.deleteMany({ where: { id: roleId } });
    await prisma.$disconnect();
  });

  const trackPeople = async () => {
    const rows = await prisma.person.findMany({ where: { displayName: { startsWith: TAG } }, select: { id: true } });
    for (const r of rows) if (!ids.people.includes(r.id)) ids.people.push(r.id);
  };
  async function employee(name: string, extra: Record<string, unknown> = {}) {
    const e = await prisma.employee.create({
      data: { name: `${TAG} ${name}`, roleId, department: "Teste", costCenter: "CC", classification: "MOD", salary: 0, monthlyHours: 220, status: "ACTIVE", admissionDate: new Date("2024-01-01"), ...extra },
    });
    ids.employees.push(e.id);
    return e;
  }

  it("ensurePersonFromSource reutiliza a Pessoa com o mesmo CPF em vez de criar outra", async () => {
    const existing = await prisma.person.create({ data: { displayName: `${TAG} Ana`, cpfNormalized: CPF_A, origin: "MANUAL" } });
    ids.people.push(existing.id);
    const e = await employee("Ana colaboradora", { cpf: "529.982.247-25" });
    const r = await ensurePersonFromSource(prisma, { sourceKind: "employee", sourceId: e.id });
    assert.equal(r.id, existing.id);
    assert.equal(r.reused, true);
    assert.equal(r.evidence, "CPF_EXACT");
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: e.id } })).personId, existing.id);
    const ev = await prisma.personLinkEvent.findFirst({ where: { personId: existing.id, entityId: e.id } });
    assert.equal(ev?.eventKind, "LINKED");
    assert.equal(ev?.evidence, "CPF_EXACT");
    assert.equal(await prisma.person.count({ where: { cpfNormalized: CPF_A } }), 1, "nenhuma duplicata");
  });

  it("e-mail igual sem CPF nunca decide sozinho: 409 nomeando a candidata, nada gravado", async () => {
    const existing = await prisma.person.create({ data: { displayName: `${TAG} Bia`, corporateEmail: `${TAG}-bia@local.test`.toLowerCase(), origin: "MANUAL" } });
    ids.people.push(existing.id);
    const c = await prisma.commissionPerson.create({ data: { name: `${TAG} Bia comissionada`, type: "SELLER", source: "MANUAL", email: `${TAG}-bia@local.test`.toLowerCase() } });
    ids.commission.push(c.id);
    await assert.rejects(
      () => ensurePersonFromSource(prisma, { sourceKind: "commission_person", sourceId: c.id }),
      (err: unknown) => err instanceof CanonicalPersonError && err.code === "DUPLICATE_PRIMARY_EMAIL" && err.message.includes("Bia")
    );
    assert.equal((await prisma.commissionPerson.findUniqueOrThrow({ where: { id: c.id } })).personId, null);
    await trackPeople();
    assert.equal(await prisma.person.count({ where: { displayName: { startsWith: `${TAG} Bia` } } }), 1);
  });

  it("conta de acesso nunca é ligada por esta rotina: origem app_user sem Pessoa → 409, conta e Pessoas intactas", async () => {
    const u = await prisma.appUser.create({ data: { name: `${TAG} Duda usuária`, email: `${TAG}-duda@local.test`.toLowerCase(), passwordHash: "x", role: "VIEWER" } });
    ids.users.push(u.id);
    const before = await prisma.person.count();
    await assert.rejects(
      () => ensurePersonFromSource(prisma, { sourceKind: "app_user", sourceId: u.id }),
      (err: unknown) => err instanceof CanonicalPersonError && err.code === "ACCOUNT_REGULARIZATION_REQUIRED" && err.status === 409
    );
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } })).personId, null);
    assert.equal(await prisma.person.count(), before);
  });

  it("a prévia nunca cria Pessoa (origem sem Pessoa devolve wouldCreatePerson)", async () => {
    const d = await prisma.fleetDriver.create({ data: { name: `${TAG} Caio motorista`, cpf: CPF_B, status: "AUTHORIZED" } });
    ids.drivers.push(d.id);
    const before = await prisma.person.count();
    const preview = await previewLinkEmployeeToPerson(prisma, { sourceKind: "fleet_driver", sourceId: d.id, form: { displayName: `${TAG} Caio motorista`, cpfNormalized: CPF_B } });
    assert.equal(preview.personId, null);
    assert.equal(preview.wouldCreatePerson, true);
    assert.equal(preview.conflicts.length, 0);
    assert.equal(await prisma.person.count(), before, "prévia não grava");
    assert.equal((await prisma.fleetDriver.findUniqueOrThrow({ where: { id: d.id } })).personId, null);
  });

  it("plano + aplicação: falha depois do plano não deixa Pessoa órfã (rollback da transação)", async () => {
    const before = await prisma.person.count();
    const plan = await planEmployeePersonLink(prisma, { createNewPerson: true, form: { name: `${TAG} Dora`, cpf: "" } });
    assert.equal(plan.kind, "CREATE");
    assert.equal(await prisma.person.count(), before, "plano não grava");
    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          await applyEmployeePersonLinkPlan(tx, plan);
          throw new Error("validação posterior falhou");
        }),
      /validação posterior falhou/
    );
    assert.equal(await prisma.person.count(), before, "rollback: nada ficou");
  });

  it("vincular e desvincular colaborador deixa eventos; desvincular não apaga a Pessoa", async () => {
    const e = await employee("Eva");
    const plan = await planEmployeePersonLink(prisma, { createNewPerson: true, existingEmployeeId: e.id, form: { name: `${TAG} Eva`, cpf: "" } });
    const applied = await prisma.$transaction((tx) => applyEmployeePersonLinkPlan(tx, plan));
    assert.ok(applied.personId);
    ids.people.push(applied.personId!);
    await prisma.employee.update({ where: { id: e.id }, data: { personId: applied.personId } });
    await unlinkEmployeeFromPerson(prisma, e.id, { actorUserId: null, reason: "teste" });
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: e.id } })).personId, null);
    assert.equal(await prisma.person.count({ where: { id: applied.personId! } }), 1);
    const kinds = (await prisma.personLinkEvent.findMany({ where: { personId: applied.personId! }, orderBy: { createdAt: "asc" } })).map((x) => x.eventKind);
    assert.deepEqual(kinds, ["PERSON_CREATED", "UNLINKED"]);
  });

  it("Pessoa MERGED não pode receber vínculo novo", async () => {
    const keep = await prisma.person.create({ data: { displayName: `${TAG} Fabi`, origin: "MANUAL" } });
    const merged = await prisma.person.create({ data: { displayName: `${TAG} Fabi dup`, origin: "MANUAL", status: "MERGED", mergedIntoPersonId: keep.id } });
    ids.people.push(keep.id, merged.id);
    await assert.rejects(
      () => previewLinkEmployeeToPerson(prisma, { personId: merged.id, form: { displayName: "Fabi" } }),
      (err: unknown) => err instanceof CanonicalPersonError && err.code === "PERSON_MERGED"
    );
  });
});
