/**
 * Serviço — detecção e registro de mudanças financeiras pós-fechamento.
 * Não reescreve fechamentos CLOSED; apenas gera/atualiza exceção
 * FINANCIAL_CHANGE_AFTER_CLOSING (POST_CLOSING_FINANCIAL_CHANGE).
 */

import type { PrismaClient } from "@prisma/client";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import type { TreasuryExceptionDto } from "../contracts/treasuryDto.js";
import {
  detectTreasuryPostClosingFinancialChange,
  type TreasuryPostClosingChangeEventInput,
  type TreasuryPostClosingClosingSnapshot,
} from "../domain/treasuryPostClosingChangeRules.js";
import { runTreasuryExceptionEngine } from "../domain/treasuryExceptionEngine.js";
import {
  createTreasuryDailyClosingRepository,
  type TreasuryDailyClosingRepository,
  type TreasuryDailyClosingRow,
} from "../repositories/treasuryDailyClosingRepository.server.js";
import {
  createTreasuryExceptionService,
  type TreasuryExceptionActor,
  type TreasuryExceptionService,
} from "./treasuryExceptionService.server.js";

export function buildTreasuryPostClosingSystemActor(
  requestId?: string | null
): TreasuryExceptionActor {
  return {
    userId: "system:treasury-post-closing",
    userName: "Motor pós-fechamento",
    role: "SYSTEM",
    isSuperAdmin: true,
    canViewExceptions: true,
    canManageExceptions: true,
    sessionId: null,
    requestId: requestId ?? null,
  };
}

function toClosingSnapshot(
  row: TreasuryDailyClosingRow
): TreasuryPostClosingClosingSnapshot {
  return {
    id: row.id,
    companyCode: row.companyCode,
    civilDate: row.civilDate,
    status: row.status,
    version: row.version,
    sourceHash: row.sourceHash,
    observedBalance: row.observedBalance,
    closingBalance: row.closingBalance,
    differenceAmount: row.differenceAmount,
  };
}

export type TreasuryPostClosingRecordResult =
  | {
      raised: false;
      reason: "DAY_NOT_CLOSED" | "NO_DETECTION" | "DISABLED";
    }
  | {
      raised: true;
      created: boolean;
      recurrenceIncremented: boolean;
      exception: TreasuryExceptionDto;
      differenceAmount: string | null;
      changeId: string;
      closingId: string;
    };

export type TreasuryPostClosingChangeService = {
  /**
   * Se o dia civil estiver CLOSED, gera/atualiza exceção pós-fechamento.
   * Idempotente por uniqueKey (reprocessamento incrementa recorrência).
   */
  recordFinancialChange(
    event: TreasuryPostClosingChangeEventInput,
    options?: { actor?: TreasuryExceptionActor; now?: Date }
  ): Promise<TreasuryPostClosingRecordResult>;

  /**
   * Varredura: para cada CLOSED no intervalo, se currentSourceHash ≠ sourceHash
   * (ou se hash atual não informado), registra SYNC_CHANGE no fechamento.
   */
  scanClosedDaysAfterSync(input: {
    companyCode: string;
    dateFrom: string;
    dateTo: string;
    /** Hash atual por data civil; se omitido e forceWithoutHash, usa marcador sintético. */
    currentSourceHashByCivilDate?: Record<string, string>;
    /**
     * Quando true e não há hash por data, registra SYNC_CHANGE com marcador
     * `sync-touch:{requestId|timestamp}` (ainda idempotente por changeId estável do closing).
     */
    forceWithoutHash?: boolean;
    requestId?: string | null;
    now?: Date;
  }): Promise<TreasuryPostClosingRecordResult[]>;
};

