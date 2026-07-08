/** Rótulos de família/grupo do cadastro de matérias-primas. */

export const MATERIAL_CATEGORY_LABELS: Record<string, string> = {
  MATERIA_PRIMA: "Matéria-Prima",
  INSUMO: "Insumo",
  EMBALAGEM: "Embalagem",
};

export function formatMaterialCategoryLabel(category: string): string {
  const key = category?.trim();
  if (!key) return "—";
  return MATERIAL_CATEGORY_LABELS[key] ?? key.replace(/_/g, " ");
}
