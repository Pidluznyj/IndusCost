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
 *  - KR herda o período do Goal pai.
 */

import type { PrismaClient } from "@prisma/client";
import {
  GoalContractError,
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
  executeGoalRule,
  normalizeGoalRuleForPersist,
  resolveGoalRule,
} from "./goalRuleEngine.server.js";
import {
  GOAL_METRIC_OPERATION_LABELS,
  findGoalMetadataEntity,
  findGoalMetadataMetric,
} from "./goalMetadata.js";

export class GoalDomainError extends Error {
  readonly code: "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR" | "BUSY";
  constructor(
    code: "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR" | "BUSY",
    message: string
  ) {
    super(message);
    this.name = "GoalDomainError";
    this.code = code;
  }
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

function civilDateToUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
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
  return `${GOAL_METRIC_OPERATION_LABELS[metric.operation]} de "${metric.label}" em ${entity.label}${filtersLabel}`;
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
  owner?: { name: string } | null;
  quotas?: QuotaRow[];
};

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

function toKeyResultDto(row: KeyResultRow): GoalKeyResultDto {
  const baseline = decimalToString(row.baseline);
  const target = decimalToString(row.target);
  const achievedValue = decimalToString(row.achievedValue);
  const progress = computeGoalKeyResultProgress({ baseline, target, achievedValue });
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
    status: row.status as GoalStatusValue,
    progressPercent: progressRatioToPercent(progress.ratio),
    invalidTargets: progress.invalidTargets,
    hasRule: row.ruleJson != null,
    ruleSummary: buildGoalRuleSummary(row.ruleJson),
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
  const keyResults = row.keyResults.map(toKeyResultDto);
  const rollup = computeGoalRollup(
    row.keyResults.map((kr) => ({
      status: kr.status,
      weight: decimalToString(kr.weight),
      baseline: decimalToString(kr.baseline),
      target: decimalToString(kr.target),
      achievedValue: decimalToString(kr.achievedValue),
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

  /** Executa a regra do KR (janela = período do Goal) e persiste valor + snapshot. */
  async function computeAndStoreRuleValue(
    kr: {
      id: string;
      ruleJson: unknown;
      baseline: unknown;
      target: unknown;
      goal: { startDate: Date; endDate: Date };
    },
    source: "ENGINE" | "REFRESH",
    now: Date
  ): Promise<string> {
    const achievedValue = await executeGoalRule(prisma, kr.ruleJson, {
      startCivilDate: kr.goal.startDate.toISOString().slice(0, 10),
      endCivilDate: kr.goal.endDate.toISOString().slice(0, 10),
    });
    const progress = computeGoalKeyResultProgress({
      baseline: decimalToString(kr.baseline),
      target: decimalToString(kr.target),
      achievedValue,
    });
    await prisma.goalKeyResult.update({
      where: { id: kr.id },
      data: { achievedValue },
    });
    await writeSnapshot(kr.id, achievedValue, progress.ratio, source, now);
    return achievedValue;
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

    async updateGoal(id: string, input: GoalUpdateInput): Promise<GoalDto> {
      const current = await requireGoal(id);
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
      const updated = await prisma.goal.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
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
      return toGoalDto(updated as unknown as GoalRow);
    },

    /**
     * RN-001: exclusão física só sem histórico de processamento; caso
     * contrário arquiva (soft-delete) — Objetivo e KRs.
     */
    async deleteGoal(id: string): Promise<{ deleted: boolean; archived: boolean }> {
      const current = await requireGoal(id);
      const snapshotCount = await prisma.goalKeyResultSnapshot.count({
        where: { keyResult: { goalId: id } },
      });
      if (snapshotCount === 0) {
        await prisma.goalInitiative.deleteMany({
          where: { OR: [{ goalId: id }, { keyResult: { goalId: id } }] },
        });
        await prisma.goalKeyResultQuota.deleteMany({
          where: { keyResult: { goalId: id } },
        });
        await prisma.goalKeyResult.deleteMany({ where: { goalId: id } });
        await prisma.goal.delete({ where: { id } });
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
      return { deleted: false, archived: true };
    },

    async createKeyResult(
      goalId: string,
      input: GoalKeyResultCreateInput & { rule?: unknown | null }
    ): Promise<GoalKeyResultDto> {
      const goal = await requireGoal(goalId);
      if (goal.status === "ARCHIVED") {
        throw new GoalDomainError("CONFLICT", "Objetivo arquivado não recebe novos KRs.");
      }
      const rule = input.rule != null ? normalizeGoalRuleForPersist(input.rule) : null;
      const created = await prisma.goalKeyResult.create({
        data: {
          goalId,
          title: input.title,
          domain: input.domain,
          trackingType: input.trackingType,
          baseline: input.baseline,
          target: input.target,
          achievedValue: input.baseline,
          unit: input.unit,
          weight: input.weight,
          ownerAppUserId: input.ownerAppUserId,
          manualTracking: rule == null,
          ruleJson: rule ?? undefined,
        },
        include: KR_INCLUDE,
      });
      return toKeyResultDto(created as unknown as KeyResultRow);
    },

    async updateKeyResult(
      id: string,
      input: GoalKeyResultUpdateInput & { rule?: unknown | null }
    ): Promise<GoalKeyResultDto> {
      const current = await requireKeyResult(id);
      const baseline = input.baseline ?? decimalToString(current.baseline);
      const target = input.target ?? decimalToString(current.target);
      if (Number(baseline) === Number(target)) {
        throw new GoalDomainError(
          "VALIDATION_ERROR",
          "Alvo não pode ser igual à linha de base (meta sem intervalo)."
        );
      }
      const ruleProvided = input.rule !== undefined;
      const rule =
        ruleProvided && input.rule != null
          ? normalizeGoalRuleForPersist(input.rule)
          : null;
      const updated = await prisma.goalKeyResult.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.domain !== undefined ? { domain: input.domain } : {}),
          ...(input.trackingType !== undefined
            ? { trackingType: input.trackingType }
            : {}),
          ...(input.baseline !== undefined ? { baseline: input.baseline } : {}),
          ...(input.target !== undefined ? { target: input.target } : {}),
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
            ? { ruleJson: rule ?? null, manualTracking: rule == null }
            : {}),
        },
        include: KR_INCLUDE,
      });
      return toKeyResultDto(updated as unknown as KeyResultRow);
    },

    async deleteKeyResult(id: string): Promise<{ deleted: boolean; archived: boolean }> {
      await requireKeyResult(id);
      const snapshotCount = await prisma.goalKeyResultSnapshot.count({
        where: { keyResultId: id },
      });
      if (snapshotCount === 0) {
        await prisma.goalInitiative.deleteMany({ where: { keyResultId: id } });
        await prisma.goalKeyResultQuota.deleteMany({ where: { keyResultId: id } });
        await prisma.goalKeyResult.delete({ where: { id } });
        return { deleted: true, archived: false };
      }
      await prisma.goalKeyResult.update({
        where: { id },
        data: { status: "ARCHIVED", archivedAt: new Date() },
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
      now: Date = new Date()
    ): Promise<GoalKeyResultDto> {
      const current = await requireKeyResult(id);
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
      return toKeyResultDto(updated as unknown as KeyResultRow);
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
      // Lock nomeado por KR (classe 0x60A15 + hash do id) dentro da transação.
      const lockKey = hashGoalLockKey(current.id);
      await prisma.$transaction(async (tx) => {
        const lockRows = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(${0x60a15}::int, ${lockKey}::int) AS locked
        `;
        if (!lockRows[0]?.locked) {
          throw new GoalDomainError(
            "BUSY",
            "Este indicador já está sendo recalculado — aguarde alguns segundos."
          );
        }
        const achievedValue = await executeGoalRule(tx as unknown as PrismaClient, current.ruleJson, {
          startCivilDate: current.goal.startDate.toISOString().slice(0, 10),
          endCivilDate: current.goal.endDate.toISOString().slice(0, 10),
        });
        const progress = computeGoalKeyResultProgress({
          baseline: decimalToString(current.baseline),
          target: decimalToString(current.target),
          achievedValue,
        });
        await tx.goalKeyResult.update({
          where: { id },
          data: { achievedValue },
        });
        const snapshotDate = civilDateToUtc(todayGoalCivilDateInSaoPaulo(now));
        await tx.goalKeyResultSnapshot.upsert({
          where: { keyResultId_snapshotDate: { keyResultId: id, snapshotDate } },
          create: {
            keyResultId: id,
            snapshotDate,
            achievedValue,
            progressRatio: progress.ratio.toFixed(6),
            source: "REFRESH",
          },
          update: {
            achievedValue,
            progressRatio: progress.ratio.toFixed(6),
            source: "REFRESH",
          },
        });
      });
      const fresh = await requireKeyResult(id);
      return toKeyResultDto(fresh as unknown as KeyResultRow);
    },

    /** Job diário (RN-008): calcula todos os KRs ativos com regra. */
    async runDailySnapshots(now: Date = new Date()): Promise<{
      computed: number;
      manualSnapshotted: number;
      failures: Array<{ keyResultId: string; message: string }>;
    }> {
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
            await computeAndStoreRuleValue(
              kr as unknown as Parameters<typeof computeAndStoreRuleValue>[0],
              "ENGINE",
              now
            );
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
          failures.push({
            keyResultId: kr.id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { computed, manualSnapshotted, failures };
    },

    /** Substitui TODAS as cotas do KR (Σ ≤ target — bloqueio). */
    async setQuotas(
      keyResultId: string,
      quotas: GoalQuotaInput[]
    ): Promise<GoalKeyResultDto> {
      const current = await requireKeyResult(keyResultId);
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
      return toKeyResultDto(fresh as unknown as KeyResultRow);
    },

    // ─── Iniciativas (US-05) ────────────────────────────────────────────────

    async createInitiative(
      input: GoalInitiativeCreateInput,
      actorUserId: string
    ): Promise<GoalInitiativeDto> {
      if (input.goalId) await requireGoal(input.goalId);
      if (input.keyResultId) await requireKeyResult(input.keyResultId);
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
      input: GoalInitiativeUpdateInput
    ): Promise<GoalInitiativeDto> {
      const current = await prisma.goalInitiative.findUnique({ where: { id } });
      if (!current) throw new GoalDomainError("NOT_FOUND", "Iniciativa não encontrada.");
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

    async deleteInitiative(id: string): Promise<{ deleted: true }> {
      const current = await prisma.goalInitiative.findUnique({ where: { id } });
      if (!current) throw new GoalDomainError("NOT_FOUND", "Iniciativa não encontrada.");
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
      assertQuotasWithinTarget(input.keyResult.target, input.quotas);

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
            target: input.keyResult.target,
            achievedValue: input.keyResult.baseline,
            unit: input.keyResult.unit,
            weight: input.keyResult.weight,
            ownerAppUserId: input.keyResult.ownerAppUserId,
            manualTracking: rule == null,
            ruleJson: rule ?? undefined,
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
        return goal.id;
      });

      // Primeira leitura do motor logo após criar ("Ligar os Motores").
      if (rule != null) {
        try {
          const kr = await prisma.goalKeyResult.findFirst({
            where: { goalId },
            include: { goal: true },
          });
          if (kr) {
            await computeAndStoreRuleValue(
              kr as unknown as Parameters<typeof computeAndStoreRuleValue>[0],
              "REFRESH",
              new Date()
            );
          }
        } catch {
          // Falha da primeira leitura não desfaz a criação — o job noturno cobre.
        }
      }
      return service.getGoal(goalId);
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
