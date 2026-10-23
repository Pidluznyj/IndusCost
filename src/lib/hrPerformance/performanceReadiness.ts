/**
 * Prontidão do ciclo antes da abertura: garante que cada perfil terá todas as avaliações que lhe cabem
 * (docs/avaliacao-desempenho/DOSSIE_AVALIACOES_POR_PERFIL.md). Cada item diz o que falta e qual ação
 * resolve com um clique. "BLOCK" impede abrir; "WARN" só avisa.
 *
 * - L1  ciclo oficial sem modelo de liderança: ninguém avaliaria o próprio líder (BLOCK).
 * - L2  liderado no ciclo cujo líder ficou fora: a equipe não avaliaria o líder e ele não seria avaliado (BLOCK).
 * - L3  avaliador sem conta ativa ligada ao colaborador (AppUser.employeeId): a avaliação dele nunca
 *       seria respondida (BLOCK). Com a identidade dos avaliadores (evaluatorIdentity), o motivo é
 *       separado: sem conta, conta da mesma Pessoa sem vínculo (regularizar), conta inativa, conflito.
 * - L4  topo da estrutura sem avaliador: só calibração por exceção (WARN, com ação para definir).
 * - L11 líder atual há menos que a observação mínima: avaliação de quem mal se conhece (WARN).
 * - líder no ciclo, mas não elegível: a equipe não o avalia neste ciclo (WARN).
 */
import { eligibleParticipants, liveParticipants } from "./performanceService.js";
import type { CycleRecord, ParticipantRecord, PerformanceDatabase } from "./performanceState.js";
import type { EvaluatorIdentity, EvaluatorIdentityStatus } from "./evaluatorIdentity.js";

export type ReadinessAction =
  | "SET_LEADERSHIP_MODEL"
  | "INCLUDE_LEADERS"
  | "LINK_USERS"
  | "REGULARIZE_ACCOUNT"
  | "REVIEW_ACCOUNT"
  | "REVIEW_IDENTITY"
  | "SET_EVALUATOR"
  | "REVIEW_LEADER";
export type ReadinessPerson = { participantId: string | null; employeeId: string; name: string; detail?: string | null; personId?: string | null };
export type ReadinessIssue = {
  code:
    | "LEADERSHIP_MODEL_REQUIRED"
    | "LEADER_OUTSIDE_CYCLE"
    | "EVALUATOR_WITHOUT_USER"
    | "EVALUATOR_ACCOUNT_NOT_LINKED"
    | "EVALUATOR_ACCOUNT_INACTIVE"
    | "EVALUATOR_IDENTITY_CONFLICT"
    | "TOP_WITHOUT_EVALUATOR"
    | "RECENT_LEADER_CHANGE"
    | "LEADER_NOT_ELIGIBLE";
  severity: "BLOCK" | "WARN";
  title: string;
  message: string;
  action: ReadinessAction;
  people: ReadinessPerson[];
};

/** Dados de fora do módulo (cadastro e usuários), lidos pela rota. */
export type ReadinessContext = {
  /** Colaboradores com conta ativa ligada (AppUser.employeeId) — a mesma identidade que "Minha equipe" usa. */
  linkedEmployeeIds: ReadonlySet<string>;
  /** Por que cada avaliador não está apto (somente leitura). Sem ele, tudo vira EVALUATOR_WITHOUT_USER. */
  evaluatorIdentity?: ReadonlyMap<string, EvaluatorIdentity>;
  /** Desde quando cada pessoa está com o líder atual (último registro de troca de gestor no cadastro). */
  leaderSince: ReadonlyMap<string, { since: string; managerId: string | null; previousManagerName: string | null }>;
  /** Nome de quem não é participante (líder fora do ciclo). */
  names: ReadonlyMap<string, string>;
};

const DAY = 86_400_000;

export function readinessEvaluatorIds(db: PerformanceDatabase, cycleId: string): string[] {
  const ids = new Set<string>();
  for (const p of eligibleParticipants(db, cycleId)) if (p.managerId && p.managerId !== p.employeeId) ids.add(p.managerId);
  return [...ids];
}

