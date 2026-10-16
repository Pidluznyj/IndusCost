/**
 * Competências e Desenvolvimento — escopo hierárquico (puro).
 *
 * Política oficial (líderes):
 * - O acesso ao módulo (permissão `admin.employees.competencies…`) é separado do escopo de
 *   colaboradores visíveis. Ter o menu não dá acesso a ninguém por si só.
 * - ALL (perfil administrativo de RH, `resolvePeopleAccessScope` = ALL): todos os colaboradores.
 * - DIRECT_REPORTS: somente os liderados diretos (`Employee.managerId` = ator).
 * - DESCENDANTS: somente a árvore oficial abaixo do ator (resolvida no servidor).
 * - O próprio ator NUNCA entra no conjunto visível: o líder não vê a própria matriz nem as
 *   próprias avaliações, nem pares, superiores ou outras equipes.
 * - SELF e NONE (ou usuário sem colaborador vinculado): nenhum dado individual.
 *
 * O ator só aparece como referência de avaliador (nome), nunca com dados de competência.
 */
import type { PeopleAccessScope } from "../peopleProfileTypes";

export type CompetencyScopeView = "ALL" | "TEAM" | "SELF" | "NONE";

export type CompetencyScope =
  | { kind: "ALL" }
  | {
      kind: "LIMITED";
      accessScope: PeopleAccessScope;
      actorEmployeeId: string | null;
      /** Colaboradores cujos dados individuais podem ser lidos (nunca inclui o ator). */
      visible: ReadonlySet<string>;
      /** Colaboradores que podem ser avaliados/alterados (igual a `visible` para líderes). */
      writable: ReadonlySet<string>;
    };

export const COMPETENCY_SCOPE_ALL: CompetencyScope = { kind: "ALL" };

const TEAM_SCOPES: readonly PeopleAccessScope[] = ["DIRECT_REPORTS", "DESCENDANTS"];

export function isTeamAccessScope(accessScope: PeopleAccessScope): boolean {
  return TEAM_SCOPES.includes(accessScope);
}

export function buildCompetencyScope(input: {
  accessScope: PeopleAccessScope;
  actorEmployeeId: string | null;
  /** Liderados diretos (DIRECT_REPORTS) ou toda a árvore (DESCENDANTS), resolvidos no servidor. */
  teamIds?: readonly string[];
}): CompetencyScope {
  if (input.accessScope === "ALL") return COMPETENCY_SCOPE_ALL;
  const actor = input.actorEmployeeId;
  // SELF / NONE / sem colaborador vinculado: nenhum dado individual.
  const team =
    actor && isTeamAccessScope(input.accessScope)
      ? new Set((input.teamIds ?? []).filter((id) => Boolean(id) && id !== actor))
      : new Set<string>();
  return {
    kind: "LIMITED",
    accessScope: input.accessScope,
    actorEmployeeId: actor,
    visible: team,
    writable: team,
  };
}

export function canSeeEmployee(scope: CompetencyScope, employeeId: string): boolean {
  return scope.kind === "ALL" || scope.visible.has(employeeId);
}

export function canWriteEmployee(scope: CompetencyScope, employeeId: string): boolean {
  return scope.kind === "ALL" || scope.writable.has(employeeId);
}

/**
 * Avaliador aceito numa avaliação: alguém do escopo ou o próprio líder (só como referência
 * de quem avaliou; isso não dá acesso aos dados de competência dele).
 */
export function canUseAsEvaluator(scope: CompetencyScope, employeeId: string): boolean {
  if (scope.kind === "ALL") return true;
  if (scope.visible.has(employeeId)) return true;
  return Boolean(scope.actorEmployeeId && employeeId === scope.actorEmployeeId && isTeamAccessScope(scope.accessScope));
}

/** Ids da lista fora do escopo de escrita (vazio = tudo permitido). */
export function outOfWriteScope(scope: CompetencyScope, employeeIds: readonly string[]): string[] {
  return scope.kind === "ALL" ? [] : employeeIds.filter((id) => !scope.writable.has(id));
}

/**
 * Conjunto autorizado para relatórios/exportações gerados no servidor (ex.: futuro PDF):
 * "ALL" ou os ids visíveis. A exportação deve partir só destes registros, nunca de ids enviados
 * pelo cliente sem passar por aqui.
 */
export function authorizedEmployeeIds(scope: CompetencyScope): "ALL" | ReadonlySet<string> {
  return scope.kind === "ALL" ? "ALL" : scope.visible;
}

/** Filtra ids pedidos pelo cliente ao conjunto autorizado (nunca amplia). */
export function restrictToScope(scope: CompetencyScope, requestedIds: readonly string[]): string[] {
  return requestedIds.filter((id) => canSeeEmployee(scope, id));
}

export function competencyScopeView(scope: CompetencyScope): CompetencyScopeView {
  if (scope.kind === "ALL") return "ALL";
  if (scope.actorEmployeeId && isTeamAccessScope(scope.accessScope)) return "TEAM";
  if (scope.accessScope === "SELF" && scope.actorEmployeeId) return "SELF";
  return "NONE";
}

/** Chaves usadas pela resolução do escopo de Competências (mesmas do RH, sem `employees.view`). */
export const COMPETENCY_SCOPE_PERMISSIONS = {
  /** Autorização administrativa efetiva de RH: editor do cadastro (inclui SUPER_ADMIN). */
  global: "employees.edit",
  teamDescendants: "employees.team.descendants.view",
  teamDirect: "employees.team.view",
  self: "employees.profile.view",
} as const;

/**
 * Escopo de Competências a partir das permissões efetivas do usuário.
 *
 * Diferente de `resolvePeopleAccessScope` (política global de RH, inalterada): aqui
 * `employees.view` NÃO dá acesso global. Essa chave chega a líderes por caminhos que não são
 * autorização administrativa: Organograma (`admin.employees.org_chart:view`) e o editor legado,
 * que a adiciona como "pai" de "Ver equipe direta". ALL exige o editor de RH (`employees.edit`,
 * que o SUPER_ADMIN e quem executa o cadastro de Colaboradores têm).
 */
export function resolveCompetencyAccessScope(check: { hasPermission: (permission: string) => boolean }): PeopleAccessScope {
  if (check.hasPermission(COMPETENCY_SCOPE_PERMISSIONS.global)) return "ALL";
  if (check.hasPermission(COMPETENCY_SCOPE_PERMISSIONS.teamDescendants)) return "DESCENDANTS";
  if (check.hasPermission(COMPETENCY_SCOPE_PERMISSIONS.teamDirect)) return "DIRECT_REPORTS";
  if (check.hasPermission(COMPETENCY_SCOPE_PERMISSIONS.self)) return "SELF";
  return "NONE";
}
