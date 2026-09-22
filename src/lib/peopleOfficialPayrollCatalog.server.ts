import type { PrismaClient } from "@prisma/client";
import {
  mapPayrollComponentToHrCatalogItem,
  type OfficialPayrollHrCatalogItem,
} from "./peopleOfficialPayrollCatalog.js";

export async function listOfficialPayrollHrCatalogItems(
  prisma: PrismaClient,
  opts?: { includeValues?: boolean }
): Promise<OfficialPayrollHrCatalogItem[]> {
  const rows = await prisma.payrollComponent.findMany({
    select: { id: true, name: true, type: true, calculationType: true, value: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  return rows.map((row) =>
    mapPayrollComponentToHrCatalogItem({ ...row, value: Number(row.value) }, opts)
  );
}
