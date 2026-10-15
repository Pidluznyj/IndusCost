/**
 * Competências e Desenvolvimento — escopo hierárquico (puro).
 *
 * Mesma régua do RH (`resolvePeopleAccessScope`): RH / SUPER_ADMIN = ALL; líder com
 * `employees.team.view` = liderados diretos; com `employees.team.descendants.view` = toda a árvore.
 *
 * - Leitura (`visible`): o próprio líder + liderados do escopo.
 * - Escrita (`writable`): só os liderados — ninguém avalia nem altera o próprio nível sem ser RH.
 * - Sem colaborador vinculado ao usuário (ou escopo NONE): nada visível nem gravável.
 */
import type { PeopleAccessScope } from "../peopleProfileTypes";

export type CompetencyScopeView = "ALL" | "TEAM" | "SELF" | "NONE";

export type CompetencyScope =
  | { kind: "ALL" }
  | {
      kind: "LIMITED";
      accessScope: PeopleAccessScope;
      actorEmployeeId: string | null;
      visible: ReadonlySet<string>;
      writable: ReadonlySet<string>;
    };

export const COMPETENCY_SCOPE_ALL: CompetencyScope = { kind: "ALL" };

export function buildCompetencyScope(input: {
  accessScope: PeopleAccessScope;
  actorEmployeeId: string | null;
  /** Liderados diretos (DIRECT_REPORTS) ou toda a árvore (DESCENDANTS). */
  teamIds?: readonly string[];
}): CompetencyScope {
  if (input.accessScope === "ALL") return COMPETENCY_SCOPE_ALL;
  const actor = input.actorEmployeeId;
  const team = new Set((input.teamIds ?? []).filter((id) => id && id !== actor));
  const hasTeam = input.accessScope === "DIRECT_REPORTS" || input.accessScope === "DESCENDANTS";
  const visible = new Set<string>();
  if (actor && input.accessScope !== "NONE") visible.add(actor);
  if (actor && hasTeam) for (const id of team) visible.add(id);
  return {
    kind: "LIMITED",
    accessScope: input.accessScope,
    actorEmployeeId: actor,
    visible,
    writable: actor && hasTeam ? team : new Set<string>(),
  };
}

export function canSeeEmployee(scope: CompetencyScope, employeeId: string): boolean {
  return scope.kind === "ALL" || scope.visible.has(employeeId);
}

export function canWriteEmployee(scope: CompetencyScope, employeeId: string): boolean {
  return scope.kind === "ALL" || scope.writable.has(employeeId);
}

/** Ids da lista fora do escopo de escrita (vazio = tudo permitido). */
export function outOfWriteScope(scope: CompetencyScope, employeeIds: readonly string[]): string[] {
  return scope.kind === "ALL" ? [] : employeeIds.filter((id) => !scope.writable.has(id));
}

export function competencyScopeView(scope: CompetencyScope): CompetencyScopeView {
  if (scope.kind === "ALL") return "ALL";
  if (scope.writable.size > 0 || scope.accessScope === "DIRECT_REPORTS" || scope.accessScope === "DESCENDANTS") {
    return scope.actorEmployeeId ? "TEAM" : "NONE";
  }
  return scope.visible.size > 0 ? "SELF" : "NONE";
}
