/**
 * Projetos — códigos legíveis das linhas de estrutura para documentos (regra pura).
 * Documentos nunca exibem o id interno (UUID): usam SKU do produto, código do material ou o
 * código provisório do item simulado. Sem código conhecido → null ("—").
 */
import type { ProjectSimulatedItemRow, ProjectStructureLineRow } from "@/src/types/projects.js";

export type ProjectEntityCodes = {
  /** Product.id → SKU */
  products: Record<string, string>;
  /** Material.id → código */
  materials: Record<string, string>;
};

export function resolveStructureLineCode(
  line: Pick<ProjectStructureLineRow, "simulatedItemId" | "existingProductId" | "existingMaterialId">,
  simulatedItems: readonly Pick<ProjectSimulatedItemRow, "id" | "provisionalCode">[],
  codes?: ProjectEntityCodes | null,
): string | null {
  if (line.simulatedItemId) {
    const code = simulatedItems.find((i) => i.id === line.simulatedItemId)?.provisionalCode?.trim();
    return code || null;
  }
  if (line.existingProductId) return codes?.products[line.existingProductId]?.trim() || null;
  if (line.existingMaterialId) return codes?.materials[line.existingMaterialId]?.trim() || null;
  return null;
}

/** Ids de produtos/materiais oficiais referenciados nas linhas (para buscar os códigos). */
export function collectStructureEntityIds(lines: readonly ProjectStructureLineRow[]): {
  productIds: string[];
  materialIds: string[];
} {
  const productIds = new Set<string>();
  const materialIds = new Set<string>();
  for (const l of lines) {
    if (l.existingProductId) productIds.add(l.existingProductId);
    if (l.existingMaterialId) materialIds.add(l.existingMaterialId);
  }
  return { productIds: [...productIds], materialIds: [...materialIds] };
}

/**
 * Horas de mão de obra: soma das quantidades das linhas cuja unidade é hora (HH/H).
 * Nunca usa valores em R$ como horas.
 */
export function sumLaborHours(
  lines: readonly Pick<ProjectStructureLineRow, "unitSnapshot" | "quantity" | "countsInSimulatedProductCost">[],
): number | null {
  const hourLines = lines.filter(
    (l) => /^(HH|H|HR|HORA|HORAS)$/i.test(l.unitSnapshot?.trim() ?? "") && l.countsInSimulatedProductCost !== false,
  );
  if (hourLines.length === 0) return null;
  return hourLines.reduce((acc, l) => acc + (Number.isFinite(l.quantity) ? l.quantity : 0), 0);
}

/**
 * Observação digitada pelo usuário, sem os marcadores técnicos que o sistema guarda no mesmo
 * campo (guided-origin, guided-simulation-id, group/batch, __USER_NOTES__= …). Documentos
 * nunca imprimem esses marcadores (contêm ids internos).
 */
export function documentUserNotes(notes: string | null | undefined): string | null {
  if (!notes?.trim()) return null;
  const lines = notes.split("\n");
  const userNotes = lines.find((l) => l.startsWith("__USER_NOTES__="));
  if (userNotes) return userNotes.slice("__USER_NOTES__=".length).trim() || null;
  const kept = lines
    .map((l) => l.trim())
    .filter((l) => l && !/^guided-[\w-]+(:|$)/.test(l) && !/^__[A-Z_]+__=/.test(l) && !/^(group|batch):/.test(l));
  return kept.length ? kept.join("\n") : null;
}
