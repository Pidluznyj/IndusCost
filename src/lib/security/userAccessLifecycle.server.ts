/**
 * Execução do ciclo de vida do acesso (E1/E3): inativar conta, revogar sessões e auditar,
 * sempre dentro da transação do chamador. Nunca apaga `AppUser`.
 */
import type { Prisma } from "@prisma/client";
import { SECURITY_AUDIT_EVENTS, writeSecurityAuditLog, type SecurityAuditEvent } from "@/src/lib/auth/securityAudit.server.js";
import {
  planTerminationAccessRevocation,
  parseTerminationRevokesAccessFlag,
  userAuditSnapshot,
  type TerminationRevocationDecision,
} from "@/src/lib/security/userAccessLifecycle.js";

type Tx = Prisma.TransactionClient;

export type AccessRequestMeta = { ipAddress?: string | null; userAgent?: string | null };

export function isTerminationRevokesAccessEnabled(): boolean {
  return parseTerminationRevokesAccessFlag(process.env.HR_TERMINATION_REVOKES_ACCESS);
}

/** Inativa a conta, revoga todas as sessões válidas e grava o evento de segurança. */
export async function deactivateUserAccess(
  tx: Tx,
  args: {
    userId: string;
    actorUserId: string | null;
    eventType: SecurityAuditEvent;
    metadata?: Record<string, string | number | boolean | null>;
  } & AccessRequestMeta
): Promise<{ revokedSessions: number }> {
  const user = await tx.appUser.findUnique({
    where: { id: args.userId },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  if (!user) throw new Error(`AppUser ${args.userId} não encontrado para inativação.`);
  if (user.isActive) {
    await tx.appUser.update({ where: { id: user.id }, data: { isActive: false } });
  }
  const revoked = await tx.appSession.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await writeSecurityAuditLog(tx, {
    eventType: args.eventType,
    actorUserId: args.actorUserId,
    targetUserId: user.id,
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
    metadata: { ...userAuditSnapshot(user), revokedSessions: revoked.count, ...(args.metadata ?? {}) },
  });
  return { revokedSessions: revoked.count };
}

/** Reativa a conta com auditoria (nunca automática na recontratação). */
export async function reactivateUserAccess(
  tx: Tx,
  args: { userId: string; actorUserId: string | null; metadata?: Record<string, string | number | boolean | null> } & AccessRequestMeta
): Promise<void> {
  const user = await tx.appUser.findUnique({
    where: { id: args.userId },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  if (!user) throw new Error(`AppUser ${args.userId} não encontrado para reativação.`);
  if (!user.isActive) {
    await tx.appUser.update({ where: { id: user.id }, data: { isActive: true } });
  }
  await writeSecurityAuditLog(tx, {
    eventType: SECURITY_AUDIT_EVENTS.USER_REACTIVATED,
    actorUserId: args.actorUserId,
    targetUserId: user.id,
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
    metadata: { ...userAuditSnapshot(user), ...(args.metadata ?? {}) },
  });
}

/**
 * E1: ao desligar um colaborador, revoga o acesso da conta ligada por `employeeId`.
 * Decisão pura + execução transacional. Devolve o que foi feito para o chamador auditar.
 */
export async function revokeAccessOnEmployeeTermination(
  tx: Tx,
  args: {
    employeeId: string;
    previousStatus: string | null | undefined;
    nextStatus: string | null | undefined;
    terminationDate: Date | string | null | undefined;
    actorUserId: string | null;
    enabled?: boolean;
  } & AccessRequestMeta
): Promise<TerminationRevocationDecision> {
  const linked = await tx.appUser.findUnique({
    where: { employeeId: args.employeeId },
    select: { id: true, isActive: true, role: true },
  });
  const decision = planTerminationAccessRevocation({
    enabled: args.enabled ?? isTerminationRevokesAccessEnabled(),
    previousStatus: args.previousStatus,
    nextStatus: args.nextStatus,
    terminationDate: args.terminationDate,
    linkedUser: linked,
  });
  if (decision.action === "DEACTIVATE") {
    await deactivateUserAccess(tx, {
      userId: decision.userId,
      actorUserId: args.actorUserId,
      eventType: SECURITY_AUDIT_EVENTS.USER_DEACTIVATED_BY_TERMINATION,
      metadata: { employeeId: args.employeeId, source: "EMPLOYEE_TERMINATION" },
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
    });
  }
  return decision;
}
