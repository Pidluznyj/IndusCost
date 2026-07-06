import { prisma } from "@/src/lib/prisma.js";
import {
  normalizeClientProposalQuantityPerSet,
  type ProjectClientProposalQuantityRow,
} from "./projectsClientReport.js";

export async function loadProjectClientProposalQuantities(
  projectId: string
): Promise<Map<string, number>> {
  const rows = await prisma.projectClientProposalItem.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
  const map = new Map<string, number>();
  for (const row of rows) {
    const quantity = normalizeClientProposalQuantityPerSet(row.quantityPerSet);
    if (quantity != null) {
      map.set(row.targetItemId, quantity);
    }
  }
  return map;
}

export async function upsertProjectClientProposalQuantities(
  projectId: string,
  items: ProjectClientProposalQuantityRow[]
): Promise<Map<string, number>> {
  const normalized: ProjectClientProposalQuantityRow[] = [];
  for (const item of items) {
    const quantityPerSet = normalizeClientProposalQuantityPerSet(item.quantityPerSet);
    if (quantityPerSet == null) {
      throw new Error(`Quantidade inválida para o item ${item.targetItemId}.`);
    }
    normalized.push({
      targetItemId: item.targetItemId,
      quantityPerSet,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectClientProposalItem.deleteMany({ where: { projectId } });
    for (const item of normalized) {
      await tx.projectClientProposalItem.create({
        data: {
          projectId,
          targetItemId: item.targetItemId,
          quantityPerSet: item.quantityPerSet,
        },
      });
    }
  });

  return loadProjectClientProposalQuantities(projectId);
}
