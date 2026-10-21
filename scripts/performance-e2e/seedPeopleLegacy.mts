// Dados FICTÍCIOS que reproduzem os 7 casos legados de homologação (contas sem Pessoa) para
// o roteiro E2E part16 — só banco local. Idempotente por e-mail. Nenhum dado real.
//
// L1 legado.superadmin  SUPER_ADMIN sem employeeId/personId; existe colaborador ativo com Pessoa e mesmo e-mail (caso "Paulo")
// L2 legado.inativa     VIEWER com colaborador ativo cuja Pessoa está INACTIVE (caso "Eduardo")
// L3 legado.email       VIEWER com colaborador; e-mail de login ≠ e-mail corporativo (caso "Leticia")
// L4 legado.simples     VIEWER com colaborador e Pessoa ativas, e-mails iguais (casos Gi/Joseane/Maria/Pedrinho)
// L5 legado.semperson   VIEWER com colaborador SEM Pessoa
// L6 legado.ocupada     VIEWER com colaborador cuja Pessoa já é de outra conta ativa
// L7 legado.duplicada   VIEWER com colaborador cuja Pessoa tem o CPF repetido em outra Pessoa
// Extra: legado.inativo (conta inativa, sem Pessoa) e vendedor.legado (SELLER com vínculo Nomus, para invariância)
//
// Uso: DATABASE_URL=<local> PERF_DEMO_PASSWORD=<12+> PEOPLE_LEGACY_STATE=<arquivo.json fora do repo> npx tsx scripts/performance-e2e/seedPeopleLegacy.mts
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/auth/appAuth.server.js";

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\/(?!teste_bi)/.test(url)) throw new Error("recusado: DATABASE_URL não é local/descartável");
const password = process.env.PERF_DEMO_PASSWORD ?? "";
if (password.length < 12) throw new Error("Defina PERF_DEMO_PASSWORD (a mesma do seed).");
const statePath = process.env.PEOPLE_LEGACY_STATE ?? "";

const prisma = new PrismaClient();
const passwordHash = await hashPassword(password);
const TAG = "[LEGADO]";

const role = await prisma.role.upsert({ where: { name: `${TAG} Cargo` }, create: { name: `${TAG} Cargo`, baseSalary: 0 }, update: {} });

async function person(name: string, extra: Record<string, unknown> = {}) {
  // Idempotente mesmo se o roteiro renomeou a Pessoa (o nome pode ganhar sufixo): procura pelo prefixo, a mais antiga.
  const existing = await prisma.person.findFirst({ where: { displayName: { startsWith: `${TAG} ${name}` } }, orderBy: { createdAt: "asc" } });
  if (existing) {
    await prisma.person.update({ where: { id: existing.id }, data: { status: (extra.status as string) ?? "ACTIVE", mergedIntoPersonId: null, ...extra } });
    return existing;
  }
  return prisma.person.create({ data: { displayName: `${TAG} ${name}`, origin: "MANUAL", ...extra } });
}
async function employee(name: string, personId: string | null, corporateEmail: string | null, extra: Record<string, unknown> = {}) {
  const data = { name: `${TAG} ${name}`, roleId: role.id, department: "Administrativo", costCenter: "ADM", classification: "MOI", salary: 0, monthlyHours: 220, status: "ACTIVE", admissionDate: new Date("2023-01-02"), personId, corporateEmail, ...extra };
  const existing = await prisma.employee.findFirst({ where: { name: data.name } });
  if (existing) return prisma.employee.update({ where: { id: existing.id }, data });
  return prisma.employee.create({ data });
}
async function user(email: string, name: string, extra: Record<string, unknown> = {}) {
  const base = { name: `${TAG} ${name}`, passwordHash, isActive: true, role: "VIEWER" as const, permissions: [] as string[], employeeId: null as string | null, personId: null as string | null, accessProfileId: null, ...extra };
  return prisma.appUser.upsert({ where: { email }, create: { email, ...base }, update: { ...base, permissionsVersion: { increment: 1 } } });
}
async function sessions(userId: string, n: number) {
  await prisma.appSession.deleteMany({ where: { userId } });
  for (let i = 0; i < n; i += 1) {
    await prisma.appSession.create({ data: { userId, tokenHash: `legado-${userId}-${i}`, expiresAt: new Date(Date.now() + 6 * 3600_000), permissionsVersionAtIssue: 0 } });
  }
}

// L1 — Paulo: conta SUPER_ADMIN sem vínculos; colaborador ativo com Pessoa e mesmo e-mail
const p1 = await person("Paulo Super", { cpfNormalized: "98765432100", corporateEmail: "legado.superadmin@induscost.test" });
const e1 = await employee("Paulo Super", p1.id, "legado.superadmin@induscost.test");
const u1 = await user("legado.superadmin@induscost.test", "Paulo Super", { role: "SUPER_ADMIN" });
await sessions(u1.id, 1);

