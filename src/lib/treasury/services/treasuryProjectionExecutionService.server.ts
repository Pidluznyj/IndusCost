/**
 * Serviço — execução e persistência de projeção.
 * PROCESSING = RUNNING; COMPLETED = SUCCEEDED (enum Prisma).
 * Não substitui projeção anterior; lock advisory por empresa+cenário.
 */

import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import { buildTreasuryProjectionSourceVersion } from "../domain/treasuryProjectionSourceHash.js";
import {
  runTreasuryProjectionEngine,
  TREASURY_PROJECTION_ALGORITHM_VERSION,
  type TreasuryProjectionEngineInput,
  type TreasuryProjectionEngineResult,
} from "../domain/treasuryProjectionEngine.js";
import type { TreasuryProjectionLayer } from "../contracts/treasuryEnums.js";
import {
  createTreasuryProjectionRunRepository,
  type TreasuryProjectionDayLinePersistInput,
  type TreasuryProjectionRunRepository,
  type TreasuryProjectionRunRow,
} from "../repositories/treasuryProjectionRunRepository.server.js";
import type { PrismaClient } from "@prisma/client";

export type ExecuteTreasuryProjectionCommand = {
  companyCode: string;
  scenario: TreasuryProjectionLayer;
  periodFrom: string;
  periodTo: string;
  asOfCivilDate: string;
  actorUserId: string;
  requestId?: string | null;
  idempotencyKey?: string | null;
  notes?: string | null;
  engineInput: Omit<
    TreasuryProjectionEngineInput,
    "scenario" | "periodFrom" | "periodTo" | "asOfCivilDate"
  > &
    Partial<
      Pick<
        TreasuryProjectionEngineInput,
        "scenario" | "periodFrom" | "periodTo" | "asOfCivilDate"
      >
    >;
  sourceParts?: Record<string, unknown>;
};

export type ExecuteTreasuryProjectionResult = {
  run: TreasuryProjectionRunRow;
  engine: TreasuryProjectionEngineResult | null;
  previousValidRunId: string | null;
};

export type TreasuryProjectionExecutionDeps = {
  repository: TreasuryProjectionRunRepository;
  runEngine?: (
    input: TreasuryProjectionEngineInput
  ) => TreasuryProjectionEngineResult;
  now?: () => Date;
  batchSize?: number;
};

function toPersistLines(
  engine: TreasuryProjectionEngineResult
): TreasuryProjectionDayLinePersistInput[] {
  return engine.dayLines.map((line) => ({
    accountId: line.accountId,
    civilDate: line.civilDate,
    openingBalance: line.openingBalance,
    inflows: line.inflows,
    outflows: line.outflows,
    transfers: line.transfers,
    realized: line.realized,
    closingBalance: line.closingBalance,
    uncertainReceivables: line.uncertainReceivables,
    minimumBalance: line.minimumBalance,
    riskAmount: line.riskAmount,
    riskCode: line.riskCode,
    itemCount: line.itemCount,
    composition: line.composition.map((c) => ({
      itemKind: c.itemKind,
      amount: c.amount,
      label: c.label,
      officialTitleId: c.officialTitleId,
      nomusExternalId: c.nomusExternalId,
      ledgerEntryId: c.ledgerEntryId,
      transferGroupId: c.transferGroupId,
      sourceRef: c.sourceRef,
      sortOrder: c.sortOrder,
      metadata: c.metadata,
    })),
  }));
}

export function createTreasuryProjectionExecutionDeps(
  db: PrismaClient
): TreasuryProjectionExecutionDeps {
  return {
    repository: createTreasuryProjectionRunRepository(db),
  };
}

export async function getLatestValidTreasuryProjection(
  companyCode: string | null,
  scenario: TreasuryProjectionLayer,
  deps: Pick<TreasuryProjectionExecutionDeps, "repository">
): Promise<TreasuryProjectionRunRow | null> {
  return deps.repository.findLatestSucceeded(companyCode, scenario);
}

/**
 * Executa projeção de ponta a ponta:
 * create → RUNNING → cálculo → persistência → SUCCEEDED | FAILED.
 */
