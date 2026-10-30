/**
 * Etapas do ciclo com início e fim (fluxo simples para quem responde e para quem administra):
 *
 *   1. Autoavaliação           — todos se autoavaliam                         (SELF)
 *   2. Avaliação do líder       — cada chefe avalia os seus liderados          (LEADER)
 *   3. Avaliação da liderança   — quem tem liderados é avaliado pela equipe,
 *                                 por si e pelo superior (180°)                (LEADERSHIP_*)
 *   4. Calibração e devolutiva  — o líder analisa, propõe a posição, agenda a
 *                                 conversa e prepara devolutiva e PDI; o RH
 *                                 confere e torna oficial
 *   5. Encerramento
 *
 * Por baixo continuam os mesmos estados (Aberto = etapas 1–3; Consolidação, Calibração e Homologado = etapa 4).
 * Cada etapa de coleta só aceita respostas dentro da sua janela. Ciclo sem calendário de etapas (anterior a este
 * fluxo) continua como antes: tudo aberto enquanto o ciclo estiver Aberto.
 *
 * Datas são dias civis de São Paulo (YYYY-MM-DD), inclusivos nas duas pontas.
 */
import { isIsoDate, type AssignmentKind, type CycleStatus } from "./performanceDomain.js";

export type StageKey = "SELF" | "LEADER" | "LEADERSHIP" | "CALIBRATION";

export type StageSchedule = {
  selfStartAt: string | null;
  selfDueAt: string;
  leaderStartAt: string | null;
  leaderDueAt: string;
  leadershipStartAt: string | null;
  leadershipDueAt: string | null;
  calibrationStartAt: string | null;
  calibrationDueAt: string | null;
};

export type StageCycle = StageSchedule & { status: CycleStatus; leadershipModelId: string | null };

export type StageWindow = { key: StageKey; index: number; label: string; who: string; startsAt: string | null; endsAt: string | null };

export const STAGE_LABELS: Record<StageKey, { label: string; who: string }> = {
  SELF: { label: "Autoavaliação", who: "Todos se autoavaliam" },
  LEADER: { label: "Avaliação do líder", who: "Cada chefe avalia os seus liderados" },
  LEADERSHIP: { label: "Avaliação da liderança", who: "Quem tem liderados é avaliado pela equipe, por si e pelo superior" },
  CALIBRATION: { label: "Calibração e devolutiva", who: "O líder analisa, agenda a conversa e prepara devolutiva e PDI; o RH torna oficial" },
};

/** Dia civil em São Paulo (o ciclo é corporativo e os prazos são dias, não instantes). */
export function localDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function stageWindows(cycle: StageCycle): StageWindow[] {
  const keys: StageKey[] = cycle.leadershipModelId ? ["SELF", "LEADER", "LEADERSHIP", "CALIBRATION"] : ["SELF", "LEADER", "CALIBRATION"];
  const range: Record<StageKey, [string | null, string | null]> = {
    SELF: [cycle.selfStartAt, cycle.selfDueAt],
    LEADER: [cycle.leaderStartAt, cycle.leaderDueAt],
    LEADERSHIP: [cycle.leadershipStartAt, cycle.leadershipDueAt],
    CALIBRATION: [cycle.calibrationStartAt, cycle.calibrationDueAt],
  };
  return keys.map((key, i) => ({ key, index: i + 1, ...STAGE_LABELS[key], startsAt: range[key][0], endsAt: range[key][1] }));
}

/** O ciclo tem calendário de etapas (todas as datas de início e fim preenchidas)? */
export function hasStageSchedule(cycle: StageCycle): boolean {
  return stageWindows(cycle).every((w) => isIsoDate(w.startsAt) && isIsoDate(w.endsAt));
}

export function windowState(window: Pick<StageWindow, "startsAt" | "endsAt">, today: string): "BEFORE" | "OPEN" | "AFTER" {
  if (window.startsAt && today < window.startsAt) return "BEFORE";
  if (window.endsAt && today > window.endsAt) return "AFTER";
  return "OPEN";
}

export function stageOfKind(kind: AssignmentKind): StageKey {
  if (kind === "SELF") return "SELF";
  if (kind === "LEADER") return "LEADER";
  return "LEADERSHIP";
}

/**
 * A janela da etapa desta tarefa está aberta hoje? Vale só para a coleta (ciclo Aberto). Sem calendário de etapas,
 * a resposta é sempre sim (comportamento anterior).
 */
export function kindWindowOpen(cycle: StageCycle, kind: AssignmentKind, today: string): boolean {
  if (!hasStageSchedule(cycle)) return true;
  const window = stageWindows(cycle).find((w) => w.key === stageOfKind(kind));
  return !window || windowState(window, today) === "OPEN";
}

export function kindWindow(cycle: StageCycle, kind: AssignmentKind): StageWindow | null {
  if (!hasStageSchedule(cycle)) return null;
  return stageWindows(cycle).find((w) => w.key === stageOfKind(kind)) ?? null;
}

