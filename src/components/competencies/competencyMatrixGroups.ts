import { competencyCategoryLabel, isCompetencyCategory } from "@/src/lib/competencies/competencyDomain";

/** Competências cujo `category` não é um valor oficial do catálogo. */
export const UNCATEGORIZED_MATRIX_GROUP = "uncategorized";

export type MatrixCompetencyGroup<T> = {
  key: string;
  label: string;
  competencies: T[];
};

export function matrixCategoryKey(category: string): string {
  return isCompetencyCategory(category) ? category : UNCATEGORIZED_MATRIX_GROUP;
}

/**
 * Agrupa as colunas da matriz pela categoria oficial de `HrCompetency`.
 * A ordem dos grupos é a primeira aparição na lista já ordenada do catálogo.
 * Dentro do grupo, a ordem das competências é a mesma lista.
 * Categorias fora do vocabulário oficial ficam juntas em "Sem categoria".
 * Grupo sem competências não é emitido.
 */
export function groupMatrixCompetencies<T extends { category: string }>(
  competencies: readonly T[],
): MatrixCompetencyGroup<T>[] {
  const order: string[] = [];
  const buckets = new Map<string, T[]>();
  for (const competency of competencies) {
    const key = matrixCategoryKey(competency.category);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.push(competency);
  }
  return order.map((key) => ({
    key,
    label: key === UNCATEGORIZED_MATRIX_GROUP ? "Sem categoria" : competencyCategoryLabel(key),
    competencies: buckets.get(key) ?? [],
  }));
}
