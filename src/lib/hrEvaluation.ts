/**
 * Avaliações de RH — regras puras (sem Prisma).
 *
 * Genérico por template/tipo. Os marcos iniciais são experiência de 45 dias
 * e avaliação final. Outros tipos (anual, PDI, 360) reutilizam as mesmas tabelas.
 *
 * Término do contrato de experiência: Employee não possui data própria.
 * Não foi criado campo duplicado. O marco de 45 dias usa admissão + 45.
 * A avaliação final usa admissão + 90 como término de fallback e vence
 * alguns dias antes. O RH pode ajustar a data prevista.
 *
 * Matrícula: não há número funcional distinto do id interno. O impresso
 * mostra "—" quando o snapshot de matrícula está vazio.
 */

export const HR_EVALUATION_TYPES = ["EXPERIENCE_45_DAYS", "EXPERIENCE_FINAL"] as const;
export type HrEvaluationType = (typeof HR_EVALUATION_TYPES)[number];

export const HR_EVALUATION_STATUSES = [
  "SCHEDULED",
  "READY_TO_PRINT",
  "PRINTED",
  "WAITING_RETURN",
  "RETURNED",
  "TRANSCRIBING",
  "COMPLETED",
  "CANCELLED",
] as const;
export type HrEvaluationStatus = (typeof HR_EVALUATION_STATUSES)[number];

export const HR_EVALUATION_ACTION_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export type HrEvaluationActionStatus = (typeof HR_EVALUATION_ACTION_STATUSES)[number];

export const EXPERIENCE_FIRST_MARK_DAYS = 45;
/** Fallback: a base não guarda o término real do contrato de experiência. */
export const EXPERIENCE_FALLBACK_CONTRACT_DAYS = 90;
/** A final fica disponível alguns dias antes do término usado. */
export const EXPERIENCE_FINAL_LEAD_DAYS = 5;
export const EVALUATION_SCORE_MAX = 5;

export const HR_EVALUATION_TYPE_LABELS: Record<string, string> = {
  EXPERIENCE_45_DAYS: "Avaliação de Experiência — 45 dias",
  EXPERIENCE_FINAL: "Avaliação Final do Período de Experiência",
};

export const HR_EVALUATION_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Programada",
  READY_TO_PRINT: "Disponível para impressão",
  PRINTED: "Impressa",
  WAITING_RETURN: "Aguardando retorno",
  RETURNED: "Devolvida",
  TRANSCRIBING: "Em preenchimento",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
};

export const HR_EVALUATION_ACTION_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendente",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
};

export const EXPERIENCE_45_RECOMMENDATIONS = [
  {
    code: "CONTINUE_NORMAL",
    label: "Continuidade normal do período de experiência",
  },
  {
    code: "CONTINUE_WITH_FOLLOW_UP",
    label: "Continuidade com pontos de acompanhamento",
  },
  {
    code: "HR_REVIEW_BEFORE_CONTINUE",
    label: "Recomendo análise do RH antes da continuidade",
  },
] as const;

export const EXPERIENCE_FINAL_RECOMMENDATIONS = [
  { code: "RECOMMEND_CONTINUE", label: "Recomendo continuidade do colaborador" },
  {
    code: "RECOMMEND_CONTINUE_WITH_PDI",
    label: "Recomendo continuidade com plano de desenvolvimento",
  },
  {
    code: "RECOMMEND_END_CONTRACT",
    label: "Recomendo encerramento ao término do contrato",
  },
  { code: "DISCUSS_WITH_HR", label: "Necessário discutir com RH / Gestão" },
] as const;

export const HR_EVALUATION_SCORE_LEGEND = [
  { score: 1, label: "Muito abaixo do esperado" },
  { score: 2, label: "Abaixo do esperado" },
  { score: 3, label: "Dentro do esperado" },
  { score: 4, label: "Acima do esperado" },
  { score: 5, label: "Destaque" },
] as const;

export const HR_EVALUATION_NA_LABEL = "Não foi possível avaliar";

export const HR_EVALUATION_PROMPTS = {
  strengths: "Quais comportamentos, conhecimentos ou entregas devem ser mantidos?",
  development: "O que precisa melhorar no próximo período?",
  guidance: "O que foi combinado com o colaborador?",
  printGuidance: "O que foi combinado para o próximo período?",
  acknowledgement:
    "A assinatura do colaborador representa ciência da avaliação e não necessariamente concordância integral com seu conteúdo.",
} as const;

