/**
 * Backfill seguro: Responsável Comercial a partir do Vendedor do Pedido (mais recente).
 *
 * Uso:
 *   npx tsx scripts/backfillCrmCommercialOwnerFromSalesOrderSeller.ts preview
 *   npx tsx scripts/backfillCrmCommercialOwnerFromSalesOrderSeller.ts apply
 */
import { PrismaClient } from "@prisma/client";
import {
  applyCommercialOwnerAutoAssignFromOrders,
  previewCommercialOwnerAutoAssignFromOrders,
} from "../src/lib/commercial/crmCommercialOwnerAutoAssign.ts";

const prisma = new PrismaClient();

async function main() {
  const mode = (process.argv[2] ?? "preview").toLowerCase();
  if (mode !== "preview" && mode !== "apply") {
    console.error("Uso: preview | apply");
    process.exitCode = 1;
    return;
  }

  const suggestions = await previewCommercialOwnerAutoAssignFromOrders(prisma);
  const unmapped = suggestions.filter(
    (s) => s.alert === "CUSTOMER_OWNER_AUTO_ASSIGN_SELLER_NOT_MAPPED"
  );
  const multi = suggestions.filter(
    (s) => s.alert === "MULTIPLE_ORDER_SELLERS_FOR_CUSTOMER"
  );
  const assignable = suggestions.filter(
    (s) => s.sellerName && s.alert !== "CUSTOMER_OWNER_AUTO_ASSIGN_SELLER_NOT_MAPPED"
  );

  console.log("=== Backfill CRM Commercial Owner from SalesOrder seller ===");
  console.log({
    mode,
    totalWithoutOwnerWithSellerSuggestion: suggestions.length,
    assignable: assignable.length,
    unmappedOrForbidden: unmapped.length,
    multipleSellersAlert: multi.length,
  });

  console.log("\nAmostra (até 25):");
  for (const row of suggestions.slice(0, 25)) {
    console.log({
      customer: row.customerName,
      order: row.orderCode,
      seller: row.sellerName || "(não mapeado)",
      distinctSellers: row.distinctSellerCount,
      alert: row.alert ?? null,
    });
  }

  if (mode === "preview") {
    console.log("\nPreview — nenhum dado alterado.");
    return;
  }

  const result = await applyCommercialOwnerAutoAssignFromOrders(prisma, {
    performedBy: "system/backfill-sales-order-seller",
  });
  console.log("\nApply resumo:", result);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
