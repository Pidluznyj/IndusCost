/**
 * Backfill do alias `employees.edit` em Pessoas/RH — preview por padrão; apply explícito.
 *
 * Uso:
 *   npm run permissions:employees-edit:dry
 *   npm run permissions:employees-edit:apply
 *   npx tsx scripts/backfillEmployeesEditAlias.ts
 *   npx tsx scripts/backfillEmployeesEditAlias.ts --apply --confirm=BACKFILL_EMPLOYEES_EDIT
 *
 * Só ACRESCENTA `employees.edit` (nunca remove chave); ignora SUPER_ADMIN; não revoga
 * sessões — o servidor lê `AppUser.permissions` a cada requisição, então o efeito é
 * imediato. Contexto e regra: docs/hr/employee-functional-record.md ("Editor de RH").
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  EMPLOYEES_MODULE_RESOURCE_KEY,
  formatEmployeesEditBackfillPlan,
  planEmployeesEditBackfill,
} from "../src/lib/security/employeesEditAliasBackfill.ts";

const CONFIRM = "BACKFILL_EMPLOYEES_EDIT";

function parseArgs(argv: string[]) {
  const confirmArg = argv.find((a) => a.startsWith("--confirm="));
  return {
    apply: argv.includes("--apply"),
    confirm: confirmArg?.slice("--confirm=".length).replace(/^"|"$/g, "") ?? null,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const [profiles, users, overrides] = await Promise.all([
      prisma.accessProfile.findMany({
        select: { id: true, name: true, permissions: true },
        orderBy: { name: "asc" },
      }),
      prisma.appUser.findMany({
        select: { id: true, email: true, role: true, permissions: true },
        orderBy: { email: "asc" },
      }),
      prisma.userPermissionOverride.findMany({
        where: { resourceKey: EMPLOYEES_MODULE_RESOURCE_KEY },
        select: { userId: true, resourceKey: true, canExecute: true, canManage: true },
      }),
    ]);

    const overridesByUser = new Map<string, typeof overrides>();
    for (const o of overrides) {
      const list = overridesByUser.get(o.userId) ?? [];
      list.push(o);
      overridesByUser.set(o.userId, list);
    }

    const plan = planEmployeesEditBackfill({
      profiles,
      users: users.map((u) => ({ ...u, overrides: overridesByUser.get(u.id) ?? [] })),
    });
    console.log(formatEmployeesEditBackfillPlan(plan));
    const total = plan.profiles.length + plan.users.length;

    if (!args.apply) {
      console.log(
        JSON.stringify({
          dryRun: true,
          profiles: plan.profiles.length,
          users: plan.users.length,
          note: `Nada gravado. Para aplicar: --apply --confirm=${CONFIRM}`,
        })
      );
      return;
    }
    if (args.confirm !== CONFIRM) {
      console.error(`Recusado: --apply exige --confirm=${CONFIRM}`);
      process.exitCode = 1;
      return;
    }
    if (total === 0) {
      console.log(JSON.stringify({ applied: 0, note: "Nada a corrigir." }));
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const c of plan.profiles) {
        await tx.accessProfile.update({ where: { id: c.id }, data: { permissions: c.after } });
      }
      for (const c of plan.users) {
        await tx.appUser.update({ where: { id: c.id }, data: { permissions: c.after } });
      }
    });

    console.log(
      JSON.stringify({
        applied: total,
        profiles: plan.profiles.length,
        users: plan.users.length,
        note:
          "Efeito imediato (AppUser.permissions é lido a cada requisição). Cada usuário foi corrigido individualmente — perfis alterados não são reaplicados aos usuários por este script.",
      })
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