export const HR_EVALUATION_CRITERION_SEEDS = [
  { code: "ASSIDUIDADE", name: "Assiduidade", category: "CONDUTA", sortOrder: 1 },
  { code: "PONTUALIDADE", name: "Pontualidade", category: "CONDUTA", sortOrder: 2 },
  { code: "QUALIDADE", name: "Qualidade do trabalho", category: "ENTREGA", sortOrder: 3 },
  { code: "PRODUTIVIDADE", name: "Produtividade / ritmo", category: "ENTREGA", sortOrder: 4 },
  { code: "APRENDIZADO", name: "Aprendizado e adaptação", category: "ENTREGA", sortOrder: 5 },
  { code: "PROCEDIMENTOS", name: "Cumprimento de procedimentos", category: "ENTREGA", sortOrder: 6 },
  { code: "SEGURANCA", name: "Segurança no trabalho", category: "SEGURANCA", sortOrder: 7 },
  { code: "ORGANIZACAO", name: "Organização", category: "ENTREGA", sortOrder: 8 },
  { code: "EQUIPE", name: "Trabalho em equipe", category: "RELACAO", sortOrder: 9 },
  { code: "COMUNICACAO", name: "Comunicação", category: "RELACAO", sortOrder: 10 },
  { code: "RESPONSABILIDADE", name: "Responsabilidade", category: "ENTREGA", sortOrder: 11 },
  { code: "AUTONOMIA", name: "Autonomia compatível com o cargo", category: "ENTREGA", sortOrder: 12 },
] as const;

export const HR_EVALUATION_TEMPLATE_SEEDS = [
  {
    code: "EXPERIENCE_45_DAYS",
    evaluationType: "EXPERIENCE_45_DAYS" as const,
    name: "Avaliação de Experiência — 45 dias",
    description: "Primeiro marco do período de experiência.",
    version: 1,
  },
  {
    code: "EXPERIENCE_FINAL",
    evaluationType: "EXPERIENCE_FINAL" as const,
    name: "Avaliação Final do Período de Experiência",
    description:
      "Avaliação final do período de experiência. Sem data de término contratual na ficha, o marco usa admissão + 90 dias.",
    version: 1,
  },
] as const;

const SAO_PAULO = "America/Sao_Paulo";

export class HrEvaluationError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "HrEvaluationError";
    this.code = code;
    this.status = status;
  }
}

export function evaluationTypeLabel(type: string): string {
  return HR_EVALUATION_TYPE_LABELS[type] ?? type;
}

export function evaluationTypeShortLabel(type: string): string {
  if (type === "EXPERIENCE_45_DAYS") return "45 dias";
  if (type === "EXPERIENCE_FINAL") return "Final / 90 dias";
  return evaluationTypeLabel(type);
}

export function evaluationPrintTitle(type: string): string {
  if (type === "EXPERIENCE_45_DAYS" || type === "EXPERIENCE_FINAL") {
    return "AVALIAÇÃO DO PERÍODO DE EXPERIÊNCIA";
  }
  return "AVALIAÇÃO";
}

export function evaluationPrintSubtitle(type: string): string {
  if (type === "EXPERIENCE_45_DAYS") return "45 dias";
  if (type === "EXPERIENCE_FINAL") return "Avaliação Final / 90 dias";
  return evaluationTypeLabel(type);
}

export function evaluationStatusLabel(status: string): string {
  return HR_EVALUATION_STATUS_LABELS[status] ?? status;
}

export function recommendationsFor(evaluationType: string): readonly { code: string; label: string }[] {
  if (evaluationType === "EXPERIENCE_FINAL") return EXPERIENCE_FINAL_RECOMMENDATIONS;
  if (evaluationType === "EXPERIENCE_45_DAYS") return EXPERIENCE_45_RECOMMENDATIONS;
  return [];
}

export function isValidRecommendation(evaluationType: string, code: string): boolean {
  return recommendationsFor(evaluationType).some((item) => item.code === code);
}

export function recommendationLabel(evaluationType: string, code: string | null | undefined): string | null {
  if (!code) return null;
  return recommendationsFor(evaluationType).find((item) => item.code === code)?.label ?? code;
}

