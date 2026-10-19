// Usuários FICTÍCIOS de RH para o roteiro de permissões (parte 10). Só banco local.
// Liga cada um ao perfil de sistema correspondente (criado como na tela de perfis), sem `employees.edit`
// e sem vínculo de colaborador: o alcance vem só das permissões do Desempenho.
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/auth/appAuth.server.js";
import { ensureSystemAccessProfiles } from "../../src/lib/accessProfilesService.js";

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) throw new Error("recusado: DATABASE_URL não é local");
const password = process.env.PERF_DEMO_PASSWORD ?? "";
if (password.length < 12) throw new Error("Defina PERF_DEMO_PASSWORD (a mesma do seed).");

const prisma = new PrismaClient();
await ensureSystemAccessProfiles(prisma);
const passwordHash = await hashPassword(password);
for (const [email, name, systemKey] of [
  ["rh.operacional@induscost.test", "Olga RH Operacional (teste)", "hr_performance_operational"],
  ["rh.gestor@induscost.test", "Gil RH Gestor (teste)", "hr_performance_manager"],
] as const) {
  const profile = await prisma.accessProfile.findUnique({ where: { systemKey } });
  if (!profile) throw new Error(`perfil ${systemKey} ausente`);
  const access = { passwordHash, isActive: true, role: "VIEWER" as const, employeeId: null, permissions: profile.permissions, accessProfileId: profile.id };
  await prisma.appUser.upsert({ where: { email }, create: { name, email, ...access }, update: { ...access, permissionsVersion: { increment: 1 } } });
  console.log(`${email} → ${profile.name} (${profile.permissions.length} permissões)`);
}
await prisma.$disconnect();