/**
 * Confere um calendário de etapas. Todas ou nenhuma data de início; cada etapa começa antes de terminar; as etapas
 * seguem a ordem (autoavaliação → líder → liderança → calibração), podendo se sobrepor na coleta; a calibração começa
 * depois do fim da coleta.
 */
export function stageScheduleProblem(schedule: StageSchedule, leadership: boolean): string | null {
  const starts = [schedule.selfStartAt, schedule.leaderStartAt, schedule.calibrationStartAt, ...(leadership ? [schedule.leadershipStartAt] : [])];
  const ends = [schedule.calibrationDueAt, ...(leadership ? [schedule.leadershipDueAt] : [])];
  const any = [...starts, ...ends].some((v) => v);
  if (!any) return null;
  if (![...starts, ...ends].every((v) => isIsoDate(v))) return "Preencha início e fim de todas as etapas (ou deixe o calendário de etapas em branco).";
  const s = schedule as Required<{ [K in keyof StageSchedule]: string }>;
  const windows: Array<[string, string, string]> = [
    ["Autoavaliação", s.selfStartAt, s.selfDueAt],
    ["Avaliação do líder", s.leaderStartAt, s.leaderDueAt],
    ...(leadership ? ([["Avaliação da liderança", s.leadershipStartAt, s.leadershipDueAt]] as Array<[string, string, string]>) : []),
    ["Calibração e devolutiva", s.calibrationStartAt, s.calibrationDueAt],
  ];
  for (const [label, start, end] of windows) if (end < start) return `${label}: o fim não pode vir antes do início.`;
  if (s.leaderStartAt < s.selfStartAt) return "A avaliação do líder não pode começar antes da autoavaliação.";
  if (leadership && s.leadershipStartAt < s.leaderStartAt) return "A avaliação da liderança não pode começar antes da avaliação do líder.";
  const collectionEnd = [s.selfDueAt, s.leaderDueAt, ...(leadership ? [s.leadershipDueAt] : [])].sort().pop()!;
  if (s.calibrationStartAt <= collectionEnd) return "A calibração começa depois do fim da coleta (autoavaliação, líder e liderança).";
  return null;
}

/** Última data de coleta (fim da autoavaliação, do líder e da liderança). */
export function collectionEnd(cycle: StageCycle): string {
  return [cycle.selfDueAt, cycle.leaderDueAt, ...(cycle.leadershipModelId && cycle.leadershipDueAt ? [cycle.leadershipDueAt] : [])].sort().pop()!;
}

export type CurrentStage = {
  /** PREPARATION = antes de abrir; CLOSED = encerrado. */
  key: StageKey | "PREPARATION" | "CLOSED";
  label: string;
  window: StageWindow | null;
  /** Etapas de coleta abertas hoje (podem se sobrepor). */
  openNow: StageKey[];
  /** Próximo passo sugerido ao RH (nunca executado sozinho). */
  advice: string | null;
};

export function currentStage(cycle: StageCycle, today: string): CurrentStage {
  const windows = stageWindows(cycle);
  const calibration = windows.find((w) => w.key === "CALIBRATION")!;
  if (cycle.status === "DRAFT" || cycle.status === "PREPARED") {
    return { key: "PREPARATION", label: "Preparação", window: null, openNow: [], advice: cycle.status === "DRAFT" ? "Inclua as pessoas e prepare o ciclo." : "Abra o ciclo para começar a autoavaliação." };
  }
  if (cycle.status === "CLOSED") return { key: "CLOSED", label: "Encerrado", window: null, openNow: [], advice: null };
  if (cycle.status !== "OPEN") {
    const ended = calibration.endsAt ? today > calibration.endsAt : false;
    return {
      key: "CALIBRATION",
      label: calibration.label,
      window: calibration,
      openNow: [],
      advice:
        cycle.status === "CONSOLIDATION"
          ? "Coleta fechada: inicie a calibração para os líderes proporem as posições e agendarem as conversas."
          : cycle.status === "CALIBRATION"
            ? ended
              ? "O prazo da calibração terminou: confira as propostas dos líderes e torne os resultados oficiais."
              : "Líderes propõem a posição, agendam a conversa e preparam devolutiva e PDI; o RH confere e torna oficial."
            : "Resultados oficiais: os líderes registram a devolutiva e o PDI preparados e encerram com a ciência da pessoa.",
    };
  }
  // Aberto: a etapa atual é a última já iniciada; sem calendário, a coleta inteira está aberta.
  if (!hasStageSchedule(cycle)) {
    return { key: "SELF", label: "Coleta aberta", window: null, openNow: windows.filter((w) => w.key !== "CALIBRATION").map((w) => w.key), advice: null };
  }
  const collection = windows.filter((w) => w.key !== "CALIBRATION");
  const openNow = collection.filter((w) => windowState(w, today) === "OPEN").map((w) => w.key);
  const started = collection.filter((w) => windowState(w, today) !== "BEFORE");
  const current = started[started.length - 1] ?? collection[0]!;
  const end = collectionEnd(cycle);
  return {
    key: current.key,
    label: current.label,
    window: current,
    openNow,
    advice: today > end ? `A coleta terminou em ${end.split("-").reverse().join("/")}: feche a coleta para começar a calibração.` : null,
  };
}
