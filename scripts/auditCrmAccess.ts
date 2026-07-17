/**
 * Inventário read-only do acesso CRM.
 *
 * Uso:
 *   npm run audit:crm:access
 *   npm run audit:crm:access -- --json --active-only
 *   npm run audit:crm:access -- --user=nome@empresa.com
 */
import "dotenv/config";
import { prisma } from "@/src/lib/prisma.js";
import {
  buildCrmAccessInventoryRow,
  summarizeCrmAccessInventory,
} from "@/src/lib/crmAccessInventory.js";

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() || null : null;
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const activeOnly = process.argv.includes("--active-only");
  const userFilter = argValue("user");

  const users = await prisma.appUser.findMany({
    where: {
      ...(activeOnly ? { isActive: true } : {}),
      ...(userFilter
        ? {
            OR: [
              { email: { contains: userFilter, mode: "insensitive" } },
              { name: { contains: userFilter, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      permissionsVersion: true,
      permissions: true,
      externalSellerId: true,
      externalSellerIds: true,
      sellerResponsibleName: true,
      accessProfile: {
        select: { id: true, name: true, permissions: true },
      },
      permissionOverrides: {
        select: {
          resourceKey: true,
          canView: true,
          canExecute: true,
          canManage: true,
        },
      },
    },
  });

  const rows = users.map((user) =>
    buildCrmAccessInventoryRow({
      ...user,
      role: String(user.role),
    })
  );
  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    filters: { activeOnly, user: userFilter },
    summary: summarizeCrmAccessInventory(rows),
    users: rows,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(JSON.stringify(report.summary, null, 2));
  for (const row of rows.filter((item) => item.issues.length > 0)) {
    console.log(
      `${row.email} | role=${row.role} | profile=${row.accessProfile?.name ?? "-"} | ` +
        `scope=${row.dataScope} | linked=${row.sellerLinked} | issues=${row.issues.join(",")}`
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
