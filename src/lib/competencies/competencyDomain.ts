/**
 * Competências e Desenvolvimento — vocabulário do domínio (puro, sem Prisma).
 *
 * Valores persistidos em inglês (strings, padrão do RH); rótulos pt-BR para a UI.
 * Regras de cálculo NÃO ficam aqui: ver `competencyEngine.ts` (engine oficial).
 */

/** Escala fixa de proficiência 0..4 (0 = não avaliado). */
export const COMPETENCY_LEVELS = [0, 1, 2, 3, 4] as const;
export type CompetencyLevel = (typeof COMPETENCY_LEVELS)[number];
export const MIN_ASSESSED_LEVEL = 1;
export const MAX_LEVEL = 4;
/** Nível efetivo quando a reciclagem vence ("Em formação"). */
export const RECYCLING_EXPIRED_LEVEL = 1;

export const COMPETENCY_LEVEL_LABELS: Record<CompetencyLevel, string> = {
  0: "Não avaliado",
  1: "Em formação",
  2: "Básico",
  3: "Proficiente",
  4: "Referência",
};

export const COMPETENCY_LEVEL_DESCRIPTIONS: Record<CompetencyLevel, string> = {
  0: "Sem registro",
  1: "Executa com acompanhamento constante",
  2: "Executa tarefas padrão com supervisão",
  3: "Executa com autonomia e qualidade",
  4: "Domina, ensina e melhora o processo",
};

export const COMPETENCY_CATEGORIES = ["TECHNICAL", "SAFETY", "QUALITY", "BEHAVIORAL"] as const;
export type CompetencyCategory = (typeof COMPETENCY_CATEGORIES)[number];
export const COMPETENCY_CATEGORY_LABELS: Record<CompetencyCategory, string> = {
  TECHNICAL: "Técnica",
  SAFETY: "Segurança",
  QUALITY: "Qualidade",
  BEHAVIORAL: "Comportamental",
};

export const SHIFT_PATTERNS = ["ONE_SHIFT", "TWO_SHIFTS", "THREE_SHIFTS"] as const;
export type ShiftPattern = (typeof SHIFT_PATTERNS)[number];
export const SHIFT_PATTERN_LABELS: Record<ShiftPattern, string> = {
  ONE_SHIFT: "1 turno",
  TWO_SHIFTS: "2 turnos",
  THREE_SHIFTS: "3 turnos",
};

export const COMPETENCY_LEVEL_SOURCES = ["ASSESSMENT", "MANUAL", "TRAINING", "IMPORT"] as const;
export type CompetencyLevelSource = (typeof COMPETENCY_LEVEL_SOURCES)[number];
export const COMPETENCY_LEVEL_SOURCE_LABELS: Record<CompetencyLevelSource, string> = {
  ASSESSMENT: "Avaliação",
  MANUAL: "Ajuste na matriz",
  TRAINING: "Treinamento",
  IMPORT: "Importação de planilha",
};

export const COMPETENCY_ASSESSMENT_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"] as const;
export type CompetencyAssessmentStatus = (typeof COMPETENCY_ASSESSMENT_STATUSES)[number];
export const COMPETENCY_ASSESSMENT_STATUS_LABELS: Record<CompetencyAssessmentStatus, string> = {
  PENDING: "Pendente",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluída",
};

export const TRAINING_MODALITIES = ["IN_PERSON", "ONLINE", "ON_THE_JOB"] as const;
export type TrainingModality = (typeof TRAINING_MODALITIES)[number];
export const TRAINING_MODALITY_LABELS: Record<TrainingModality, string> = {
  IN_PERSON: "Presencial",
  ONLINE: "Online",
  ON_THE_JOB: "On-the-job",
};

export const TRAINING_STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] as const;
export type TrainingStatus = (typeof TRAINING_STATUSES)[number];
export const TRAINING_STATUS_LABELS: Record<TrainingStatus, string> = {
  SCHEDULED: "Agendado",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluído",
};

function isMember<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export const isCompetencyCategory = (v: unknown): v is CompetencyCategory => isMember(COMPETENCY_CATEGORIES, v);
export const isShiftPattern = (v: unknown): v is ShiftPattern => isMember(SHIFT_PATTERNS, v);
export const isCompetencyAssessmentStatus = (v: unknown): v is CompetencyAssessmentStatus =>
  isMember(COMPETENCY_ASSESSMENT_STATUSES, v);
export const isTrainingModality = (v: unknown): v is TrainingModality => isMember(TRAINING_MODALITIES, v);
export const isTrainingStatus = (v: unknown): v is TrainingStatus => isMember(TRAINING_STATUSES, v);

export function isCompetencyLevel(v: unknown): v is CompetencyLevel {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_LEVEL;
}

/** Nível atribuível numa avaliação ou exigível num posto (1..4). */
export function isAssessedLevel(v: unknown): v is 1 | 2 | 3 | 4 {
  return isCompetencyLevel(v) && v >= MIN_ASSESSED_LEVEL;
}

export function competencyLevelLabel(level: number): string {
  return isCompetencyLevel(level) ? COMPETENCY_LEVEL_LABELS[level] : "—";
}

export function competencyCategoryLabel(category: string): string {
  return isCompetencyCategory(category) ? COMPETENCY_CATEGORY_LABELS[category] : category;
}

export function shiftPatternLabel(shift: string): string {
  return isShiftPattern(shift) ? SHIFT_PATTERN_LABELS[shift] : shift;
}

export const BUSINESS_TIME_ZONE = "America/Sao_Paulo";

/** Data de negócio "AAAA-MM-DD" no fuso de São Paulo (servidor e navegador). */
export function businessTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** "2026-10-21" → "21/10/2026"; vazio → "—". Só data (sem fuso). */
export function formatIsoDateBr(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}
