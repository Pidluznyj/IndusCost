/**
 * Metas (OKR) — service (única camada com I/O do módulo).
 *
 * Regras (docs/goal-engine-plan.md):
 *  - progresso do Goal/KR é DERIVADO (roll-up ponderado) — nunca aceito por input;
 *  - exclusão física só sem histórico (snapshot); com histórico vira ARCHIVED;
 *  - valor realizado manual grava `achievedValue` + upsert do snapshot do DIA
 *    CORRENTE (dias passados são imutáveis — RN-009);
 *  - KR com regra dinâmica (ruleJson validado contra o dicionário) tem
 *    manualTracking=false e é calculado pelo motor (job diário + refresh);
 *  - refresh sob demanda usa pg_try_advisory_xact_lock — o SEGUNDO clique
 *    recebe "já em processamento" (RN-008, anti duplo-clique no backend);
 *  - quotas: Σ(quotas) ≤ target — BLOQUEIO, validado em micros (BigInt),
 *    nunca float (RN-006/US-04);
 *  - KR herda o período do Goal pai, mas pode ter recorte PRÓPRIO (trimestre,
 *    semestre, datas livres). A janela realmente medida é sempre a interseção
 *    com o período do Goal — indicador nunca conta fora do período do pai.
 */

import type { PrismaClient } from "@prisma/client";
import {
  GOAL_TARGET_COMPARISON_MODE_LABELS,
  GoalContractError,
  classifyGoalTargetConfiguration,
  isDuplicateGoalKeyResult,
  computeGoalTargetFromComparison,
  resolveGoalMeasurementWindow,
  resolveGoalTargetComparisonWindow,
  type GoalKeyResultComparisonInput,
  type GoalTargetBasisValue,
  type GoalTargetComparisonModeValue,
  type GoalAchievedValueInput,
  type GoalCreateInput,
  type GoalDto,
  type GoalDomainValue,
  type GoalInitiativeCreateInput,
  type GoalInitiativeDto,
  type GoalInitiativeStatusValue,
  type GoalInitiativeUpdateInput,
  type GoalKeyResultCreateInput,
  type GoalKeyResultDto,
  type GoalKeyResultUpdateInput,
  type GoalQuotaDto,
  type GoalQuotaInput,
  type GoalKeyResultSeriesDto,
  type GoalMeasurementStatusValue,
  type GoalSeriesPointDto,
  type GoalSnapshotDto,
  type GoalStatusValue,
  type GoalTrackingTypeValue,
  type GoalUpdateInput,
  type GoalWizardInput,
} from "./goalContracts.js";
import {
  computeGoalKeyResultProgress,
  computeGoalRollup,
  progressRatioToPercent,
} from "./goalProgress.js";
import {
  accumulateGoalRuleMonths,
  executeGoalRule,
  executeGoalRuleMonthly,
  normalizeGoalRuleForPersist,
  resolveGoalRule,
} from "./goalRuleEngine.server.js";
import {
  goalSeriesMonthCivilDate,
  limitGoalSeriesToMonth,
  listGoalSeriesMonths,
} from "./goalSeries.js";
import {
  GOAL_METRIC_OPERATION_LABELS,
  findGoalMetadataEntity,
  findGoalMetadataMetric,
} from "./goalMetadata.js";

export type GoalDomainErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "BUSY"
  | "FORBIDDEN"
  | "MEASUREMENT_FAILED";

export class GoalDomainError extends Error {
  readonly code: GoalDomainErrorCode;
  constructor(code: GoalDomainErrorCode, message: string) {
    super(message);
    this.name = "GoalDomainError";
    this.code = code;
  }
}

// ─── Autorização por objeto ─────────────────────────────────────────────────

/**
 * Quem está agindo, resolvido na BORDA HTTP pela decisão canônica de
 * permissões (requireResource/authorizeRequest): `canManage` = admin.goals:
 * manage permitido. Chamadas internas (jobs/scripts) omitem o ator e são
 * tratadas como sistema confiável.
 *
 * Política (P0-B): possuir `update` NÃO significa editar qualquer meta —
 * update dá a capacidade; o VÍNCULO com o objeto dá o direito.
 */
export type GoalActor = {
  userId: string;
  canManage: boolean;
};

/** Owner do Goal ou manage. */
export function canActorEditGoal(
  actor: GoalActor,
  goal: { ownerAppUserId: string }
): boolean {
  return actor.canManage || goal.ownerAppUserId === actor.userId;
}

/** Owner do Goal, owner do KR ou manage. */
export function canActorEditKeyResult(
  actor: GoalActor,
  kr: { ownerAppUserId: string; goal: { ownerAppUserId: string } }
): boolean {
  return (
    actor.canManage ||
    kr.ownerAppUserId === actor.userId ||
    kr.goal.ownerAppUserId === actor.userId
  );
}

/**
 * Iniciativa: owner do Goal (quando ligada ao Goal), owner do KR ou do Goal
 * pai (quando ligada ao KR), manage sempre; o assignee pode atualizar o fluxo
 * operacional da PRÓPRIA iniciativa (allowAssignee) — mas não excluí-la.
 */
export function canActorTouchInitiative(
  actor: GoalActor,
  links: {
    goalOwnerAppUserId: string | null;
    keyResultOwnerAppUserId: string | null;
    assigneeAppUserId: string | null;
  },
  opts: { allowAssignee: boolean }
): boolean {
  if (actor.canManage) return true;
  if (links.goalOwnerAppUserId === actor.userId) return true;
  if (links.keyResultOwnerAppUserId === actor.userId) return true;
  if (opts.allowAssignee && links.assigneeAppUserId === actor.userId) return true;
  return false;
}

const GOAL_FORBIDDEN_MESSAGE =
  "Você não tem vínculo com esta meta — apenas o responsável (ou um gestor do módulo) pode alterá-la.";

function assertActor(allowed: boolean): void {
  if (!allowed) throw new GoalDomainError("FORBIDDEN", GOAL_FORBIDDEN_MESSAGE);
}

// ─── Medição — sanitização de erro ──────────────────────────────────────────

/**
 * Mensagem persistível de uma falha de medição: erros de domínio/contrato já
 * são frases pt-BR seguras; QUALQUER outro erro (Prisma, SQL, rede) vira
 * mensagem genérica — stack trace, SQL e segredos nunca chegam ao banco.
 */
export function sanitizeGoalMeasurementError(err: unknown): string {
  if (err instanceof GoalDomainError || err instanceof GoalContractError) {
    return err.message.slice(0, 300);
  }
  return "Erro interno ao executar a medição — os dados de origem não puderam ser lidos.";
}

/** Dia civil corrente em São Paulo (YYYY-MM-DD) — snapshots são por dia civil. */
export function todayGoalCivilDateInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Mês civil corrente em São Paulo (YYYY-MM) — TODA decisão de "mês corrente"
 * do módulo passa por aqui. Perto da meia-noite, o dia UTC já virou enquanto
 * o dia de negócio em São Paulo ainda não — cortar série pelo mês UTC faria
 * a curva "pular" um mês três horas antes da virada real.
 */
export function currentGoalCivilMonthInSaoPaulo(now: Date = new Date()): string {
  return todayGoalCivilDateInSaoPaulo(now).slice(0, 7);
}

/**
 * Invariante direção × base/alvo na borda do service (cobre alvo apurado por
 * COMPARISON, que só existe depois do cálculo). Mensagens em português e
 * cientes da origem do alvo.
 */
function assertGoalTargetDirectionOrDomainError(
  trackingType: GoalTrackingTypeValue,
  baseline: string,
  target: string,
  origin: "MANUAL" | "COMPARISON"
): void {
  const issue = classifyGoalTargetConfiguration(trackingType, baseline, target);
  if (issue == null) return;
  if (issue === "NO_INTERVAL") {
    throw new GoalDomainError(
      "VALIDATION_ERROR",
      origin === "COMPARISON"
        ? "O alvo apurado ficou igual à linha de base — ajuste o percentual ou o ponto de partida."
        : "Alvo não pode ser igual à linha de base (meta sem intervalo)."
    );
  }
  const comparisonPrefix =
    origin === "COMPARISON"
      ? `O alvo apurado pela comparação foi ${target}. `
      : "";
  throw new GoalDomainError(
    "VALIDATION_ERROR",
    trackingType === "INCREASE"
      ? `${comparisonPrefix}Meta de AUMENTO exige alvo maior que a linha de base (base ${baseline}, alvo ${target}). Aumente o alvo${origin === "COMPARISON" ? "/percentual" : ""} ou troque a direção para redução.`
      : `${comparisonPrefix}Meta de REDUÇÃO exige alvo menor que a linha de base (base ${baseline}, alvo ${target}). Diminua o alvo${origin === "COMPARISON" ? "/percentual" : ""} ou troque a direção para aumento.`
  );
}

function civilDateToUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** YYYY-MM-DD → DD/MM/AAAA (mensagens de erro em linguagem do usuário). */
function formatCivilBr(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

/** Decimal string → micros (6 casas) em BigInt — soma exata, nunca float. */
export function goalDecimalToMicros(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) {
    throw new GoalContractError(`Valor decimal inválido: ${value}`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]!);
  const frac = BigInt((match[3] ?? "").padEnd(6, "0") || "0");
  return sign * (whole * 1_000_000n + frac);
}

