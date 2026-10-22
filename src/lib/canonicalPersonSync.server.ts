/**
 * Propagação da identidade canônica entre o colaborador e a conta ligada a ele (E4).
 *
 * Regra: a conta recebe a Pessoa do colaborador quando a associação é inequívoca
 * (conta sem Pessoa, ou com a Pessoa anterior do mesmo colaborador). Nunca sobrescreve
 * silenciosamente uma conta que aponta para OUTRA Pessoa: isso é conflito e vai para
 * a correção controlada (Pessoas 360°).
 *
 * É efeito colateral de uma operação interativa (PUT do colaborador): exige a permissão efetiva de
 * vínculo com usuário e passa pela política única de identidade de conta com o ator da requisição.
 * Recusa (sem permissão, sem ator, a própria conta, SUPER_ADMIN sem step-up) não grava e fica como pendência.
 */
import type { Prisma } from "@prisma/client";
import type { SuperAdminGuardActor } from "@/src/lib/security/superAdminRoleGuard.js";
import { accountIdentityChangeDenial } from "@/src/lib/security/accountIdentityLinkPolicy.js";
import { SECURITY_AUDIT_EVENTS, writeSecurityAuditLog } from "@/src/lib/auth/securityAudit.server.js";
import { lockPersonAccountLinks } from "@/src/lib/people/personLocks.server.js";

type Tx = Pick<Prisma.TransactionClient, "appUser" | "$executeRaw"> & Partial<Pick<Prisma.TransactionClient, "person" | "securityAuditLog">>;

export type PersonPropagationOutcome =
  | { outcome: "NO_LINKED_USER" }
  | { outcome: "ALREADY_SAME" }
  | { outcome: "PROPAGATED"; userId: string; fromPersonId: string | null }
  | { outcome: "USER_HAS_OTHER_PERSON"; userId: string; userPersonId: string }
  | { outcome: "PERSON_HELD_BY_OTHER_USER"; userId: string; otherUserId: string }
  | { outcome: "PERSON_NOT_ACTIVE"; userId: string; personStatus: string }
  | { outcome: "ACCOUNT_IDENTITY_DENIED"; userId: string; code: string }
  | { outcome: "NO_PERSON" };

export async function propagateEmployeePersonToLinkedUser(
  tx: Tx,
  args: {
    employeeId: string;
    personId: string | null;
    previousPersonId: string | null;
    actor?: SuperAdminGuardActor | null;
    /** Permissão efetiva de vínculo com usuário da requisição (ausente = não tem). */
    canManageAccountIdentity?: boolean;
  }
): Promise<PersonPropagationOutcome> {
  if (!args.personId) return { outcome: "NO_PERSON" };
  const user = await tx.appUser.findUnique({
    where: { employeeId: args.employeeId },
    select: { id: true, personId: true, role: true },
  });
  if (!user) return { outcome: "NO_LINKED_USER" };
  if (user.personId === args.personId) return { outcome: "ALREADY_SAME" };
  if (user.personId && user.personId !== args.previousPersonId) {
    return { outcome: "USER_HAS_OTHER_PERSON", userId: user.id, userPersonId: user.personId };
  }
  // Mudar a Pessoa da conta de outra pessoa exige a permissão efetiva de vínculo com usuário.
  if (!args.canManageAccountIdentity) return { outcome: "ACCOUNT_IDENTITY_DENIED", userId: user.id, code: "ACCOUNT_LINK_PERMISSION_REQUIRED" };
  // Política única: sem ator, a própria conta ou SUPER_ADMIN sem step-up → não propaga (fica como pendência).
  const denial = accountIdentityChangeDenial({ actor: args.actor ?? null, account: { id: user.id, role: user.role } });
  if (denial) return { outcome: "ACCOUNT_IDENTITY_DENIED", userId: user.id, code: denial.code };
  await lockPersonAccountLinks(tx, [user.personId, args.personId]);
  // Pessoa inativa/unificada nunca é copiada para a conta em silêncio.
  if (tx.person) {
    const p = await tx.person.findUnique({ where: { id: args.personId }, select: { status: true } });
    if (p && p.status !== "ACTIVE") return { outcome: "PERSON_NOT_ACTIVE", userId: user.id, personStatus: p.status };
  }
  const holder = await tx.appUser.findUnique({ where: { personId: args.personId }, select: { id: true } });
  if (holder && holder.id !== user.id) {
    return { outcome: "PERSON_HELD_BY_OTHER_USER", userId: user.id, otherUserId: holder.id };
  }
  await tx.appUser.update({ where: { id: user.id }, data: { personId: args.personId } });
  if (tx.securityAuditLog) {
    await writeSecurityAuditLog(tx as Pick<Prisma.TransactionClient, "securityAuditLog">, {
      eventType: SECURITY_AUDIT_EVENTS.USER_IDENTITY_LINKED,
      actorUserId: args.actor?.id ?? null,
      targetUserId: user.id,
      metadata: { source: "EMPLOYEE_PERSON_PROPAGATION", employeeId: args.employeeId, personId: args.personId, fromPersonId: user.personId, touchesSuperAdmin: user.role === "SUPER_ADMIN" },
    });
  }
  return { outcome: "PROPAGATED", userId: user.id, fromPersonId: user.personId };
}
