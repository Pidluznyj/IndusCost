/**
 * Ciclo de vida do colaborador — desligamento e afastamentos (regras puras, browser-safe).
 *
 * Modelo:
 * - `Employee.status` é o VÍNCULO: ACTIVE (vínculo ativo) ou INACTIVE (desligado).
 *   Afastado continua com vínculo ativo (contrato suspenso ou interrompido): por isso o
 *   colaborador afastado não sai da folha, do organograma, da gestão nem de Competências.
 * - "Afastado" é a SITUAÇÃO derivada do afastamento em andamento (`HrAbsence` de tipo de
 *   afastamento), com justificativa obrigatória e as regras legais de cada tipo.
 * - Desligamento exige data, motivo e aviso prévio; conflitos legais bloqueiam ou pedem ciência.
 *
 * Base legal citada em cada regra. Os textos são de apoio ao RH: casos concretos (convenção
 * coletiva, benefícios do INSS, decisões judiciais) devem ser conferidos pelo DP/jurídico.
 */

export const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Datas de negócio (AAAA-MM-DD)
// ---------------------------------------------------------------------------

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Date | string ISO → "AAAA-MM-DD" (UTC) ou null. */
export function toIsoDay(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string" && isIsoDate(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function dayNumber(iso: string): number {
  return Math.round(new Date(`${iso}T00:00:00.000Z`).getTime() / DAY_MS);
}

export function addDaysIso(iso: string, days: number): string {
  return new Date((dayNumber(iso) + days) * DAY_MS).toISOString().slice(0, 10);
}

export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Dias corridos entre duas datas, contando as duas pontas (início e fim inclusos). */
export function inclusiveDays(startIso: string, endIso: string): number {
  return dayNumber(endIso) - dayNumber(startIso) + 1;
}