/** Frase leiga da regra para exibição nos cards. */
export function buildGoalRuleSummary(ruleJson: unknown): string | null {
  if (!ruleJson || typeof ruleJson !== "object") return null;
  const raw = ruleJson as Record<string, unknown>;
  const entity = findGoalMetadataEntity(String(raw.entityKey ?? ""));
  if (!entity) return null;
  const metric = findGoalMetadataMetric(entity, String(raw.metricKey ?? ""));
  if (!metric) return null;
  const filterCount = Array.isArray(raw.filters) ? raw.filters.length : 0;
  const filtersLabel =
    filterCount > 0
      ? ` com ${filterCount} regra${filterCount > 1 ? "s" : ""} de exceção`
      : "";
  // Métrica oficial diz a FONTE em texto leigo — nunca tabela/coluna/SQL.
  const sourceLabel = metric.sourceLabel ? ` — Fonte: ${metric.sourceLabel}` : "";
  return `${GOAL_METRIC_OPERATION_LABELS[metric.operation]} de "${metric.label}" em ${entity.label}${filtersLabel}${sourceLabel}`;
}

// ─── Row → DTO ──────────────────────────────────────────────────────────────

type QuotaRow = {
  id: string;
  assignedAppUserId: string;
  quotaValue: unknown;
  assignee?: { name: string } | null;
};

type KeyResultRow = {
  id: string;
  goalId: string;
  title: string;
  domain: string;
  trackingType: string;
  baseline: unknown;
  target: unknown;
  achievedValue: unknown;
  unit: string | null;
  weight: unknown;
  ownerAppUserId: string;
  manualTracking: boolean;
  ruleJson: unknown;
  status: string;
  updatedAt: Date;
  /** Estado canônico da medição (rows antigos podem não trazer — fallback). */
  measurementStatus?: string | null;
  lastMeasurementAt?: Date | null;
  lastMeasurementError?: string | null;
  /** Período próprio (null = herda o do Objetivo). */
  startDate?: Date | null;
  endDate?: Date | null;
  /** Alvo comparado (congelado no cadastro). */
  targetBasis?: string | null;
  comparisonMode?: string | null;
  comparisonStartDate?: Date | null;
  comparisonEndDate?: Date | null;
  comparisonValue?: unknown;
  comparisonPercent?: unknown;
  comparisonComputedAt?: Date | null;
  owner?: { name: string } | null;
  quotas?: QuotaRow[];
  versions?: Array<{
    version: number;
    source: string;
    createdAt: Date;
    actorName: string | null;
  }>;
};

/** Janela civil do Objetivo pai — necessária para resolver o período do KR. */
type GoalWindow = { startDate: string; endDate: string };

function civilFromDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function decimalToString(value: unknown): string {
  return value == null ? "0" : String(value);
}

function toQuotaDto(row: QuotaRow): GoalQuotaDto {
  return {
    id: row.id,
    assignedAppUserId: row.assignedAppUserId,
    assigneeName: row.assignee?.name ?? null,
    quotaValue: decimalToString(row.quotaValue),
  };
}

