/**
 * Resolução de contas autorizadas (anti-IDOR) reutilizável pelos serviços.
 */

import {
  canTreasuryActorAccessAccount,
  canTreasuryActorManageAccount,
  canTreasuryActorMutateAccountBalance,
  canTreasuryActorViewAccountBalance,
  canTreasuryActorViewAllAccounts,
  type TreasuryAccountAccessSnapshot,
  type TreasuryAccountActor,
} from "../domain/treasuryAccountRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryAccountRepository } from "../repositories/treasuryAccountRepository.server.js";

export type TreasuryAccountAclMode =
  | "access"
  | "viewBalance"
  | "manage"
  | "mutateBalance";

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

function allows(
  mode: TreasuryAccountAclMode,
  actor: TreasuryAccountActor,
  access: TreasuryAccountAccessSnapshot | null
): boolean {
  switch (mode) {
    case "access":
      return canTreasuryActorAccessAccount(actor, access);
    case "viewBalance":
      return canTreasuryActorViewAccountBalance(actor, access);
    case "manage":
      return canTreasuryActorManageAccount(actor, access);
    case "mutateBalance":
      return canTreasuryActorMutateAccountBalance(actor, access);
    default:
      return false;
  }
}

/** Lista IDs de contas ativas autorizadas no modo informado. */
export async function listTreasuryAuthorizedAccountIds(
  actor: TreasuryAccountActor,
  accountRepo: TreasuryAccountRepository,
  mode: TreasuryAccountAclMode = "viewBalance"
): Promise<string[]> {
  const listed = await accountRepo.list({
    companyCode: null,
    isActive: true,
    sortBy: "sortOrder",
    sortDirection: "asc",
    page: 1,
    pageSize: 200,
    accessibleByUserId: canTreasuryActorViewAllAccounts(actor)
      ? null
      : actor.userId,
  });

  const authorized: string[] = [];
  for (const acc of listed.rows) {
    const access = asAccessSnapshot(
      await accountRepo.findAccess(acc.id, actor.userId)
    );
    if (allows(mode, actor, access)) {
      authorized.push(acc.id);
    }
  }
  return authorized;
}

/**
 * Intersecta pedido do cliente com contas autorizadas.
 * `requestedAccountId` / `requestedAccountIds` fora do ACL → FORBIDDEN.
 */
export async function resolveTreasuryAuthorizedAccountIds(input: {
  actor: TreasuryAccountActor;
  accountRepo: TreasuryAccountRepository;
  mode?: TreasuryAccountAclMode;
  requestedAccountId?: string | null;
  requestedAccountIds?: string[] | null;
  fieldName?: string;
}): Promise<string[]> {
  const mode = input.mode ?? "viewBalance";
  const authorized = await listTreasuryAuthorizedAccountIds(
    input.actor,
    input.accountRepo,
    mode
  );
  const field = input.fieldName ?? "accountId";

  const single = input.requestedAccountId?.trim();
  if (single) {
    if (!authorized.includes(single)) {
      throw new TreasuryDomainError(
        "FORBIDDEN",
        "Sem acesso à conta financeira solicitada.",
        field
      );
    }
    return [single];
  }

  const many = (input.requestedAccountIds ?? [])
    .map((id) => id.trim())
    .filter(Boolean);
  if (many.length) {
    for (const id of many) {
      if (!authorized.includes(id)) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem acesso à conta financeira solicitada.",
          field
        );
      }
    }
    return many;
  }

  return authorized;
}

export async function assertTreasuryAccountAuthorized(input: {
  actor: TreasuryAccountActor;
  accountRepo: TreasuryAccountRepository;
  accountId: string;
  mode?: TreasuryAccountAclMode;
  fieldName?: string;
}): Promise<void> {
  await resolveTreasuryAuthorizedAccountIds({
    actor: input.actor,
    accountRepo: input.accountRepo,
    mode: input.mode ?? "manage",
    requestedAccountId: input.accountId,
    fieldName: input.fieldName ?? "accountId",
  });
}