export function isKnownEvaluationType(value: string): value is HrEvaluationType {
  return (HR_EVALUATION_TYPES as readonly string[]).includes(value);
}

export function isoDateInSaoPaulo(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SAO_PAULO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) throw new HrEvaluationError("INVALID_DATE", "Data inválida.");
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Meio-dia em America/Sao_Paulo (UTC-3, sem horário de verão). */
export function isoDateToStoredDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) throw new HrEvaluationError("INVALID_DATE", "Data inválida.");
  return new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
}

export function storedDateToIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return isoDateInSaoPaulo(date);
}

export function calendarDaysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function displayOrDash(value: string | null | undefined): string {
  const text = value?.trim();
  return text ? text : "—";
}

export type ExperienceSchedule = {
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  /** True quando a final usou admissão + 90 por falta de término contratual. */
  usedFallbackContractEnd: boolean;
};

export function scheduleExperienceDates(
  admission: Date | string | null | undefined,
  evaluationType: string
): ExperienceSchedule {
  const admissionIso = storedDateToIso(admission ?? null);
  if (!admissionIso) {
    return { periodStart: null, periodEnd: null, dueDate: null, usedFallbackContractEnd: false };
  }
  if (evaluationType === "EXPERIENCE_45_DAYS") {
    const end = addCalendarDays(admissionIso, EXPERIENCE_FIRST_MARK_DAYS);
    return { periodStart: admissionIso, periodEnd: end, dueDate: end, usedFallbackContractEnd: false };
  }
  if (evaluationType === "EXPERIENCE_FINAL") {
    const contractEnd = addCalendarDays(admissionIso, EXPERIENCE_FALLBACK_CONTRACT_DAYS);
    const due = addCalendarDays(contractEnd, -EXPERIENCE_FINAL_LEAD_DAYS);
    return {
      periodStart: admissionIso,
      periodEnd: contractEnd,
      dueDate: due,
      usedFallbackContractEnd: true,
    };
  }
  return { periodStart: admissionIso, periodEnd: null, dueDate: null, usedFallbackContractEnd: false };
}

export function experienceCycleKey(admission: Date | string | null | undefined): string {
  return storedDateToIso(admission ?? null) ?? "NO_ADMISSION";
}

export function formatEvaluationReferenceCode(
  year: number,
  sequence: number,
  evaluationType: string
): string {
  const suffix =
    evaluationType === "EXPERIENCE_45_DAYS"
      ? "45"
      : evaluationType === "EXPERIENCE_FINAL"
        ? "90"
        : "GEN";
  return `EXP-${year}-${String(sequence).padStart(5, "0")}-${suffix}`;
}

export function evaluationQrPayload(referenceCode: string, evaluationId: string): string {
  return `INDUSCOST-HR-EVAL:${referenceCode}:${evaluationId}`;
}

export type ScoreInput = { score: number | null; notApplicable: boolean };

export function normalizeAnswerScore(input: {
  score: number | null;
  notApplicable: boolean;
  allowNotApplicable?: boolean;
}): ScoreInput {
  if (input.notApplicable) {
    if (input.allowNotApplicable === false) {
      throw new HrEvaluationError("NA_NOT_ALLOWED", "Este critério não aceita N/A.");
    }
    return { score: null, notApplicable: true };
  }
  if (input.score == null) return { score: null, notApplicable: false };
  if (!Number.isInteger(input.score) || input.score < 1 || input.score > EVALUATION_SCORE_MAX) {
    throw new HrEvaluationError("INVALID_SCORE", "A nota deve ser um inteiro de 1 a 5.");
  }
  return { score: input.score, notApplicable: false };
}

/** Média simples. N/A e respostas vazias ficam de fora. Peso não entra. */
export function calculateEvaluationAverage(answers: readonly ScoreInput[]): {
  average: number | null;
  validCount: number;
  excludedCount: number;
} {
  const valid = answers.filter(
    (answer) =>
      !answer.notApplicable &&
      answer.score != null &&
      answer.score >= 1 &&
      answer.score <= EVALUATION_SCORE_MAX
  );
  if (valid.length === 0) {
    return { average: null, validCount: 0, excludedCount: answers.length };
  }
  const sum = valid.reduce((total, answer) => total + (answer.score ?? 0), 0);
  const average = Math.round((sum / valid.length) * 100) / 100;
  return { average, validCount: valid.length, excludedCount: answers.length - valid.length };
}

