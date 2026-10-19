/**
 * Escopo do módulo. Deny é decidido antes, no guard da rota.
 * Líder escreve só na equipe. A própria avaliação gerencial não entra por esse caminho.
 */
export type PerformanceAccessScope = "ALL" | "DIRECT_REPORTS" | "DESCENDANTS" | "SELF" | "NONE";

export type PerformanceScope =
  | { kind: "ALL"; actorEmployeeId?: string | null }
  | {
      kind: "LIMITED";
      actorEmployeeId: string | null;
      visible: ReadonlySet<string>;
      writable: ReadonlySet<string>;
    };

export function buildPerformanceScope(input: {
  accessScope: PerformanceAccessScope;
  actorEmployeeId: string | null;
  teamIds?: readonly string[];
}): PerformanceScope {
  if (input.accessScope === "ALL") return { kind: "ALL", actorEmployeeId: input.actorEmployeeId };
  const actor = input.actorEmployeeId;
  const team = new Set((input.teamIds ?? []).filter((id) => id && id !== actor));
  const hasTeam = input.accessScope === "DIRECT_REPORTS" || input.accessScope === "DESCENDANTS";
  const visible = new Set<string>();
  if (actor && input.accessScope !== "NONE") visible.add(actor);
  if (actor && hasTeam) for (const id of team) visible.add(id);
  return {
    kind: "LIMITED",
    actorEmployeeId: actor,
    visible,
    writable: actor && hasTeam ? team : new Set<string>(),
  };
}

export function canSeeEmployee(scope: PerformanceScope, employeeId: string): boolean {
  return scope.kind === "ALL" || scope.visible.has(employeeId);
}

export function canEvaluateEmployee(scope: PerformanceScope, employeeId: string): boolean {
  if (scope.kind === "ALL") return true;
  return scope.writable.has(employeeId);
}

/** A fila do líder não devolve a própria ficha gerencial. */
export function leaderQueueIncludes(scope: PerformanceScope, subjectEmployeeId: string, actorEmployeeId: string | null): boolean {
  if (actorEmployeeId && subjectEmployeeId === actorEmployeeId) return false;
  return canEvaluateEmployee(scope, subjectEmployeeId);
}