function toKeyResultDto(row: KeyResultRow, goalWindow: GoalWindow): GoalKeyResultDto {
  const baseline = decimalToString(row.baseline);
  const target = decimalToString(row.target);
  const achievedValue = decimalToString(row.achievedValue);
  // trackingType habilita a checagem de coerência: KR legado com direção
  // incompatível aparece SINALIZADO (configurationIssue) e com progresso 0 —
  // nunca corrigido em silêncio, nunca fingindo estar certo.
  const progress = computeGoalKeyResultProgress({
    baseline,
    target,
    achievedValue,
    trackingType: row.trackingType,
  });
  const startDate = civilFromDate(row.startDate);
  const endDate = civilFromDate(row.endDate);
  const window = resolveGoalMeasurementWindow({
    goalStartDate: goalWindow.startDate,
    goalEndDate: goalWindow.endDate,
    keyResultStartDate: startDate,
    keyResultEndDate: endDate,
  });
  return {
    id: row.id,
    goalId: row.goalId,
    title: row.title,
    domain: row.domain as GoalDomainValue,
    trackingType: row.trackingType as GoalTrackingTypeValue,
    baseline,
    target,
    achievedValue,
    unit: row.unit,
    weight: decimalToString(row.weight),
    ownerAppUserId: row.ownerAppUserId,
    ownerName: row.owner?.name ?? null,
    manualTracking: row.manualTracking,
    measurementStatus: (row.measurementStatus ??
      (row.manualTracking ? "MANUAL" : "OK")) as GoalMeasurementStatusValue,
    lastMeasurementAt: row.lastMeasurementAt
      ? row.lastMeasurementAt.toISOString()
      : null,
    lastMeasurementError: row.lastMeasurementError ?? null,
    status: row.status as GoalStatusValue,
    progressPercent: progressRatioToPercent(progress.ratio),
    invalidTargets: progress.invalidTargets,
    configurationIssue: progress.configurationIssue,
    hasRule: row.ruleJson != null,
    ruleSummary: buildGoalRuleSummary(row.ruleJson),
    configVersion: row.versions?.[0]?.version ?? 1,
    // "Alvo alterado em DD/MM por X": só quando o compromisso já MUDOU
    // (a versão inicial não é mudança).
    lastConfigChange:
      row.versions?.[0] && row.versions[0].source !== "CREATE"
        ? {
            at: row.versions[0].createdAt.toISOString(),
            version: row.versions[0].version,
            actorName: row.versions[0].actorName ?? null,
          }
        : null,
    targetBasis: (row.targetBasis ?? "MANUAL") as GoalTargetBasisValue,
    comparison:
      row.targetBasis === "COMPARISON" && row.comparisonMode
        ? {
            mode: row.comparisonMode as GoalTargetComparisonModeValue,
            modeLabel:
              GOAL_TARGET_COMPARISON_MODE_LABELS[
                row.comparisonMode as GoalTargetComparisonModeValue
              ],
            startDate: civilFromDate(row.comparisonStartDate) ?? "",
            endDate: civilFromDate(row.comparisonEndDate) ?? "",
            value: decimalToString(row.comparisonValue),
            percent: decimalToString(row.comparisonPercent),
            computedAt: row.comparisonComputedAt
              ? row.comparisonComputedAt.toISOString()
              : null,
          }
        : null,
    startDate,
    endDate,
    effectiveStartDate: window.startCivilDate,
    effectiveEndDate: window.endCivilDate,
    hasOwnPeriod:
      window.startCivilDate !== goalWindow.startDate ||
      window.endCivilDate !== goalWindow.endDate,
    quotas: (row.quotas ?? []).map(toQuotaDto),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type InitiativeRow = {
  id: string;
  goalId: string | null;
  keyResultId: string | null;
  title: string;
  status: string;
  assigneeAppUserId: string | null;
  dueDate: Date | null;
  createdAt: Date;
  assignee?: { name: string } | null;
};

function toInitiativeDto(row: InitiativeRow): GoalInitiativeDto {
  return {
    id: row.id,
    goalId: row.goalId,
    keyResultId: row.keyResultId,
    title: row.title,
    status: row.status as GoalInitiativeStatusValue,
    assigneeAppUserId: row.assigneeAppUserId,
    assigneeName: row.assignee?.name ?? null,
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

type GoalRow = {
  id: string;
  title: string;
  description: string | null;
  startDate: Date;
  endDate: Date;
  status: string;
  ownerAppUserId: string;
  createdAt: Date;
  updatedAt: Date;
  owner?: { name: string } | null;
  keyResults: KeyResultRow[];
  initiatives?: InitiativeRow[];
};

function toGoalDto(row: GoalRow, extraInitiatives: InitiativeRow[] = []): GoalDto {
  const goalWindow: GoalWindow = {
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
  };
  const keyResults = row.keyResults.map((kr) => toKeyResultDto(kr, goalWindow));
  const rollup = computeGoalRollup(
    row.keyResults.map((kr) => ({
      status: kr.status,
      weight: decimalToString(kr.weight),
      baseline: decimalToString(kr.baseline),
      target: decimalToString(kr.target),
      achievedValue: decimalToString(kr.achievedValue),
      trackingType: kr.trackingType,
    }))
  );
  const initiatives = [...(row.initiatives ?? []), ...extraInitiatives]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(toInitiativeDto);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
    status: row.status as GoalStatusValue,
    ownerAppUserId: row.ownerAppUserId,
    ownerName: row.owner?.name ?? null,
    progressPercent: progressRatioToPercent(rollup.ratio),
    activeKeyResults: rollup.activeKeyResults,
    invalidKeyResults: rollup.invalidKeyResults,
    keyResults,
    initiatives,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const KR_INCLUDE = {
  owner: { select: { name: true } },
  quotas: {
    orderBy: { sortOrder: "asc" as const },
    include: { assignee: { select: { name: true } } },
  },
  // Última versão do compromisso — alimenta configVersion/lastConfigChange.
  versions: {
    orderBy: { version: "desc" as const },
    take: 1,
    select: {
      version: true,
      source: true,
      createdAt: true,
      actorName: true,
    },
  },
};

const GOAL_INCLUDE = {
  owner: { select: { name: true } },
  keyResults: {
    orderBy: { createdAt: "asc" as const },
    include: KR_INCLUDE,
  },
};

const GOAL_DETAIL_INCLUDE = {
  ...GOAL_INCLUDE,
  initiatives: {
    orderBy: { createdAt: "asc" as const },
    include: { assignee: { select: { name: true } } },
  },
};

export type GoalListFilters = {
  /** Filtra Objetivos/KRs onde o usuário é Owner ("Minhas Metas"). */
  ownerAppUserId?: string | null;
  status?: GoalStatusValue | null;
  includeArchived?: boolean;
  /** Ano de referência (interseção com o período do Objetivo). */
  year?: number | null;
};

export function createGoalService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps;

  async function requireGoal(id: string, detail = false) {
    const row = await prisma.goal.findUnique({
      where: { id },
      include: detail ? GOAL_DETAIL_INCLUDE : GOAL_INCLUDE,
    });
    if (!row) throw new GoalDomainError("NOT_FOUND", "Objetivo não encontrado.");
    return row;
  }

  async function requireKeyResult(id: string) {
    const row = await prisma.goalKeyResult.findUnique({
      where: { id },
      include: { ...KR_INCLUDE, goal: true },
    });
    if (!row) throw new GoalDomainError("NOT_FOUND", "Key Result não encontrado.");
    return row;
  }

  /** Valida Σ(quotas) ≤ target em micros (BigInt) — RN-006. */
  function assertQuotasWithinTarget(target: string, quotas: GoalQuotaInput[]): void {
    const targetMicros = goalDecimalToMicros(target);
    let sum = 0n;
    for (const quota of quotas) sum += goalDecimalToMicros(quota.quotaValue);
    if (sum > targetMicros) {
      throw new GoalDomainError(
        "VALIDATION_ERROR",
        "A soma das cotas ultrapassa o alvo do indicador — ajuste as fatias."
      );
    }
  }

  // ─── Versionamento do compromisso + auditoria (P3) ───────────────────────

  /** Linha de KR com os campos que DEFINEM o compromisso. */
  type KrConfigRow = {
    id: string;
    title: string;
    trackingType: string;
    baseline: unknown;
    target: unknown;
    weight: unknown;
    unit: string | null;
    ownerAppUserId: string;
    status: string;
    startDate?: Date | null;
    endDate?: Date | null;
    targetBasis?: string | null;
    comparisonMode?: string | null;
    comparisonValue?: unknown;
    comparisonPercent?: unknown;
    ruleJson?: unknown;
  };

  /**
   * Assinatura da CONFIGURAÇÃO (nunca do valor realizado): mudança relevante
   * = assinatura diferente → nova versão. Mudança irrelevante (ex.: salvar
   * sem alterar nada) não duplica versão.
   */
  function krConfigSignature(kr: KrConfigRow): string {
    return JSON.stringify({
      title: kr.title,
      trackingType: kr.trackingType,
      baseline: decimalToString(kr.baseline),
      target: decimalToString(kr.target),
      weight: decimalToString(kr.weight),
      unit: kr.unit ?? null,
      ownerAppUserId: kr.ownerAppUserId,
      status: kr.status,
      startDate: civilFromDate(kr.startDate),
      endDate: civilFromDate(kr.endDate),
      targetBasis: kr.targetBasis ?? "MANUAL",
      comparisonMode: kr.comparisonMode ?? null,
      comparisonValue:
        kr.comparisonValue == null ? null : decimalToString(kr.comparisonValue),
      comparisonPercent:
        kr.comparisonPercent == null ? null : decimalToString(kr.comparisonPercent),
      // Duas leituras do MESMO banco têm ordenação jsonb estável.
      rule: JSON.stringify(kr.ruleJson ?? null),
    });
  }

  async function resolveActorName(actorUserId?: string | null): Promise<string | null> {
    if (!actorUserId) return null;
    try {
      const user = await prisma.appUser.findUnique({
        where: { id: actorUserId },
        select: { name: true },
      });
      return user?.name ?? null;
    } catch {
      return null;
    }
  }

  /** Dados imutáveis de uma versão a partir da linha ATUAL do KR. */
  function krVersionData(
    kr: KrConfigRow,
    version: number,
    source: "CREATE" | "UPDATE" | "SYSTEM",
    actorUserId: string | null,
    actorName: string | null,
    reason?: string | null
  ) {
    return {
      keyResultId: kr.id,
      version,
      source,
      actorUserId,
      actorName,
      reason: reason ?? null,
      title: kr.title,
      trackingType: kr.trackingType,
      baseline: decimalToString(kr.baseline),
      target: decimalToString(kr.target),
      weight: decimalToString(kr.weight),
      unit: kr.unit,
      ownerAppUserId: kr.ownerAppUserId,
      status: kr.status,
      startDate: kr.startDate ?? null,
      endDate: kr.endDate ?? null,
      targetBasis: kr.targetBasis ?? "MANUAL",
      comparisonMode: kr.comparisonMode ?? null,
      comparisonValue:
        kr.comparisonValue == null ? null : decimalToString(kr.comparisonValue),
      comparisonPercent:
        kr.comparisonPercent == null ? null : decimalToString(kr.comparisonPercent),
      ruleJson: kr.ruleJson ?? undefined,
    } as never;
  }

  async function writeSnapshot(
    keyResultId: string,
    achievedValue: string,
    ratio: number,
    source: "MANUAL" | "ENGINE" | "REFRESH",
    now: Date
  ): Promise<void> {
    const snapshotDate = civilDateToUtc(todayGoalCivilDateInSaoPaulo(now));
    await prisma.goalKeyResultSnapshot.upsert({
      where: { keyResultId_snapshotDate: { keyResultId, snapshotDate } },
      create: {
        keyResultId,
        snapshotDate,
        achievedValue,
        progressRatio: ratio.toFixed(6),
        source,
      },
      update: {
        achievedValue,
        progressRatio: ratio.toFixed(6),
        source,
      },
    });
  }

  /**
   * Janela de medição do KR: período próprio quando existe, senão o do
   * Objetivo — sempre recortado pela janela do Objetivo (RN: o indicador
   * nunca conta o que aconteceu fora do período do pai).
   */
  function keyResultWindow(kr: {
    startDate?: Date | null;
    endDate?: Date | null;
    goal: { startDate: Date; endDate: Date };
  }) {
    return resolveGoalMeasurementWindow({
      goalStartDate: kr.goal.startDate.toISOString().slice(0, 10),
      goalEndDate: kr.goal.endDate.toISOString().slice(0, 10),
      keyResultStartDate: civilFromDate(kr.startDate),
      keyResultEndDate: civilFromDate(kr.endDate),
    });
  }

  /**
   * Valida o período próprio do indicador contra a janela do Objetivo —
   * bloqueio, não aviso: um indicador fora do período do pai mediria algo que
   * o compromisso não cobre.
   */
  function assertPeriodWithinGoal(
    goal: { startDate: Date; endDate: Date; title: string },
    startDate: string | null,
    endDate: string | null
  ): void {
    const goalStart = goal.startDate.toISOString().slice(0, 10);
    const goalEnd = goal.endDate.toISOString().slice(0, 10);
    const outside =
      (startDate != null && (startDate < goalStart || startDate > goalEnd)) ||
      (endDate != null && (endDate < goalStart || endDate > goalEnd));
    if (outside) {
      throw new GoalDomainError(
        "VALIDATION_ERROR",
        `O período do indicador precisa ficar dentro do período do objetivo (${formatCivilBr(goalStart)} a ${formatCivilBr(goalEnd)}).`
      );
    }
    if (startDate && endDate && endDate < startDate) {
      throw new GoalDomainError(
        "VALIDATION_ERROR",
        "A data final do indicador não pode ser anterior à inicial."
      );
    }
  }

  /**
   * Alvo derivado de período anterior: mede a MESMA regra na janela de
   * comparação e aplica o percentual.
   *
   * O valor apurado é CONGELADO junto com a janela e o instante da apuração.
   * Recalcular a cada leitura faria o alvo mudar sozinho — e o sync do Nomus
   * reescreve pedidos antigos, então "o ano passado" muda de valor com o
   * tempo. Compromisso que se move não é compromisso; quem quiser atualizar
   * salva o indicador de novo e vê o novo número antes de confirmar.
   */
  async function resolveComparisonTarget(args: {
    ruleJson: unknown;
    trackingType: GoalTrackingTypeValue;
    measuredWindow: { startCivilDate: string; endCivilDate: string };
    comparison: GoalKeyResultComparisonInput;
  }): Promise<{
    target: string;
    comparisonValue: string;
    window: { startCivilDate: string; endCivilDate: string };
    computedAt: Date;
  }> {
    if (args.ruleJson == null) {
      throw new GoalDomainError(
        "VALIDATION_ERROR",
        "Só dá para comparar com um período anterior quando o sistema mede sozinho — neste indicador o número é informado por você."
      );
    }
    const window = resolveGoalTargetComparisonWindow({
      measuredStartDate: args.measuredWindow.startCivilDate,
      measuredEndDate: args.measuredWindow.endCivilDate,
      mode: args.comparison.mode,
      customStartDate: args.comparison.startDate,
      customEndDate: args.comparison.endDate,
    });
    if (!window) {
      throw new GoalDomainError(
        "VALIDATION_ERROR",
        "Não foi possível montar o período de comparação — revise as datas."
      );
    }
    const comparisonValue = await executeGoalRule(prisma, args.ruleJson, window);
    const target = computeGoalTargetFromComparison({
      comparisonValue,
      percent: args.comparison.percent,
      trackingType: args.trackingType,
    });
    return { target, comparisonValue, window, computedAt: new Date() };
  }

  type MeasurableKr = {
    id: string;
    ruleJson: unknown;
    baseline: unknown;
    target: unknown;
    trackingType?: string;
    startDate?: Date | null;
    endDate?: Date | null;
    goal: { startDate: Date; endDate: Date };
  };

  type GoalMeasurementOutcome =
    | { ok: true; achievedValue: string }
    | { ok: false; error: string };

  /**
   * Caminho ÚNICO da medição automática — primeira leitura, refresh manual e
   * job diário passam todos por aqui:
   *  - advisory lock por KR dentro da transação: duas medições do mesmo
   *    indicador nunca rodam juntas (a segunda recebe BUSY);
   *  - sucesso: valor + measurementStatus OK + lastMeasurementAt + snapshot
   *    idempotente do dia, tudo na mesma transação curta;
   *  - falha da REGRA: não lança — registra ERROR com mensagem SANITIZADA,
   *    PRESERVA o último achievedValue válido (nunca vira zero) e devolve o
   *    outcome para o chamador decidir a resposta.
   * BUSY é a única exceção que escapa (o chamador informa/pula).
   */
  async function measureKeyResult(
    kr: MeasurableKr,
    source: "ENGINE" | "REFRESH",
    now: Date
  ): Promise<GoalMeasurementOutcome> {
    const lockKey = hashGoalLockKey(kr.id);
    try {
      const achievedValue = await prisma.$transaction(async (tx) => {
        const lockRows = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(${0x60a15}::int, ${lockKey}::int) AS locked
        `;
        if (!lockRows[0]?.locked) {
          throw new GoalDomainError(
            "BUSY",
            "Este indicador já está sendo recalculado — aguarde alguns segundos."
          );
        }
        const value = await executeGoalRule(
          tx as unknown as PrismaClient,
          kr.ruleJson,
          keyResultWindow(kr)
        );
        const progress = computeGoalKeyResultProgress({
          baseline: decimalToString(kr.baseline),
          target: decimalToString(kr.target),
          achievedValue: value,
          trackingType: kr.trackingType,
        });
        await tx.goalKeyResult.update({
          where: { id: kr.id },
          data: {
            achievedValue: value,
            measurementStatus: "OK",
            lastMeasurementAt: now,
            lastMeasurementError: null,
          },
        });
        const snapshotDate = civilDateToUtc(todayGoalCivilDateInSaoPaulo(now));
        await tx.goalKeyResultSnapshot.upsert({
          where: { keyResultId_snapshotDate: { keyResultId: kr.id, snapshotDate } },
          create: {
            keyResultId: kr.id,
            snapshotDate,
            achievedValue: value,
            progressRatio: progress.ratio.toFixed(6),
            source,
          },
          update: {
            achievedValue: value,
            progressRatio: progress.ratio.toFixed(6),
            source,
          },
        });
        return value;
      });
      return { ok: true, achievedValue };
    } catch (err) {
      if (err instanceof GoalDomainError && err.code === "BUSY") throw err;
      const message = sanitizeGoalMeasurementError(err);
      console.error(`[goals] medição do indicador ${kr.id} falhou (${source})`, err);
      // Registro da falha FORA da transação abortada: estado ERROR + mensagem;
      // achievedValue fica intocado — o último valor válido permanece visível.
      try {
        await prisma.goalKeyResult.update({
          where: { id: kr.id },
          data: { measurementStatus: "ERROR", lastMeasurementError: message },
        });
      } catch (recordErr) {
        console.error(
          `[goals] falha ao registrar erro de medição do indicador ${kr.id}`,
          recordErr
        );
      }
      return { ok: false, error: message };
    }
  }

  const service = {
    async listGoals(filters: GoalListFilters): Promise<GoalDto[]> {
      const yearWindow =
        filters.year != null
          ? {
              startDate: { lte: civilDateToUtc(`${filters.year}-12-31`) },
              endDate: { gte: civilDateToUtc(`${filters.year}-01-01`) },
            }
          : {};
      const rows = await prisma.goal.findMany({
        where: {
          ...(filters.includeArchived ? {} : { status: { not: "ARCHIVED" } }),
          ...(filters.status ? { status: filters.status } : {}),
          ...yearWindow,
          ...(filters.ownerAppUserId
            ? {
                OR: [
                  { ownerAppUserId: filters.ownerAppUserId },
                  { keyResults: { some: { ownerAppUserId: filters.ownerAppUserId } } },
                  {
                    keyResults: {
                      some: {
                        quotas: { some: { assignedAppUserId: filters.ownerAppUserId } },
                      },
                    },
                  },
                ],
              }
            : {}),
        },
        include: GOAL_INCLUDE,
        orderBy: [{ status: "asc" }, { endDate: "asc" }],
      });
      return rows.map((r) => toGoalDto(r as unknown as GoalRow));
    },

    async getGoal(id: string): Promise<GoalDto> {
      const row = await requireGoal(id, true);
      // Iniciativas dos KRs do objetivo entram no mesmo board.
      const krInitiatives = await prisma.goalInitiative.findMany({
        where: { keyResult: { goalId: id } },
        include: { assignee: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      });
      return toGoalDto(
        row as unknown as GoalRow,
        krInitiatives as unknown as InitiativeRow[]
      );
    },

    async createGoal(input: GoalCreateInput, actorUserId: string): Promise<GoalDto> {
      const created = await prisma.goal.create({
        data: {
          title: input.title,
          description: input.description,
          startDate: civilDateToUtc(input.startDate),
          endDate: civilDateToUtc(input.endDate),
          status: input.status,
          ownerAppUserId: input.ownerAppUserId,
          createdByUserId: actorUserId,
        },
        include: GOAL_INCLUDE,
      });
      return toGoalDto(created as unknown as GoalRow);
    },

    async updateGoal(
      id: string,
      input: GoalUpdateInput,
      actor?: GoalActor
    ): Promise<GoalDto> {
      const current = await requireGoal(id);
      if (actor) assertActor(canActorEditGoal(actor, current));
      const startDate = input.startDate
        ? civilDateToUtc(input.startDate)
        : current.startDate;
      const endDate = input.endDate ? civilDateToUtc(input.endDate) : current.endDate;
      if (endDate < startDate) {
        throw new GoalDomainError(
          "VALIDATION_ERROR",
          "Data fim não pode ser anterior à data início."
        );
      }
      // ATÔMICO: update do Objetivo + aparo dos recortes dos indicadores +
      // releitura na MESMA transação — período do pai e dos filhos nunca
      // ficam parcialmente aplicados (falhou qualquer passo, nada muda).
      const goalEditorName = await resolveActorName(actor?.userId);
      const dtoRow = await prisma.$transaction(async (tx) => {
        const updated = await tx.goal.update({
          where: { id },
          data: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            ...(input.startDate !== undefined ? { startDate } : {}),
            ...(input.endDate !== undefined ? { endDate } : {}),
            ...(input.status !== undefined
              ? {
                  status: input.status,
                  archivedAt: input.status === "ARCHIVED" ? new Date() : null,
                }
              : {}),
            ...(input.ownerAppUserId !== undefined
              ? { ownerAppUserId: input.ownerAppUserId }
              : {}),
          },
          include: GOAL_INCLUDE,
        });
        // Encolheu o período do Objetivo? Os recortes próprios dos indicadores
        // são aparados para dentro da nova janela — nenhum indicador mede fora
        // do período do pai, nem sequer no histórico do que foi cadastrado.
        // Auditoria: mudanças relevantes do Objetivo ficam na trilha.
        const relevant = (["title", "status", "ownerAppUserId"] as const).filter(
          (field) => input[field] !== undefined && input[field] !== (current as never)[field]
        );
        const periodChanged =
          (input.startDate !== undefined &&
            startDate.getTime() !== current.startDate.getTime()) ||
          (input.endDate !== undefined && endDate.getTime() !== current.endDate.getTime());
        if (relevant.length > 0 || periodChanged) {
          await tx.goalAuditLog.create({
            data: {
              entityType: "GOAL",
              entityId: id,
              action: "UPDATE",
              beforeJson: {
                title: current.title,
                startDate: current.startDate.toISOString().slice(0, 10),
                endDate: current.endDate.toISOString().slice(0, 10),
                ownerAppUserId: current.ownerAppUserId,
                status: current.status,
              },
              afterJson: {
                title: input.title ?? current.title,
                startDate: startDate.toISOString().slice(0, 10),
                endDate: endDate.toISOString().slice(0, 10),
                ownerAppUserId: input.ownerAppUserId ?? current.ownerAppUserId,
                status: input.status ?? current.status,
              },
              actorUserId: actor?.userId || null,
            },
          });
        }
        if (input.startDate !== undefined || input.endDate !== undefined) {
          // KRs que SERÃO aparados ganham versão SYSTEM — o compromisso deles
          // mudou (mesmo que por consequência do pai), e isso fica registrado.
          const affected = await tx.goalKeyResult.findMany({
            where: {
              goalId: id,
              OR: [
                { startDate: { lt: startDate } },
                { startDate: { gt: endDate } },
                { endDate: { gt: endDate } },
                { endDate: { lt: startDate } },
              ],
            },
            select: { id: true },
          });
          await tx.goalKeyResult.updateMany({
            where: { goalId: id, startDate: { lt: startDate } },
            data: { startDate },
          });
          await tx.goalKeyResult.updateMany({
            where: { goalId: id, startDate: { gt: endDate } },
            data: { startDate: endDate },
          });
          await tx.goalKeyResult.updateMany({
            where: { goalId: id, endDate: { gt: endDate } },
            data: { endDate },
          });
          await tx.goalKeyResult.updateMany({
            where: { goalId: id, endDate: { lt: startDate } },
            data: { endDate: startDate },
          });
          for (const { id: krId } of affected) {
            const fresh = await tx.goalKeyResult.findUnique({
              where: { id: krId },
              include: {
                versions: {
                  orderBy: { version: "desc" as const },
                  take: 1,
                  select: { version: true },
                },
              },
            });
            if (!fresh) continue;
            await tx.goalKeyResultVersion.create({
              data: krVersionData(
                fresh as unknown as KrConfigRow,
                ((fresh as unknown as { versions?: Array<{ version: number }> })
                  .versions?.[0]?.version ?? 1) + 1,
                "SYSTEM",
                actor?.userId ?? null,
                goalEditorName,
                "Período aparado pela alteração do período do Objetivo."
              ),
            });
          }
          const reread = await tx.goal.findUnique({
            where: { id },
            include: GOAL_INCLUDE,
          });
          if (!reread) throw new GoalDomainError("NOT_FOUND", "Objetivo não encontrado.");
          return reread;
        }
        return updated;
      });
      return toGoalDto(dtoRow as unknown as GoalRow);
    },

    /**
     * RN-001: exclusão física só sem histórico de processamento; caso
     * contrário arquiva (soft-delete) — Objetivo e KRs.
     */
    async deleteGoal(
      id: string,
      actor?: GoalActor
    ): Promise<{ deleted: boolean; archived: boolean }> {
      const current = await requireGoal(id);
      // Excluir/arquivar é ato administrativo: manage, sempre (a rota já
      // exige; a checagem aqui cobre qualquer chamador direto do service).
      if (actor) assertActor(actor.canManage);
      const [snapshotCount, changeVersionCount] = await Promise.all([
        prisma.goalKeyResultSnapshot.count({ where: { keyResult: { goalId: id } } }),
        // Alguma versão além da inicial em qualquer KR = histórico relevante.
        prisma.goalKeyResultVersion.count({
          where: { keyResult: { goalId: id }, version: { gt: 1 } },
        }),
      ]);
      if (snapshotCount === 0 && changeVersionCount === 0) {
        await prisma.goalInitiative.deleteMany({
          where: { OR: [{ goalId: id }, { keyResult: { goalId: id } }] },
        });
        await prisma.goalKeyResultQuota.deleteMany({
          where: { keyResult: { goalId: id } },
        });
        // Versões iniciais caem por cascade junto com os KRs.
        await prisma.goalKeyResult.deleteMany({ where: { goalId: id } });
        await prisma.goal.delete({ where: { id } });
        await prisma.goalAuditLog.create({
          data: {
            entityType: "GOAL",
            entityId: id,
            action: "DELETE",
            actorUserId: actor?.userId || null,
          },
        });
        return { deleted: true, archived: false };
      }
      await prisma.goalKeyResult.updateMany({
        where: { goalId: id, status: { not: "ARCHIVED" } },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      await prisma.goal.update({
        where: { id: current.id },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      await prisma.goalAuditLog.create({
        data: {
          entityType: "GOAL",
          entityId: id,
          action: "ARCHIVE",
          actorUserId: actor?.userId || null,
        },
      });
      return { deleted: false, archived: true };
    },

    async createKeyResult(
      goalId: string,
      input: GoalKeyResultCreateInput & { rule?: unknown | null },
      actor?: GoalActor
    ): Promise<GoalKeyResultDto> {
      return service.createKeyResultWithQuotas(goalId, input, [], actor);
    },

    /**
     * Caminho ATÔMICO do wizard: indicador + cotas nascem na MESMA transação.
     * Cota inválida → o KR não nasce (nada de estado parcial). A primeira
     * medição (consulta pesada) roda DEPOIS da transação e registra o estado
     * explicitamente (PENDING → OK/ERROR) — nunca dentro dela.
     */
    async createKeyResultWithQuotas(
      goalId: string,
      input: GoalKeyResultCreateInput & { rule?: unknown | null },
      quotas: GoalQuotaInput[],
      actor?: GoalActor
    ): Promise<GoalKeyResultDto> {
      const goal = await requireGoal(goalId);
      if (actor) assertActor(canActorEditGoal(actor, goal));
      if (goal.status === "ARCHIVED") {
        throw new GoalDomainError("CONFLICT", "Objetivo arquivado não recebe novos KRs.");
      }
      const rule = input.rule != null ? normalizeGoalRuleForPersist(input.rule) : null;
      const startDate = input.startDate ?? null;
      const endDate = input.endDate ?? null;
      assertPeriodWithinGoal(goal, startDate, endDate);

      // Alvo comparado: apura a mesma regra na janela anterior e congela.
      let resolvedTarget = input.target;
      let comparisonData: Record<string, unknown> = {};
      if (input.targetBasis === "COMPARISON" && input.comparison) {
        const measuredWindow = resolveGoalMeasurementWindow({
          goalStartDate: goal.startDate.toISOString().slice(0, 10),
          goalEndDate: goal.endDate.toISOString().slice(0, 10),
          keyResultStartDate: startDate,
          keyResultEndDate: endDate,
        });
        const resolved = await resolveComparisonTarget({
          ruleJson: rule,
          trackingType: input.trackingType,
          measuredWindow,
          comparison: input.comparison,
        });
        resolvedTarget = resolved.target;
        comparisonData = {
          targetBasis: "COMPARISON",
          comparisonMode: input.comparison.mode,
          comparisonStartDate: civilDateToUtc(resolved.window.startCivilDate),
          comparisonEndDate: civilDateToUtc(resolved.window.endCivilDate),
          comparisonValue: resolved.comparisonValue,
          comparisonPercent: input.comparison.percent,
          comparisonComputedAt: resolved.computedAt,
        };
      }
      if (resolvedTarget == null) {
        throw new GoalDomainError("VALIDATION_ERROR", "Informe o alvo do indicador.");
      }
      assertGoalTargetDirectionOrDomainError(
        input.trackingType,
        input.baseline,
        resolvedTarget,
        input.targetBasis === "COMPARISON" ? "COMPARISON" : "MANUAL"
      );
      // Cotas validadas ANTES de qualquer escrita: se a soma estoura o alvo,
      // nem o indicador nasce.
      assertQuotasWithinTarget(resolvedTarget, quotas);

      // Trava de duplicidade: uma tentativa que falhou DEPOIS da gravação (ex.:
      // erro ao salvar as fatias, queda de rede lendo a resposta) deixa o
      // indicador criado, e o usuário — vendo a mensagem de erro — clica de
      // novo. Sem esta trava, cada nova tentativa criava outro indicador
      // idêntico e a lista virava um borrão de linhas iguais.
      const sameTitle = await prisma.goalKeyResult.findMany({
        where: { goalId, title: input.title },
        select: {
          id: true,
          title: true,
          trackingType: true,
          baseline: true,
          target: true,
          unit: true,
          ruleJson: true,
        },
      });
      const signature = {
        title: input.title,
        trackingType: input.trackingType,
        baseline: input.baseline,
        target: resolvedTarget,
        unit: input.unit,
        ruleJson: rule,
      };
      if (
        sameTitle.some((existing) =>
          isDuplicateGoalKeyResult(signature, {
            title: existing.title,
            trackingType: existing.trackingType,
            baseline: decimalToString(existing.baseline),
            target: decimalToString(existing.target),
            unit: existing.unit,
            ruleJson: existing.ruleJson ?? null,
          })
        )
      ) {
        throw new GoalDomainError(
          "CONFLICT",
          "Este objetivo já tem um indicador idêntico (mesmo título, mesma medição e mesmo alvo). " +
            "Se a tentativa anterior mostrou erro, ela pode ter sido salva mesmo assim — confira a lista antes de criar outro."
        );
      }

      // ATÔMICO: indicador + cotas na mesma transação — falha em qualquer
      // cota desfaz tudo (o KR não fica órfão de configuração).
      const creatorName = await resolveActorName(actor?.userId);
      const created = await prisma.$transaction(async (tx) => {
        const kr = await tx.goalKeyResult.create({
          data: {
            goalId,
            title: input.title,
            domain: input.domain,
            trackingType: input.trackingType,
            baseline: input.baseline,
            target: resolvedTarget,
            ...comparisonData,
            achievedValue: input.baseline,
            unit: input.unit,
            weight: input.weight,
            ownerAppUserId: input.ownerAppUserId,
            manualTracking: rule == null,
            ruleJson: rule ?? undefined,
            // Automático nasce PENDING: baseline exibida NÃO é medição.
            measurementStatus: rule == null ? "MANUAL" : "PENDING",
            startDate: startDate ? civilDateToUtc(startDate) : null,
            endDate: endDate ? civilDateToUtc(endDate) : null,
          },
        });
        for (const [index, quota] of quotas.entries()) {
          await tx.goalKeyResultQuota.create({
            data: {
              keyResultId: kr.id,
              assignedAppUserId: quota.assignedAppUserId,
              quotaValue: quota.quotaValue,
              sortOrder: index,
            },
          });
        }
        // Versão INICIAL do compromisso — nasce junto, na mesma transação.
        await tx.goalKeyResultVersion.create({
          data: krVersionData(
            kr as unknown as KrConfigRow,
            1,
            "CREATE",
            actor?.userId ?? null,
            creatorName
          ),
        });
        return kr;
      });
      // Primeira leitura do motor FORA da transação (consulta pesada não
      // segura a gravação). Falha não desfaz a criação — vira estado ERROR
      // persistido + sinal transitório na resposta; PENDING/ERROR dizem ao
      // usuário que o número exibido ainda é a linha de base.
      let firstMeasurementFailed = false;
      if (rule != null) {
        try {
          const outcome = await measureKeyResult(
            {
              id: created.id,
              ruleJson: created.ruleJson,
              baseline: created.baseline,
              target: created.target,
              trackingType: created.trackingType,
              startDate: created.startDate,
              endDate: created.endDate,
              goal: { startDate: goal.startDate, endDate: goal.endDate },
            },
            "REFRESH",
            new Date()
          );
          firstMeasurementFailed = !outcome.ok;
        } catch {
          // BUSY (medição concorrente) — improvável num KR recém-criado;
          // fica PENDING e o job cobre.
          firstMeasurementFailed = true;
        }
      }
      const fresh = await prisma.goalKeyResult.findUniqueOrThrow({
        where: { id: created.id },
        include: KR_INCLUDE,
      });
      const dto = toKeyResultDto(fresh as unknown as KeyResultRow, {
        startDate: goal.startDate.toISOString().slice(0, 10),
        endDate: goal.endDate.toISOString().slice(0, 10),
      });
      return firstMeasurementFailed ? { ...dto, firstMeasurementFailed: true } : dto;
    },

    async updateKeyResult(
      id: string,
      input: GoalKeyResultUpdateInput & { rule?: unknown | null },
      actor?: GoalActor
    ): Promise<GoalKeyResultDto> {
      const current = await requireKeyResult(id);
      if (actor) assertActor(canActorEditKeyResult(actor, current));
      const ruleProvided = input.rule !== undefined;
      const rule =
        ruleProvided && input.rule != null
          ? normalizeGoalRuleForPersist(input.rule)
          : null;
      const nextStartDate =
        input.startDate !== undefined ? input.startDate : civilFromDate(current.startDate);
      const nextEndDate =
        input.endDate !== undefined ? input.endDate : civilFromDate(current.endDate);
      if (input.startDate !== undefined || input.endDate !== undefined) {
        assertPeriodWithinGoal(current.goal, nextStartDate, nextEndDate);
      }

      // Alvo comparado: reapura na janela anterior e recongela. Salvar o
      // indicador de novo é o gesto explícito de "atualizar a base".
      let comparisonData: Record<string, unknown> = {};
      let resolvedTarget: string | null | undefined = input.target;
      if (input.targetBasis === "COMPARISON" && input.comparison) {
        const measuredWindow = resolveGoalMeasurementWindow({
          goalStartDate: current.goal.startDate.toISOString().slice(0, 10),
          goalEndDate: current.goal.endDate.toISOString().slice(0, 10),
          keyResultStartDate: nextStartDate,
          keyResultEndDate: nextEndDate,
        });
        const resolved = await resolveComparisonTarget({
          ruleJson: ruleProvided ? rule : current.ruleJson,
          trackingType: (input.trackingType ??
            current.trackingType) as GoalTrackingTypeValue,
          measuredWindow,
          comparison: input.comparison,
        });
        resolvedTarget = resolved.target;
        comparisonData = {
          targetBasis: "COMPARISON",
          comparisonMode: input.comparison.mode,
          comparisonStartDate: civilDateToUtc(resolved.window.startCivilDate),
          comparisonEndDate: civilDateToUtc(resolved.window.endCivilDate),
          comparisonValue: resolved.comparisonValue,
          comparisonPercent: input.comparison.percent,
          comparisonComputedAt: resolved.computedAt,
        };
      } else if (input.targetBasis === "MANUAL") {
        // Voltou para número digitado: a procedência antiga sai junto, senão
        // a tela mostraria uma comparação que não define mais nada.
        comparisonData = {
          targetBasis: "MANUAL",
          comparisonMode: null,
          comparisonStartDate: null,
          comparisonEndDate: null,
          comparisonValue: null,
          comparisonPercent: null,
          comparisonComputedAt: null,
        };
      }

      const baseline = input.baseline ?? decimalToString(current.baseline);
      const target = resolvedTarget ?? decimalToString(current.target);
      // Direção validada com os valores FINAIS (atuais + novos): update
      // parcial não escapa da invariante, e alvo COMPARISON é validado
      // depois de apurado.
      assertGoalTargetDirectionOrDomainError(
        (input.trackingType ?? current.trackingType) as GoalTrackingTypeValue,
        baseline,
        target,
        input.targetBasis === "COMPARISON" || (input.comparison != null && resolvedTarget != null)
          ? "COMPARISON"
          : "MANUAL"
      );
      // Versão do compromisso na MESMA transação do update: alteração
      // relevante (assinatura de configuração mudou) cria versão nova e
      // imutável; salvar sem mudar nada não duplica versão.
      const editorName = await resolveActorName(actor?.userId);
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.goalKeyResult.update({
          where: { id },
          data: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.domain !== undefined ? { domain: input.domain } : {}),
            ...(input.trackingType !== undefined
              ? { trackingType: input.trackingType }
              : {}),
            ...(input.baseline !== undefined ? { baseline: input.baseline } : {}),
            ...(resolvedTarget != null ? { target: resolvedTarget } : {}),
            ...comparisonData,
            ...(input.unit !== undefined ? { unit: input.unit } : {}),
            ...(input.weight !== undefined ? { weight: input.weight } : {}),
            ...(input.status !== undefined
              ? {
                  status: input.status,
                  archivedAt: input.status === "ARCHIVED" ? new Date() : null,
                }
              : {}),
            ...(input.ownerAppUserId !== undefined
              ? { ownerAppUserId: input.ownerAppUserId }
              : {}),
            ...(ruleProvided
              ? {
                  ruleJson: rule ?? null,
                  manualTracking: rule == null,
                  // Troca de medição reseta o estado: manual não tem medição;
                  // automático (nova regra) volta a "aguardando 1ª leitura".
                  measurementStatus: rule == null ? "MANUAL" : "PENDING",
                  lastMeasurementError: null,
                }
              : {}),
            ...(input.startDate !== undefined
              ? { startDate: input.startDate ? civilDateToUtc(input.startDate) : null }
              : {}),
            ...(input.endDate !== undefined
              ? { endDate: input.endDate ? civilDateToUtc(input.endDate) : null }
              : {}),
          },
          include: KR_INCLUDE,
        });
        const changed =
          krConfigSignature(current as unknown as KrConfigRow) !==
          krConfigSignature(row as unknown as KrConfigRow);
        if (changed) {
          const latestVersion =
            (current as unknown as KeyResultRow).versions?.[0]?.version ?? 1;
          await tx.goalKeyResultVersion.create({
            data: krVersionData(
              row as unknown as KrConfigRow,
              latestVersion + 1,
              "UPDATE",
              actor?.userId ?? null,
              editorName
            ),
          });
          return tx.goalKeyResult.findUniqueOrThrow({
            where: { id },
            include: KR_INCLUDE,
          });
        }
        return row;
      });
      return toKeyResultDto(updated as unknown as KeyResultRow, {
        startDate: current.goal.startDate.toISOString().slice(0, 10),
        endDate: current.goal.endDate.toISOString().slice(0, 10),
      });
    },

    async deleteKeyResult(
      id: string,
      actor?: GoalActor
    ): Promise<{ deleted: boolean; archived: boolean }> {
      await requireKeyResult(id);
      if (actor) assertActor(actor.canManage);
      const [snapshotCount, changeVersionCount] = await Promise.all([
        prisma.goalKeyResultSnapshot.count({ where: { keyResultId: id } }),
        // Versões ALÉM da inicial = histórico de compromisso relevante.
        prisma.goalKeyResultVersion.count({
          where: { keyResultId: id, version: { gt: 1 } },
        }),
      ]);
      // Exclusão física só sem NENHUM histórico (nem retrato, nem mudança de
      // compromisso). A versão inicial cai junto (cascade) — ela só espelha o
      // que está sendo apagado.
      if (snapshotCount === 0 && changeVersionCount === 0) {
        await prisma.goalInitiative.deleteMany({ where: { keyResultId: id } });
        await prisma.goalKeyResultQuota.deleteMany({ where: { keyResultId: id } });
        await prisma.goalKeyResult.delete({ where: { id } });
        await prisma.goalAuditLog.create({
          data: {
            entityType: "KEY_RESULT",
            entityId: id,
            action: "DELETE",
            actorUserId: actor?.userId || null,
          },
        });
        return { deleted: true, archived: false };
      }
      await prisma.goalKeyResult.update({
        where: { id },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      await prisma.goalAuditLog.create({
        data: {
          entityType: "KEY_RESULT",
          entityId: id,
          action: "ARCHIVE",
          actorUserId: actor?.userId || null,
        },
      });
      return { deleted: false, archived: true };
    },

    /**
     * MVP 1 — valor realizado manual: grava o valor vivo e upserta o snapshot
     * do dia corrente. Dias passados nunca são tocados (RN-009).
     */
    async setAchievedValue(
      id: string,
      input: GoalAchievedValueInput,
      now: Date = new Date(),
      actor?: GoalActor
    ): Promise<GoalKeyResultDto> {
      const current = await requireKeyResult(id);
      if (actor) assertActor(canActorEditKeyResult(actor, current));
      if (current.status === "ARCHIVED") {
        throw new GoalDomainError("CONFLICT", "KR arquivado não recebe valores.");
      }
      if (!current.manualTracking) {
        throw new GoalDomainError(
          "CONFLICT",
          "Este indicador é calculado automaticamente — use o Atualizar Painel."
        );
      }
      const progress = computeGoalKeyResultProgress({
        baseline: decimalToString(current.baseline),
        target: decimalToString(current.target),
        achievedValue: input.achievedValue,
      });
      const updated = await prisma.goalKeyResult.update({
        where: { id },
        data: { achievedValue: input.achievedValue },
        include: KR_INCLUDE,
      });
      await writeSnapshot(id, input.achievedValue, progress.ratio, "MANUAL", now);
      return toKeyResultDto(updated as unknown as KeyResultRow, {
        startDate: current.goal.startDate.toISOString().slice(0, 10),
        endDate: current.goal.endDate.toISOString().slice(0, 10),
      });
    },

    /**
     * "Atualizar Painel" (RN-008): recalcula o KR de regra dinâmica AGORA.
     * pg_try_advisory_xact_lock por KR — cliques concorrentes recebem BUSY.
     */
    async refreshKeyResult(id: string, now: Date = new Date()): Promise<GoalKeyResultDto> {
      const current = await requireKeyResult(id);
      if (current.status === "ARCHIVED") {
        throw new GoalDomainError("CONFLICT", "KR arquivado não é recalculado.");
      }
      if (current.manualTracking || current.ruleJson == null) {
        throw new GoalDomainError(
          "CONFLICT",
          "Este indicador é manual — lance o valor realizado diretamente."
        );
      }
      // Caminho ÚNICO da medição (lock por KR + estado + snapshot). Falha da
      // regra vira estado ERROR persistido e erro claro ao usuário — o último
      // valor válido permanece na tela, nunca vira zero.
      const outcome = await measureKeyResult(current, "REFRESH", now);
      if (outcome.ok === false) {
        throw new GoalDomainError("MEASUREMENT_FAILED", outcome.error);
      }
      const fresh = await requireKeyResult(id);
      return toKeyResultDto(fresh as unknown as KeyResultRow, {
        startDate: fresh.goal.startDate.toISOString().slice(0, 10),
        endDate: fresh.goal.endDate.toISOString().slice(0, 10),
      });
    },

    /**
     * Job diário (RN-008): calcula todos os KRs ativos com regra.
     *
     * População: SÓ status ACTIVE em Objetivo ACTIVE — arquivados e
     * concluídos (DONE) ficam fora por definição, e o job NUNCA muda status
     * (100% atingido ≠ encerrado administrativamente; DONE é decisão humana).
     * Idempotente no dia: snapshots são upsert por (KR, dia civil SP).
     */
    async runDailySnapshots(now: Date = new Date()): Promise<{
      computed: number;
      manualSnapshotted: number;
      failures: Array<{ keyResultId: string; message: string }>;
      durationMs: number;
    }> {
      const startedAt = Date.now();
      const active = await prisma.goalKeyResult.findMany({
        where: { status: "ACTIVE", goal: { status: "ACTIVE" } },
        include: { goal: true },
      });
      let computed = 0;
      let manualSnapshotted = 0;
      const failures: Array<{ keyResultId: string; message: string }> = [];
      for (const kr of active) {
        try {
          if (kr.ruleJson != null && !kr.manualTracking) {
            // Mesmo caminho de domínio do refresh manual (lock, estado,
            // snapshot idempotente) — job e clique nunca medem em paralelo.
            const outcome = await measureKeyResult(
              kr as unknown as MeasurableKr,
              "ENGINE",
              now
            );
            if (outcome.ok === false) {
              failures.push({ keyResultId: kr.id, message: outcome.error });
              continue;
            }
            computed += 1;
          } else {
            // KR manual também ganha retrato diário (burn-up contínuo).
            const achievedValue = decimalToString(kr.achievedValue);
            const progress = computeGoalKeyResultProgress({
              baseline: decimalToString(kr.baseline),
              target: decimalToString(kr.target),
              achievedValue,
            });
            await writeSnapshot(kr.id, achievedValue, progress.ratio, "ENGINE", now);
            manualSnapshotted += 1;
          }
        } catch (err) {
          // BUSY e afins: mensagem sanitizada (nunca SQL/segredo no resumo).
          failures.push({
            keyResultId: kr.id,
            message: sanitizeGoalMeasurementError(err),
          });
        }
      }
      const durationMs = Date.now() - startedAt;
      // Resumo operacional (sem dado sensível — só contagens e duração).
      console.info(
        `[goals] job diário: ${computed} medidos, ${manualSnapshotted} manuais retratados, ${failures.length} falhas em ${durationMs}ms`
      );
      return { computed, manualSnapshotted, failures, durationMs };
    },

    /** Substitui TODAS as cotas do KR (Σ ≤ target — bloqueio). */
    async setQuotas(
      keyResultId: string,
      quotas: GoalQuotaInput[],
      actor?: GoalActor
    ): Promise<GoalKeyResultDto> {
      const current = await requireKeyResult(keyResultId);
      if (actor) assertActor(canActorEditKeyResult(actor, current));
      assertQuotasWithinTarget(decimalToString(current.target), quotas);
      await prisma.$transaction(async (tx) => {
        await tx.goalKeyResultQuota.deleteMany({ where: { keyResultId } });
        for (const [index, quota] of quotas.entries()) {
          await tx.goalKeyResultQuota.create({
            data: {
              keyResultId,
              assignedAppUserId: quota.assignedAppUserId,
              quotaValue: quota.quotaValue,
              sortOrder: index,
            },
          });
        }
      });
      const fresh = await requireKeyResult(keyResultId);
      return toKeyResultDto(fresh as unknown as KeyResultRow, {
        startDate: fresh.goal.startDate.toISOString().slice(0, 10),
        endDate: fresh.goal.endDate.toISOString().slice(0, 10),
      });
    },

    // ─── Iniciativas (US-05) ────────────────────────────────────────────────

    async createInitiative(
      input: GoalInitiativeCreateInput,
      actorUserId: string,
      actor?: GoalActor
    ): Promise<GoalInitiativeDto> {
      const goal = input.goalId ? await requireGoal(input.goalId) : null;
      const kr = input.keyResultId ? await requireKeyResult(input.keyResultId) : null;
      if (actor) {
        assertActor(
          canActorTouchInitiative(
            actor,
            {
              goalOwnerAppUserId: goal?.ownerAppUserId ?? kr?.goal.ownerAppUserId ?? null,
              keyResultOwnerAppUserId: kr?.ownerAppUserId ?? null,
              assigneeAppUserId: null,
            },
            { allowAssignee: false }
          )
        );
      }
      const created = await prisma.goalInitiative.create({
        data: {
          goalId: input.goalId,
          keyResultId: input.keyResultId,
          title: input.title,
          assigneeAppUserId: input.assigneeAppUserId,
          dueDate: input.dueDate ? civilDateToUtc(input.dueDate) : null,
          createdByUserId: actorUserId,
        },
        include: { assignee: { select: { name: true } } },
      });
      return toInitiativeDto(created as unknown as InitiativeRow);
    },

    async updateInitiative(
      id: string,
      input: GoalInitiativeUpdateInput,
      actor?: GoalActor
    ): Promise<GoalInitiativeDto> {
      const current = await prisma.goalInitiative.findUnique({
        where: { id },
        include: {
          goal: { select: { ownerAppUserId: true } },
          keyResult: {
            select: { ownerAppUserId: true, goal: { select: { ownerAppUserId: true } } },
          },
        },
      });
      if (!current) throw new GoalDomainError("NOT_FOUND", "Iniciativa não encontrada.");
      // Owners/manage sempre; o ASSIGNEE pode atualizar o fluxo operacional
      // da própria iniciativa (mover no kanban, ajustar prazo/título).
      if (actor) {
        assertActor(
          canActorTouchInitiative(
            actor,
            {
              goalOwnerAppUserId:
                current.goal?.ownerAppUserId ??
                current.keyResult?.goal.ownerAppUserId ??
                null,
              keyResultOwnerAppUserId: current.keyResult?.ownerAppUserId ?? null,
              assigneeAppUserId: current.assigneeAppUserId,
            },
            { allowAssignee: true }
          )
        );
      }
      const updated = await prisma.goalInitiative.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.assigneeAppUserId !== undefined
            ? { assigneeAppUserId: input.assigneeAppUserId }
            : {}),
          ...(input.dueDate !== undefined
            ? { dueDate: input.dueDate ? civilDateToUtc(input.dueDate) : null }
            : {}),
        },
        include: { assignee: { select: { name: true } } },
      });
      return toInitiativeDto(updated as unknown as InitiativeRow);
    },

    async deleteInitiative(id: string, actor?: GoalActor): Promise<{ deleted: true }> {
      const current = await prisma.goalInitiative.findUnique({
        where: { id },
        include: {
          goal: { select: { ownerAppUserId: true } },
          keyResult: {
            select: { ownerAppUserId: true, goal: { select: { ownerAppUserId: true } } },
          },
        },
      });
      if (!current) throw new GoalDomainError("NOT_FOUND", "Iniciativa não encontrada.");
      // Excluir NÃO é fluxo operacional: assignee não basta — owners/manage.
      if (actor) {
        assertActor(
          canActorTouchInitiative(
            actor,
            {
              goalOwnerAppUserId:
                current.goal?.ownerAppUserId ??
                current.keyResult?.goal.ownerAppUserId ??
                null,
              keyResultOwnerAppUserId: current.keyResult?.ownerAppUserId ?? null,
              assigneeAppUserId: current.assigneeAppUserId,
            },
            { allowAssignee: false }
          )
        );
      }
      await prisma.goalInitiative.delete({ where: { id } });
      return { deleted: true };
    },

    // ─── Wizard (criação completa, transacional) ────────────────────────────

    async createFromWizard(
      input: GoalWizardInput,
      actorUserId: string
    ): Promise<GoalDto> {
      const rule =
        input.keyResult.rule != null
          ? normalizeGoalRuleForPersist(input.keyResult.rule)
          : null;
      // O indicador pode ter recorte próprio, mas nunca fora da moldura do
      // Objetivo que está nascendo junto.
      assertPeriodWithinGoal(
        {
          startDate: civilDateToUtc(input.goal.startDate),
          endDate: civilDateToUtc(input.goal.endDate),
          title: input.goal.title,
        },
        input.keyResult.startDate,
        input.keyResult.endDate
      );

      // Alvo comparado é apurado ANTES da transação: a leitura do período
      // anterior é uma consulta pesada e não pode segurar a transação aberta.
      let wizardTarget = input.keyResult.target;
      let wizardComparison: Record<string, unknown> = {};
      if (input.keyResult.targetBasis === "COMPARISON" && input.keyResult.comparison) {
        const measuredWindow = resolveGoalMeasurementWindow({
          goalStartDate: input.goal.startDate,
          goalEndDate: input.goal.endDate,
          keyResultStartDate: input.keyResult.startDate,
          keyResultEndDate: input.keyResult.endDate,
        });
        const resolved = await resolveComparisonTarget({
          ruleJson: rule,
          trackingType: input.keyResult.trackingType,
          measuredWindow,
          comparison: input.keyResult.comparison,
        });
        wizardTarget = resolved.target;
        wizardComparison = {
          targetBasis: "COMPARISON",
          comparisonMode: input.keyResult.comparison.mode,
          comparisonStartDate: civilDateToUtc(resolved.window.startCivilDate),
          comparisonEndDate: civilDateToUtc(resolved.window.endCivilDate),
          comparisonValue: resolved.comparisonValue,
          comparisonPercent: input.keyResult.comparison.percent,
          comparisonComputedAt: resolved.computedAt,
        };
      }
      if (wizardTarget == null) {
        throw new GoalDomainError("VALIDATION_ERROR", "Informe o alvo do indicador.");
      }
      assertGoalTargetDirectionOrDomainError(
        input.keyResult.trackingType,
        input.keyResult.baseline,
        wizardTarget,
        input.keyResult.targetBasis === "COMPARISON" ? "COMPARISON" : "MANUAL"
      );
      assertQuotasWithinTarget(wizardTarget, input.quotas);

      const wizardActorName = await resolveActorName(actorUserId);
      const goalId = await prisma.$transaction(async (tx) => {
        const goal = await tx.goal.create({
          data: {
            title: input.goal.title,
            description: input.goal.description,
            startDate: civilDateToUtc(input.goal.startDate),
            endDate: civilDateToUtc(input.goal.endDate),
            status: input.goal.status === "DRAFT" ? "ACTIVE" : input.goal.status,
            ownerAppUserId: input.goal.ownerAppUserId,
            createdByUserId: actorUserId,
          },
        });
        const kr = await tx.goalKeyResult.create({
          data: {
            goalId: goal.id,
            title: input.keyResult.title,
            domain: input.keyResult.domain,
            trackingType: input.keyResult.trackingType,
            baseline: input.keyResult.baseline,
            target: wizardTarget,
            ...wizardComparison,
            achievedValue: input.keyResult.baseline,
            unit: input.keyResult.unit,
            weight: input.keyResult.weight,
            ownerAppUserId: input.keyResult.ownerAppUserId,
            manualTracking: rule == null,
            ruleJson: rule ?? undefined,
            // Automático nasce PENDING: baseline exibida NÃO é medição.
            measurementStatus: rule == null ? "MANUAL" : "PENDING",
            startDate: input.keyResult.startDate
              ? civilDateToUtc(input.keyResult.startDate)
              : null,
            endDate: input.keyResult.endDate
              ? civilDateToUtc(input.keyResult.endDate)
              : null,
          },
        });
        for (const [index, quota] of input.quotas.entries()) {
          await tx.goalKeyResultQuota.create({
            data: {
              keyResultId: kr.id,
              assignedAppUserId: quota.assignedAppUserId,
              quotaValue: quota.quotaValue,
              sortOrder: index,
            },
          });
        }
        // Versão INICIAL do compromisso do KR criado pelo wizard.
        await tx.goalKeyResultVersion.create({
          data: krVersionData(
            kr as unknown as KrConfigRow,
            1,
            "CREATE",
            actorUserId || null,
            wizardActorName
          ),
        });
        return goal.id;
      });

      // Primeira leitura do motor logo após criar ("Ligar os Motores").
      // Falha não desfaz a criação (o recálculo automático cobre), mas a
      // resposta DISTINGUE criação bem-sucedida de primeira leitura falha —
      // o número exibido nesse caso é a linha de base, não medição real.
      let firstMeasurementFailed = false;
      if (rule != null) {
        try {
          const kr = await prisma.goalKeyResult.findFirst({
            where: { goalId },
            include: { goal: true },
          });
          if (kr) {
            const outcome = await measureKeyResult(
              kr as unknown as MeasurableKr,
              "REFRESH",
              new Date()
            );
            firstMeasurementFailed = !outcome.ok;
          }
        } catch {
          // BUSY — medição concorrente; fica PENDING e o job cobre.
          firstMeasurementFailed = true;
        }
      }
      const goalDto = await service.getGoal(goalId);
      return firstMeasurementFailed
        ? { ...goalDto, firstMeasurementFailed: true }
        : goalDto;
    },

    /** Lista enxuta de usuários ativos para seletores (id+nome, nada sensível). */
    async listOwnerOptions(): Promise<Array<{ id: string; name: string }>> {
      const rows = await prisma.appUser.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      return rows;
    },

    async listSnapshots(keyResultId: string): Promise<GoalSnapshotDto[]> {
      await requireKeyResult(keyResultId);
      const rows = await prisma.goalKeyResultSnapshot.findMany({
        where: { keyResultId },
        orderBy: { snapshotDate: "asc" },
      });
      return rows.map((r) => ({
        snapshotDate: r.snapshotDate.toISOString().slice(0, 10),
        achievedValue: decimalToString(r.achievedValue),
        progressRatio: decimalToString(r.progressRatio),
        source: r.source,
      }));
    },

    /**
     * Curvas do gráfico: acumulado mês a mês na janela medida e, quando o alvo
     * nasce de comparação com período anterior, a MESMA regra na janela
     * comparada (a "evolução do ano passado").
     *
     * Leitura pura — nenhum snapshot é gravado. Diferente de `listSnapshots`,
     * que só sabe do que foi retratado depois que a meta existe, aqui a regra
     * responde o período inteiro, inclusive o que aconteceu antes do cadastro.
     * Indicador de lançamento manual (sem regra) devolve as curvas vazias: não
     * há de onde tirar o histórico sem inventar número.
     */
    async getKeyResultSeries(keyResultId: string): Promise<GoalKeyResultSeriesDto> {
      // Custo (P3, medido por inspeção): 1 query agregada mensal no motor
      // genérico (índices por data) ou ≤12 chamadas/ano à função oficial no
      // provider; +1 janela quando há comparação. CUSTOMER_MOMENT adiciona
      // window function — aceitável na leitura sob demanda do detalhe.
      // SEM cache por decisão: cachear sem chave por versão/configuração
      // arriscaria servir série de compromisso antigo como atual; se a
      // telemetria de produção mostrar custo real, a chave terá de incluir
      // KR + configVersion + janela + regra/provider (+ comparação).
      const kr = await requireKeyResult(keyResultId);
      const window = keyResultWindow(kr);
      const empty: GoalKeyResultSeriesDto = {
        keyResultId,
        startDate: window.startCivilDate,
        endDate: window.endCivilDate,
        current: [],
        comparison: null,
      };
      if (!kr.ruleJson) return empty;

      const operation = resolveGoalRule(kr.ruleJson).metric.operation;

      async function seriesFor(
        startCivilDate: string,
        endCivilDate: string
      ): Promise<GoalSeriesPointDto[]> {
        const months = listGoalSeriesMonths(startCivilDate, endCivilDate);
        if (months.length === 0) return [];
        const buckets = await executeGoalRuleMonthly(prisma, kr.ruleJson, {
          startCivilDate,
          endCivilDate,
        });
        return accumulateGoalRuleMonths(months, buckets, operation).map((p) => ({
          month: p.month,
          civilDate: goalSeriesMonthCivilDate(p.month, endCivilDate),
          accumulated: p.accumulated,
        }));
      }

      // Mês corrente pelo calendário civil de São Paulo — o mês UTC vira até
      // 3h antes do mês de negócio e cortaria a curva cedo demais.
      const todayMonth = currentGoalCivilMonthInSaoPaulo();
      const current = limitGoalSeriesToMonth(
        await seriesFor(window.startCivilDate, window.endCivilDate),
        todayMonth
      );

      const comparisonStart = civilFromDate(kr.comparisonStartDate);
      const comparisonEnd = civilFromDate(kr.comparisonEndDate);
      const comparison =
        kr.targetBasis === "COMPARISON" && kr.comparisonMode && comparisonStart && comparisonEnd
          ? {
              startDate: comparisonStart,
              endDate: comparisonEnd,
              label:
                GOAL_TARGET_COMPARISON_MODE_LABELS[
                  kr.comparisonMode as GoalTargetComparisonModeValue
                ],
              // Janela comparada é sempre passado fechado: a curva vai inteira,
              // sem corte no mês corrente.
              points: await seriesFor(comparisonStart, comparisonEnd),
            }
          : null;

      return { ...empty, current, comparison };
    },

    /**
     * "Testar medição agora" (wizard): executa a regra em modo SOMENTE
     * LEITURA na janela informada e devolve o valor atual — nada é
     * persistido, nenhum snapshot é gravado. A regra passa pela mesma
     * validação total do dicionário (resolveGoalRule) antes de virar SQL.
     */
    async previewRule(
      ruleJson: unknown,
      window: { startCivilDate: string; endCivilDate: string }
    ): Promise<{ value: string }> {
      const value = await executeGoalRule(prisma, ruleJson, window);
      return { value };
    },
  };

  return service;
}

/** Hash 31-bit estável do id do KR para a chave do advisory lock. */
export function hashGoalLockKey(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2147483647;
}

export type GoalService = ReturnType<typeof createGoalService>;
export { GoalContractError };
