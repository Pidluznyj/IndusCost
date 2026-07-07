#!/usr/bin/env npx tsx
/**
 * Auditoria de resolução de vendedor Nomus em pedidos.
 * Uso: npx tsx scripts/audit-nomus-order-seller-resolution.ts
 */
import { prisma } from "../src/lib/prisma.js";
import { countNomusOrderSellerResolutions } from "../src/lib/commissions/commissionNomusOrderSellerResolver.js";
import { loadCommissionSellerIdentityContext } from "../src/lib/commissions/commissionSellerIdentity.server.js";

async function main() {
  const [orders, identityCtx] = await Promise.all([
    prisma.salesOrder.findMany({
      select: {
        id: true,
        orderCode: true,
        externalSellerId: true,
        issueDate: true,
        responsible: true,
      },
    }),
    loadCommissionSellerIdentityContext(prisma),
  ]);

  const counts = countNomusOrderSellerResolutions(
    orders.map((order) => ({
      externalSellerId: order.externalSellerId,
      issueDate: order.issueDate,
      legacyResponsible: order.responsible,
    })),
    identityCtx
  );

  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
