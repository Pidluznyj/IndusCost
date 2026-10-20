/**
 * Dados FICTÍCIOS para o piloto local do módulo Desempenho e Cultura.
 *
 * Só roda contra banco local (127.0.0.1 / localhost) e recusa qualquer outro host.
 * Cria cargos, pessoas, um afastamento e três usuários de teste:
 *   - rh.teste@induscost.test     → SUPER_ADMIN (RH)
 *   - lider.teste@induscost.test  → VIEWER + perfil "[DEMO] Líder de produção", vinculado a "Bruno Líder"
 *   - marcos.teste@induscost.test → idem, vinculado a "Marcos Manutenção" (avaliador de Otávio precisa de usuário)
 * A senha vem de PERF_DEMO_PASSWORD (obrigatória). Nada é enviado a Nomus ou a qualquer serviço.
 *
 * Uso:
 *   DATABASE_URL=postgresql://...@127.0.0.1:54329/perf_e2e PERF_DEMO_PASSWORD=... npx tsx scripts/seedPerformanceLocalDemo.ts
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/appAuth.server.js";

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) {
  console.error("Recusado: DATABASE_URL não é local.");
  process.exit(1);
}
const password = process.env.PERF_DEMO_PASSWORD ?? "";
if (password.length < 12) {
  console.error("Defina PERF_DEMO_PASSWORD com pelo menos 12 caracteres.");
  process.exit(1);
}

const prisma = new PrismaClient();
const PREFIX = "[DEMO]";

async function role(name: string) {
  return prisma.role.upsert({ where: { name }, create: { name, baseSalary: 0 }, update: {} });
}

async function employee(input: {
  name: string;
  roleId: string;
  department: string;
  admission: string;
  managerId?: string | null;
  managerName?: string | null;
  status?: string;
  terminationDate?: string | null;
}) {
  const name = `${PREFIX} ${input.name}`;
  const existing = await prisma.employee.findFirst({ where: { name } });
  const data = {
    name,
    roleId: input.roleId,
    department: input.department,
    costCenter: "CC-DEMO",
    classification: "MOD",
    salary: 0,
    monthlyHours: 220,
    status: input.status ?? "ACTIVE",
    admissionDate: new Date(`${input.admission}T12:00:00.000Z`),
    terminationDate: input.terminationDate ? new Date(`${input.terminationDate}T12:00:00.000Z`) : null,
    managerId: input.managerId ?? null,
    managerName: input.managerName ?? null,
  };
  return existing ? prisma.employee.update({ where: { id: existing.id }, data }) : prisma.employee.create({ data });
}

async function main() {
  const operator = await role(`${PREFIX} Operador de produção`);
  const leaderRole = await role(`${PREFIX} Líder de produção`);
  const managerRole = await role(`${PREFIX} Gerente industrial`);
  const maintenance = await role(`${PREFIX} Técnico de manutenção`);

  const carla = await employee({ name: "Carla Gerente", roleId: managerRole.id, department: "Produção", admission: "2018-03-01" });
  const bruno = await employee({ name: "Bruno Líder", roleId: leaderRole.id, department: "Produção", admission: "2019-05-10", managerId: carla.id, managerName: carla.name });
  const marcos = await employee({ name: "Marcos Manutenção", roleId: leaderRole.id, department: "Manutenção", admission: "2017-02-01", managerId: carla.id, managerName: carla.name });
  const team = { managerId: bruno.id, managerName: bruno.name };
  await employee({ name: "Ana Souza", roleId: operator.id, department: "Produção", admission: "2023-01-10", ...team });
  await employee({ name: "Bia Lima", roleId: operator.id, department: "Produção", admission: "2022-06-01", ...team });
  await employee({ name: "Caio Recém", roleId: operator.id, department: "Produção", admission: "2026-09-20", ...team });
  await employee({ name: "Dora Desligada", roleId: operator.id, department: "Produção", admission: "2021-01-01", status: "INACTIVE", terminationDate: "2026-08-30", ...team });
  const eva = await employee({ name: "Eva Afastada", roleId: operator.id, department: "Produção", admission: "2020-02-01", ...team });
  await employee({ name: "Fabi Sem Líder", roleId: operator.id, department: "Expedição", admission: "2022-03-01" });
  await employee({ name: "Otávio Pereira", roleId: maintenance.id, department: "Manutenção", admission: "2021-09-01", managerId: marcos.id, managerName: marcos.name });

  const absence = await prisma.hrAbsence.findFirst({ where: { employeeId: eva.id } });
  if (!absence) {
    await prisma.hrAbsence.create({
      data: { employeeId: eva.id, type: "MEDICAL", startDate: new Date("2026-07-01T12:00:00.000Z"), endDate: new Date("2026-09-15T12:00:00.000Z"), status: "COMPLETED", reason: "Afastamento fictício" },
    });
  }

  const passwordHash = await hashPassword(password);
  // Perfil de acesso oficial (as chaves do perfil viram grants canônicos por recurso).
  const leaderPermissions = ["employees.team.view", "employees.performance.view", "employees.performance.evaluate", "employees.performance.report"];
  const leaderProfile = await prisma.accessProfile.upsert({
    where: { name: `${PREFIX} Líder de produção` },
    create: { name: `${PREFIX} Líder de produção`, description: "Perfil fictício do piloto local", roleBase: "VIEWER", permissions: leaderPermissions },
    update: { permissions: leaderPermissions, isActive: true },
  });
  await prisma.appUser.upsert({
    where: { email: "rh.teste@induscost.test" },
    create: { name: "Rita RH (teste)", email: "rh.teste@induscost.test", passwordHash, role: "SUPER_ADMIN", isActive: true },
    update: { passwordHash, isActive: true, role: "SUPER_ADMIN", permissionsVersion: { increment: 1 } },
  });
  await prisma.appUser.upsert({
    where: { email: "lider.teste@induscost.test" },
    create: {
      name: "Bruno Líder (teste)",
      email: "lider.teste@induscost.test",
      passwordHash,
      role: "VIEWER",
      isActive: true,
      employeeId: bruno.id,
      permissions: leaderPermissions,
      accessProfileId: leaderProfile.id,
    },
    update: {
      passwordHash,
      isActive: true,
      employeeId: bruno.id,
      permissions: leaderPermissions,
      accessProfileId: leaderProfile.id,
      // Mesma regra da tela de usuários: mudança de acesso invalida o cache de permissões.
      permissionsVersion: { increment: 1 },
    },
  });
  // Marcos avalia Otávio: todo avaliador precisa de usuário (a prontidão do ciclo bloqueia avaliador sem acesso).
  await prisma.appUser.upsert({
    where: { email: "marcos.teste@induscost.test" },
    create: { name: "Marcos Manutenção (teste)", email: "marcos.teste@induscost.test", passwordHash, role: "VIEWER", isActive: true, employeeId: marcos.id, permissions: leaderPermissions, accessProfileId: leaderProfile.id },
    update: { passwordHash, isActive: true, employeeId: marcos.id, permissions: leaderPermissions, accessProfileId: leaderProfile.id, permissionsVersion: { increment: 1 } },
  });
  console.log("Dados fictícios prontos: 11 pessoas, 1 afastamento, 3 usuários de teste.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