export function createTreasuryPostClosingChangeService(deps: {
  prisma?: PrismaClient;
  closingRepository?: TreasuryDailyClosingRepository;
  exceptionService?: TreasuryExceptionService;
}): TreasuryPostClosingChangeService {
  const closingRepo =
    deps.closingRepository ??
    createTreasuryDailyClosingRepository(deps.prisma!);
  const exceptionService =
    deps.exceptionService ??
    createTreasuryExceptionService({ prisma: deps.prisma! });

  return {
    async recordFinancialChange(event, options) {
      const actor =
        options?.actor ??
        buildTreasuryPostClosingSystemActor(null);
      const now = options?.now ?? new Date();
      const current = await closingRepo.findCurrent(
        event.companyCode.trim().toUpperCase(),
        event.civilDate
      );
      const detection = detectTreasuryPostClosingFinancialChange({
        closing: current ? toClosingSnapshot(current) : null,
        event: {
          ...event,
          companyCode: event.companyCode.trim().toUpperCase(),
        },
      });
      if (!detection) {
        return {
          raised: false,
          reason: current?.status === "CLOSED" ? "NO_DETECTION" : "DAY_NOT_CLOSED",
        };
      }

      const engine = runTreasuryExceptionEngine({
        companyCode: detection.companyCode,
        asOfCivilDate: detection.closedCivilDate,
        detectedAtIso: formatTreasuryTimestampIso(now),
        nowEpochMs: now.getTime(),
        postClosingChanges: [detection.seed],
        openExceptions: [],
      });
      const candidate = engine.plan.upserts[0];
      if (!candidate) {
        return { raised: false, reason: "NO_DETECTION" };
      }

      const upserted = await exceptionService.upsertByUniqueKey(actor, {
        companyCode: detection.companyCode,
        uniqueKey: candidate.uniqueKey,
        type: candidate.type,
        severity: candidate.severity,
        entityKind: candidate.entityKind,
        entityId: candidate.entityId,
        accountId: candidate.accountId,
        nomusExternalId: candidate.nomusExternalId,
        title: detection.title,
        description: detection.description,
        amount: candidate.amount,
        detectedAt: formatTreasuryTimestampIso(now),
        dueAt: candidate.dueAt,
        responsibleUserId: candidate.responsibleUserId,
        metadata: {
          ...candidate.metadata,
          treatmentHref: `/finance/treasury/closing?date=${encodeURIComponent(detection.closedCivilDate)}&companyCode=${encodeURIComponent(detection.companyCode)}`,
        },
      });

      return {
        raised: true,
        created: upserted.created,
        recurrenceIncremented: upserted.recurrenceIncremented,
        exception: upserted.exception,
        differenceAmount: detection.differenceAmount,
        changeId: detection.changeId,
        closingId: detection.closingId,
      };
    },

    async scanClosedDaysAfterSync(input) {
      const listed = await closingRepo.list({
        companyCode: input.companyCode.trim().toUpperCase(),
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        status: "CLOSED",
        page: 1,
        pageSize: 500,
      });
      const now = input.now ?? new Date();
      const actor = buildTreasuryPostClosingSystemActor(input.requestId);
      const results: TreasuryPostClosingRecordResult[] = [];

      // Dedup por civilDate: manter maior versão (list já ordena version desc).
      const seenDates = new Set<string>();
      for (const row of listed.rows) {
        if (seenDates.has(row.civilDate)) continue;
        seenDates.add(row.civilDate);
        let currentHash =
          input.currentSourceHashByCivilDate?.[row.civilDate] ?? null;
        if (!currentHash && input.forceWithoutHash) {
          // Marcador distinto do hash congelado → detection SYNC_CHANGE dispara;
          // changeId permanece estável (kind|CLOSING|closingId|date) → reprocessamento idempotente.
          currentHash = `sync-touch:${input.requestId ?? "batch"}`;
        }
        if (!currentHash) {
          results.push({ raised: false, reason: "NO_DETECTION" });
          continue;
        }
        const result = await this.recordFinancialChange(
          {
            companyCode: row.companyCode,
            civilDate: row.civilDate,
            changeKind: "SYNC_CHANGE",
            entityKind: "CLOSING",
            entityId: row.id,
            amount: row.differenceAmount,
            frozenAmount: row.observedBalance,
            currentAmount: null,
            changedAtIso: formatTreasuryTimestampIso(now),
            currentSourceHash: currentHash,
          },
          { actor, now }
        );
        results.push(result);
      }
      return results;
    },
  };
}

/**
 * Hook fail-soft após mutação — nunca propaga erro para o fluxo financeiro.
 */
export async function notifyTreasuryPostClosingFinancialChange(
  event: TreasuryPostClosingChangeEventInput,
  deps: {
    prisma?: PrismaClient;
    service?: TreasuryPostClosingChangeService;
    requestId?: string | null;
  }
): Promise<TreasuryPostClosingRecordResult | null> {
  try {
    const service =
      deps.service ??
      createTreasuryPostClosingChangeService({ prisma: deps.prisma! });
    return await service.recordFinancialChange(event, {
      actor: buildTreasuryPostClosingSystemActor(deps.requestId),
    });
  } catch {
    return null;
  }
}

export function civilDateFromReferenceAt(referenceAt: Date | string): string | null {
  return toCivilDateKey(referenceAt);
}