export function formatAverageLabel(average: number | null | undefined): string {
  if (average == null || !Number.isFinite(average)) return "—";
  const text = average.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${text} / 5,00`;
}

export function scoreDelta(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) * 100) / 100;
}

export function evolutionDirection(delta: number | null): "up" | "down" | "flat" | "none" {
  if (delta == null) return "none";
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}

export function formatScoreDelta(delta: number | null): string {
  if (delta == null || delta === 0) return "—";
  const abs = Math.abs(delta);
  const text = Number.isInteger(abs)
    ? String(abs)
    : abs.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return delta > 0 ? `+${text}` : `-${text}`;
}

export type ComparisonAnswer = {
  code: string;
  name: string;
  sortOrder: number;
  score: number | null;
  notApplicable: boolean;
};

export type ComparisonSide = {
  evaluationId: string;
  referenceCode: string;
  generalScore: number | null;
  answers: readonly ComparisonAnswer[];
};

export type CriterionComparisonRow = {
  code: string;
  name: string;
  sortOrder: number;
  fortyFive: number | null;
  fortyFiveNotApplicable: boolean;
  final: number | null;
  finalNotApplicable: boolean;
  delta: number | null;
  direction: "up" | "down" | "flat" | "none";
};

export function compareExperienceEvaluations(
  fortyFive: ComparisonSide | null,
  finalEvaluation: ComparisonSide | null
): {
  rows: CriterionComparisonRow[];
  fortyFiveAverage: number | null;
  finalAverage: number | null;
  averageDelta: number | null;
  averageDirection: "up" | "down" | "flat" | "none";
} | null {
  if (!fortyFive || !finalEvaluation) return null;
  const byCode = new Map<string, CriterionComparisonRow>();
  for (const answer of fortyFive.answers) {
    byCode.set(answer.code, {
      code: answer.code,
      name: answer.name,
      sortOrder: answer.sortOrder,
      fortyFive: answer.notApplicable ? null : answer.score,
      fortyFiveNotApplicable: answer.notApplicable,
      final: null,
      finalNotApplicable: false,
      delta: null,
      direction: "none",
    });
  }
  for (const answer of finalEvaluation.answers) {
    const current = byCode.get(answer.code) ?? {
      code: answer.code,
      name: answer.name,
      sortOrder: answer.sortOrder,
      fortyFive: null,
      fortyFiveNotApplicable: false,
      final: null,
      finalNotApplicable: false,
      delta: null,
      direction: "none" as const,
    };
    current.final = answer.notApplicable ? null : answer.score;
    current.finalNotApplicable = answer.notApplicable;
    if (!byCode.has(answer.code)) current.name = answer.name;
    byCode.set(answer.code, current);
  }
  const rows = [...byCode.values()]
    .map((row) => {
      const delta =
        row.fortyFiveNotApplicable || row.finalNotApplicable
          ? null
          : scoreDelta(row.fortyFive, row.final);
      return { ...row, delta, direction: evolutionDirection(delta) };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt-BR"));
  const averageDelta = scoreDelta(fortyFive.generalScore, finalEvaluation.generalScore);
  return {
    rows,
    fortyFiveAverage: fortyFive.generalScore,
    finalAverage: finalEvaluation.generalScore,
    averageDelta,
    averageDirection: evolutionDirection(averageDelta),
  };
}

export function isOpenEvaluationStatus(status: string): boolean {
  return status !== "COMPLETED" && status !== "CANCELLED";
}

export type EvaluationAlert = {
  evaluationId: string;
  evaluationType: string;
  tone: "info" | "warning" | "danger";
  message: string;
};

export function evaluationAlert(input: {
  id: string;
  evaluationType: string;
  status: string;
  dueDate: string | null;
  todayIso: string;
}): EvaluationAlert | null {
  if (!isOpenEvaluationStatus(input.status)) return null;
  const short = input.evaluationType === "EXPERIENCE_FINAL" ? "final" : "de 45 dias";
  const days =
    input.dueDate != null ? calendarDaysBetween(input.todayIso, input.dueDate) : null;

  if (days != null && days < 0) {
    return {
      evaluationId: input.id,
      evaluationType: input.evaluationType,
      tone: "danger",
      message:
        input.evaluationType === "EXPERIENCE_FINAL"
          ? "Avaliação final vencida."
          : "Avaliação de 45 dias vencida.",
    };
  }
  if (input.status === "PRINTED" || input.status === "WAITING_RETURN") {
    return {
      evaluationId: input.id,
      evaluationType: input.evaluationType,
      tone: "warning",
      message:
        input.evaluationType === "EXPERIENCE_FINAL"
          ? "Avaliação final aguardando retorno do líder."
          : "Avaliação de 45 dias aguardando retorno do líder.",
    };
  }
  if (
    input.evaluationType === "EXPERIENCE_FINAL" &&
    days != null &&
    days <= 10
  ) {
    return {
      evaluationId: input.id,
      evaluationType: input.evaluationType,
      tone: "warning",
      message: "Avaliação final pendente próxima ao término do contrato.",
    };
  }
  if (
    (input.status === "SCHEDULED" || input.status === "READY_TO_PRINT") &&
    (days == null || days <= 7)
  ) {
    return {
      evaluationId: input.id,
      evaluationType: input.evaluationType,
      tone: "info",
      message:
        input.evaluationType === "EXPERIENCE_FINAL"
          ? "Avaliação final disponível para impressão."
          : "Avaliação de 45 dias disponível para impressão.",
    };
  }
  if (input.evaluationType === "EXPERIENCE_FINAL") {
    return {
      evaluationId: input.id,
      evaluationType: input.evaluationType,
      tone: "info",
      message: "Avaliação final pendente.",
    };
  }
  if (input.status === "RETURNED" || input.status === "TRANSCRIBING") {
    return {
      evaluationId: input.id,
      evaluationType: input.evaluationType,
      tone: "info",
      message: `Avaliação ${short} em preenchimento.`,
    };
  }
  return null;
}

export function validateEvaluationCompletion(input: {
  evaluationDate: string | null;
  evaluatorName: string | null;
  recommendation: string | null;
  evaluationType: string;
  answers: readonly (ScoreInput & { criterionName?: string })[];
}): string[] {
  const errors: string[] = [];
  if (!input.evaluationDate) errors.push("Informe a data da avaliação.");
  if (!input.evaluatorName?.trim()) errors.push("Informe o líder avaliador.");
  const allowed = new Set(recommendationsFor(input.evaluationType).map((item) => item.code));
  if (!input.recommendation || !allowed.has(input.recommendation)) {
    errors.push("Selecione a recomendação.");
  }
  if (input.answers.length === 0) {
    errors.push("A avaliação não possui critérios.");
    return errors;
  }
  for (const answer of input.answers) {
    const name = answer.criterionName?.trim() || "Critério";
    if (answer.notApplicable) continue;
    if (answer.score == null) {
      errors.push(`Informe a nota ou N/A em ${name}.`);
      continue;
    }
    if (!Number.isInteger(answer.score) || answer.score < 1 || answer.score > 5) {
      errors.push(`Nota inválida em ${name}.`);
    }
  }
  return errors;
}

export function isAllowedEvaluationAttachment(mime: string | null | undefined, fileName: string): boolean {
  const normalized = (mime ?? "").toLowerCase().split(";")[0].trim();
  if (
    normalized === "application/pdf" ||
    normalized === "image/jpeg" ||
    normalized === "image/jpg" ||
    normalized === "image/png"
  ) {
    return true;
  }
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return ext === "pdf" || ext === "jpg" || ext === "jpeg" || ext === "png";
}

export function historyNoteForCompletedEvaluation(input: {
  evaluationType: string;
  average: number | null;
}): string {
  const kind =
    input.evaluationType === "EXPERIENCE_FINAL"
      ? "Avaliação final do período de experiência concluída"
      : input.evaluationType === "EXPERIENCE_45_DAYS"
        ? "Avaliação de experiência de 45 dias concluída"
        : `${evaluationTypeLabel(input.evaluationType)} concluída`;
  if (input.average == null) return `${kind}.`;
  return `${kind} — média ${formatAverageLabel(input.average).replace(" / 5,00", "")}.`;
}

export function shouldAutoScheduleExperience(status: string | null | undefined): boolean {
  const normalized = (status ?? "ACTIVE").toUpperCase();
  return normalized !== "TERMINATED" && normalized !== "INACTIVE";
}

const PATCHABLE_STATUSES = new Set([
  "SCHEDULED",
  "READY_TO_PRINT",
  "PRINTED",
  "WAITING_RETURN",
  "RETURNED",
  "TRANSCRIBING",
]);

export function assertPatchableStatus(status: string): void {
  if (status === "CANCELLED") {
    throw new HrEvaluationError("CANCELLED", "Avaliação cancelada não pode ser alterada.", 409);
  }
  if (!PATCHABLE_STATUSES.has(status) && status !== "COMPLETED") {
    throw new HrEvaluationError("INVALID_STATUS", "Situação inválida.");
  }
}

export function statusAfterTranscription(current: string): string {
  if (current === "COMPLETED" || current === "CANCELLED") return current;
  const early = new Set(["SCHEDULED", "READY_TO_PRINT", "PRINTED", "WAITING_RETURN", "RETURNED"]);
  return early.has(current) ? "TRANSCRIBING" : current;
}

export function statusAfterPrint(current: string): string {
  if (current === "SCHEDULED" || current === "READY_TO_PRINT") return "PRINTED";
  return current;
}

export type HrEvaluationAnswerDto = {
  id: string;
  criterionId: string;
  code: string;
  name: string;
  category: string | null;
  sortOrder: number;
  allowNotApplicable: boolean;
  score: number | null;
  notApplicable: boolean;
  comment: string | null;
};

export type HrEvaluationActionPlanDto = {
  id: string;
  evaluationId: string;
  title: string;
  description: string | null;
  responsibleEmployeeId: string | null;
  responsibleName: string | null;
  dueDate: string | null;
  status: string;
  statusLabel: string;
  completedAt: string | null;
  notes: string | null;
};

export type HrEvaluationDocumentDto = {
  id: string;
  displayName: string;
  originalFileName: string;
  mimeType: string | null;
  fileSize: number | null;
  createdAt: string;
  uploadedByName: string | null;
  downloadUrl: string;
  openUrl: string;
};

export type HrEvaluationAuditDto = {
  id: string;
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  createdAt: string;
  details: Record<string, unknown> | null;
};

export type HrEmployeeEvaluationDto = {
  id: string;
  employeeId: string;
  employeeName: string;
  templateId: string;
  templateVersion: number;
  templateName: string;
  evaluationType: string;
  typeLabel: string;
  shortLabel: string;
  referenceCode: string;
  cycleKey: string;
  status: string;
  statusLabel: string;
  admissionDate: string | null;
  roleName: string | null;
  department: string | null;
  registration: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  evaluationDate: string | null;
  evaluatorEmployeeId: string | null;
  evaluatorName: string | null;
  evaluatorRole: string | null;
  managerName: string | null;
  generalScore: number | null;
  averageLabel: string;
  recommendation: string | null;
  recommendationLabel: string | null;
  recommendationNotes: string | null;
  strengths: string | null;
  developmentPoints: string | null;
  actionGuidance: string | null;
  employeeAcknowledged: boolean;
  employeeAcknowledgedAt: string | null;
  employeeAcknowledgementNotes: string | null;
  transcriptionAt: string | null;
  transcriptionUserName: string | null;
  completedAt: string | null;
  printedAt: string | null;
  scheduleNote: string | null;
  createdAt: string;
  updatedAt: string;
  answers: HrEvaluationAnswerDto[];
  actionPlans: HrEvaluationActionPlanDto[];
  priorActionPlans: HrEvaluationActionPlanDto[];
  documents: HrEvaluationDocumentDto[];
  audit: HrEvaluationAuditDto[];
};

export type HrEvaluationUpdateInput = {
  dueDate?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  evaluationDate?: string | null;
  evaluatorName?: string | null;
  evaluatorRole?: string | null;
  evaluatorEmployeeId?: string | null;
  recommendation?: string | null;
  recommendationNotes?: string | null;
  strengths?: string | null;
  developmentPoints?: string | null;
  actionGuidance?: string | null;
  employeeAcknowledged?: boolean;
  employeeAcknowledgedAt?: string | null;
  employeeAcknowledgementNotes?: string | null;
  status?: string | null;
  answers?: Array<{
    id: string;
    score: number | null;
    notApplicable: boolean;
    comment?: string | null;
  }>;
};
