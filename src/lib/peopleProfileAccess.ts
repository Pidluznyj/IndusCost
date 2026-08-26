/**
 * Escopo hierárquico e detecção de ciclo (grafo em memória).
 * Backend valida com CTE; estas funções são a fonte de verdade testável.
 */

import type { PeopleAccessScope } from "./peopleProfileTypes.js";

export type ManagerLink = {
  id: string;
  managerId: string | null;
};

export function wouldCreateSelfManager(employeeId: string, managerId: string | null): boolean {
  return Boolean(managerId) && managerId === employeeId;
}

/**
 * Detecta ciclo se `employeeId` passar a reportar a `managerId`.
 * Percorre a cadeia do gestor proposto até a raiz.
 */
export function wouldCreateManagerCycle(
  links: readonly ManagerLink[],
  employeeId: string,
  managerId: string | null
): boolean {
  if (!managerId) return false;
  if (wouldCreateSelfManager(employeeId, managerId)) return true;
  const byId = new Map(links.map((row) => [row.id, row.managerId ?? null]));
  if (!byId.has(managerId) && !links.some((l) => l.id === managerId)) {
    // gestor fora do grafo conhecido: ciclo só se auto-referência (já tratada)
    byId.set(managerId, null);
  }
  const seen = new Set<string>();
  let cursor: string | null = managerId;
  let depth = 0;
  while (cursor && depth < 500) {
    if (cursor === employeeId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor) ?? null;
    depth += 1;
  }
  return false;
}

export function collectDirectReportIds(
  links: readonly ManagerLink[],
  managerEmployeeId: string
): string[] {
  return links.filter((row) => row.managerId === managerEmployeeId).map((row) => row.id);
}

/** Descendentes (filhos, netos, …) — BFS, sem N+1. */
export function collectDescendantIds(
  links: readonly ManagerLink[],
  rootEmployeeId: string
): string[] {
  const children = new Map<string, string[]>();
  for (const row of links) {
    if (!row.managerId) continue;
    const list = children.get(row.managerId) ?? [];
    list.push(row.id);
    children.set(row.managerId, list);
  }
  const out: string[] = [];
  const queue = [...(children.get(rootEmployeeId) ?? [])];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id) || id === rootEmployeeId) continue;
    seen.add(id);
    out.push(id);
    const next = children.get(id);
    if (next) queue.push(...next);
  }
  return out;
}

export function isEmployeeInScope(input: {
  scope: PeopleAccessScope;
  actorEmployeeId: string | null;
  targetEmployeeId: string;
  targetManagerId: string | null;
  descendantIds?: ReadonlySet<string>;
}): boolean {
  if (input.scope === "ALL") return true;
  if (input.scope === "NONE") return false;
  const actor = input.actorEmployeeId;
  if (!actor) return false;
  if (input.scope === "SELF") return actor === input.targetEmployeeId;
  if (actor === input.targetEmployeeId) return true;
  if (input.scope === "DIRECT_REPORTS") return input.targetManagerId === actor;
  if (input.scope === "DESCENDANTS") {
    if (input.targetManagerId === actor) return true;
    return input.descendantIds?.has(input.targetEmployeeId) === true;
  }
  return false;
}

export function canAccessEmployeeRecord(input: {
  scope: PeopleAccessScope;
  actorEmployeeId: string | null;
  targetEmployeeId: string;
  targetManagerId: string | null;
  descendantIds?: ReadonlySet<string>;
}): boolean {
  return isEmployeeInScope(input);
}
