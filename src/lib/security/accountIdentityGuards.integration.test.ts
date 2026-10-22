/**
 * Política de identidade de conta em PostgreSQL local (dados sintéticos): nenhum caminho altera o
 * vínculo de uma conta — nem planta a evidência "mesma Pessoa" — sem ator identificado, sem a
 * permissão efetiva de vínculo com usuário, na própria conta, ou por rotina sem autoridade.
 * Só roda com PEOPLE_PG_TEST_URL local e nunca em teste_bi*.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { CanonicalPersonError } from "@/src/lib/canonicalPerson";
import { applyEmployeePersonLinkPlan, ensurePersonFromSource, type EmployeePersonLinkPlan } from "@/src/lib/canonicalPersonService.server";
import { BackfillHeld, linkBackfillCandidate } from "@/src/lib/canonicalPersonBackfill.server";
import type { BackfillCandidate } from "@/src/lib/canonicalPersonBackfill";
import { attachAccountToPerson, previewAttachAccount, relinkEntity, unlinkEntity } from "@/src/lib/people/personLinkOps.server";
import { findPendingLinksForPerson, listPeople } from "@/src/lib/people/personProfile.server";
import { propagateEmployeePersonToLinkedUser } from "@/src/lib/canonicalPersonSync.server";

const url = process.env.PEOPLE_PG_TEST_URL ?? "";
const isLocal = /@(127\.0\.0\.1|localhost)(:\d+)?\/(?!teste_bi)/.test(url);
const skip = !url ? "PEOPLE_PG_TEST_URL não definida" : !isLocal ? "URL não é local/descartável: recusado" : false;
const TAG = `acct-guard-${Date.now()}`;

/** CPF válido derivado de uma semente (evita colidir com CPFs fixos de outras suítes). */
function cpfFrom(seed: number): string {
  const base = String(100000000 + (seed % 899999999)).slice(0, 9).split("").map(Number);
  const dv = (digits: number[]) => {
    const sum = digits.reduce((acc, d, i) => acc + d * (digits.length + 1 - i), 0);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join("");
}
const codeOf = (code: string) => (err: unknown) => err instanceof CanonicalPersonError && err.code === code;

describe("política de identidade de conta — todos os caminhos (PostgreSQL local)", { skip }, () => {
  let prisma: PrismaClient;
  let roleId = "";
  const ids = { people: [] as string[], employees: [] as string[], users: [] as string[] };

  before(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    roleId = (await prisma.role.upsert({ where: { name: `${TAG} cargo` }, create: { name: `${TAG} cargo`, baseSalary: 0 }, update: {} })).id;
  });
  after(async () => {
    await prisma.personLinkEvent.deleteMany({ where: { OR: [{ personId: { in: ids.people } }, { fromPersonId: { in: ids.people } }, { toPersonId: { in: ids.people } }] } });
    await prisma.securityAuditLog.deleteMany({ where: { OR: [{ targetUserId: { in: ids.users } }, { actorUserId: { in: ids.users } }] } });
    await prisma.appUser.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.employee.deleteMany({ where: { id: { in: ids.employees } } });
    await prisma.person.deleteMany({ where: { id: { in: ids.people } } });
    await prisma.role.deleteMany({ where: { id: roleId } });
    await prisma.$disconnect();
  });

  const person = async (name: string, extra: Record<string, unknown> = {}) => {
    const p = await prisma.person.create({ data: { displayName: `${TAG} ${name}`, origin: "MANUAL", ...extra } });
    ids.people.push(p.id);
    return p;
  };
  const employee = async (name: string, personId: string | null, cpf: string | null = null) => {
    const e = await prisma.employee.create({ data: { name: `${TAG} ${name}`, roleId, department: "T", costCenter: "CC", classification: "MOD", salary: 0, monthlyHours: 220, status: "ACTIVE", admissionDate: new Date("2024-01-01"), personId, cpf } });
    ids.employees.push(e.id);
    return e;
  };
  const account = async (name: string, data: Record<string, unknown>) => {
    const u = await prisma.appUser.create({ data: { name: `${TAG} ${name}`, email: `${TAG}-${name}@local.test`.toLowerCase(), passwordHash: "x", role: "VIEWER", isActive: true, ...data } });
    ids.users.push(u.id);
    return u;
  };
  const actorOf = (u: { id: string; role: string }, elevated = false) => ({ id: u.id, name: "ator", role: u.role, elevated });
  const reload = {
    employee: (id: string) => prisma.employee.findUniqueOrThrow({ where: { id }, select: { personId: true } }),
    account: (id: string) => prisma.appUser.findUniqueOrThrow({ where: { id }, select: { personId: true, employeeId: true } }),
  };

  it("Pessoas 360°: plantar a 'mesma Pessoa' movendo o colaborador do líder para a própria Pessoa → recusado; sem permissão → recusado; outra conta com permissão → permitido", async () => {
    const pX = await person("X");
    const x = await account("x", { personId: pX.id }); // operador: conta da Pessoa X, sem colaborador
    const pE = await person("Lider");
    const e = await employee("Lider", pE.id);
    const pY = await person("Y");
    await account("y", { personId: pY.id }); // conta de outra pessoa, sem colaborador
    const relinkEmployee = (target: string, actor: ReturnType<typeof actorOf>, canManageAccountIdentity: boolean) =>
      relinkEntity(prisma, { targetPersonId: target, entityKind: "employee", entityId: e.id, expectedCurrentPersonId: pE.id, reason: "teste de política", actor, canManageAccountIdentity });

    await assert.rejects(relinkEmployee(pX.id, actorOf(x), true), codeOf("SELF_LINK_FORBIDDEN"));
    await assert.rejects(relinkEmployee(pY.id, actorOf(x), false), codeOf("ACCOUNT_LINK_PERMISSION_REQUIRED"));
    await assert.rejects(relinkEmployee(pY.id, { id: null as unknown as string, name: "?", role: "SUPER_ADMIN", elevated: true }, true), codeOf("ACTOR_REQUIRED"));
    assert.equal((await reload.employee(e.id)).personId, pE.id, "nada gravado nas recusas");
    // Pessoa sem conta: não mexe em conta nenhuma, segue a regra de sempre.
    const pFree = await person("Livre");
    await relinkEntity(prisma, { targetPersonId: pFree.id, entityKind: "employee", entityId: e.id, expectedCurrentPersonId: pE.id, reason: "teste sem conta", actor: actorOf(x), canManageAccountIdentity: false });
    assert.equal((await reload.employee(e.id)).personId, pFree.id);
    // Conta de outra pessoa, com a permissão efetiva: permitido (auditado em PersonLinkEvent).
    await relinkEntity(prisma, { targetPersonId: pY.id, entityKind: "employee", entityId: e.id, expectedCurrentPersonId: pFree.id, reason: "teste com permissão", actor: actorOf(x), canManageAccountIdentity: true });
    assert.equal((await reload.employee(e.id)).personId, pY.id);
  });

  it("Pessoas 360°: corrigir/desvincular a Pessoa de uma conta exige a permissão de vínculo com usuário e ator identificado", async () => {
    const pA = await person("A");
    const pB = await person("B");
    const op = await account("op-a", {});
    const target = await account("alvo-a", { personId: pA.id });
    const relink = (canManageAccountIdentity: boolean, actor = actorOf(op)) =>
      relinkEntity(prisma, { targetPersonId: pB.id, entityKind: "app_user", entityId: target.id, expectedCurrentPersonId: pA.id, reason: "teste de política", actor, canManageAccountIdentity });
    await assert.rejects(relink(false), codeOf("ACCOUNT_LINK_PERMISSION_REQUIRED"));
    await assert.rejects(relink(true, { id: null as unknown as string, name: "?", role: "VIEWER", elevated: false }), codeOf("ACTOR_REQUIRED"));
    await assert.rejects(unlinkEntity(prisma, { personId: pA.id, entityKind: "app_user", entityId: target.id, reason: "teste de política", actor: actorOf(op) }), codeOf("ACCOUNT_LINK_PERMISSION_REQUIRED"));
    assert.equal((await reload.account(target.id)).personId, pA.id, "nada gravado nas recusas");
    await relink(true);
    assert.equal((await reload.account(target.id)).personId, pB.id);
    await unlinkEntity(prisma, { personId: pB.id, entityKind: "app_user", entityId: target.id, reason: "teste de política", actor: actorOf(op), canManageAccountIdentity: true });
    assert.equal((await reload.account(target.id)).personId, null);
  });

  it("regularização (attach) sem ator identificado → ACTOR_REQUIRED, nada gravado", async () => {
    const p = await person("Reg");
    const u = await account("reg", {});
    await assert.rejects(
      attachAccountToPerson(prisma, { targetPersonId: p.id, appUserId: u.id, expected: { personId: null, employeeId: null }, confirmEmailMismatch: true, reason: "teste sem ator", actor: { id: null, name: null, role: "SUPER_ADMIN", elevated: true } }),
      codeOf("ACTOR_REQUIRED")
    );
    assert.equal((await reload.account(u.id)).personId, null);
  });

  it("regularização: se um colaborador entrar na Pessoa entre a prévia e a confirmação, a confirmação recusa (STALE) em vez de ligar outro colaborador", async () => {
    const p = await person("PrevConf");
    const u = await account("prevconf", {});
    const z = await account("prevconf-op", {});
    const preview = await previewAttachAccount(prisma, { targetPersonId: p.id, appUserId: u.id, actor: actorOf(z) });
    assert.equal(preview.expected.linkEmployeeId, null, "a prévia não ligaria colaborador nenhum");
    const e = await employee("PrevConf colab", p.id); // chega depois da prévia
    await assert.rejects(
      attachAccountToPerson(prisma, { targetPersonId: p.id, appUserId: u.id, expected: preview.expected, confirmEmailMismatch: true, reason: "confirmação após mudança", actor: actorOf(z) }),
      codeOf("STALE")
    );
    assert.deepEqual(await reload.account(u.id), { personId: null, employeeId: null });
    const again = await previewAttachAccount(prisma, { targetPersonId: p.id, appUserId: u.id, actor: actorOf(z) });
    assert.equal(again.expected.linkEmployeeId, e.id, "nova prévia mostra o colaborador");
  });

  it("cadastro do colaborador: entrar na Pessoa de uma conta sem colaborador exige permissão e nunca a própria conta", async () => {
    const pX = await person("FormX");
    const x = await account("form-x", { personId: pX.id });
    const e = await employee("FormLider", null);
    const plan = async (personId: string): Promise<EmployeePersonLinkPlan> => {
      const { displayName } = await prisma.person.findUniqueOrThrow({ where: { id: personId }, select: { displayName: true } });
      return { kind: "LINK", personId, sourceKind: null, sourceId: null, appliedForm: { displayName }, conflicts: [], existingEmployeeId: e.id, actorUserId: x.id };
    };
    const apply = async (personId: string, accountIdentity?: Parameters<typeof applyEmployeePersonLinkPlan>[2]) => {
      const p = await plan(personId);
      return prisma.$transaction((tx) => applyEmployeePersonLinkPlan(tx, p, accountIdentity));
    };
    await assert.rejects(apply(pX.id, { actor: { id: x.id, role: "VIEWER", elevated: false }, canManageAccountIdentity: true }), codeOf("SELF_LINK_FORBIDDEN"));
    await assert.rejects(apply(pX.id), codeOf("ACCOUNT_LINK_PERMISSION_REQUIRED"), "sem o contexto da requisição: sem autoridade sobre contas");
    const other = await account("form-op", {});
    const ok = await apply(pX.id, { actor: { id: other.id, role: "VIEWER", elevated: false }, canManageAccountIdentity: true });
    assert.equal(ok.personId, pX.id, "outro operador com a permissão efetiva: permitido");
    const pNoAccount = await person("FormLivre");
    assert.equal((await apply(pNoAccount.id)).personId, pNoAccount.id, "Pessoa sem conta: regra de sempre");
  });

  it("formulários de colaborador/cliente (ensurePersonFromSource): nunca ligam conta nem põem colaborador na Pessoa de uma conta sem colaborador", async () => {
    const cpf = cpfFrom(Date.now());
    const pX = await person("CpfX", { cpfNormalized: cpf });
    await account("cpf-x", { personId: pX.id });
    const e = await employee("CpfLider", null, cpf);
    await assert.rejects(ensurePersonFromSource(prisma, { sourceKind: "employee", sourceId: e.id }), codeOf("ACCOUNT_REGULARIZATION_REQUIRED"));
    assert.equal((await reload.employee(e.id)).personId, null);
    const loose = await account("solta", {});
    await assert.rejects(ensurePersonFromSource(prisma, { sourceKind: "app_user", sourceId: loose.id }), codeOf("ACCOUNT_REGULARIZATION_REQUIRED"));
    assert.equal((await reload.account(loose.id)).personId, null);
  });

  it("propagação recusada por falta de permissão: a pendência aparece em Pessoas 360° (lista, ficha) e só administrador autorizado regulariza", async () => {
    // Estado que um PUT do colaborador deixa quando quem edita não tem vínculo com usuário.
    const p1 = await person("PropAntes");
    const p2 = await person("PropDepois");
    const e = await employee("PropColab", p1.id);
    const u = await account("prop-conta", { personId: p1.id, employeeId: e.id });
    const legacyP = await person("PropLegadoDepois");
    const eLegacy = await employee("PropLegadoColab", null);
    const uLegacy = await account("prop-legado", { personId: null, employeeId: eLegacy.id });
    const editor = await account("prop-editor", {});
    const admin = await account("prop-admin", {});
    const moveAndPropagate = async (emp: { id: string }, from: string | null, to: string) =>
      prisma.$transaction(async (tx) => {
        await tx.employee.update({ where: { id: emp.id }, data: { personId: to } });
        return propagateEmployeePersonToLinkedUser(tx, { employeeId: emp.id, personId: to, previousPersonId: from, actor: actorOf(editor), canManageAccountIdentity: false });
      });
    assert.deepEqual(await moveAndPropagate(e, p1.id, p2.id), { outcome: "ACCOUNT_IDENTITY_DENIED", userId: u.id, code: "ACCOUNT_LINK_PERMISSION_REQUIRED" });
    assert.deepEqual(await moveAndPropagate(eLegacy, null, legacyP.id), { outcome: "ACCOUNT_IDENTITY_DENIED", userId: uLegacy.id, code: "ACCOUNT_LINK_PERMISSION_REQUIRED" });
    assert.deepEqual(await reload.account(u.id), { personId: p1.id, employeeId: e.id }, "conta intacta: escopo do líder não muda");

    // Visível: lista com o filtro "divergência" e o item pendente na ficha da Pessoa nova.
    const listed = await listPeople(prisma, { q: TAG, pending: "mismatch", canViewPii: false, limit: 100 });
    const flagsOf = (id: string) => listed.items.find((r) => r.id === id)?.flags ?? [];
    assert.ok(flagsOf(p2.id).includes("USER_ON_OTHER_PERSON"), "conta em outra Pessoa");
    assert.ok(flagsOf(legacyP.id).includes("USER_WITHOUT_PERSON"), "conta sem Pessoa");
    const pending = await findPendingLinksForPerson(prisma, p2.id);
    assert.ok(pending.some((x) => x.kind === "app_user" && x.entityId === u.id && x.severity === "CONFLICT" && x.currentPersonId === p1.id));
    const pendingLegacy = await findPendingLinksForPerson(prisma, legacyP.id);
    assert.ok(pendingLegacy.some((x) => x.kind === "app_user" && x.entityId === uLegacy.id && x.currentPersonId === null));

    // Regularizável só por quem tem a permissão efetiva — e nunca pela própria conta.
    const fix = (actor: ReturnType<typeof actorOf>, canManageAccountIdentity: boolean) =>
      relinkEntity(prisma, { targetPersonId: p2.id, entityKind: "app_user", entityId: u.id, expectedCurrentPersonId: p1.id, reason: "regularizar pendência da propagação", actor, canManageAccountIdentity });
    await assert.rejects(fix(actorOf(editor), false), codeOf("ACCOUNT_LINK_PERMISSION_REQUIRED"));
    await assert.rejects(fix(actorOf(u), true), codeOf("SELF_LINK_FORBIDDEN"));
    await fix(actorOf(admin), true);
    await relinkEntity(prisma, { targetPersonId: legacyP.id, entityKind: "app_user", entityId: uLegacy.id, expectedCurrentPersonId: null, reason: "regularizar pendência da propagação", actor: actorOf(admin), canManageAccountIdentity: true });
    assert.deepEqual(await reload.account(u.id), { personId: p2.id, employeeId: e.id });
    assert.deepEqual(await reload.account(uLegacy.id), { personId: legacyP.id, employeeId: eLegacy.id });
    assert.ok(!(await findPendingLinksForPerson(prisma, p2.id)).some((x) => x.entityId === u.id), "pendência resolvida");
    const ev = await prisma.personLinkEvent.findFirst({ where: { entityKind: "app_user", entityId: u.id, toPersonId: p2.id }, select: { actorUserId: true, reason: true } });
    assert.deepEqual(ev, { actorUserId: admin.id, reason: "regularizar pendência da propagação" }, "regularização auditada com ator e motivo");
  });

  it("backfill (rotina interna): segura SUPER_ADMIN e qualquer ligação que criaria a evidência conta ↔ colaborador; o resto liga", async () => {
    const cand = (entityKind: "employee" | "app_user", entityId: string, targetPersonId: string) => ({ entityKind, entityId, targetPersonId }) as unknown as BackfillCandidate;
    const held = (msg: RegExp) => (err: unknown) => err instanceof BackfillHeld && msg.test(err.message);
    const pSa = await person("BfSa");
    const sa = await account("bf-sa", { role: "SUPER_ADMIN" });
    await assert.rejects(linkBackfillCandidate(prisma, cand("app_user", sa.id, pSa.id)), held(/SUPER_ADMIN/));
    const pEmp = await person("BfEmp");
    await employee("BfEmp", pEmp.id);
    const u = await account("bf-u", {});
    await assert.rejects(linkBackfillCandidate(prisma, cand("app_user", u.id, pEmp.id)), held(/colaborador sem conta/));
    const pAcc = await person("BfAcc");
    await account("bf-acc", { personId: pAcc.id });
    const e = await employee("BfE", null);
    await assert.rejects(linkBackfillCandidate(prisma, cand("employee", e.id, pAcc.id)), held(/conta sem colaborador/));
    assert.equal((await reload.account(sa.id)).personId, null);
    assert.equal((await reload.account(u.id)).personId, null);
    assert.equal((await reload.employee(e.id)).personId, null);
    const pPlain = await person("BfPlain");
    assert.equal(await linkBackfillCandidate(prisma, cand("app_user", u.id, pPlain.id)), "linked");
  });
});
