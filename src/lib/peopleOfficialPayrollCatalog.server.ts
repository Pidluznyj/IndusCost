import type { PrismaClient } from "@prisma/client";
import {
  mapPayrollComponentToHrCatalogItem,
  type OfficialPayrollHrCatalogItem,
} from "./peopleOfficialPayrollCatalog.js";

export async function listOfficialPayrollHrCatalogItems(
  prisma: PrismaClient
): Promise<OfficialPayrollHrCatalogItem[]> {
  const rows = await prisma.payrollComponent.findMany({
    select: { id: true, name: true, type: true, calculationType: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  return rows.map(mapPayrollComponentToHrCatalogItem);
}
