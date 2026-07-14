/**
 * QA: Vendedor do Pedido na Auditoria 360º usa resolução canônica (como Comissões).
 *
 * Uso:
 *   npx tsx scripts/qaOrderFullAuditSellerResolution.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CommissionSellerIdentityContext } from "../src/lib/commissions/commissionSellerIdentity.ts";
import {
  ORDER_SELLER_NOT_INFORMED_LABEL,
  ORDER_SELLER_UNMAPPED_LABEL,
  isSellerIdOnlyLabel,
  resolveCommercialResponsibleDisplay,
  resolveOrderSellerIdentity,
} from "../src/lib/commercial/orderSellerIdentityResolver.ts";
import { resolveOrderFullAuditSellerDisplay } from "../src/lib/finance/orderFullAuditSellerDisplay.ts";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function ctx(): CommissionSellerIdentityContext {
  return {
    persons: [
      {
        id: "person-rodrigo",
        nomusPersonId: 646,
        name: "Rodrigo Da Silva Ramos",
        type: "SELLER",
        source: "NOMUS",
        active: true,
        linkedRecordCount: 10,
      },
    ],
    aliases: [
      {
        id: "a1399",
        commissionedPersonId: "person-rodrigo",
        source: "NOMUS_ORDER",
        rawSellerId: 1399,
        rawSellerName: "RODRIGO",
        normalizedSellerName: "rodrigo",
        status: "ACTIVE",
        confidence: 1,
      },
    ],
  };
}

function runPure(): void {
  console.log("== QA puro ==");

  const pd02523 = resolveOrderSellerIdentity(
    {
      salesOrder: {
        externalSellerId: 1399,
        nomusSellerName: null,
        issueDate: "2026-03-15",
      },
    },
    ctx()
  );
  assert.equal(pd02523.displayName, "Rodrigo Da Silva Ramos");
  assert.equal(pd02523.rawExternalId, 1399);
  assert.notEqual(pd02523.displayName, ORDER_SELLER_NOT_INFORMED_LABEL);
  assert.equal(isSellerIdOnlyLabel(pd02523.displayName), false);
  assert.ok(!pd02523.alertCodes.includes("SELLER_NOT_INFORMED"));

  const display = resolveOrderFullAuditSellerDisplay(
    { externalSellerId: 1399, nomusSellerName: null, issueDate: "2026-03-15" },
    ctx()
  );
  assert.equal(display.orderSellerName, "Rodrigo Da Silva Ramos");
  assert.equal(display.orderSellerExternalId, 1399);

  const fromSnap = resolveOrderSellerIdentity(
    {
      salesOrder: { externalSellerId: null, nomusSellerName: null },
      commissionSnapshot: {
        rawSellerId: 1399,
        canonicalSellerName: "Rodrigo Da Silva Ramos",
        canonicalSellerId: "person-rodrigo",
      },
    },
    { persons: [], aliases: [] }
  );
  assert.equal(fromSnap.displayName, "Rodrigo Da Silva Ramos");
  assert.ok(
    fromSnap.alertCodes.includes(
      "SELLER_MISSING_IN_SALES_ORDER_BUT_PRESENT_IN_SNAPSHOT"
    )
  );

  const unmapped = resolveOrderSellerIdentity(
    { salesOrder: { externalSellerId: 9999, nomusSellerName: null } },
    { persons: [], aliases: [] }
  );
  assert.equal(unmapped.displayName, ORDER_SELLER_UNMAPPED_LABEL);
  assert.ok(unmapped.alertCodes.includes("SELLER_ALIAS_NOT_MAPPED"));

  const none = resolveOrderSellerIdentity(
    { salesOrder: { externalSellerId: null, nomusSellerName: null } },
    ctx()
  );
  assert.equal(none.displayName, ORDER_SELLER_NOT_INFORMED_LABEL);

  const crm = resolveCommercialResponsibleDisplay({
    canonicalName: "Vendedor ID 1399",
  });
  assert.equal(crm.source, "NONE");

  const service = read("src/lib/finance/orderFullAuditService.ts");
  assert.match(service, /resolveOrderSellerIdentity/);
  assert.match(service, /loadCommissionSellerIdentityContext/);
  assert.doesNotMatch(
    service,
    /orderSellerName:\s*order\?\.nomusSellerName\s*\?\?\s*null/
  );

  const dialog = read(
    "src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx"
  );
  assert.equal(/from ["']@prisma\/client["']/.test(dialog), false);

  // UI executiva: label "Vendedor ID" não deve ser padrão no CrmModule resumido
  const crmModule = read("src/components/CrmModule.tsx");
  assert.doesNotMatch(crmModule, /`Vendedor ID \$\{/);

  console.log("OK puro — PD 02523 padrão + alertas corretos + CRM ID-only rejeitado.");
}

async function runDb(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL ausente — QA live SKIP.");
    return;
  }
  const { PrismaClient } = await import("@prisma/client");
  const { expandNomusOrderCodeLookupVariants } = await import(
    "../src/lib/salesOrderNomusSync.server.ts"
  );
  const { loadCommissionSellerIdentityContext } = await import(
    "../src/lib/commissions/commissionSellerIdentity.server.ts"
  );
  const prisma = new PrismaClient();
  try {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      console.log(
        "DB indisponível — QA live SKIP:",
        err instanceof Error ? err.message.split("\n")[0] : String(err)
      );
      return;
    }
    const variants = expandNomusOrderCodeLookupVariants("PD 02523");
    const order = await prisma.salesOrder.findFirst({
      where: { orderCode: { in: variants } },
      select: {
        id: true,
        externalSellerId: true,
        nomusSellerName: true,
        issueDate: true,
        nomusRawResponse: true,
      },
    });
    if (!order) {
      console.log("SKIP live — PD 02523 não encontrado");
      return;
    }
    const snap = await prisma.commissionOrderSnapshot.findFirst({
      where: { salesOrderId: order.id, status: "ACTIVE" },
      select: {
        rawSellerId: true,
        rawSellerName: true,
        canonicalSellerId: true,
        canonicalSellerName: true,
      },
    });
    const identityCtx = await loadCommissionSellerIdentityContext(prisma);
    const resolved = resolveOrderSellerIdentity(
      { salesOrder: order, commissionSnapshot: snap },
      identityCtx
    );
    console.log({
      externalSellerId: order.externalSellerId,
      displayName: resolved.displayName,
      canonical: resolved.canonicalName,
      snapSeller: snap?.canonicalSellerName ?? null,
      alerts: resolved.alertCodes,
    });
    assert.equal(resolved.rawExternalId, 1399);
    assert.match((resolved.displayName || "").toLowerCase(), /rodrigo/);
    assert.equal(isSellerIdOnlyLabel(resolved.displayName), false);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  runPure();
  await runDb();
  console.log("\nqaOrderFullAuditSellerResolution: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
