/**
 * Diagnóstico READ-ONLY — escopo de acesso CRM Comercial (carteira por responsável).
 *
 * Uso:
 *   npx tsx tmp-audits/inspect-crm-commercial-access-scope.ts
 *   npx tsx tmp-audits/inspect-crm-commercial-access-scope.ts --email=user@empresa.com
 *   npx tsx tmp-audits/inspect-crm-commercial-access-scope.ts --name="GISLENE" --days=30
 *
 * Sem DATABASE_URL: imprime matriz estática / exemplos por role.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMMERCIAL_MANAGER_TEAM_HIERARCHY_TODO,
  getAllowedCustomerIds,
  getAllowedResponsibleIds,
  getCommercialAccessScope,
} from "../src/lib/commercial/commercialAccessScopeService.ts";
import { normalizeSellerIdentityName } from "../src/lib/crmSellerIdentityConsolidation.ts";
import type { AppAuthContext } from "../src/lib/appAuth.ts";

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim() || null;
  }
  return null;
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mockUser(partial: Partial<AppAuthContext> & Pick<AppAuthContext, "role">): AppAuthContext {
  return {
    id: partial.id ?? "inspect-user",
    name: partial.name ?? "Inspect",
    email: partial.email ?? "inspect@local",
    role: partial.role,
    permissions: partial.permissions ?? [],
    effectivePermissions: partial.effectivePermissions ?? partial.permissions ?? [],
    accessProfileId: null,
    accessProfileName: null,
    isActive: true,
    externalSellerId: partial.externalSellerId ?? null,
    sellerResponsibleName: partial.sellerResponsibleName ?? null,
    sellerIdentityKey: partial.sellerIdentityKey ?? null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "inspect",
  };
}

function printScope(label: string, user: AppAuthContext): void {
  const scope = getCommercialAccessScope(user);
  const allowed = getAllowedResponsibleIds(user);
  console.log(`\n=== ${label} ===`);
  console.log(
    JSON.stringify(
      {
        email: user.email,
        name: user.name,
        role: user.role,
        mode: scope.mode,
        dataScope: scope.dataScope,
        sellerLinked: scope.sellerLinked,
        sellerIdentityKey: scope.sellerIdentityKey,
        externalSellerId: scope.externalSellerId,
        canViewGeneral: scope.canViewCommercialGeneral,
        commercialManagerFallback: scope.commercialManagerUsesTeamFallback,
        blockedReason: scope.blockedReason,
        blockedMessage: scope.blockedMessage,
        allowedResponsibles: allowed,
        hierarchyTodo: scope.hierarchyTodo,
      },
      null,
      2
    )
  );
}

async function liveInspect(): Promise<Record<string, unknown>> {
  if (!process.env.DATABASE_URL?.trim()) {
    return { live: false, reason: "DATABASE_URL ausente" };
  }

  const { PrismaClient, Prisma } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const days = Number.parseInt(parseArg("days") || "30", 10) || 30;
  const to = formatYmd(new Date());
  const start = new Date(`${to}T12:00:00`);
  start.setDate(start.getDate() - (days - 1));
  const from = formatYmd(start);
  const periodFrom = new Date(`${from}T00:00:00`);
  const periodTo = new Date(`${to}T23:59:59.999`);

  try {
    await prisma.$queryRaw`SELECT 1`;
    const email = parseArg("email");
    const nameHint = parseArg("name");

    let dbUser = null as Awaited<ReturnType<typeof prisma.appUser.findFirst>>;
    if (email) {
      dbUser = await prisma.appUser.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
      });
    } else if (nameHint) {
      dbUser = await prisma.appUser.findFirst({
        where: {
          OR: [
            { name: { contains: nameHint, mode: "insensitive" } },
            { sellerResponsibleName: { contains: nameHint, mode: "insensitive" } },
          ],
        },
      });
    }

    if (!dbUser) {
      return {
        live: true,
        period: { from, to },
        userFound: false,
        hint: "Passe --email= ou --name= para inspecionar um AppUser real",
      };
    }

    const auth = mockUser({
      id: dbUser.id,
      name: dbUser.name,
      email: dbUser.email,
      role: dbUser.role,
      permissions: Array.isArray(dbUser.permissions) ? (dbUser.permissions as string[]) : [],
      effectivePermissions: Array.isArray(dbUser.permissions)
        ? (dbUser.permissions as string[])
        : [],
      externalSellerId: dbUser.externalSellerId,
      sellerResponsibleName: dbUser.sellerResponsibleName,
      sellerIdentityKey: dbUser.sellerResponsibleName
        ? normalizeSellerIdentityName(dbUser.sellerResponsibleName)
        : null,
    });

    const scope = getCommercialAccessScope(auth);
    const customers = await getAllowedCustomerIds(auth);
    const periodSql = Prisma.sql`so."issueDate" >= ${periodFrom} AND so."issueDate" <= ${periodTo}`;

    let ordersAllowed = 0;
    let ordersBlockedEstimate = 0;
    let sampleCustomers: { id: string; name: string | null }[] = [];
    let sampleOrders: { orderCode: string; customerId: string; nomus: string | null }[] = [];
    let sampleDivergence: { orderCode: string; owner: string | null; nomus: string | null }[] = [];

    if (customers.unrestricted) {
      const [row] = await prisma.$queryRaw<{ c: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS c FROM "SalesOrder" so WHERE ${periodSql}`
      );
      ordersAllowed = row?.c ?? 0;
      sampleOrders = await prisma.$queryRaw`
        SELECT so."orderCode" AS "orderCode", so."customerId" AS "customerId",
          NULLIF(TRIM(COALESCE(so."nomusSellerName", '')), '') AS nomus
        FROM "SalesOrder" so
        WHERE ${periodSql}
        ORDER BY so."issueDate" DESC
        LIMIT 5
      `;
    } else if (customers.customerIds.length > 0) {
      const ids = customers.customerIds;
      const [allowed] = await prisma.$queryRaw<{ c: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS c FROM "SalesOrder" so
        WHERE ${periodSql} AND so."customerId" = ANY(${ids}::uuid[])
      `);
      const [total] = await prisma.$queryRaw<{ c: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS c FROM "SalesOrder" so WHERE ${periodSql}`
      );
      ordersAllowed = allowed?.c ?? 0;
      ordersBlockedEstimate = Math.max(0, (total?.c ?? 0) - ordersAllowed);

      sampleCustomers = await prisma.customer.findMany({
        where: { id: { in: ids.slice(0, 5) } },
        select: { id: true, companyName: true },
        take: 5,
      }).then((rows) => rows.map((r) => ({ id: r.id, name: r.companyName })));

      sampleOrders = await prisma.$queryRaw`
        SELECT so."orderCode" AS "orderCode", so."customerId" AS "customerId",
          NULLIF(TRIM(COALESCE(so."nomusSellerName", '')), '') AS nomus
        FROM "SalesOrder" so
        WHERE ${periodSql} AND so."customerId" = ANY(${ids}::uuid[])
        ORDER BY so."issueDate" DESC
        LIMIT 5
      `;

      sampleDivergence = await prisma.$queryRaw`
        SELECT so."orderCode" AS "orderCode",
          own."sellerCanonicalName" AS owner,
          NULLIF(TRIM(COALESCE(so."nomusSellerName", '')), '') AS nomus
        FROM "SalesOrder" so
        INNER JOIN "CrmCustomerCommercialOwner" own
          ON own."customerId" = so."customerId" AND own."isActive" = true
        WHERE ${periodSql}
          AND so."customerId" = ANY(${ids}::uuid[])
          AND NULLIF(TRIM(COALESCE(so."nomusSellerName", '')), '') IS NOT NULL
          AND LOWER(TRIM(own."sellerCanonicalName"))
            <> LOWER(TRIM(so."nomusSellerName"))
        LIMIT 5
      `;
    }

    return {
      live: true,
      period: { from, to },
      user: {
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role,
        externalSellerId: dbUser.externalSellerId,
        sellerResponsibleName: dbUser.sellerResponsibleName,
      },
      scope: {
        mode: scope.mode,
        dataScope: scope.dataScope,
        blockedReason: scope.blockedReason,
        commercialManagerFallback: scope.commercialManagerUsesTeamFallback,
      },
      allowedCustomerCount: customers.unrestricted ? "ALL" : customers.customerIds.length,
      ordersAllowedInPeriod: ordersAllowed,
      ordersBlockedEstimate,
      sampleCustomers,
      sampleOrders,
      sampleDivergence,
      note: "Pedidos bloqueados = universo SalesOrder no período − pedidos dos clientes permitidos (eixos diferentes por desenho).",
    };
  } catch (err) {
    return {
      live: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  console.log("Inspect CRM commercial access scope");
  console.log(COMMERCIAL_MANAGER_TEAM_HIERARCHY_TODO);

  printScope(
    "SUPER_ADMIN",
    mockUser({ role: "SUPER_ADMIN", permissions: ["crm.general.view", "crm.seller.all"] })
  );
  printScope("ADMIN (role only)", mockUser({ role: "ADMIN", permissions: [] }));
  printScope(
    "COMMERCIAL_MANAGER fallback",
    mockUser({ role: "COMMERCIAL_MANAGER", permissions: [] })
  );
  printScope(
    "SELLER linked GISLENE",
    mockUser({
      role: "SELLER",
      permissions: ["crm.seller.own"],
      sellerResponsibleName: "GISLENE LIMA",
      externalSellerId: 464,
    })
  );
  printScope("SELLER not linked", mockUser({ role: "SELLER", permissions: ["crm.seller.own"] }));
  printScope("VIEWER", mockUser({ role: "VIEWER", permissions: [] }));

  const live = await liveInspect();
  console.log("\n=== LIVE ===");
  console.log(JSON.stringify(live, null, 2));

  const outDir = join(process.cwd(), "tmp-audits");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "crm-commercial-access-scope-latest.json");
  writeFileSync(
    outPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), live }, null, 2),
    "utf8"
  );
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
