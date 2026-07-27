/**
 * Preview de importação OFX — processa arquivo, classifica linhas e emite token.
 * Não grava movimentos/transações financeiras.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { TreasuryOfxPreviewDuplicateReason } from "../contracts/treasuryEnums.js";
import {
  canTreasuryActorManageAccount,
  type TreasuryAccountAccessSnapshot,
  type TreasuryAccountActor,
} from "../domain/treasuryAccountRules.js";
import { buildTreasuryBankMovementFingerprint } from "../domain/treasuryBankMovementFingerprint.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  absoluteTreasuryMoneyString,
  buildTreasuryOfxPreviewClassification,
  type TreasuryOfxPreviewMovementRow,
  type TreasuryOfxPreviewPeriod,
  type TreasuryOfxPreviewTotals,
} from "../domain/treasuryOfxPreviewRules.js";
import { inspectTreasuryOfxUpload } from "../ofx/treasuryOfxInspection.server.js";
import {
  hashTreasuryOfxPreviewContent,
  issueTreasuryOfxPreviewToken,
} from "../ofx/treasuryOfxPreviewToken.server.js";
import {
  createTreasuryAccountRepository,
  type TreasuryAccountRepository,
} from "../repositories/treasuryAccountRepository.server.js";
import {
  createTreasuryBankMovementRepository,
  type TreasuryBankMovementRepository,
} from "../repositories/treasuryBankMovementRepository.server.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";

export type TreasuryBankImportOfxPreviewActor = {
  userId: string;
  userName?: string | null;
  role: string;
  sessionId?: string | null;
  requestId?: string | null;
  isSuperAdmin: boolean;
  canManageReconciliation: boolean;
  canManageAccounts: boolean;
  canViewAccounts: boolean;
};

export function buildTreasuryBankImportOfxPreviewActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryBankImportOfxPreviewActor {
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    sessionId: user.sessionId,
    requestId: requestId ?? null,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canManageReconciliation: canTreasuryCapability(user, "manageReconciliation"),
    canManageAccounts: canTreasuryCapability(user, "manageAccounts"),
    canViewAccounts: canTreasuryCapability(user, "viewAccounts"),
  };
}

function asAccountActor(
  actor: TreasuryBankImportOfxPreviewActor
): TreasuryAccountActor {
  return {
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    sessionId: actor.sessionId,
    requestId: actor.requestId,
    isSuperAdmin: actor.isSuperAdmin,
    // Visualização ampla da lista ≠ bypass de ACL operacional da conta.
    canViewAccounts:
      actor.canViewAccounts || actor.canManageReconciliation,
    // Importação exige OPERATE/MANAGE na conta (ou manageAccounts / super-admin).
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

export type TreasuryBankImportOfxPreviewInput = {
  accountId: string;
  buffer: Buffer;
  originalName: string;
  mimeType: string;
};

export type TreasuryOfxPreviewMovementDto = {
  sortOrder: number;
  status: TreasuryOfxPreviewMovementRow["status"];
  fingerprint: string | null;
  fitId: string | null;
  direction: TreasuryOfxPreviewMovementRow["direction"];
  amount: string | null;
  currency: string | null;
  postedCivilDate: string | null;
  description: string | null;
  documentNumber: string | null;
  counterpartyName: string | null;
  trnType: string | null;
  invalidReason: string | null;
  duplicateReason: TreasuryOfxPreviewDuplicateReason | null;
};

export type TreasuryBankImportOfxPreviewResult = {
  ok: true;
  persisted: false;
  previewToken: string;
  expiresAt: string;
  accountId: string;
  companyCode: string;
  fileSha256: string;
  originalFileName: string;
  format: string;
  byteLength: number;
  fileAlreadyImported: boolean;
  period: TreasuryOfxPreviewPeriod;
  totals: TreasuryOfxPreviewTotals;
  movements: TreasuryOfxPreviewMovementDto[];
  warnings: string[];
};

export type TreasuryBankImportOfxPreviewService = {
  preview(
    actor: TreasuryBankImportOfxPreviewActor,
    input: TreasuryBankImportOfxPreviewInput
  ): Promise<TreasuryBankImportOfxPreviewResult>;
};

function toMovementDto(
  row: TreasuryOfxPreviewMovementRow
): TreasuryOfxPreviewMovementDto {
  return {
    sortOrder: row.sortOrder,
    status: row.status,
    fingerprint: row.fingerprint,
    fitId: row.fitId,
    direction: row.direction,
    amount: row.amount,
    currency: row.currency,
    postedCivilDate: row.postedCivilDate,
    description: row.description,
    documentNumber: row.documentNumber,
    counterpartyName: row.counterpartyName,
    trnType: row.trnType,
    invalidReason: row.invalidReason,
    duplicateReason: row.duplicateReason,
  };
}

export function createTreasuryBankImportOfxPreviewService(deps: {
  prisma: PrismaClient;
  accountRepo?: TreasuryAccountRepository;
  movementRepo?: TreasuryBankMovementRepository;
  inspectUpload?: typeof inspectTreasuryOfxUpload;
  issueToken?: typeof issueTreasuryOfxPreviewToken;
}): TreasuryBankImportOfxPreviewService {
  const accountRepo =
    deps.accountRepo ?? createTreasuryAccountRepository(deps.prisma);
  const movementRepo =
    deps.movementRepo ?? createTreasuryBankMovementRepository(deps.prisma);
  const inspectUpload = deps.inspectUpload ?? inspectTreasuryOfxUpload;
  const issueToken = deps.issueToken ?? issueTreasuryOfxPreviewToken;

  return {
    async preview(actor, input) {
      if (!actor.canManageReconciliation && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para importação/conciliação bancária."
        );
      }

      const accountId = String(input.accountId ?? "").trim();
      if (!accountId) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "accountId é obrigatório.",
          "accountId"
        );
      }

      const account = await accountRepo.findById(accountId);
      if (!account || !account.isActive) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Conta financeira não encontrada ou inativa.",
          "accountId"
        );
      }

      const access = await accountRepo.findAccess(accountId, actor.userId);
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

      if (!input.buffer?.byteLength) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "Arquivo OFX não enviado.",
          "file"
        );
      }

      const inspected = inspectUpload(
        {
          buffer: input.buffer,
          originalName: input.originalName,
          mimeType: input.mimeType,
        },
        { quarantineInvalid: true }
      );

      const candidateFingerprints = inspected.transactions.map((tx) =>
        buildTreasuryBankMovementFingerprint({
          accountId,
          fitId: tx.fitId,
          postedCivilDate: tx.postedCivilDate,
          direction: tx.direction,
          amount: absoluteTreasuryMoneyString(tx.amount),
          description: tx.memo,
          documentNumber: null,
        })
      );

      const [existingFingerprints, existingBatchId] = await Promise.all([
        movementRepo.findExistingFingerprints(accountId, candidateFingerprints),
        movementRepo.findBatchIdByFileSha256(accountId, inspected.fileSha256),
      ]);

      const fileAlreadyImported = Boolean(existingBatchId);
      const classified = buildTreasuryOfxPreviewClassification({
        accountId,
        transactions: inspected.transactions,
        invalidSeeds: inspected.invalidTransactions.map((row) => ({
          sortOrder: row.sortOrder,
          reason: row.reason,
          field: row.field,
          fitId: row.fitId,
          description: row.description,
        })),
        existingFingerprints,
        fileAlreadyImported,
      });

      const contentHash = hashTreasuryOfxPreviewContent(classified.movements);
      const token = issueToken({
        userId: actor.userId,
        accountId,
        companyCode: account.companyCode,
        fileSha256: inspected.fileSha256,
        originalFileName: input.originalName,
        format: inspected.format,
        byteLength: inspected.byteLength,
        contentHash,
        movements: classified.movements,
      });

      return {
        ok: true,
        persisted: false,
        previewToken: token.previewToken,
        expiresAt: token.expiresAt,
        accountId,
        companyCode: account.companyCode,
        fileSha256: inspected.fileSha256,
        originalFileName: input.originalName,
        format: inspected.format,
        byteLength: inspected.byteLength,
        fileAlreadyImported,
        period: classified.period,
        totals: classified.totals,
        movements: classified.movements.map(toMovementDto),
        warnings: inspected.warnings,
      };
    },
  };
}
