import { competencyCategoryLabel, isCompetencyCategory } from "@/src/lib/competencies/competencyDomain";
import type { DepartmentCompetencyBoard } from "@/src/lib/competencies/competencyTypes";

/** Competência com categoria ausente ou em branco. */
export const UNCATEGORIZED_MATRIX_GROUP = "uncategorized";
/** Competência do catálogo sem associação a departamento, só na visão de todos. */
export const UNASSIGNED_MATRIX_DEPARTMENT = "unassigned";

export type MatrixGroupMode = "department" | "category";

export type MatrixAssociation = {
  departmentId: string;
  departmentName: string;
  competencyId: string;
  appliesToAllShifts?: boolean;
  shifts?: readonly string[];
};

export type MatrixColumn<T> = {
  /** Grupo + competência. A mesma competência pode repetir em outro grupo. */
  columnKey: string;
  competency: T;
};

export type MatrixCompetencyGroup<T> = {
  key: string;
  label: string;
  columns: MatrixColumn<T>[];
};

/** Mesma regra de `linkAppliesToShifts`: turno vazio não restringe; todos os turnos cobre qualquer filtro. */
export function associationAppliesToShifts(link: Pick<MatrixAssociation, "appliesToAllShifts" | "shifts">, shifts: readonly string[]): boolean {
  if (shifts.length === 0) return true;
  if (link.appliesToAllShifts !== false) return true;
  const codes = link.shifts ?? [];
  return shifts.some((shift) => codes.includes(shift));
}

export function associationsFromBoard(board: DepartmentCompetencyBoard): MatrixAssociation[] {
  return board.departments.flatMap((department) =>
    department.links.map((link) => ({
      departmentId: department.id,
      departmentName: department.name,
      competencyId: link.competencyId,
      appliesToAllShifts: link.appliesToAllShifts,
      shifts: link.shifts,
    })),
  );
}

/** Restringe colunas ao departamento escolhido. Sem departamento, a lista recebida permanece inteira. */
function applicableIds(
  competencies: readonly { id: string }[],
  associations: readonly MatrixAssociation[],
  departmentId: string | null,
  shifts: readonly string[],
): Set<string> | null {
  if (!departmentId) return null;
  const allowed = new Set<string>();
  const known = new Set(competencies.map((competency) => competency.id));
  for (const link of associations) {
    if (!known.has(link.competencyId) || link.departmentId !== departmentId) continue;
    if (!associationAppliesToShifts(link, shifts)) continue;
    allowed.add(link.competencyId);
  }
  return allowed;
}

/**
 * Sanfona da matriz. Não grava categoria, departamento nem competência.
 * Departamento usa `HrDepartmentCompetency` e o turno configurado.
 * Categoria usa o texto gravado; vazio vira "Sem categoria".
 * A mesma competência pode ocupar mais de uma coluna visual, com o mesmo id.
 */
export function groupMatrixColumns<T extends { id: string; category: string }>(
  competencies: readonly T[],
  options: {
    mode: MatrixGroupMode;
    associations?: readonly MatrixAssociation[];
    departmentId?: string | null;
    shifts?: readonly string[] | null;
  },
): MatrixCompetencyGroup<T>[] {
  const associations = options.associations ?? [];
  const departmentId = options.departmentId || null;
  const shifts = (options.shifts ?? []).filter((shift) => shift.length > 0);
  const allowed = applicableIds(competencies, associations, departmentId, shifts);
  const visible = allowed ? competencies.filter((competency) => allowed.has(competency.id)) : competencies;
  if (options.mode === "category") return groupByStoredCategory(visible);
  return groupByDepartment(visible, competencies, associations, departmentId, shifts);
}

function groupByStoredCategory<T extends { id: string; category: string }>(competencies: readonly T[]): MatrixCompetencyGroup<T>[] {
  const order: string[] = [];
  const buckets = new Map<string, { label: string; competencies: T[] }>();
  for (const competency of competencies) {
    const raw = competency.category.trim();
    const key = raw ? `category:${raw}` : `category:${UNCATEGORIZED_MATRIX_GROUP}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        label: raw ? (isCompetencyCategory(raw) ? competencyCategoryLabel(raw) : raw) : "Sem categoria",
        competencies: [],
      };
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.competencies.push(competency);
  }
  return order.map((key) => ({
    key,
    label: buckets.get(key)?.label ?? key,
    columns: (buckets.get(key)?.competencies ?? []).map((competency) => ({
      columnKey: `${key}:${competency.id}`,
      competency,
    })),
  }));
}

function groupByDepartment<T extends { id: string; category: string }>(
  visible: readonly T[],
  catalog: readonly T[],
  associations: readonly MatrixAssociation[],
  departmentId: string | null,
  shifts: readonly string[],
): MatrixCompetencyGroup<T>[] {
  const byId = new Map(visible.map((competency) => [competency.id, competency]));
  const order: string[] = [];
  const buckets = new Map<string, { label: string; ids: string[] }>();
  for (const link of associations) {
    if (departmentId && link.departmentId !== departmentId) continue;
    if (!byId.has(link.competencyId) || !associationAppliesToShifts(link, shifts)) continue;
    const key = `department:${link.departmentId}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { label: link.departmentName, ids: [] };
      buckets.set(key, bucket);
      order.push(key);
    }
    if (!bucket.ids.includes(link.competencyId)) bucket.ids.push(link.competencyId);
  }
  const catalogOrder = new Map(catalog.map((competency, index) => [competency.id, index]));
  for (const bucket of buckets.values()) {
    bucket.ids.sort((a, b) => (catalogOrder.get(a) ?? 0) - (catalogOrder.get(b) ?? 0));
  }
  const placed = new Set([...buckets.values()].flatMap((bucket) => bucket.ids));
  if (!departmentId) {
    const rest = visible.filter((competency) => !placed.has(competency.id));
    if (rest.length > 0) {
      const key = `department:${UNASSIGNED_MATRIX_DEPARTMENT}`;
      order.push(key);
      buckets.set(key, { label: "Sem departamento", ids: rest.map((competency) => competency.id) });
    }
  }
  return order.flatMap((key) => {
    const bucket = buckets.get(key);
    if (!bucket || bucket.ids.length === 0) return [];
    return [{
      key,
      label: bucket.label,
      columns: bucket.ids.flatMap((id) => {
        const competency = byId.get(id);
        return competency ? [{ columnKey: `${key}:${id}`, competency }] : [];
      }),
    }];
  });
}
