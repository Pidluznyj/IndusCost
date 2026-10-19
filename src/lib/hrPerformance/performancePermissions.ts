/**
 * Capacidades do módulo Desempenho, Cultura e Potencial sobre o RBAC oficial (sem mecanismo paralelo).
 *
 * Cada capacidade vem de um recurso/ação do catálogo (`permissionContract/resources.ts`), resolvido
 * pelo mesmo `can` dos guards (deny > allow). Separação central:
 * - operacional (acompanhar, ciclos, modelos, convites, situação da calibração) dá alcance de toda a
 *   organização para METADADOS: quem concluiu, quem responde, prazos e motivos;
 * - resultado (notas, Nine-Box individual, devolutiva, PDI, histórico) exige `results`;
 * - calibrar, homologar e ocorrências são concessões separadas.
 * Nenhuma capacidade abre a avaliação da equipe sobre o líder nem os comentários dela.
 */
import { PERFORMANCE_RESOURCE_KEYS } from "./performanceAccessKeys.js";

export type PerformanceCapabilityKey =
  | "view"
  | "evaluate"
  | "track"
  | "trackExport"
  | "cycles"
  | "models"
  | "invites"
  | "results"
  | "calibrationView"
  | "calibrate"
  | "homologate"
  | "reports"
  | "conduct";

export type PerformanceCaps = Record<PerformanceCapabilityKey, boolean> & {
  /** Alcance de toda a organização (escopo ALL) para o que a capacidade permitir. */
  orgWide: boolean;
  /** Classificar, inativar, reativar e excluir ciclo de teste (decisão anterior: só SUPER_ADMIN). */
  lifecycle: boolean;
};

export type CanFn = (resourceKey: string, action: string) => Promise<boolean>;

/** Recursos sem o atalho do editor de RH: só concessão explícita (ou SUPER_ADMIN). */
export const STRICT_PERFORMANCE_RESOURCES: readonly string[] = [
  PERFORMANCE_RESOURCE_KEYS.results,
  PERFORMANCE_RESOURCE_KEYS.calibration,
  PERFORMANCE_RESOURCE_KEYS.homologation,
  PERFORMANCE_RESOURCE_KEYS.conduct,
];

export async function resolvePerformanceCaps(input: { can: CanFn; employeesOrgWide: boolean; superAdmin: boolean }): Promise<PerformanceCaps> {
  const k = PERFORMANCE_RESOURCE_KEYS;
  const checks: [string, string][] = [
    [k.module, "view"],
    [k.module, "update"],
    [k.module, "manage"],
    [k.tracking, "view"],
    [k.tracking, "export"],
    [k.cycles, "manage"],
    [k.models, "manage"],
    [k.invites, "manage"],
    [k.results, "view"],
    [k.calibration, "view"],
    [k.calibration, "manage"],
    [k.homologation, "manage"],
    [k.reports, "view"],
    [k.conduct, "manage"],
  ];
  // Em sequência: o contexto do usuário é carregado uma vez por requisição (cache do guard) e cada
  // checagem depois é só cálculo em memória; a ordem fixa deixa a decisão previsível e fácil de auditar.
  const out: boolean[] = [];
  for (const [resource, action] of checks) out.push(await input.can(resource, action));
  const [view, evaluate, legacyManage, track, trackExport, cycles, models, invites, results, calibrationView, calibrate, homologate, reports, conduct] = out as [
    boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean,
  ];
  // `employees.performance.manage` (perfis anteriores) continua valendo para ciclos, modelos e acompanhamento.
  const caps = {
    view,
    evaluate,
    track: track || legacyManage,
    trackExport: (track || legacyManage) && trackExport,
    cycles: cycles || legacyManage,
    models: models || legacyManage,
    invites,
    results,
    calibrationView: calibrationView || calibrate,
    calibrate,
    homologate,
    reports,
    conduct,
  };
  const orgWide =
    input.employeesOrgWide || caps.track || caps.cycles || caps.models || caps.invites || caps.results || caps.calibrationView || caps.homologate;
  return { ...caps, orgWide, lifecycle: input.superAdmin };
}

/** Sem nenhuma capacidade (usuário sem permissão). */
export const NO_CAPS: PerformanceCaps = {
  view: false,
  evaluate: false,
  track: false,
  trackExport: false,
  cycles: false,
  models: false,
  invites: false,
  results: false,
  calibrationView: false,
  calibrate: false,
  homologate: false,
  reports: false,
  conduct: false,
  orgWide: false,
  lifecycle: false,
};

/**
 * Pode ver o RESULTADO desta pessoa? Com alcance de toda a organização, só com `results` (ou
 * `calibrate`, no contexto da calibração). Fora disso vale a hierarquia: quem lidera vê a equipe.
 */
export function canSeeResultOf(caps: PerformanceCaps, ctx: { orgWide: boolean; actorEmployeeId: string | null; teamIds: ReadonlySet<string> }, participant: { employeeId: string; managerId: string | null }, purpose: "read" | "calibration" = "read"): boolean {
  if (caps.results) return true;
  if (purpose === "calibration" && caps.calibrate) return true;
  if (!ctx.actorEmployeeId || participant.employeeId === ctx.actorEmployeeId) return false;
  return participant.managerId === ctx.actorEmployeeId || ctx.teamIds.has(participant.employeeId);
}
