/**
 * Apply de importação OFX — consome preview token, persiste lote/movimentos.
 * Idempotente por (accountId, fileSha256); não duplica fingerprints.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type { TreasuryBankImportOfxApplyInput } from "../contracts/treasurySchemas.js";
import {
  canTreasuryActorManageAccount,
  type TreasuryAccountAccessSnapshot,
  type TreasuryAccountActor,
} from "../domain/treasuryAccountRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryOfxPreviewMovementRow } from "../domain/treasuryOfxPreviewRules.js";
import {
  consumeTreasuryOfxPreviewToken,
  peekTreasuryOfxPreviewToken,
} from "../ofx/treasuryOfxPreviewToken.server.js";
import {
  createTreasuryAccountRepository,
  type TreasuryAccountRepository,
} from "../repositories/treasuryAccountRepository.server.js";
import {
  createTreasuryBankMovementRepository,
  type TreasuryBankImportBatchRow,
  type TreasuryBankMovementCreateData,
  type TreasuryBankMovementRepository,
} from "../repositories/treasuryBankMovementRepository.server.js";
import { writeTreasuryAuditLog } from "./treasuryAuditService.server.js";
import {
  requestTreasuryProjectionRecalc,
  type TreasuryProjectionRecalcResult,
} from "./treasuryProjectionRecalc.server.js";
import {
  requestTreasuryReconciliationSuggestions,
  type TreasuryReconciliationSuggestionsResult,
} from "./treasuryReconciliationSuggestions.server.js";
import {
  buildTreasuryBankImportOfxPreviewActor,
  type TreasuryBankImportOfxPreviewActor,
} from "./treasuryBankImportOfxPreviewService.server.js";

export type TreasuryBankImportOfxApplyActor = TreasuryBankImportOfxPreviewActor;

export const buildTreasuryBankImportOfxApplyActor =
  buildTreasuryBankImportOfxPreviewActor;

function asAccountActor(
  actor: TreasuryBankImportOfxApplyActor
): TreasuryAccountActor {
  return {
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    sessionId: actor.sessionId,
    requestId: actor.requestId,
    isSuperAdmin: actor.isSuperAdmin,
    canViewAccounts:
      actor.canViewAccounts || actor.canManageReconciliation,
    canManageAccounts: actor.canManageAccounts,
  };
}

function asAccessSnapshot(
  access: Awaited<ReturnType<TreasuryAccountRepository["findAccess"]>>
): TreasuryAccountAccessSnapshot | null {
  if (!access) return null;
  return {
    userId: access.userId,
    accessLevel: access.accessLevel as TreasuryAccountAccessSnapshot["accessLevel"],
    isActive: access.isActive,
    revokedAt: access.revokedAt,
    canViewBalance: access.canViewBalance,
    canMutateBalance: access.canMutateBalance,
  };
}

function civilDateToUtc(civilDate: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civilDate.trim());
  if (!m) {
    throw new TreasuryDomainError(
      "INVALID_CIVIL_DATE",
      `Data civil inválida: ${civilDate}`,
      "postedCivilDate"
    );
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      String((err as { code?: string }).code) === "P2002"
  );
}

export type TreasuryOfxApplyIgnoredItem = {
  fingerprint: string | null;
  fitId: string | null;
  reason: string;
  duplicateReason: string | null;
};

export type TreasuryOfxApplyInvalidItem = {
  sortOrder: number;
  fitId: string | null;
  reason: string;
};

export type TreasuryOfxApplyErrorItem = {
  code: string;
  message: string;
  field?: string;
  fingerprint?: string | null;
};

export type TreasuryBankImportOfxApplyResult = {
  ok: true;
  idempotent: boolean;
  batchId: string;
  accountId: string;
  companyCode: string;
  fileSha256: string;
  status: string;
  created: {
    count: number;
    movementIds: string[];
    fingerprints: string[];
  };
  ignored: {
    count: number;
    items: TreasuryOfxApplyIgnoredItem[];
  };
  invalid: {
    count: number;
    items: TreasuryOfxApplyInvalidItem[];
  };
  errors: TreasuryOfxApplyErrorItem[];
  suggestionsRequested: TreasuryReconciliationSuggestionsResult;
  projectionRecalc: TreasuryProjectionRecalcResult;
};

export type TreasuryBankImportOfxApplyService = {
  apply(
    actor: TreasuryBankImportOfxApplyActor,
    input: TreasuryBankImportOfxApplyInput
  ): Promise<TreasuryBankImportOfxApplyResult>;
};

function buildIdempotentResult(input: {
  batch: TreasuryBankImportBatchRow;
  movements: readonly TreasuryOfxPreviewMovementRow[];
  suggestionsRequested: TreasuryReconciliationSuggestionsResult;
  projectionRecalc: TreasuryProjectionRecalcResult;
}): TreasuryBankImportOfxApplyResult {
  const ignored: TreasuryOfxApplyIgnoredItem[] = [];
  const invalid: TreasuryOfxApplyInvalidItem[] = [];
  for (const row of input.movements) {
    if (row.status === "INVALID") {
      invalid.push({
        sortOrder: row.sortOrder,
        fitId: row.fitId,
        reason: row.invalidReason ?? "Linha inválida no preview.",
      });
      continue;
    }
    ignored.push({
      fingerprint: row.fingerprint,
      fitId: row.fitId,
      reason: "Arquivo já importado para esta conta (idempotente).",
      duplicateReason: row.duplicateReason ?? "EXISTING_FILE",
    });
  }
  return {
    ok: true,
    idempotent: true,
    batchId: input.batch.id,
    accountId: input.batch.accountId,
    companyCode: input.batch.companyCode,
    fileSha256: input.batch.fileSha256,
    status: String(input.batch.status),
    created: { count: 0, movementIds: [], fingerprints: [] },
    ignored: { count: ignored.length, items: ignored },
    invalid: { count: invalid.length, items: invalid },
    errors: [],
    suggestionsRequested: input.suggestionsRequested,
    projectionRecalc: input.projectionRecalc,
  };
}

export function createTreasuryBankImportOfxApplyService(deps: {
  prisma: PrismaClient;
  accountRepo?: TreasuryAccountRepository;
  movementRepo?: TreasuryBankMovementRepository;
  peekToken?: typeof peekTreasuryOfxPreviewToken;
  consumeToken?: typeof consumeTreasuryOfxPreviewToken;
  requestSuggestions?: typeof requestTreasuryReconciliationSuggestions;
  requestProjectionRecalc?: typeof requestTreasuryProjectionRecalc;
  runInTransaction?: <T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>
  ) => Promise<T>;
}): TreasuryBankImportOfxApplyService {
  const accountRepo =
    deps.accountRepo ?? createTreasuryAccountRepository(deps.prisma);
  const movementRepo =
    deps.movementRepo ?? createTreasuryBankMovementRepository(deps.prisma);
  const peekToken = deps.peekToken ?? peekTreasuryOfxPreviewToken;
  const consumeToken = deps.consumeToken ?? consumeTreasuryOfxPreviewToken;
  const requestSuggestions =
    deps.requestSuggestions ?? requestTreasuryReconciliationSuggestions;
  const requestProjection =
    deps.requestProjectionRecalc ?? requestTreasuryProjectionRecalc;
  const runInTransaction =
    deps.runInTransaction ??
    ((fn) => deps.prisma.$transaction(async (tx) => fn(tx)));

  return {
    async apply(actor, input) {
      if (!actor.canManageReconciliation && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para importação/conciliação bancária."
        );
      }

      const preview = peekToken(input.previewToken, {
        expectedUserId: actor.userId,
      });
      if (!preview) {
        throw new TreasuryDomainError(
          "VALIDATION_ERROR",
          "previewToken inválido, expirado ou de outro usuário.",
          "previewToken"
        );
      }
      if (
        input.contentHash &&
        input.contentHash.trim() !== preview.contentHash
      ) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "contentHash do preview não confere.",
          "contentHash"
        );
      }

      const account = await accountRepo.findById(preview.accountId);
      if (!account || !account.isActive) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Conta financeira não encontrada ou inativa.",
          "accountId"
        );
      }
      const access = await accountRepo.findAccess(
        preview.accountId,
        actor.userId
      );
      if (
        !canTreasuryActorManageAccount(
          asAccountActor(actor),
          asAccessSnapshot(access)
        )
      ) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem autorização operacional nesta conta financeira.",
          "accountId"
        );
      }

      const existingBatch = await movementRepo.findBatchByFileSha256(
        preview.accountId,
        preview.fileSha256
      );
      if (existingBatch) {
        consumeToken(input.previewToken, { expectedUserId: actor.userId });
        const suggestionsRequested = requestSuggestions({
          reason: "ofx_import_idempotent",
          accountId: existingBatch.accountId,
          batchId: existingBatch.id,
          companyCode: existingBatch.companyCode,
          movementIds: [],
          requestId: actor.requestId,
        });
        const projectionRecalc = requestProjection({
          reason: "ofx_import_idempotent",
          titleId: existingBatch.id,
          titleType: "RECEIVABLE",
          expectedDate: null,
          companyCode: existingBatch.companyCode,
          projectionLayer: "PROBABLE",
          requestId: actor.requestId,
        });
        return buildIdempotentResult({
          batch: existingBatch,
          movements: preview.movements,
          suggestionsRequested,
          projectionRecalc,
        });
      }

      const ignored: TreasuryOfxApplyIgnoredItem[] = [];
      const invalid: TreasuryOfxApplyInvalidItem[] = [];
      const errors: TreasuryOfxApplyErrorItem[] = [];
      const candidates: TreasuryOfxPreviewMovementRow[] = [];

      for (const row of preview.movements) {
        if (row.status === "INVALID") {
          invalid.push({
            sortOrder: row.sortOrder,
            fitId: row.fitId,
            reason: row.invalidReason ?? "Linha inválida no preview.",
          });
          continue;
        }
        if (row.status === "DUPLICATE") {
          ignored.push({
            fingerprint: row.fingerprint,
            fitId: row.fitId,
            reason: "Movimento duplicado (já existente ou intra-arquivo).",
            duplicateReason: row.duplicateReason,
          });
          continue;
        }
        if (
          !row.fingerprint ||
          !row.direction ||
          !row.amount ||
          !row.postedCivilDate
        ) {
          errors.push({
            code: "VALIDATION_ERROR",
            message: "Movimento NEW incompleto no preview.",
            field: "movements",
            fingerprint: row.fingerprint,
          });
          continue;
        }
        candidates.push(row);
      }

      const liveFingerprints = await movementRepo.findExistingFingerprints(
        preview.accountId,
        candidates.map((c) => c.fingerprint!)
      );
      const toInsert: TreasuryOfxPreviewMovementRow[] = [];
      for (const row of candidates) {
        if (liveFingerprints.has(row.fingerprint!)) {
          ignored.push({
            fingerprint: row.fingerprint,
            fitId: row.fitId,
            reason: "Fingerprint já persistido (corrida/idempotência).",
            duplicateReason: "EXISTING_MOVEMENT",
          });
          continue;
        }
        toInsert.push(row);
      }

      let batch: TreasuryBankImportBatchRow;
      let createdRows: { id: string; fingerprint: string }[] = [];

      try {
        const persisted = await runInTransaction(async (tx) => {
          const raced = await movementRepo.findBatchByFileSha256(
            preview.accountId,
            preview.fileSha256,
            tx
          );
          if (raced) {
            return { kind: "idempotent" as const, batch: raced, created: [] };
          }

          const summaryJson = {
            previewContentHash: preview.contentHash,
            createdCount: toInsert.length,
            ignoredCount: ignored.length,
            invalidCount: invalid.length,
            errorCount: errors.length,
            totalsFromPreview: {
              movementCount: preview.movements.length,
            },
            ledgerBalanceAmount: preview.ledgerBalanceAmount ?? null,
            ledgerBalanceAsOfCivilDate:
              preview.ledgerBalanceAsOfCivilDate ?? null,
          } satisfies Record<string, unknown>;

          const createdBatch = await movementRepo.createBatch(
            {
              companyCode: preview.companyCode,
              accountId: preview.accountId,
              fileSha256: preview.fileSha256,
              originalFileName: preview.originalFileName,
              byteLength: preview.byteLength,
              format: preview.format,
              status: "PROCESSED",
              transactionCount: toInsert.length,
              summaryJson: summaryJson as Prisma.InputJsonValue,
              requestId: actor.requestId ?? null,
              notes: input.notes,
              createdByUserId: actor.userId,
              processedAt: new Date(),
            },
            tx
          );

          const movementData: TreasuryBankMovementCreateData[] = [];
          for (const row of toInsert) {
            movementData.push({
              batchId: createdBatch.id,
              companyCode: preview.companyCode,
              accountId: preview.accountId,
              fingerprint: row.fingerprint!,
              fitId: row.fitId,
              direction: row.direction!,
              amount: row.amount!,
              currency: (row.currency ?? "BRL").toUpperCase(),
              postedCivilDate: civilDateToUtc(row.postedCivilDate!),
              userCivilDate: row.userCivilDate
                ? civilDateToUtc(row.userCivilDate)
                : null,
              description: row.description,
              documentNumber: row.documentNumber,
              counterpartyName: row.counterpartyName,
              trnType: row.trnType,
              normalizedPayloadJson: (row.normalizedPayload ??
                null) as Prisma.InputJsonValue | null,
              sortOrder: row.sortOrder,
            });
          }

          const inserted = await movementRepo.createMovements(movementData, tx);
          const insertedFp = new Set(inserted.map((r) => r.fingerprint));
          for (const data of movementData) {
            if (!insertedFp.has(data.fingerprint)) {
              ignored.push({
                fingerprint: data.fingerprint,
                fitId: data.fitId,
                reason: "Duplicidade detectada na transação (P2002).",
                duplicateReason: "EXISTING_MOVEMENT",
              });
            }
          }

          await writeTreasuryAuditLog(tx, {
            entityType: "OFX_IMPORT",
            entityId: createdBatch.id,
            action: "IMPORT",
            before: null,
            after: {
              id: createdBatch.id,
              accountId: createdBatch.accountId,
              fileSha256: createdBatch.fileSha256,
              status: createdBatch.status,
              transactionCount: inserted.length,
              originalFileName: createdBatch.originalFileName,
            },
            metadata: {
              createdCount: inserted.length,
              ignoredCount: ignored.length,
              invalidCount: invalid.length,
              errorCount: errors.length,
            },
            justification: input.notes ?? "Importação OFX aplicada.",
            userId: actor.userId,
            userName: actor.userName,
            sessionId: actor.sessionId,
            requestId: actor.requestId,
          });

          return {
            kind: "created" as const,
            batch: createdBatch,
            created: inserted,
          };
        });

        if (persisted.kind === "idempotent") {
          consumeToken(input.previewToken, { expectedUserId: actor.userId });
          const suggestionsRequested = requestSuggestions({
            reason: "ofx_import_idempotent",
            accountId: persisted.batch.accountId,
            batchId: persisted.batch.id,
            companyCode: persisted.batch.companyCode,
            movementIds: [],
            requestId: actor.requestId,
          });
          const projectionRecalc = requestProjection({
            reason: "ofx_import_idempotent",
            titleId: persisted.batch.id,
            titleType: "RECEIVABLE",
            expectedDate: null,
            companyCode: persisted.batch.companyCode,
            projectionLayer: "PROBABLE",
            requestId: actor.requestId,
          });
          return buildIdempotentResult({
            batch: persisted.batch,
            movements: preview.movements,
            suggestionsRequested,
            projectionRecalc,
          });
        }

        batch = persisted.batch;
        createdRows = persisted.created;
      } catch (err) {
        if (isPrismaUniqueViolation(err)) {
          const raced = await movementRepo.findBatchByFileSha256(
            preview.accountId,
            preview.fileSha256
          );
          if (raced) {
            consumeToken(input.previewToken, {
              expectedUserId: actor.userId,
            });
            const suggestionsRequested = requestSuggestions({
              reason: "ofx_import_idempotent",
              accountId: raced.accountId,
              batchId: raced.id,
              companyCode: raced.companyCode,
              movementIds: [],
              requestId: actor.requestId,
            });
            const projectionRecalc = requestProjection({
              reason: "ofx_import_idempotent",
              titleId: raced.id,
              titleType: "RECEIVABLE",
              expectedDate: null,
              companyCode: raced.companyCode,
              projectionLayer: "PROBABLE",
              requestId: actor.requestId,
            });
            return buildIdempotentResult({
              batch: raced,
              movements: preview.movements,
              suggestionsRequested,
              projectionRecalc,
            });
          }
        }
        throw err;
      }

      consumeToken(input.previewToken, { expectedUserId: actor.userId });

      const periodEnd =
        toInsert
          .map((m) => m.postedCivilDate)
          .filter((d): d is string => Boolean(d))
          .sort()
          .at(-1) ?? null;

      const suggestionsRequested = requestSuggestions({
        reason: "ofx_import_applied",
        accountId: batch.accountId,
        batchId: batch.id,
        companyCode: batch.companyCode,
        movementIds: createdRows.map((r) => r.id),
        requestId: actor.requestId,
      });
      const projectionRecalc = requestProjection({
        reason: "ofx_import_applied",
        titleId: batch.id,
        titleType: "RECEIVABLE",
        expectedDate: periodEnd,
        companyCode: batch.companyCode,
        projectionLayer: "PROBABLE",
        requestId: actor.requestId,
      });

      return {
        ok: true,
        idempotent: false,
        batchId: batch.id,
        accountId: batch.accountId,
        companyCode: batch.companyCode,
        fileSha256: batch.fileSha256,
        status: String(batch.status),
        created: {
          count: createdRows.length,
          movementIds: createdRows.map((r) => r.id),
          fingerprints: createdRows.map((r) => r.fingerprint),
        },
        ignored: { count: ignored.length, items: ignored },
        invalid: { count: invalid.length, items: invalid },
        errors,
        suggestionsRequested,
        projectionRecalc,
      };
    },
  };
}