// L2 — Eduardo: colaborador ativo apontando para Pessoa INACTIVE
const p2 = await person("Eduardo Inativa", { status: "INACTIVE", inactivatedAt: new Date("2025-06-01"), origin: "EMPLOYEE", cpfNormalized: "28641481028", corporateEmail: "legado.inativa@induscost.test" });
const e2 = await employee("Eduardo Inativa", p2.id, "legado.inativa@induscost.test");
const u2 = await user("legado.inativa@induscost.test", "Eduardo Inativa", { role: "COMMERCIAL_MANAGER", employeeId: e2.id });

// L3 — Leticia: e-mail de login ≠ corporativo
const p3 = await person("Leticia Email", { cpfNormalized: "15350946056", corporateEmail: "leticia.corp@induscost.test" });
const e3 = await employee("Leticia Email", p3.id, "leticia.corp@induscost.test");
const u3 = await user("legado.email@induscost.test", "Leticia Email", { employeeId: e3.id });
await sessions(u3.id, 2);

// L4 — caso simples
const p4 = await person("Gi Simples", { cpfNormalized: "74792131073", corporateEmail: "legado.simples@induscost.test" });
const e4 = await employee("Gi Simples", p4.id, "legado.simples@induscost.test");
const u4 = await user("legado.simples@induscost.test", "Gi Simples", { role: "SELLER", employeeId: e4.id, permissions: ["commissions.view"] });
await sessions(u4.id, 2);

// L5 — colaborador sem Pessoa
const e5 = await employee("Maria SemPessoa", null, "legado.semperson@induscost.test", { cpf: "60384052088" });
const u5 = await user("legado.semperson@induscost.test", "Maria SemPessoa", { employeeId: e5.id });

// L6 — Pessoa já ocupada por outra conta
const p6 = await person("Pedro Ocupada", { cpfNormalized: "71428793860", corporateEmail: "legado.ocupada@induscost.test" });
const e6 = await employee("Pedro Ocupada", p6.id, "legado.ocupada@induscost.test");
const dono = await user("legado.dono@induscost.test", "Dono Ocupada", { personId: p6.id });
const u6 = await user("legado.ocupada@induscost.test", "Pedro Ocupada", { employeeId: e6.id });

// L7 — CPF repetido entre Pessoas
const p7 = await person("Joseane Dup A", { cpfNormalized: "05432879042", corporateEmail: "legado.duplicada@induscost.test" });
await person("Joseane Dup B", { cpfNormalized: "05432879042", origin: "APP_USER" });
const e7 = await employee("Joseane Dup A", p7.id, "legado.duplicada@induscost.test");
const u7 = await user("legado.duplicada@induscost.test", "Joseane Dup", { employeeId: e7.id });

// Extras
const uInativo = await user("legado.inativo@induscost.test", "Conta Inativa", { isActive: false });
const pVend = await person("Vendedor Legado", { cpfNormalized: "39053344705", corporateEmail: "vendedor.legado@induscost.test" });
const eVend = await employee("Vendedor Legado", pVend.id, "vendedor.legado@induscost.test");
const uVend = await user("vendedor.legado@induscost.test", "Vendedor Legado", { role: "SELLER", employeeId: eVend.id, externalSellerId: 999464, externalSellerIds: [999464, 999646], sellerResponsibleName: "VENDEDOR LEGADO" });
const cpExisting = await prisma.commissionPerson.findFirst({ where: { nomusPersonId: 999464 } });
const cp = cpExisting
  ? await prisma.commissionPerson.update({ where: { id: cpExisting.id }, data: { active: true, personId: pVend.id } })
  : await prisma.commissionPerson.create({ data: { name: "VENDEDOR LEGADO", type: "SELLER", source: "NOMUS", nomusPersonId: 999464, active: true, personId: pVend.id } });

const state = {
  seededAt: new Date().toISOString(),
  L1: { user: u1.id, employee: e1.id, person: p1.id },
  L2: { user: u2.id, employee: e2.id, person: p2.id },
  L3: { user: u3.id, employee: e3.id, person: p3.id },
  L4: { user: u4.id, employee: e4.id, person: p4.id },
  L5: { user: u5.id, employee: e5.id },
  L6: { user: u6.id, employee: e6.id, person: p6.id, holder: dono.id },
  L7: { user: u7.id, employee: e7.id, person: p7.id },
  inactiveUser: uInativo.id,
  seller: { user: uVend.id, person: pVend.id, commissionPerson: cp.id },
};
if (statePath) writeFileSync(statePath, JSON.stringify(state, null, 2));
console.log(JSON.stringify(state));
await prisma.$disconnect();