export async function executeTreasuryProjection(
  command: ExecuteTreasuryProjectionCommand,
  deps: TreasuryProjectionExecutionDeps
): Promise<ExecuteTreasuryProjectionResult> {
  const companyCode = command.companyCode.trim();
  if (!companyCode) {
    throw new TreasuryDomainError(
      "REQUIRED_FIELD",
      "companyCode é obrigatório para execução de projeção.",
      "companyCode"
    );
  }

  const sourceVersion = buildTreasuryProjectionSourceVersion(
    command.sourceParts ?? {
      companyCode,
      scenario: command.scenario,
      periodFrom: command.periodFrom,
      periodTo: command.periodTo,
      asOfCivilDate: command.asOfCivilDate,
      accounts: command.engineInput.accounts,
      receivables: command.engineInput.receivables,
      payables: command.engineInput.payables,
      settlements: command.engineInput.settlements,
      expectations: command.engineInput.expectations,
      promises: command.engineInput.promises,
      programming: command.engineInput.programming,
      ledgerEntries: command.engineInput.ledgerEntries,
      transfers: command.engineInput.transfers,
      applications: command.engineInput.applications ?? [],
    }
  );

  const previousValid = await deps.repository.findLatestSucceeded(
    companyCode,
    command.scenario
  );
  const previousValidRunId = previousValid?.id ?? null;

  const locked = await deps.repository.tryAcquireExecutionLock(
    companyCode,
    command.scenario
  );
  if (!locked) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Já existe execução de projeção em andamento para a mesma empresa e cenário.",
      "scenario"
    );
  }

  let run: TreasuryProjectionRunRow | null = null;
  let engine: TreasuryProjectionEngineResult | null = null;
  const now = deps.now ?? (() => new Date());
  const runEngine = deps.runEngine ?? runTreasuryProjectionEngine;

  try {
    try {
      run = await deps.repository.createRun({
        companyCode,
        scenario: command.scenario,
        periodFrom: command.periodFrom,
        periodTo: command.periodTo,
        sourceVersion,
        algorithmVersion: TREASURY_PROJECTION_ALGORITHM_VERSION,
        createdByUserId: command.actorUserId,
        requestId: command.requestId ?? null,
        idempotencyKey: command.idempotencyKey ?? null,
        notes: command.notes ?? null,
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "P2002") {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Idempotency-Key já utilizada para execução de projeção.",
          "idempotencyKey"
        );
      }
      throw err;
    }

    // PROCESSING
    run = await deps.repository.markRunning(run.id, now());

    try {
      const engineInput: TreasuryProjectionEngineInput = {
        ...command.engineInput,
        scenario: command.scenario,
        periodFrom: command.periodFrom,
        periodTo: command.periodTo,
        asOfCivilDate: command.asOfCivilDate,
      };
      engine = runEngine(engineInput);
      await deps.repository.persistDayLines(
        run.id,
        toPersistLines(engine),
        { batchSize: deps.batchSize ?? 50 }
      );
      // COMPLETED
      run = await deps.repository.markSucceeded(run.id, {
        finishedAt: now(),
        lineCount: engine.lineCount,
        itemCount: engine.itemCount,
        updatedByUserId: command.actorUserId,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Falha na execução da projeção.";
      const failureCode =
        err instanceof TreasuryDomainError ? err.code : "VALIDATION_ERROR";
      run = await deps.repository.markFailed(run.id, {
        finishedAt: now(),
        failureCode,
        failureMessage: message,
        failureDetail: {
          name: err instanceof Error ? err.name : "Error",
          stack: err instanceof Error ? err.stack ?? null : null,
        },
        updatedByUserId: command.actorUserId,
      });
      throw err instanceof TreasuryDomainError
        ? err
        : new TreasuryDomainError("VALIDATION_ERROR", message);
    }

    return {
      run,
      engine,
      previousValidRunId,
    };
  } finally {
    await deps.repository.releaseExecutionLock(companyCode, command.scenario);
  }
}
