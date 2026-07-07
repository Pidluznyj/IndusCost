#!/usr/bin/env npx tsx
/**
 * Auditoria: pedidos sem vendedor oficial informado no Nomus.
 *
 * Uso:
 *   npx tsx scripts/audit-sales-orders-missing-nomus-seller.ts
 *   npx tsx scripts/audit-sales-orders-missing-nomus-seller.ts --order=02498
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  formatSalesOrderNomusSellerStatusLabel,
  isNomusSellerInformed,
  resolveSalesOrderNomusSellerStatus,
} from "../src/lib/salesOrderNomusSeller.ts";

const prisma = new PrismaClient();

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim() || null;
  }
  return null;
}

async function main(): Promise<void> {
  const orderFilter = parseArg("order");

  const orders = await prisma.salesOrder.findMany({
    where: orderFilter
      ? {
          OR: [
            { orderCode: { contains: orderFilter, mode: "insensitive" } },
            { externalSalesOrderCode: { contains: orderFilter, mode: "insensitive" } },
          ],
        }
      : undefined,
    select: {
      id: true,
      orderCode: true,
      externalSellerId: true,
      nomusSellerName: true,
      responsible: true,
      Customer: {
        select: {
          tradeName: true,
          companyName: true,
          CrmCustomerCommercialOwner: {
            select: {
              sellerCanonicalName: true,
              sellerResponsibleName: true,
              isActive: true,
            },
          },
        },
      },
    },
    orderBy: [{ issueDate: "desc" }],
    take: orderFilter ? 20 : 5000,
  });

  const missing = orders.filter(
    (order) =>
      !isNomusSellerInformed({
        externalSellerId: order.externalSellerId,
        nomusSellerName: order.nomusSellerName,
      })
  );

  const payload = {
    scanned: orders.length,
    missingNomusSellerCount: missing.length,
    rows: missing.map((order) => ({
      orderCode: order.orderCode,
      customer:
        order.Customer.tradeName?.trim() || order.Customer.companyName?.trim() || "—",
      crmCommercialResponsible:
        order.Customer.CrmCustomerCommercialOwner?.isActive === false
          ? null
          : order.Customer.CrmCustomerCommercialOwner?.sellerCanonicalName ??
            order.Customer.CrmCustomerCommercialOwner?.sellerResponsibleName ??
            null,
      nomusSellerId: order.externalSellerId,
      nomusSellerName: order.nomusSellerName,
      legacyResponsible: order.responsible,
      status: formatSalesOrderNomusSellerStatusLabel(
        resolveSalesOrderNomusSellerStatus({
          externalSellerId: order.externalSellerId,
          nomusSellerName: order.nomusSellerName,
        })
      ),
    })),
  };

  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
