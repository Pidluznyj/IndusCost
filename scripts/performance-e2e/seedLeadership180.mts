// Complemento FICTÍCIO para o roteiro da avaliação 180° (rodar depois de scripts/seedPerformanceLocalDemo.ts).
// Só banco local. Deixa Bruno com equipe suficiente (6 elegíveis) e Marcos com equipe pequena (1),
// cria o usuário da gerente (Carla), superior dos dois, para avaliar e calibrar a liderança,
// e põe Carla no topo da estrutura (diretoria raiz fictícia).
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/auth/appAuth.server.js";

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) throw new Error("recusado: DATABASE_URL não é local");
const password = process.env.PERF_DEMO_PASSWORD ?? "";
if (password.length < 12) throw new Error("Defina PERF_DEMO_PASSWORD (a mesma do seed).");

const prisma = new PrismaClient();
const find = async (name: string) => {
  const e = await prisma.employee.findFirst({ where: { name: `[DEMO] ${name}` } });
  if (!e) throw new Error(`rode antes scripts/seedPerformanceLocalDemo.ts (${name} não existe)`);
  return e;
};
const bruno = await find("Bruno Líder");
const carla = await find("Carla Gerente");
const ana = await find("Ana Souza");
for (const name of ["Gabi Rocha", "Hugo Alves", "Iris Melo", "João Pinto"]) {
  const full = `[DEMO] ${name}`;
  const data = {
    name: full,
    roleId: ana.roleId,
    department: "Produção",
    costCenter: "CC-DEMO",
    classification: "MOD",
    salary: 0,
    monthlyHours: 220,
    status: "ACTIVE",
    admissionDate: new Date("2022-04-01T12:00:00.000Z"),
    managerId: bruno.id,
    managerName: bruno.name,
  };
  const existing = await prisma.employee.findFirst({ where: { name: full } });
  if (existing) await prisma.employee.update({ where: { id: existing.id }, data });
  else await prisma.employee.create({ data });
}
// Topo da estrutura: Carla lidera a diretoria raiz. Sem organograma, o sistema não presume topo.
await prisma.hrDepartment.deleteMany({ where: { name: { startsWith: "[DEMO]" } } });
await prisma.hrDirectorate.deleteMany({ where: { name: { startsWith: "[DEMO]" } } });
await prisma.hrDirectorate.create({ data: { name: "[DEMO] Diretoria Industrial", leaderEmployeeId: carla.id } });
const profile = await prisma.accessProfile.findUnique({ where: { name: "[DEMO] Líder de produção" } });
if (!profile) throw new Error("perfil de líder fictício ausente");
const passwordHash = await hashPassword(password);
const access = { passwordHash, isActive: true, role: "VIEWER" as const, employeeId: carla.id, permissions: profile.permissions, accessProfileId: profile.id };
// Marcos também avalia a equipe dele: precisa de usuário (a prontidão bloqueia avaliador sem acesso).
const marcos = await find("Marcos Manutenção");
const marcosAccess = { ...access, employeeId: marcos.id };
await prisma.appUser.upsert({
  where: { email: "marcos.teste@induscost.test" },
  create: { name: "Marcos Manutenção (teste)", email: "marcos.teste@induscost.test", ...marcosAccess },
  update: { ...marcosAccess, permissionsVersion: { increment: 1 } },
});
await prisma.appUser.upsert({
  where: { email: "gerente.teste@induscost.test" },
  create: { name: "Carla Gerente (teste)", email: "gerente.teste@induscost.test", ...access },
  update: { ...access, permissionsVersion: { increment: 1 } },
});
console.log("180°: Bruno com 6 liderados elegíveis, Marcos com 1, usuário gerente.teste vinculado a Carla.");
await prisma.$disconnect();
