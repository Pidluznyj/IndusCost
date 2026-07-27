/**
 * Regras puras de contas financeiras da Tesouraria (sem Prisma / sem I/O).
 */

import { TreasuryDomainError } from "./treasuryErrors.js";

export type TreasuryAccountActor = {
  userId: string;
  userName?: string | null;
  role: string;
  sessionId?: string | null;
  requestId?: string | null;
  isSuperAdmin: boolean;
  canViewAccounts: boolean;
  canManageAccounts: boolean;
  /** Capacidade `finance.treasury.balances` manage. */
  canManageBalances?: boolean;
};

export type TreasuryAccountAccessSnapshot = {
  userId: string;
  accessLevel: "VIEW" | "OPERATE" | "MANAGE";
  isActive: boolean;
  revokedAt?: Date | string | null;
  canViewBalance?: boolean;
  canMutateBalance?: boolean;
};

/** Impede conta origem = destino (transferências futuras e validações atuais). */
export function assertTreasuryTransferAccountsDistinct(
  fromAccountId: string,
  toAccountId: string
): void {
  const from = fromAccountId.trim();
  const to = toAccountId.trim();
  if (!from || !to) {
    throw new TreasuryDomainError(
      "REQUIRED_FIELD",
      "fromAccountId e toAccountId são obrigatórios."
    );
  }
  if (from === to) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Conta de origem e destino devem ser distintas.",
      "toAccountId"
    );
  }
}

export function isTreasuryAccountSuperAdmin(
  actor: Pick<TreasuryAccountActor, "isSuperAdmin" | "role">
): boolean {
  return actor.isSuperAdmin === true || actor.role === "SUPER_ADMIN";
}

export function canTreasuryActorViewAllAccounts(
  actor: TreasuryAccountActor
): boolean {
  return isTreasuryAccountSuperAdmin(actor) || actor.canManageAccounts;
}

export function canTreasuryActorAccessAccount(
  actor: TreasuryAccountActor,
  access: TreasuryAccountAccessSnapshot | null
): boolean {
  if (canTreasuryActorViewAllAccounts(actor)) return true;
  if (!actor.canViewAccounts) return false;
  if (!access) return false;
  if (!access.isActive || access.revokedAt) return false;
  return access.userId === actor.userId;
}

export function canTreasuryActorManageAccount(
  actor: TreasuryAccountActor,
  access: TreasuryAccountAccessSnapshot | null
): boolean {
  if (isTreasuryAccountSuperAdmin(actor) || actor.canManageAccounts) return true;
  if (!access || !access.isActive || access.revokedAt) return false;
  return (
    access.userId === actor.userId &&
    (access.accessLevel === "MANAGE" || access.accessLevel === "OPERATE")
  );
}

/** Revelar identificadores bancários mascarados armazenados (ainda mascarados no DB). */
export function canRevealTreasuryBankIdentifiers(
  actor: TreasuryAccountActor,
  access: TreasuryAccountAccessSnapshot | null
): boolean {
  if (isTreasuryAccountSuperAdmin(actor) || actor.canManageAccounts) return true;
  if (!access || !access.isActive || access.revokedAt) return false;
  return (
    access.userId === actor.userId &&
    (access.accessLevel === "OPERATE" || access.accessLevel === "MANAGE")
  );
}

/** Visualizar saldos/snapshots da conta. */
export function canTreasuryActorViewAccountBalance(
  actor: TreasuryAccountActor,
  access: TreasuryAccountAccessSnapshot | null
): boolean {
  if (isTreasuryAccountSuperAdmin(actor) || actor.canManageAccounts) return true;
  if (!canTreasuryActorAccessAccount(actor, access)) return false;
  if (!access) return false;
  return access.canViewBalance !== false;
}

/** Informar novo snapshot de saldo. */
export function canTreasuryActorMutateAccountBalance(
  actor: TreasuryAccountActor,
  access: TreasuryAccountAccessSnapshot | null
): boolean {
  if (isTreasuryAccountSuperAdmin(actor) || actor.canManageAccounts) return true;
  if (!actor.canManageBalances) return false;
  if (canTreasuryActorViewAllAccounts(actor)) return true;
  if (!access || !access.isActive || access.revokedAt) return false;
  if (access.userId !== actor.userId) return false;
  return (
    access.canMutateBalance === true ||
    access.accessLevel === "OPERATE" ||
    access.accessLevel === "MANAGE"
  );
}

/**
 * Redação adicional para VIEW-only: não expor o padrão mascarado completo.
 * Valores já chegam mascarados do cadastro; aqui só ofuscamos mais.
 */
export function maskTreasuryBankIdentifierForViewer(
  value: string,
  reveal: boolean
): string {
  if (reveal) return value;
  const trimmed = value.trim();
  if (trimmed.length <= 2) return "**";
  return `${"*".repeat(Math.min(4, trimmed.length - 2))}${trimmed.slice(-2)}`;
}

export function assertTreasuryAccountHardDeleteAllowed(history: {
  snapshotCount: number;
  auditCount: number;
  accessCount: number;
}): never {
  if (
    history.snapshotCount > 0 ||
    history.auditCount > 0 ||
    history.accessCount > 0
  ) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Conta financeira com histórico não pode ser excluída fisicamente."
    );
  }
  throw new TreasuryDomainError(
    "CONFLICT",
    "Contas financeiras não admitem exclusão física; use desativação."
  );
}

export function assertOptimisticLockMatch(input: {
  expectedUpdatedAt: Date | string;
  actualUpdatedAt: Date;
}): void {
  const expected =
    input.expectedUpdatedAt instanceof Date
      ? input.expectedUpdatedAt.getTime()
      : new Date(input.expectedUpdatedAt).getTime();
  if (!Number.isFinite(expected)) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "expectedUpdatedAt inválido.",
      "expectedUpdatedAt"
    );
  }
  if (expected !== input.actualUpdatedAt.getTime()) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Conta foi alterada por outro processo (optimistic lock).",
      "expectedUpdatedAt"
    );
  }
}
