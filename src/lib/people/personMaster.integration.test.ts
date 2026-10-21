/**
 * Pessoas 360° — cadastro mestre em PostgreSQL local: criar/editar/situação, habilitar acesso,
 * regularizar os 7 casos legados, habilitar motorista e invariância de comissões.
 * Só roda com PEOPLE_PG_TEST_URL local (127.0.0.1/localhost) e nunca em teste_bi*.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { CanonicalPersonError } from "@/src/lib/canonicalPerson";
import { createAppUserAccount } from "@/src/lib/adminUserCreation.server";
import { createPersonManual, setPersonStatus, updatePersonIdentity } from "@/src/lib/people/personMaster.server";
import { attachAccountToPerson, listCandidateAccounts, previewAttachAccount, relinkEntity } from "@/src/lib/people/personLinkOps.server";
import { enableDriverForPerson, previewDriverEnable } from "@/src/lib/people/personDriverEnable.server";
import { resolvePersonByCpf } from "@/src/lib/people/personIdentityResolve.server";

const url = process.env.PEOPLE_PG_TEST_URL ?? "";
const isLocal = /@(127\.0\.0\.1|localhost)(:\d+)?\/(?!teste_bi)/.test(url);
const skip = !url ? "PEOPLE_PG_TEST_URL não definida" : !isLocal ? "URL não é local/descartável: recusado" : false;
const TAG = `p360-master-${Date.now()}`;
const sa = { id: null as string | null, name: "SA teste", role: "SUPER_ADMIN", elevated: true };
const admin = { id: null as string | null, name: "Admin teste", role: "ADMIN", elevated: false };
const origin = { ipAddress: null, userAgent: null };
const CPF_A = "52998224725";
const CPF_B = "11144477735";
const CPF_C = "39053344705";
const CPF_D = "12345678909";

describe("Pessoas 360° — cadastro mestre (PostgreSQL local)", { skip }, () => {
  let prisma: PrismaClient;
  let roleId = "";
  const ids = { people: [] as string[], employees: [] as string[], users: [] as string[], drivers: [] as string[], commission: [] as string[] };

  before(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const role = await prisma.role.upsert({ where: { name: `${TAG} cargo` }, create: { name: `${TAG} cargo`, baseSalary: 0 }, update: {} });
    roleId = role.id;
  });
  after(async () => {
    const people = [...new Set(ids.people)];
    await prisma.personLinkEvent.deleteMany({ where: { OR: [{ personId: { in: people } }, { fromPersonId: { in: people } }, { toPersonId: { in: people } }] } });
    await prisma.securityAuditLog.deleteMany({ where: { targetUserId: { in: ids.users } } });
    await prisma.appSession.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.appUser.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.fleetAuditLog.deleteMany({ where: { entityId: { in: ids.drivers } } });
    await prisma.fleetDriver.deleteMany({ where: { id: { in: ids.drivers } } });
    await prisma.commissionPerson.deleteMany({ where: { id: { in: ids.commission } } });
    await prisma.employee.deleteMany({ where: { id: { in: ids.employees } } });
    await prisma.person.updateMany({ where: { id: { in: people } }, data: { mergedIntoPersonId: null } });
    await prisma.person.deleteMany({ where: { id: { in: people } } });
    await prisma.role.deleteMany({ where: { id: roleId } });
    await prisma.$disconnect();
  });

  async function person(name: string, extra: Record<string, unknown> = {}) {
    const p = await prisma.person.create({ data: { displayName: `${TAG} ${name}`, origin: "MANUAL", ...extra } });
    ids.people.push(p.id);
    return p;
  }
  async function employee(name: string, personId: string | null, extra: Record<string, unknown> = {}) {
    const e = await prisma.employee.create({ data: { name: `${TAG} ${name}`, roleId, department: "T", costCenter: "CC", classification: "MOD", salary: 0, monthlyHours: 220, status: "ACTIVE", admissionDate: new Date("2024-01-01"), personId, ...extra } });
    ids.employees.push(e.id);
    return e;
  }
  async function user(name: string, employeeId: string | null, personId: string | null, extra: Record<string, unknown> = {}, sessions = 0) {
    const u = await prisma.appUser.create({ data: { name: `${TAG} ${name}`, email: `${TAG}-${name}@local.test`.toLowerCase(), passwordHash: `hash-${name}`, role: "VIEWER", employeeId, personId, isActive: true, permissions: ["x.view"], ...extra } });
    ids.users.push(u.id);
    for (let i = 0; i < sessions; i += 1) {
      await prisma.appSession.create({ data: { userId: u.id, tokenHash: `${TAG}-${name}-${i}`, expiresAt: new Date(Date.now() + 3600_000), permissionsVersionAtIssue: 0 } });
    }
    return u;
  }
  const events = (personId: string) => prisma.personLinkEvent.findMany({ where: { personId }, orderBy: { createdAt: "asc" } });

  // ---------------------------------------------------------------- CRUD
  it("criar Pessoa direta: evento PERSON_CREATED; CPF repetido → 409; CPF de Pessoa MERGED não bloqueia", async () => {
    const created = await createPersonManual(prisma, { actor: sa, body: { displayName: `${TAG} Nova`, cpf: "529.982.247-25", corporateEmail: `${TAG}-nova@local.test` } });
    ids.people.push(created.id);
    const row = await prisma.person.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(row.cpfNormalized, CPF_A);
    assert.equal(row.origin, "MANUAL");
    assert.equal((await events(created.id))[0]?.eventKind, "PERSON_CREATED");
    await assert.rejects(createPersonManual(prisma, { actor: sa, body: { displayName: `${TAG} Dup`, cpf: CPF_A } }), (e: unknown) => e instanceof CanonicalPersonError && e.code === "DUPLICATE_CPF");
    // Pessoa absorvida mantém o CPF, mas não é duplicata
    const merged = await person("Absorvida", { status: "MERGED", mergedIntoPersonId: created.id, cpfNormalized: CPF_C });
    const other = await createPersonManual(prisma, { actor: sa, body: { displayName: `${TAG} Mesma CPF da absorvida`, cpf: CPF_C } });
    ids.people.push(other.id);
    assert.ok(other.id !== merged.id);
  });

  it("editar identidade: grava IDENTITY_UPDATED mascarado e NÃO reescreve as cópias do colaborador/conta", async () => {
    const p = await person("Editavel", { cpfNormalized: CPF_B, corporateEmail: `${TAG}-edit@local.test` });
    const e = await employee("Edit Colab", p.id, { cpf: CPF_B, corporateEmail: `${TAG}-edit@local.test` });
    const u = await user("edit", e.id, p.id);
    const r = await updatePersonIdentity(prisma, p.id, { actor: sa, reason: "correção de nome", body: { displayName: `${TAG} Editada`, phone: "(11) 97777-6666" } });
    assert.deepEqual(r.changed, ["displayName", "phoneNormalized"]);
    const ev = (await events(p.id)).find((x) => x.eventKind === "IDENTITY_UPDATED")!;
    assert.ok(ev, "evento gravado");
    assert.ok(!JSON.stringify(ev.snapshot).includes("97777"), "telefone mascarado no snapshot");
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: e.id } })).name, `${TAG} Edit Colab`, "Employee.name intacto");
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } })).name, `${TAG} edit`, "AppUser.name intacto");
    await assert.rejects(updatePersonIdentity(prisma, p.id, { actor: sa, body: { cpf: "111.111.111-11" } }), (x: unknown) => x instanceof CanonicalPersonError && x.code === "INVALID_CPF");
    await assert.rejects(updatePersonIdentity(prisma, p.id, { actor: sa, body: { cpf: CPF_A } }), (x: unknown) => x instanceof CanonicalPersonError && x.code === "DUPLICATE_CPF");
  });

  it("situação: inativar exige ausência de vínculos ativos; reativar é explícito; Pessoa inativa não recebe vínculo", async () => {
    const p = await person("Situacao");
    const u = await user("situacao", null, p.id);
    await assert.rejects(setPersonStatus(prisma, p.id, { actor: sa, status: "INACTIVE", reason: "teste de bloqueio" }), (e: unknown) => e instanceof CanonicalPersonError && e.code === "PERSON_HAS_ACTIVE_LINKS");
    await prisma.appUser.update({ where: { id: u.id }, data: { isActive: false } });
    const off = await setPersonStatus(prisma, p.id, { actor: sa, status: "INACTIVE", reason: "pessoa saiu da empresa" });
    assert.equal(off.status, "INACTIVE");
    // Pessoa inativa: conta nova e vínculo novo são recusados até reativar
    const other = await user("situacao2", null, null);
    await assert.rejects(relinkEntity(prisma, { targetPersonId: p.id, entityKind: "app_user", entityId: other.id, expectedCurrentPersonId: null, reason: "tentativa em pessoa inativa", actor: sa }), (e: unknown) => e instanceof CanonicalPersonError && e.code === "TARGET_INACTIVE");
    const on = await setPersonStatus(prisma, p.id, { actor: sa, status: "ACTIVE", reason: "voltou" });
    assert.equal(on.status, "ACTIVE");
    const kinds = (await events(p.id)).map((x) => x.eventKind);
    assert.deepEqual(kinds, ["PERSON_INACTIVATED", "PERSON_REACTIVATED"]);
  });

  // ---------------------------------------------------------------- Habilitar acesso
  it("habilitar acesso: Pessoa sem colaborador → conta só com personId; com colaborador → employeeId; 2ª conta → 409; auditoria e evento", async () => {
    const ext = await person("Externa", { corporateEmail: `${TAG}-ext@local.test` });
    const created = await createAppUserAccount({ prisma }, { source: { kind: "person", personId: ext.id }, password: "SenhaForte#2026", actor: { id: null, role: "ADMIN" }, origin, creationSource: "PERSON_ENABLE_ACCESS" });
    ids.users.push(created.id);
    assert.equal(created.personId, ext.id);
    assert.equal(created.employeeId, null);
    assert.equal(created.role, "VIEWER");
    assert.equal(created.mustChangePassword, true);
    const audits = await prisma.securityAuditLog.findMany({ where: { targetUserId: created.id }, select: { eventType: true, metadata: true } });
    assert.deepEqual(audits.map((a) => a.eventType).sort(), ["USER_CREATED", "USER_INITIAL_PASSWORD_ASSIGNED"]);
    assert.ok(audits.every((a) => !JSON.stringify(a.metadata).includes("SenhaForte")));
    assert.ok((await events(ext.id)).some((x) => x.eventKind === "LINKED" && x.entityKind === "app_user"));
    await assert.rejects(createAppUserAccount({ prisma }, { source: { kind: "person", personId: ext.id }, email: `${TAG}-ext2@local.test`, password: "SenhaForte#2026", actor: { id: null, role: "ADMIN" }, origin, creationSource: "PERSON_ENABLE_ACCESS" }), (e: { code: string }) => e.code === "PERSON_ALREADY_HAS_USER");

    const withEmp = await person("Com Colab", { cpfNormalized: CPF_D });
    const e = await employee("Colab Acesso", withEmp.id, { corporateEmail: `${TAG}-colab@local.test` });
    const u2 = await createAppUserAccount({ prisma }, { source: { kind: "person", personId: withEmp.id }, password: "SenhaForte#2026", actor: { id: null, role: "ADMIN" }, origin, creationSource: "PERSON_ENABLE_ACCESS" });
    ids.users.push(u2.id);
    assert.equal(u2.employeeId, e.id);
    assert.equal(u2.email, `${TAG}-colab@local.test`);
  });

  // ---------------------------------------------------------------- Os 7 casos legados
  it("L4 caso simples: conta com colaborador, Pessoa ativa, e-mails iguais → personId copiado; senha, papel, permissões e sessões intactos", async () => {
    const p = await person("L4", { corporateEmail: `${TAG}-l4@local.test` });
    const e = await employee("L4 colab", p.id, { corporateEmail: `${TAG}-l4@local.test` });
    const u = await user("l4", e.id, null, { permissions: ["commissions.view"], externalSellerId: 464, externalSellerIds: [464, 646], sellerResponsibleName: "VENDEDOR L4" }, 2);
    const before = await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } });
    const preview = await previewAttachAccount(prisma, { targetPersonId: p.id, appUserId: u.id, actor: admin });
    assert.equal(preview.decision.ok, true);
    assert.equal(preview.emailMismatch, false);
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } })).personId, null, "prévia não grava");
    const r = await attachAccountToPerson(prisma, { targetPersonId: p.id, appUserId: u.id, expected: preview.expected, confirmEmailMismatch: false, reason: "regularização L4", actor: admin, origin });
    assert.equal(r!.kind, "LINK");
    const afterRow = await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } });
    assert.equal(afterRow.personId, p.id);
    for (const k of ["id", "email", "passwordHash", "role", "permissions", "permissionsVersion", "accessProfileId", "isActive", "mustChangePassword", "externalSellerId", "externalSellerIds", "sellerResponsibleName", "employeeId"] as const) {
      assert.deepEqual(afterRow[k], before[k], `campo ${k} intacto`);
    }
    assert.equal(await prisma.appSession.count({ where: { userId: u.id, revokedAt: null } }), 2, "sessões preservadas");
    assert.equal((await prisma.securityAuditLog.findMany({ where: { targetUserId: u.id, eventType: "USER_IDENTITY_LINKED" } })).length, 1);
  });

  it("L3 e-mails divergentes: exige confirmação explícita; login não muda; evidência MANUAL", async () => {
    const p = await person("L3", { corporateEmail: `${TAG}-l3-corp@local.test` });
    const e = await employee("L3 colab", p.id, { corporateEmail: `${TAG}-l3-corp@local.test` });
    const u = await user("l3", e.id, null); // login = TAG-l3@local.test ≠ corporativo
    const preview = await previewAttachAccount(prisma, { targetPersonId: p.id, appUserId: u.id, actor: admin });
    assert.equal(preview.emailMismatch, true);
    await assert.rejects(attachAccountToPerson(prisma, { targetPersonId: p.id, appUserId: u.id, expected: preview.expected, confirmEmailMismatch: false, reason: "sem confirmar", actor: admin }), (x: unknown) => x instanceof CanonicalPersonError && x.code === "EMAIL_MISMATCH_CONFIRMATION_REQUIRED");
    await attachAccountToPerson(prisma, { targetPersonId: p.id, appUserId: u.id, expected: preview.expected, confirmEmailMismatch: true, reason: "confirmado pelo colaborador vinculado", actor: admin });
    const row = await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } });
    assert.equal(row.personId, p.id);
    assert.equal(row.email, `${TAG}-l3@local.test`, "login preservado");
    assert.equal((await events(p.id)).find((x) => x.entityKind === "app_user")?.evidence, "MANUAL");
  });

  it("L1 SUPER_ADMIN sem colaborador nem Pessoa: candidato por busca; só SUPER_ADMIN elevado regulariza; personId + employeeId na mesma transação", async () => {
    const p = await person("L1 Paulo", { corporateEmail: `${TAG}-l1@local.test`, cpfNormalized: "98765432100" });
    const e = await employee("L1 colab", p.id, { corporateEmail: `${TAG}-l1@local.test` });
    const u = await user("l1", null, null, { role: "SUPER_ADMIN", permissions: [] });
    const cands = await listCandidateAccounts(prisma, p.id, { q: "l1", canViewPii: false });
    const cand = cands.find((c) => c.id === u.id)!;
    assert.ok(cand, "conta sem Pessoa aparece como candidata");
    assert.equal(cand.evidence, "EMAIL_EXACT");
    assert.equal(cand.email, null, "e-mail em claro só com PII");
    await assert.rejects(attachAccountToPerson(prisma, { targetPersonId: p.id, appUserId: u.id, expected: {}, confirmEmailMismatch: true, reason: "sem autoridade", actor: admin }), (x: unknown) => x instanceof CanonicalPersonError && x.code === "SUPER_ADMIN_REQUIRED");
    const r = await attachAccountToPerson(prisma, { targetPersonId: p.id, appUserId: u.id, employeeId: e.id, expected: { personId: null, employeeId: null }, confirmEmailMismatch: true, reason: "caso real do super admin", actor: sa, origin });
    assert.equal(r!.employeeId, e.id);
    const row = await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } });
    assert.equal(row.personId, p.id);
    assert.equal(row.employeeId, e.id);
    assert.equal(row.role, "SUPER_ADMIN", "papel preservado");
  });

  it("L2 colaborador ativo apontando para Pessoa INACTIVE: recusa TARGET_INACTIVE; depois de reativar (auditado) regulariza", async () => {
    const p = await person("L2 inativa", { status: "INACTIVE", inactivatedAt: new Date(), cpfNormalized: "28641481028" });
    const e = await employee("L2 colab", p.id, { corporateEmail: `${TAG}-l2@local.test` });
    const u = await user("l2", e.id, null);
    await assert.rejects(attachAccountToPerson(prisma, { targetPersonId: p.id, appUserId: u.id, expected: {}, confirmEmailMismatch: true, reason: "tentar com inativa", actor: admin }), (x: unknown) => x instanceof CanonicalPersonError && x.code === "TARGET_INACTIVE");
    await setPersonStatus(prisma, p.id, { actor: sa, status: "ACTIVE", reason: "identidade inativada por erro no legado; colaborador ativo" });
    await attachAccountToPerson(prisma, { targetPersonId: p.id, appUserId: u.id, expected: { personId: null, employeeId: e.id }, confirmEmailMismatch: true, reason: "regularização após reativar", actor: admin });
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } })).personId, p.id);
  });

  it("L5 colaborador sem Pessoa: regularizar preenche employee.personId e grava evento do colaborador", async () => {
    const p = await person("L5");
    const e = await employee("L5 colab", null);
    const u = await user("l5", e.id, null);
    const r = await attachAccountToPerson(prisma, { targetPersonId: p.id, appUserId: u.id, expected: { personId: null, employeeId: e.id }, confirmEmailMismatch: true, reason: "ligar conta e colaborador à Pessoa", actor: admin });
    assert.ok(r!.employeeEventId);
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: e.id } })).personId, p.id);
  });

  it("L6 Pessoa já ocupada por outra conta → TARGET_HAS_USER, nada muda; L7 CPF duplicado entre Pessoas → resolução ambígua, nunca automática", async () => {
    const p = await person("L6");
    const dono = await user("l6-dono", null, p.id);
    const e = await employee("L6 colab", p.id);
    const u = await user("l6", e.id, null);
    await assert.rejects(attachAccountToPerson(prisma, { targetPersonId: p.id, appUserId: u.id, expected: {}, confirmEmailMismatch: true, reason: "conflito", actor: admin }), (x: unknown) => x instanceof CanonicalPersonError && x.code === "TARGET_HAS_USER");
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: dono.id } })).personId, p.id);
    assert.equal((await prisma.appUser.findUniqueOrThrow({ where: { id: u.id } })).personId, null);
    const a = await person("L7 A", { cpfNormalized: "15350946056" });
    await person("L7 B", { cpfNormalized: "15350946056", origin: "APP_USER" });
    const resolved = await resolvePersonByCpf(prisma, "15350946056");
    assert.equal(resolved.personId, null);
    assert.equal(resolved.ambiguous, true);
    assert.ok(a.id);
  });

  // ---------------------------------------------------------------- Motorista
  it("habilitar motorista: CREATE copia nome/CPF/contato da Pessoa (status PENDING), depois ALREADY_ENABLED; LINK e REACTIVATE preservam o legado; auditoria sem CPF em claro", async () => {
    const p = await person("Motorista", { cpfNormalized: "74792131073", phoneNormalized: "11955554444", corporateEmail: `${TAG}-mot@local.test` });
    const pre = await previewDriverEnable(prisma, p.id);
    assert.equal(pre.plan.action, "CREATE");
    const created = await enableDriverForPerson(prisma, p.id, { actor: sa, body: { action: "CREATE", cnhNumber: "123", cnhCategory: "b", reason: "habilitar pela ficha" }, fleetAuditUserId: null });
    ids.drivers.push(created.driverId);
    const d = await prisma.fleetDriver.findUniqueOrThrow({ where: { id: created.driverId } });
    assert.equal(d.cpf, "74792131073");
    assert.equal(d.personId, p.id);
    assert.equal(d.status, "PENDING");
    assert.equal(d.cnhCategory, "B");
    assert.equal(d.phone, "11955554444");
    const audit = await prisma.fleetAuditLog.findMany({ where: { entityId: d.id } });
    assert.equal(audit.length, 1);
    assert.ok(!audit[0]!.newValue!.includes("74792131073"), "CPF mascarado na auditoria da Frota");
    assert.equal((await previewDriverEnable(prisma, p.id)).plan.action, "ALREADY_ENABLED");
    await assert.rejects(enableDriverForPerson(prisma, p.id, { actor: sa, body: { action: "CREATE", reason: "de novo" }, fleetAuditUserId: null }), (x: unknown) => x instanceof CanonicalPersonError && x.code === "ALREADY_ENABLED");

    // LINK: motorista legado ativo com o mesmo CPF e sem Pessoa
    const p2 = await person("Motorista Legado", { cpfNormalized: "60384052088" });
    const legacy = await prisma.fleetDriver.create({ data: { name: `${TAG} Legado`, cpf: "603.840.520-88", status: "AUTHORIZED", cnhNumber: "CNH-LEGADO", phone: "11900000000" } });
    ids.drivers.push(legacy.id);
    assert.equal((await previewDriverEnable(prisma, p2.id)).plan.action, "LINK");
    const linked = await enableDriverForPerson(prisma, p2.id, { actor: sa, body: { action: "LINK", reason: "mesmo CPF, vincular legado" }, fleetAuditUserId: null });
    assert.equal(linked.driverId, legacy.id);
    const legacyAfter = await prisma.fleetDriver.findUniqueOrThrow({ where: { id: legacy.id } });
    assert.equal(legacyAfter.personId, p2.id);
    assert.equal(legacyAfter.name, `${TAG} Legado`, "nome do legado não sobrescrito");
    assert.equal(legacyAfter.cnhNumber, "CNH-LEGADO");
    assert.equal(legacyAfter.status, "AUTHORIZED");

    // REACTIVATE: motorista INACTIVE com o CPF
    const p3 = await person("Motorista Inativo", { cpfNormalized: "71428793860" });
    const inactive = await prisma.fleetDriver.create({ data: { name: `${TAG} Inativo`, cpf: "71428793860", status: "INACTIVE" } });
    ids.drivers.push(inactive.id);
    assert.equal((await previewDriverEnable(prisma, p3.id)).plan.action, "REACTIVATE");
    await enableDriverForPerson(prisma, p3.id, { actor: sa, body: { action: "REACTIVATE", reason: "voltou a dirigir" }, fleetAuditUserId: null });
    const re = await prisma.fleetDriver.findUniqueOrThrow({ where: { id: inactive.id } });
    assert.equal(re.status, "PENDING");
    assert.equal(re.personId, p3.id);
  });

  // ---------------------------------------------------------------- Comissões intactas
  it("invariância de comissões: habilitar acesso, regularizar, editar Pessoa e habilitar motorista não tocam CommissionPerson nem o vínculo Nomus da conta", async () => {
    const p = await person("Vendas", { cpfNormalized: "05432879042", corporateEmail: `${TAG}-vendas@local.test` });
    const e = await employee("Vendas colab", p.id, { corporateEmail: `${TAG}-vendas@local.test` });
    const cp = await prisma.commissionPerson.create({ data: { name: `${TAG} VENDEDOR`, type: "SELLER", source: "NOMUS", nomusPersonId: 999464, active: true, personId: p.id } });
    ids.commission.push(cp.id);
    const u = await user("vendas", e.id, null, { role: "SELLER", externalSellerId: 999464, externalSellerIds: [999464], sellerResponsibleName: "VENDEDOR" });
    const snap = async () => {
      const c = await prisma.commissionPerson.findUniqueOrThrow({ where: { id: cp.id } });
      const a = await prisma.appUser.findUniqueOrThrow({ where: { id: u.id }, select: { externalSellerId: true, externalSellerIds: true, sellerResponsibleName: true, role: true, permissions: true } });
      return JSON.stringify({ c: { ...c, updatedAt: null }, a });
    };
    const before = await snap();
    await attachAccountToPerson(prisma, { targetPersonId: p.id, appUserId: u.id, expected: { personId: null, employeeId: e.id }, confirmEmailMismatch: true, reason: "regularizar vendedor", actor: admin });
    assert.equal(await snap(), before);
    await updatePersonIdentity(prisma, p.id, { actor: sa, body: { displayName: `${TAG} Vendas Renomeada`, corporateEmail: `${TAG}-vendas2@local.test` } });
    assert.equal(await snap(), before);
    assert.equal((await prisma.commissionPerson.findUniqueOrThrow({ where: { id: cp.id } })).name, `${TAG} VENDEDOR`, "nome do comissionável não acompanha a Pessoa");
    const drv = await enableDriverForPerson(prisma, p.id, { actor: sa, body: { action: "CREATE", reason: "vendedor também dirige" }, fleetAuditUserId: null });
    ids.drivers.push(drv.driverId);
    assert.equal(await snap(), before);
  });
});