export function cycleReadiness(db: PerformanceDatabase, cycle: CycleRecord, ctx: ReadinessContext, now: Date): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const live = liveParticipants(db, cycle.id);
  const byEmployee = new Map<string, ParticipantRecord>(live.map((p) => [p.employeeId, p]));
  const eligible = eligibleParticipants(db, cycle.id);
  const person = (p: ParticipantRecord, detail: string | null = null): ReadinessPerson => ({ participantId: p.id, employeeId: p.employeeId, name: p.employeeName, detail });

  if (!cycle.leadershipModelId) {
    issues.push({
      code: "LEADERSHIP_MODEL_REQUIRED",
      severity: cycle.classification === "OFFICIAL" ? "BLOCK" : "WARN",
      title: "Avaliação de liderança (180°) não escolhida",
      message: "Sem o modelo de liderança, ninguém avalia o próprio líder e os líderes não se autoavaliam como líderes. Escolha o modelo no ciclo.",
      action: "SET_LEADERSHIP_MODEL",
      people: [],
    });
  }

  // Líderes de quem está no ciclo, mas que ficaram fora dele.
  const outside = new Map<string, ParticipantRecord[]>();
  for (const p of eligible) {
    if (!p.managerId || p.managerId === p.employeeId || byEmployee.has(p.managerId)) continue;
    outside.set(p.managerId, [...(outside.get(p.managerId) ?? []), p]);
  }
  // Sem 180° a equipe não avalia o líder: ele só avalia (pela Minha equipe) e pode ficar fora. Com 180°, fora do ciclo ele escapa da avaliação.
  if (outside.size > 0) {
    issues.push({
      code: "LEADER_OUTSIDE_CYCLE",
      severity: cycle.leadershipModelId ? "BLOCK" : "WARN",
      title: `${outside.size} líder(es) fora do ciclo`,
      message: cycle.leadershipModelId
        ? "Quem lidera pessoas do ciclo precisa participar: a equipe avalia o líder e o líder é avaliado. Inclua os líderes com um clique."
        : "Estes líderes avaliam a equipe, mas não são avaliados neste ciclo (sem 180°). Se quiser que participem, inclua-os com um clique.",
      action: "INCLUDE_LEADERS",
      people: [...outside.entries()].map(([managerId, team]) => ({
        participantId: null,
        employeeId: managerId,
        name: ctx.names.get(managerId) ?? team[0]!.managerName ?? managerId,
        detail: `lidera ${team.map((t) => t.employeeName).slice(0, 3).join(", ")}${team.length > 3 ? ` e mais ${team.length - 3}` : ""}`,
      })),
    });
  }

  // Avaliadores que não conseguiriam responder: sem conta ativa ligada ao colaborador.
  // O motivo vem da identidade dos avaliadores; a decisão continua sendo só o vínculo direto.
  const notLinked = readinessEvaluatorIds(db, cycle.id).filter((id) => !ctx.linkedEmployeeIds.has(id));
  const evaluatorPerson = (id: string, detail: string): ReadinessPerson => {
    const p = byEmployee.get(id);
    const team = eligible.filter((x) => x.managerId === id).length;
    return { participantId: p?.id ?? null, employeeId: id, name: p?.employeeName ?? ctx.names.get(id) ?? id, detail: `avalia ${team} pessoa(s)${detail ? ` · ${detail}` : ""}`, personId: ctx.evaluatorIdentity?.get(id)?.personId ?? null };
  };
  const statusOf = (id: string): EvaluatorIdentityStatus => ctx.evaluatorIdentity?.get(id)?.status ?? "NO_ACCOUNT";
  const groups: Array<{ statuses: EvaluatorIdentityStatus[]; code: ReadinessIssue["code"]; action: ReadinessAction; title: (n: number) => string; message: string }> = [
    {
      statuses: ["ACCOUNT_NOT_LINKED"],
      code: "EVALUATOR_ACCOUNT_NOT_LINKED",
      action: "REGULARIZE_ACCOUNT",
      title: (n) => `${n} avaliador(es) com conta sem vínculo ao colaborador`,
      message:
        "A pessoa tem conta ativa (mesma Pessoa canônica), mas a conta não está ligada ao colaborador; sem esse vínculo ela não vê a equipe em Minha equipe. Regularize em Pessoas 360° › Regularizar vínculo existente (prévia, justificativa e auditoria). Nada é ligado automaticamente.",
    },
    {
      statuses: ["ACCOUNT_INACTIVE"],
      code: "EVALUATOR_ACCOUNT_INACTIVE",
      action: "REVIEW_ACCOUNT",
      title: (n) => `${n} avaliador(es) com conta inativa`,
      message: "A conta existe, mas está inativa. Reative em Configurações › Usuários (e regularize o vínculo em Pessoas 360°, se indicado) ou troque o avaliador.",
    },
    {
      statuses: ["IDENTITY_CONFLICT", "PERSON_NOT_ACTIVE"],
      code: "EVALUATOR_IDENTITY_CONFLICT",
      action: "REVIEW_IDENTITY",
      title: (n) => `${n} avaliador(es) com identidade a revisar`,
      message: "Conta e colaborador não batem com segurança (conta ligada a outro colaborador, Pessoa com mais de um colaborador, ou Pessoa inativa/unificada). Revise a ficha em Pessoas 360°; nada é escolhido automaticamente.",
    },
  ];
  for (const g of groups) {
    const ids = notLinked.filter((id) => g.statuses.includes(statusOf(id)));
    if (ids.length === 0) continue;
    issues.push({ code: g.code, severity: "BLOCK", title: g.title(ids.length), message: g.message, action: g.action, people: ids.map((id) => evaluatorPerson(id, ctx.evaluatorIdentity?.get(id)?.reason ?? "")) });
  }
  const withoutUser = notLinked.filter((id) => statusOf(id) === "NO_ACCOUNT");
  if (withoutUser.length > 0) {
    issues.push({
      code: "EVALUATOR_WITHOUT_USER",
      severity: "BLOCK",
      title: `${withoutUser.length} avaliador(es) sem acesso ao sistema`,
      message: "Estes líderes avaliam a equipe na aba Minha equipe e precisam de uma conta ativa ligada ao colaborador. Crie pela ficha da Pessoa (Pessoas 360° › Habilitar acesso), que já nasce ligada ao colaborador. Outra saída é trocar o avaliador.",
      action: "LINK_USERS",
      people: withoutUser.map((id) => evaluatorPerson(id, "")),
    });
  }

  // Topo: ninguém avalia.
  const tops = eligible.filter((p) => p.managerSource === "TOPO" && !p.managerId);
  if (tops.length > 0) {
    issues.push({
      code: "TOP_WITHOUT_EVALUATOR",
      severity: "WARN",
      title: "Topo da estrutura sem avaliador",
      message: "O topo faz a autoavaliação individual e, se lidera, a autoavaliação de liderança. A equipe direta avalia a liderança. Não há tarefa de avaliar um superior. A calibração individual usa exceção registrada.",
      action: "SET_EVALUATOR",
      people: tops.map((p) => person(p)),
    });
  }

  // Tempo com o líder atual menor que a observação mínima.
  const minDays = cycle.minObservationDays ?? 90;
  const recent: ReadinessPerson[] = [];
  for (const p of eligible) {
    const since = ctx.leaderSince.get(p.employeeId);
    // Só vale se a última troca registrada levou ao líder atual.
    if (!since || !p.managerId || since.managerId !== p.managerId) continue;
    const days = Math.floor((now.getTime() - new Date(since.since).getTime()) / DAY);
    if (days >= 0 && days < minDays) recent.push(person(p, `com ${p.managerName ?? "o líder"} há ${days} dia(s)${since.previousManagerName ? `; antes: ${since.previousManagerName}` : ""}`));
  }
  if (recent.length > 0) {
    issues.push({
      code: "RECENT_LEADER_CHANGE",
      severity: "WARN",
      title: `${recent.length} pessoa(s) com o líder atual há menos de ${minDays} dias`,
      message: "A pessoa participa. O líder novo conhece pouco o trabalho no período: mantenha o avaliador ou troque para o líder anterior, com motivo.",
      action: "REVIEW_LEADER",
      people: recent,
    });
  }

  // Líder participante, mas não elegível: a equipe não o avalia neste ciclo.
  const notEligibleLeaders = live.filter((p) => p.eligibility !== "ELIGIBLE" && eligible.some((x) => x.managerId === p.employeeId));
  if (notEligibleLeaders.length > 0 && cycle.leadershipModelId) {
    issues.push({
      code: "LEADER_NOT_ELIGIBLE",
      severity: "WARN",
      title: `${notEligibleLeaders.length} líder(es) não elegível(is)`,
      message: "A equipe não avalia a liderança de quem não é elegível no ciclo (ex.: admissão recente). O líder continua avaliando a equipe.",
      action: "REVIEW_LEADER",
      people: notEligibleLeaders.map((p) => person(p, p.eligibilityReason)),
    });
  }
  return issues;
}

export const readinessBlocked = (issues: readonly ReadinessIssue[]) => issues.filter((i) => i.severity === "BLOCK");
