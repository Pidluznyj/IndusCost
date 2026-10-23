/**
 * Inclusão de participantes por hierarquia (líder + equipe direta, líder + árvore, só liderados,
 * seleção individual, toda a organização). Puro: recebe o que a hierarquia efetiva e o cadastro
 * dizem e devolve a prévia e a assinatura que a confirmação exige.
 *
 * - A abrangência vem SÓ do serviço central de hierarquia (`orgHierarchy.ts`): liderados diretos e
 *   descendentes entre pessoas, pelas unidades. Nada é remontado aqui.
 * - Incluir a estrutura de um líder não muda o superior de ninguém: cada pessoa entra com o próprio
 *   superior efetivo (`managerId`), nunca com o líder escolhido.
 * - `isLeader` é da organização inteira (tem liderado direto ativo), não da população do ciclo.
 * - A assinatura da prévia cobre quem entra, com qual superior e qual elegibilidade: se a estrutura
 *   muda entre a prévia e a confirmação, a confirmação é recusada e pede nova prévia.
 */
import { createHash } from "node:crypto";
import { classifyFromSignals, planSurveyTasks, surveyTaskSummary, type EligibilityState, type EmployeeSnapshotSource, type EligibilitySignals } from "./performanceDomain.js";
import type { CycleRecord, PerformanceDatabase } from "./performanceState.js";

export const INCLUSION_MODES = ["DIRECT", "TREE", "REPORTS_ONLY", "INDIVIDUAL", "ALL"] as const;
export type InclusionMode = (typeof INCLUSION_MODES)[number];
export const INCLUSION_MODE_LABELS: Record<InclusionMode, string> = {
  DIRECT: "Líder + liderados diretos",
  TREE: "Líder + toda a estrutura subordinada",
  REPORTS_ONLY: "Somente os liderados diretos",
  INDIVIDUAL: "Seleção individual",
  ALL: "Toda a organização",
};
export const isInclusionMode = (v: unknown): v is InclusionMode => typeof v === "string" && (INCLUSION_MODES as readonly string[]).includes(v);

/** Recorte mínimo da hierarquia efetiva usado aqui (implementado por `OrgHierarchy`). */
export type HierarchyReader = {
  directReports(managerId: string): string[];
  descendants(managerId: string): string[];
};

/** Quem entra, por modo. Só pessoas ativas; sem repetição; o líder nunca entra como liderado de si. */
export function resolveInclusionScope(input: { mode: InclusionMode; leaderEmployeeId: string | null; employeeIds?: readonly string[]; hierarchy: HierarchyReader; activeIds: ReadonlySet<string> }): string[] {
  const { mode, leaderEmployeeId: leader, hierarchy, activeIds } = input;
  const active = (ids: readonly string[]) => ids.filter((id) => activeIds.has(id) && id !== leader);
  let ids: string[];
  switch (mode) {
    case "DIRECT":
      ids = leader ? [leader, ...active(hierarchy.directReports(leader))] : [];
      break;
    case "TREE":
      ids = leader ? [leader, ...active(hierarchy.descendants(leader))] : [];
      break;
    case "REPORTS_ONLY":
      ids = leader ? active(hierarchy.directReports(leader)) : [];
      break;
    case "INDIVIDUAL":
      ids = [...(input.employeeIds ?? [])];
      break;
    case "ALL":
      ids = [...activeIds];
      break;
  }
  return [...new Set(ids)];
}

export type HierarchyPreviewRow = {
  employeeId: string;
  name: string;
  roleName: string;
  departmentName: string;
  directorateName: string | null;
  managerId: string | null;
  managerName: string | null;
  managerSource: string;
  managerNote: string | null;
  isLeader: boolean;
  directReportCount: number;
  eligibility: EligibilityState;
  reason: string;
  /** Resumo das tarefas da pesquisa, antes da abertura. */
  taskSummary: string;
  /** NEW = entra agora; ALREADY = já participa; REACTIVATE = estava retirado e volta. */
  inclusion: "NEW" | "ALREADY" | "REACTIVATE";
  /** Superior efetivo existe mas não está no ciclo nem na prévia. */
  leaderOutside: boolean;
};

export type HierarchyPreview = {
  mode: InclusionMode;
  leader: { employeeId: string; name: string } | null;
  rows: HierarchyPreviewRow[];
  summary: {
    found: number;
    eligible: number;
    notEligible: number;
    insufficient: number;
    alreadyIncluded: number;
    newParticipants: number;
    leaders: number;
    withoutSuperior: number;
    hierarchyIssues: number;
    leadersOutside: number;
  };
  /** Assinatura do que será gravado; a confirmação exige a mesma. */
  token: string;
};