export function formatDateBr(iso: string | null | undefined): string {
  if (!iso || !isIsoDate(iso)) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------
// Afastamentos
// ---------------------------------------------------------------------------

/** Tipos de afastamento (os de `HrAbsence.type`, exceto VACATION, que é férias). */
export const LEAVE_TYPES = [
  "SICK_LEAVE",
  "ACCIDENT",
  "MATERNITY",
  "ADOPTION",
  "MISCARRIAGE",
  "PATERNITY",
  "MILITARY",
  "SUSPENSION",
  "LEAVE",
  "UNPAID",
  "OTHER",
] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export function isLeaveType(value: unknown): value is LeaveType {
  return typeof value === "string" && (LEAVE_TYPES as readonly string[]).includes(value);
}

export type ContractEffect = "INTERRUPTION" | "SUSPENSION" | "INTERRUPTION_THEN_SUSPENSION";

export const CONTRACT_EFFECT_LABELS: Record<ContractEffect, string> = {
  INTERRUPTION: "Interrupção do contrato (salário pago, tempo de serviço conta)",
  SUSPENSION: "Suspensão do contrato (sem salário pela empresa)",
  INTERRUPTION_THEN_SUSPENSION: "Interrupção nos 15 primeiros dias; suspensão a partir do 16º dia",
};

export type LeaveRule = {
  label: string;
  legalBasis: string;
  contractEffect: ContractEffect;
  /** Quem paga: texto de apoio. */
  payment: string;
  /** Dias pagos pela empresa antes do INSS (afastamentos por incapacidade). */
  employerPaidDays: number | null;
  /** Depósito de FGTS continua durante o afastamento. */
  fgtsContinues: boolean;
  /** Duração legal fixa (dias corridos) e a duração estendida (Empresa Cidadã / prorrogação). */
  fixedDays: number | null;
  extendedDays: number | null;
  extendedLabel: string | null;
  /** Limite máximo de dias (ex.: suspensão disciplinar). */
  maxDays: number | null;
  /** Estabilidade provisória após o retorno (meses) — base em `stabilityBasis`. */
  stabilityMonthsAfterReturn: number | null;
  /** Estabilidade contada a partir do início (ex.: gestante, 5 meses após o parto). */
  stabilityMonthsFromStart: number | null;
  stabilityBasis: string | null;
  /** Documentos e providências exigidos. */
  requirements: string[];
};

export const LEAVE_RULES: Record<LeaveType, LeaveRule> = {
  SICK_LEAVE: {
    label: "Doença (não relacionada ao trabalho)",
    legalBasis: "Lei 8.213/1991, arts. 59 e 60 (auxílio por incapacidade temporária — B31)",
    contractEffect: "INTERRUPTION_THEN_SUSPENSION",
    payment: "Empresa paga os 15 primeiros dias; a partir do 16º, benefício do INSS.",
    employerPaidDays: 15,
    fgtsContinues: false,
    fixedDays: null,
    extendedDays: null,
    extendedLabel: null,
    maxDays: null,
    stabilityMonthsAfterReturn: null,
    stabilityMonthsFromStart: null,
    stabilityBasis: null,
    requirements: [
      "Atestado médico",
      "Acima de 15 dias: encaminhar à perícia do INSS (requerimento do benefício)",
    ],
  },
  ACCIDENT: {
    label: "Acidente de trabalho / doença ocupacional",
    legalBasis: "Lei 8.213/1991, arts. 19 a 22, 60 e 118 (auxílio por incapacidade acidentário — B91); Lei 8.036/1990, art. 15, § 5º",
    contractEffect: "INTERRUPTION_THEN_SUSPENSION",
    payment: "Empresa paga os 15 primeiros dias; a partir do 16º, benefício acidentário do INSS.",
    employerPaidDays: 15,
    fgtsContinues: true,
    fixedDays: null,
    extendedDays: null,
    extendedLabel: null,
    maxDays: null,
    stabilityMonthsAfterReturn: 12,
    stabilityMonthsFromStart: null,
    stabilityBasis: "Estabilidade de 12 meses após a cessação do benefício acidentário (Lei 8.213/1991, art. 118)",
    requirements: [
      "Emitir a CAT até o 1º dia útil seguinte ao acidente (Lei 8.213/1991, art. 22)",
      "Atestado médico",
      "Acima de 15 dias: encaminhar à perícia do INSS",
    ],
  },
  MATERNITY: {
    label: "Licença-maternidade",
    legalBasis: "CF, art. 7º, XVIII; CLT, art. 392; Lei 11.770/2008 (Empresa Cidadã)",
    contractEffect: "INTERRUPTION",
    payment: "Salário-maternidade pago pela empresa e compensado nas contribuições ao INSS.",
    employerPaidDays: null,
    fgtsContinues: true,
    fixedDays: 120,
    extendedDays: 180,
    extendedLabel: "Prorrogação Empresa Cidadã (+60 dias)",
    maxDays: null,
    stabilityMonthsAfterReturn: null,
    stabilityMonthsFromStart: 5,
    stabilityBasis: "Estabilidade da gestante desde a confirmação da gravidez até 5 meses após o parto (ADCT, art. 10, II, b)",
    requirements: ["Atestado médico ou certidão de nascimento"],
  },
  ADOPTION: {
    label: "Licença-maternidade por adoção / guarda judicial",
    legalBasis: "CLT, art. 392-A; Lei 11.770/2008 (Empresa Cidadã)",
    contractEffect: "INTERRUPTION",
    payment: "Salário-maternidade (adotante) compensado nas contribuições ao INSS.",
    employerPaidDays: null,
    fgtsContinues: true,
    fixedDays: 120,
    extendedDays: 180,
    extendedLabel: "Prorrogação Empresa Cidadã (+60 dias)",
    maxDays: null,
    stabilityMonthsAfterReturn: null,
    stabilityMonthsFromStart: null,
    stabilityBasis: null,
    requirements: ["Termo judicial de guarda ou adoção"],
  },
  MISCARRIAGE: {
    label: "Aborto não criminoso",
    legalBasis: "CLT, art. 395",
    contractEffect: "INTERRUPTION",
    payment: "Repouso remunerado de 2 semanas (salário-maternidade).",
    employerPaidDays: null,
    fgtsContinues: true,
    fixedDays: 14,
    extendedDays: null,
    extendedLabel: null,
    maxDays: null,
    stabilityMonthsAfterReturn: null,
    stabilityMonthsFromStart: null,
    stabilityBasis: null,
    requirements: ["Atestado médico oficial"],
  },
  PATERNITY: {
    label: "Licença-paternidade",
    legalBasis: "CF, art. 7º, XIX; ADCT, art. 10, § 1º; Lei 13.257/2016 (Empresa Cidadã)",
    contractEffect: "INTERRUPTION",
    payment: "Remunerada pela empresa.",
    employerPaidDays: null,
    fgtsContinues: true,
    fixedDays: 5,
    extendedDays: 20,
    extendedLabel: "Prorrogação Empresa Cidadã (+15 dias)",
    maxDays: null,
    stabilityMonthsAfterReturn: null,
    stabilityMonthsFromStart: null,
    stabilityBasis: null,
    requirements: ["Certidão de nascimento ou termo de adoção"],
  },
  MILITARY: {
    label: "Serviço militar obrigatório",
    legalBasis: "CLT, art. 472; Lei 8.036/1990, art. 15, § 5º",
    contractEffect: "SUSPENSION",
    payment: "Sem salário pela empresa; o FGTS continua sendo depositado.",
    employerPaidDays: null,
    fgtsContinues: true,
    fixedDays: null,
    extendedDays: null,
    extendedLabel: null,
    maxDays: null,
    stabilityMonthsAfterReturn: null,
    stabilityMonthsFromStart: null,
    stabilityBasis: null,
    requirements: [
      "Documento de incorporação",
      "Retorno: o empregado deve comunicar a intenção de voltar em até 30 dias após a baixa (CLT, art. 472, § 1º)",
    ],
  },
  SUSPENSION: {
    label: "Suspensão disciplinar",
    legalBasis: "CLT, art. 474",
    contractEffect: "SUSPENSION",
    payment: "Sem salário nos dias de suspensão.",
    employerPaidDays: null,
    fgtsContinues: false,
    fixedDays: null,
    extendedDays: null,
    extendedLabel: null,
    maxDays: 30,
    stabilityMonthsAfterReturn: null,
    stabilityMonthsFromStart: null,
    stabilityBasis: null,
    requirements: [
      "Comunicação escrita ao empregado com o motivo",
      "Mais de 30 dias consecutivos equivale a rescisão injusta (CLT, art. 474)",
    ],
  },
  LEAVE: {
    label: "Licença remunerada (falta legal / convenção)",
    legalBasis: "CLT, art. 473 (ex.: casamento, falecimento, doação de sangue) e convenção coletiva",
    contractEffect: "INTERRUPTION",
    payment: "Remunerada pela empresa.",
    employerPaidDays: null,
    fgtsContinues: true,
    fixedDays: null,
    extendedDays: null,
    extendedLabel: null,
    maxDays: null,
    stabilityMonthsAfterReturn: null,
    stabilityMonthsFromStart: null,
    stabilityBasis: null,
    requirements: ["Documento comprobatório do motivo (certidão, declaração)"],
  },
  UNPAID: {
    label: "Licença não remunerada",
    legalBasis: "Acordo entre as partes (suspensão do contrato)",
    contractEffect: "SUSPENSION",
    payment: "Sem salário e sem recolhimentos pela empresa no período.",
    employerPaidDays: null,
    fgtsContinues: false,
    fixedDays: null,
    extendedDays: null,
    extendedLabel: null,
    maxDays: null,
    stabilityMonthsAfterReturn: null,
    stabilityMonthsFromStart: null,
    stabilityBasis: null,
    requirements: ["Solicitação ou acordo por escrito, assinado pelo empregado"],
  },
  OTHER: {
    label: "Outro afastamento",
    legalBasis: "Descrever a base legal na justificativa",
    contractEffect: "SUSPENSION",
    payment: "Conforme a base legal informada.",
    employerPaidDays: null,
    fgtsContinues: false,
    fixedDays: null,
    extendedDays: null,
    extendedLabel: null,
    maxDays: null,
    stabilityMonthsAfterReturn: null,
    stabilityMonthsFromStart: null,
    stabilityBasis: null,
    requirements: ["Documento que fundamente o afastamento"],
  },
};

export const LEAVE_JUSTIFICATION_MIN = 10;
export const LEAVE_JUSTIFICATION_MAX = 2000;

/** Fim legal previsto para tipos de duração fixa (dias corridos a partir do início). */
export function legalLeaveEnd(type: LeaveType, startIso: string, extended: boolean): string | null {
  const rule = LEAVE_RULES[type];
  const days = extended && rule.extendedDays ? rule.extendedDays : rule.fixedDays;
  return days ? addDaysIso(startIso, days - 1) : null;
}

export type LeaveFacts = {
  type: string;
  startDate: string;
  endDate?: string | null;
  expectedReturn?: string | null;
  actualReturn?: string | null;
  status?: string | null;
  extendedLicense?: boolean | null;
  /** Justificativa e documentos do afastamento (dado sensível: pode conter informação médica). */
  reason?: string | null;
  inssBenefitNumber?: string | null;
  catNumber?: string | null;
};

/** Registro do afastamento exibido junto das nuances legais (oculto para quem não vê afastamentos). */
export type LeaveRecord = {
  justification: string | null;
  inssBenefitNumber: string | null;
  catNumber: string | null;
};

/**
 * Afastamento ainda em vigor na data (não cancelado, não concluído, já iniciado, sem retorno nem término).
 * Retorno previsto vencido NÃO encerra: o INSS pode prorrogar; o colaborador segue afastado até o retorno ser registrado.
 */
export function isLeaveOngoing(leave: LeaveFacts, todayIso: string): boolean {
  if (!isLeaveType(leave.type)) return false;
  if (leave.status === "CANCELLED" || leave.status === "COMPLETED") return false;
  if (leave.startDate > todayIso) return false;
  if (leave.actualReturn && leave.actualReturn <= todayIso) return false;
  if (leave.endDate && leave.endDate < todayIso) return false;
  return true;
}

export type LeaveInsight = {
  type: LeaveType;
  label: string;
  legalBasis: string;
  contractEffect: string;
  payment: string;
  startDate: string;
  /** Dias corridos já transcorridos até hoje (ou até o retorno). */
  elapsedDays: number;
  expectedReturn: string | null;
  legalEnd: string | null;
  /** Último dia pago pela empresa e 1º dia a cargo do INSS. */
  employerPaidUntil: string | null;
  inssFrom: string | null;
  inssReferralNeeded: boolean;
  fgtsContinues: boolean;
  stabilityUntil: string | null;
  stabilityBasis: string | null;
  requirements: string[];
  alerts: string[];
  record: LeaveRecord | null;
};

/** Nuances legais calculadas para um afastamento. */
export function describeLeave(leave: LeaveFacts, todayIso: string): LeaveInsight | null {
  if (!isLeaveType(leave.type)) return null;
  const rule = LEAVE_RULES[leave.type];
  const end = leave.actualReturn ? addDaysIso(leave.actualReturn, -1) : todayIso;
  const elapsedDays = Math.max(0, inclusiveDays(leave.startDate, end < leave.startDate ? leave.startDate : end));
  const legalEnd = legalLeaveEnd(leave.type, leave.startDate, Boolean(leave.extendedLicense));
  const employerPaidUntil = rule.employerPaidDays ? addDaysIso(leave.startDate, rule.employerPaidDays - 1) : null;
  const inssFrom = rule.employerPaidDays ? addDaysIso(leave.startDate, rule.employerPaidDays) : null;
  const plannedEnd = leave.expectedReturn ? addDaysIso(leave.expectedReturn, -1) : null;
  const plannedDays = plannedEnd ? inclusiveDays(leave.startDate, plannedEnd) : null;
  const inssReferralNeeded = Boolean(
    rule.employerPaidDays && (elapsedDays > rule.employerPaidDays || (plannedDays ?? 0) > rule.employerPaidDays),
  );
  let stabilityUntil: string | null = null;
  if (rule.stabilityMonthsFromStart) stabilityUntil = addMonthsIso(leave.startDate, rule.stabilityMonthsFromStart);
  if (rule.stabilityMonthsAfterReturn && leave.actualReturn && inssReferralNeeded) {
    stabilityUntil = addMonthsIso(leave.actualReturn, rule.stabilityMonthsAfterReturn);
  }
  const alerts: string[] = [];
  if (inssReferralNeeded && inssFrom) {
    alerts.push(`Afastamento acima de 15 dias: a partir de ${formatDateBr(inssFrom)} o pagamento é do INSS. Encaminhe à perícia.`);
  }
  if (rule.maxDays && (plannedDays ?? elapsedDays) > rule.maxDays) {
    alerts.push(`Limite legal de ${rule.maxDays} dias excedido (${rule.legalBasis}).`);
  }
  if (legalEnd && leave.expectedReturn && leave.expectedReturn !== addDaysIso(legalEnd, 1)) {
    alerts.push(`Retorno previsto difere do prazo legal: o fim legal é ${formatDateBr(legalEnd)}.`);
  }
  const dueReturn = leave.expectedReturn ?? (legalEnd ? addDaysIso(legalEnd, 1) : null);
  if (isLeaveOngoing(leave, todayIso) && dueReturn && dueReturn < todayIso) {
    alerts.push(`Retorno previsto para ${formatDateBr(dueReturn)} e ainda não registrado. Registre o retorno ou a prorrogação do afastamento.`);
  }
  if (leave.type === "ACCIDENT" && rule.stabilityMonthsAfterReturn && !leave.actualReturn && inssReferralNeeded) {
    alerts.push("Após o retorno, o colaborador terá 12 meses de estabilidade (Lei 8.213/1991, art. 118).");
  }
  return {
    type: leave.type,
    label: rule.label,
    legalBasis: rule.legalBasis,
    contractEffect: CONTRACT_EFFECT_LABELS[rule.contractEffect],
    payment: rule.payment,
    startDate: leave.startDate,
    elapsedDays,
    expectedReturn: leave.expectedReturn ?? (legalEnd ? addDaysIso(legalEnd, 1) : null),
    legalEnd,
    employerPaidUntil,
    inssFrom,
    inssReferralNeeded,
    fgtsContinues: rule.fgtsContinues,
    stabilityUntil,
    stabilityBasis: rule.stabilityBasis,
    requirements: rule.requirements,
    alerts,
    record:
      leave.reason || leave.inssBenefitNumber || leave.catNumber
        ? { justification: leave.reason ?? null, inssBenefitNumber: leave.inssBenefitNumber ?? null, catNumber: leave.catNumber ?? null }
        : null,
  };
}

export type LeaveValidationInput = {
  type: string;
  startDate: string | null;
  expectedReturn: string | null;
  endDate: string | null;
  actualReturn: string | null;
  justification: string | null;
  extendedLicense: boolean;
  employee: { status: string | null; admissionDate: string | null; terminationDate: string | null };
  /** Outros afastamentos do colaborador (para impedir sobreposição). */
  others: (LeaveFacts & { id: string })[];
  selfId?: string | null;
};

/** Erros que impedem gravar um afastamento (vazio = ok). Férias não passam por aqui. */
export function validateLeave(input: LeaveValidationInput): string[] {
  const errors: string[] = [];
  if (!isLeaveType(input.type)) return errors;
  const rule = LEAVE_RULES[input.type];
  const justification = (input.justification ?? "").trim();
  if (justification.length < LEAVE_JUSTIFICATION_MIN) {
    errors.push(`Informe a justificativa do afastamento (mínimo de ${LEAVE_JUSTIFICATION_MIN} caracteres).`);
  }
  if (justification.length > LEAVE_JUSTIFICATION_MAX) errors.push("Justificativa muito longa.");
  if (!input.startDate || !isIsoDate(input.startDate)) {
    errors.push("Informe a data de início do afastamento.");
    return errors;
  }
  if ((input.employee.status ?? "ACTIVE").toUpperCase() === "INACTIVE") {
    errors.push("Colaborador desligado não pode ser afastado.");
  }
  if (input.employee.admissionDate && input.startDate < input.employee.admissionDate) {
    errors.push("O afastamento não pode começar antes da admissão.");
  }
  if (input.employee.terminationDate && input.startDate > input.employee.terminationDate) {
    errors.push("O afastamento não pode começar depois do desligamento.");
  }
  for (const [label, value] of [
    ["retorno previsto", input.expectedReturn],
    ["fim", input.endDate],
    ["retorno efetivo", input.actualReturn],
  ] as const) {
    if (value && value < input.startDate) errors.push(`A data de ${label} não pode ser anterior ao início.`);
  }
  if (input.extendedLicense && !rule.extendedDays) {
    errors.push(`${rule.label} não tem prorrogação Empresa Cidadã.`);
  }
  if (rule.maxDays && input.expectedReturn) {
    const days = inclusiveDays(input.startDate, addDaysIso(input.expectedReturn, -1));
    if (days > rule.maxDays) errors.push(`${rule.label}: no máximo ${rule.maxDays} dias (${rule.legalBasis}).`);
  }
  // Limite exclusivo (dia do retorno); endDate é o último dia afastado.
  const exclusiveEnd = (l: { actualReturn?: string | null; expectedReturn?: string | null; endDate?: string | null }) =>
    l.actualReturn ?? l.expectedReturn ?? (l.endDate ? addDaysIso(l.endDate, 1) : "9999-12-31");
  const myEnd = exclusiveEnd(input);
  for (const other of input.others) {
    if (other.id === input.selfId || !isLeaveType(other.type) || other.status === "CANCELLED") continue;
    const otherEnd = exclusiveEnd(other);
    if (other.startDate < myEnd && input.startDate < otherEnd) {
      errors.push(`Já existe afastamento no período (${LEAVE_RULES[other.type].label}, desde ${formatDateBr(other.startDate)}).`);
      break;
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Desligamento
// ---------------------------------------------------------------------------

export const TERMINATION_REASONS = [
  "DISMISSAL_WITHOUT_CAUSE",
  "DISMISSAL_WITH_CAUSE",
  "RESIGNATION",
  "MUTUAL_AGREEMENT",
  "CONTRACT_END",
  "EARLY_END_BY_EMPLOYER",
  "EARLY_END_BY_EMPLOYEE",
  "INDIRECT_TERMINATION",
  "DEATH",
  "OTHER",
] as const;
export type TerminationReason = (typeof TERMINATION_REASONS)[number];

export const NOTICE_TYPES = ["WORKED", "INDEMNIFIED", "WAIVED", "NOT_APPLICABLE"] as const;
export type NoticeType = (typeof NOTICE_TYPES)[number];

export const NOTICE_TYPE_LABELS: Record<NoticeType, string> = {
  WORKED: "Trabalhado",
  INDEMNIFIED: "Indenizado",
  WAIVED: "Dispensado do cumprimento",
  NOT_APPLICABLE: "Não se aplica",
};

export type TerminationRule = {
  label: string;
  legalBasis: string;
  initiative: "EMPLOYER" | "EMPLOYEE" | "BOTH" | "NONE";
  /** Aviso prévio: tipos aceitos (o 1º é o padrão). */
  noticeTypes: NoticeType[];
  /** Exige descrição detalhada (falta grave, base legal). */
  requiresDetails: boolean;
  /** Verbas e direitos (texto de apoio para o DP). */
  rights: string[];
  /** Vedado durante afastamento em andamento / estabilidade. */
  blockedDuringLeave: boolean;
  respectsStability: boolean;
};

export const TERMINATION_RULES: Record<TerminationReason, TerminationRule> = {
  DISMISSAL_WITHOUT_CAUSE: {
    label: "Dispensa sem justa causa",
    legalBasis: "CLT, arts. 477 e 487; Lei 12.506/2011; Lei 8.036/1990, art. 18, § 1º",
    initiative: "EMPLOYER",
    noticeTypes: ["WORKED", "INDEMNIFIED"],
    requiresDetails: false,
    rights: [
      "Aviso prévio proporcional (30 dias + 3 por ano completo, até 90)",
      "Multa de 40% do FGTS e saque do saldo",
      "Seguro-desemprego",
      "Férias vencidas e proporcionais + 1/3; 13º proporcional",
    ],
    blockedDuringLeave: true,
    respectsStability: true,
  },
  DISMISSAL_WITH_CAUSE: {
    label: "Dispensa por justa causa",
    legalBasis: "CLT, art. 482",
    initiative: "EMPLOYER",
    noticeTypes: ["NOT_APPLICABLE"],
    requiresDetails: true,
    rights: ["Saldo de salário e férias vencidas + 1/3", "Sem aviso prévio, multa do FGTS ou seguro-desemprego"],
    blockedDuringLeave: false,
    respectsStability: false,
  },
  RESIGNATION: {
    label: "Pedido de demissão",
    legalBasis: "CLT, art. 487, § 2º",
    initiative: "EMPLOYEE",
    noticeTypes: ["WORKED", "WAIVED", "INDEMNIFIED"],
    requiresDetails: false,
    rights: [
      "Aviso prévio de 30 dias do empregado (sem cumprimento e sem dispensa: pode ser descontado)",
      "Férias vencidas e proporcionais + 1/3; 13º proporcional",
      "Sem multa do FGTS, saque ou seguro-desemprego",
    ],
    blockedDuringLeave: false,
    respectsStability: false,
  },
  MUTUAL_AGREEMENT: {
    label: "Acordo entre as partes",
    legalBasis: "CLT, art. 484-A",
    initiative: "BOTH",
    noticeTypes: ["INDEMNIFIED", "WORKED"],
    requiresDetails: false,
    rights: [
      "Metade do aviso prévio, se indenizado",
      "Multa de 20% do FGTS e saque de até 80% do saldo",
      "Sem seguro-desemprego",
    ],
    blockedDuringLeave: true,
    respectsStability: true,
  },
  CONTRACT_END: {
    label: "Término do contrato por prazo determinado / experiência",
    legalBasis: "CLT, arts. 443 e 445",
    initiative: "NONE",
    noticeTypes: ["NOT_APPLICABLE"],
    requiresDetails: false,
    rights: ["Saldo de salário, férias proporcionais + 1/3 e 13º proporcional", "Saque do FGTS, sem multa"],
    blockedDuringLeave: false,
    respectsStability: false,
  },
  EARLY_END_BY_EMPLOYER: {
    label: "Rescisão antecipada do contrato a prazo pelo empregador",
    legalBasis: "CLT, art. 479",
    initiative: "EMPLOYER",
    noticeTypes: ["NOT_APPLICABLE"],
    requiresDetails: false,
    rights: ["Indenização de metade da remuneração devida até o fim do contrato", "Multa de 40% do FGTS e saque"],
    blockedDuringLeave: true,
    respectsStability: true,
  },
  EARLY_END_BY_EMPLOYEE: {
    label: "Rescisão antecipada do contrato a prazo pelo empregado",
    legalBasis: "CLT, art. 480",
    initiative: "EMPLOYEE",
    noticeTypes: ["NOT_APPLICABLE"],
    requiresDetails: false,
    rights: ["O empregado pode ser obrigado a indenizar os prejuízos (limitado ao que receberia, art. 480, § 1º)"],
    blockedDuringLeave: false,
    respectsStability: false,
  },
  INDIRECT_TERMINATION: {
    label: "Rescisão indireta (falta grave do empregador)",
    legalBasis: "CLT, art. 483",
    initiative: "EMPLOYEE",
    noticeTypes: ["INDEMNIFIED"],
    requiresDetails: true,
    rights: ["Mesmas verbas da dispensa sem justa causa (normalmente reconhecida judicialmente)"],
    blockedDuringLeave: false,
    respectsStability: false,
  },
  DEATH: {
    label: "Falecimento do empregado",
    legalBasis: "Lei 6.858/1980 (pagamento aos dependentes)",
    initiative: "NONE",
    noticeTypes: ["NOT_APPLICABLE"],
    requiresDetails: false,
    rights: ["Verbas pagas aos dependentes habilitados no INSS ou sucessores (Lei 6.858/1980)"],
    blockedDuringLeave: false,
    respectsStability: false,
  },
  OTHER: {
    label: "Outro motivo",
    legalBasis: "Descrever a base legal",
    initiative: "NONE",
    noticeTypes: ["NOT_APPLICABLE", "WORKED", "INDEMNIFIED", "WAIVED"],
    requiresDetails: true,
    rights: [],
    blockedDuringLeave: false,
    respectsStability: false,
  },
};

export function isTerminationReason(value: unknown): value is TerminationReason {
  return typeof value === "string" && (TERMINATION_REASONS as readonly string[]).includes(value);
}

export function isNoticeType(value: unknown): value is NoticeType {
  return typeof value === "string" && (NOTICE_TYPES as readonly string[]).includes(value);
}

export const TERMINATION_DETAILS_MIN = 20;
export const TERMINATION_DETAILS_MAX = 4000;

/** Anos completos de serviço entre admissão e a data (aniversários completos). */
export function completedYears(admissionIso: string, atIso: string): number {
  const [ay, am, ad] = admissionIso.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = atIso.split("-").map(Number) as [number, number, number];
  let years = ty - ay;
  if (tm < am || (tm === am && td < ad)) years -= 1;
  return Math.max(0, years);
}

/**
 * Dias de aviso prévio: dispensa pelo empregador = proporcional (30 + 3 por ano completo,
 * até 90 — Lei 12.506/2011); acordo (art. 484-A) = metade; pedido de demissão = 30.
 */
export function noticeDays(reason: TerminationReason, admissionIso: string | null, terminationIso: string): number | null {
  if (reason === "RESIGNATION") return 30;
  if (reason !== "DISMISSAL_WITHOUT_CAUSE" && reason !== "MUTUAL_AGREEMENT" && reason !== "INDIRECT_TERMINATION") return null;
  const years = admissionIso ? completedYears(admissionIso, terminationIso) : 0;
  const full = Math.min(90, 30 + 3 * years);
  return reason === "MUTUAL_AGREEMENT" ? Math.ceil(full / 2) : full;
}

export type TerminationInput = {
  status: string;
  terminationDate: string | null;
  reason: string | null;
  noticeType: string | null;
  noticeDate: string | null;
  details: string | null;
};

export type ParsedTermination = {
  reason: TerminationReason;
  noticeType: NoticeType;
  noticeDate: string | null;
  details: string | null;
};

/**
 * Valida o desligamento (status INACTIVE). Retorna os campos normalizados ou a lista de erros.
 * `required = false` (registro legado já inativo sem motivo, editado em outro campo) pula a exigência.
 */
export function validateTermination(
  input: TerminationInput,
  ctx: { admissionDate: string | null; required: boolean },
): { ok: true; value: ParsedTermination | null } | { ok: false; errors: string[] } {
  const status = (input.status || "ACTIVE").toUpperCase();
  if (status !== "INACTIVE") return { ok: true, value: null };
  const hasAny = Boolean(input.reason || input.noticeType || input.noticeDate || input.details);
  if (!ctx.required && !hasAny) return { ok: true, value: null };
  const errors: string[] = [];
  if (!input.terminationDate || !isIsoDate(input.terminationDate)) errors.push("Informe a data de demissão.");
  if (!isTerminationReason(input.reason)) {
    errors.push("Informe o motivo do desligamento.");
    return { ok: false, errors };
  }
  const rule = TERMINATION_RULES[input.reason];
  const noticeType = isNoticeType(input.noticeType) ? input.noticeType : null;
  if (!noticeType) errors.push("Informe o aviso prévio.");
  else if (!rule.noticeTypes.includes(noticeType)) {
    errors.push(`Aviso prévio "${NOTICE_TYPE_LABELS[noticeType]}" não se aplica a ${rule.label.toLowerCase()}.`);
  }
  let noticeDate: string | null = null;
  if (noticeType === "WORKED" || noticeType === "INDEMNIFIED") {
    if (!input.noticeDate || !isIsoDate(input.noticeDate)) errors.push("Informe a data da comunicação do aviso prévio.");
    else noticeDate = input.noticeDate;
  }
  if (noticeDate && input.terminationDate && noticeDate > input.terminationDate) {
    errors.push("A comunicação do aviso prévio não pode ser posterior à data de demissão.");
  }
  if (noticeDate && ctx.admissionDate && noticeDate < ctx.admissionDate) {
    errors.push("A comunicação do aviso prévio não pode ser anterior à admissão.");
  }
  const details = (input.details ?? "").trim();
  if (rule.requiresDetails && details.length < TERMINATION_DETAILS_MIN) {
    errors.push(`Descreva os fatos e a base legal (mínimo de ${TERMINATION_DETAILS_MIN} caracteres) — exigido para ${rule.label.toLowerCase()}.`);
  }
  if (details.length > TERMINATION_DETAILS_MAX) errors.push("Descrição muito longa.");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { reason: input.reason, noticeType: noticeType!, noticeDate, details: details || null } };
}

export type TerminationInsight = {
  reason: TerminationReason;
  label: string;
  legalBasis: string;
  rights: string[];
  noticeType: NoticeType;
  noticeTypeLabel: string;
  noticeDays: number | null;
  /** Aviso trabalhado: último dia previsto. Indenizado: data projetada (integra o tempo de serviço — CLT, art. 487, § 1º). */
  noticeEnd: string | null;
  projectedEnd: string | null;
  yearsOfService: number | null;
};

export function describeTermination(
  t: ParsedTermination & { terminationDate: string },
  admissionIso: string | null,
): TerminationInsight {
  const rule = TERMINATION_RULES[t.reason];
  const days = t.noticeType === "WORKED" || t.noticeType === "INDEMNIFIED" ? noticeDays(t.reason, admissionIso, t.terminationDate) : null;
  const base = t.noticeDate ?? t.terminationDate;
  return {
    reason: t.reason,
    label: rule.label,
    legalBasis: rule.legalBasis,
    rights: rule.rights,
    noticeType: t.noticeType,
    noticeTypeLabel: NOTICE_TYPE_LABELS[t.noticeType],
    noticeDays: days,
    noticeEnd: t.noticeType === "WORKED" && days ? addDaysIso(base, days - 1) : null,
    projectedEnd: t.noticeType === "INDEMNIFIED" && days ? addDaysIso(base, days - 1) : null,
    yearsOfService: admissionIso ? completedYears(admissionIso, t.terminationDate) : null,
  };
}

export type TerminationGuard = { blocking: string[]; warnings: string[] };

/**
 * Conflitos do desligamento com afastamentos e estabilidades.
 * Bloqueia a dispensa por iniciativa do empregador (sem justa causa / acordo / antecipação)
 * com afastamento em andamento; avisa (exige ciência) dentro de estabilidade provisória.
 */
export function terminationGuards(input: {
  reason: TerminationReason;
  terminationDate: string;
  leaves: LeaveFacts[];
}): TerminationGuard {
  const rule = TERMINATION_RULES[input.reason];
  const blocking: string[] = [];
  const warnings: string[] = [];
  for (const leave of input.leaves) {
    if (!isLeaveType(leave.type)) continue;
    const insight = describeLeave(leave, input.terminationDate);
    if (!insight) continue;
    if (rule.blockedDuringLeave && isLeaveOngoing(leave, input.terminationDate)) {
      blocking.push(
        `Afastamento em andamento (${insight.label}, desde ${formatDateBr(leave.startDate)}): o contrato está ${
          LEAVE_RULES[leave.type].contractEffect === "INTERRUPTION" ? "interrompido" : "suspenso"
        } e não admite ${rule.label.toLowerCase()}. Registre o retorno antes.`,
      );
      continue;
    }
    if (rule.respectsStability && insight.stabilityUntil && input.terminationDate <= insight.stabilityUntil && leave.startDate <= input.terminationDate) {
      warnings.push(`Estabilidade provisória até ${formatDateBr(insight.stabilityUntil)}: ${insight.stabilityBasis}.`);
    }
  }
  return { blocking, warnings };
}

// ---------------------------------------------------------------------------
// Situação exibida no cadastro
// ---------------------------------------------------------------------------

export type EmployeeSituationCode = "ACTIVE" | "ON_LEAVE" | "VACATION" | "TERMINATED";

export const EMPLOYEE_SITUATION_LABELS: Record<EmployeeSituationCode, string> = {
  ACTIVE: "Ativo",
  ON_LEAVE: "Afastado",
  VACATION: "Férias",
  TERMINATED: "Desligado",
};

export type EmployeeSituation = {
  code: EmployeeSituationCode;
  label: string;
  /** Desde quando (início do afastamento/férias ou data de demissão). */
  since: string | null;
  leaveId: string | null;
  leave: LeaveInsight | null;
};

/** Situação: desligado (vínculo encerrado) > afastado > férias > ativo. */
export function computeEmployeeSituation(input: {
  status: string | null;
  terminationDate: string | null;
  absences: (LeaveFacts & { id: string })[];
  todayIso: string;
}): EmployeeSituation {
  if ((input.status ?? "ACTIVE").toUpperCase() === "INACTIVE") {
    return { code: "TERMINATED", label: EMPLOYEE_SITUATION_LABELS.TERMINATED, since: input.terminationDate, leaveId: null, leave: null };
  }
  const ongoing = input.absences
    .filter((a) => isLeaveOngoing(a, input.todayIso))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  if (ongoing) {
    return {
      code: "ON_LEAVE",
      label: EMPLOYEE_SITUATION_LABELS.ON_LEAVE,
      since: ongoing.startDate,
      leaveId: ongoing.id,
      leave: describeLeave(ongoing, input.todayIso),
    };
  }
  const vacation = input.absences.find(
    (a) =>
      a.type === "VACATION" &&
      a.status !== "CANCELLED" &&
      a.status !== "COMPLETED" &&
      a.startDate <= input.todayIso &&
      (!a.actualReturn || a.actualReturn > input.todayIso) &&
      (!a.endDate || a.endDate >= input.todayIso),
  );
  if (vacation) {
    return { code: "VACATION", label: EMPLOYEE_SITUATION_LABELS.VACATION, since: vacation.startDate, leaveId: vacation.id, leave: null };
  }
  return { code: "ACTIVE", label: EMPLOYEE_SITUATION_LABELS.ACTIVE, since: null, leaveId: null, leave: null };
}

export type EmployeeTerminationDto = TerminationInsight & {
  terminationDate: string;
  noticeDate: string | null;
  details: string | null;
};

export type EmployeeLifecycleDto = {
  situation: EmployeeSituation;
  termination: EmployeeTerminationDto | null;
};