export function buildHierarchyPreview(input: {
  db: PerformanceDatabase;
  cycle: CycleRecord;
  mode: InclusionMode;
  leader: { employeeId: string; name: string } | null;
  employees: readonly EmployeeSnapshotSource[];
  directorateOf: (departmentId: string | null, departmentName: string) => string | null;
  /** Liderados diretos ativos de cada pessoa, pela organização inteira. */
  directReports: Readonly<Record<string, { directReportIds: readonly string[] }>>;
  signals: EligibilitySignals;
  now: Date;
}): HierarchyPreview {
  const { db, cycle, employees } = input;
  const inPreview = new Set(employees.map((e) => e.id));
  const inCycle = new Set(db.participants.filter((p) => p.cycleId === cycle.id && !p.removedAt).map((p) => p.employeeId));
  const removed = new Set(db.participants.filter((p) => p.cycleId === cycle.id && p.removedAt).map((p) => p.employeeId));
  const rows: HierarchyPreviewRow[] = employees
    .map((e) => {
      const decision = classifyFromSignals({
        employee: e,
        asOf: input.now,
        minObservationDays: cycle.minObservationDays,
        signals: input.signals,
        exceptionReason: null,
      });
      const managerId = e.managerId && e.managerId !== e.id ? e.managerId : null;
      const reports = input.directReports[e.id]?.directReportIds.length ?? 0;
      const top = (e.managerSource ?? "CADASTRO") === "TOPO" && !managerId;
      const tasks = planSurveyTasks({
        participates: decision.state === "ELIGIBLE",
        hasSuperior: Boolean(managerId) && !top,
        isLeader: reports > 0,
        leadershipModel: Boolean(cycle.leadershipModelId),
      });
      return {
        employeeId: e.id,
        name: e.name,
        roleName: e.roleName,
        departmentName: e.departmentName,
        directorateName: input.directorateOf(e.departmentId, e.departmentName),
        managerId,
        managerName: managerId ? e.managerName : null,
        managerSource: e.managerSource ?? "CADASTRO",
        managerNote: e.managerNote ?? null,
        isLeader: reports > 0,
        directReportCount: reports,
        eligibility: decision.state,
        reason: decision.reason,
        taskSummary: surveyTaskSummary(tasks, top),
        inclusion: inCycle.has(e.id) ? "ALREADY" : removed.has(e.id) ? "REACTIVATE" : "NEW",
        leaderOutside: Boolean(managerId) && !inCycle.has(managerId!) && !inPreview.has(managerId!),
      } satisfies HierarchyPreviewRow;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const entering = rows.filter((r) => r.inclusion !== "ALREADY");
  const summary = {
    found: rows.length,
    eligible: rows.filter((r) => r.eligibility === "ELIGIBLE").length,
    notEligible: rows.filter((r) => r.eligibility === "NOT_ELIGIBLE").length,
    insufficient: rows.filter((r) => r.eligibility === "INSUFFICIENT_EVIDENCE").length,
    alreadyIncluded: rows.length - entering.length,
    newParticipants: entering.length,
    leaders: rows.filter((r) => r.isLeader).length,
    withoutSuperior: rows.filter((r) => !r.managerId && r.managerSource !== "TOPO").length,
    hierarchyIssues: rows.filter((r) => (!r.managerId && r.managerSource !== "TOPO") || Boolean(r.managerNote)).length,
    leadersOutside: rows.filter((r) => r.leaderOutside && r.inclusion !== "ALREADY").length,
  };
  return { mode: input.mode, leader: input.leader, rows, summary, token: previewToken(cycle.id, input.mode, rows) };
}

/**
 * Assinatura: quem está no recorte, com qual superior, se lidera e qual a elegibilidade. Não inclui
 * "já participa": assim a mesma confirmação repetida (clique duplo, requisição simultânea) continua
 * válida e só conta duplicados, enquanto qualquer mudança de estrutura ou elegibilidade invalida.
 */
export function previewToken(cycleId: string, mode: InclusionMode, rows: readonly HierarchyPreviewRow[]): string {
  const body = rows
    .map((r) => `${r.employeeId}|${r.managerId ?? ""}|${r.isLeader ? 1 : 0}|${r.eligibility}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(`${cycleId}|${mode}\n${body}`).digest("hex").slice(0, 32);
}
