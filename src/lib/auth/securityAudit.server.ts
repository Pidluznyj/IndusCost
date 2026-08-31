/**
 * Auditoria de eventos de segurança de credencial.
 *
 * Por que uma tabela própria: `PermissionAuditLog` audita MUTAÇÃO DE ACL
 * (`resourceKey`, `targetRole`, `beforeJson`/`afterJson`) e não tem onde
 * guardar origem da requisição. Trocar senha não é mutação de ACL. Reutilizar
 * aquela tabela só porque tem "audit" no nome misturaria dois domínios.
 *
 * Regra inegociável: NUNCA persistir senha, hash, salt ou token. O sanitizador
 * abaixo é a segunda barreira — a primeira é o chamador não passar isso.
 */

import type { Prisma } from "@prisma/client";

export const SECURITY_AUDIT_EVENTS = {
  /** Troca voluntária pelo próprio usuário (exigiu a senha atual). */
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  /** Reset administrativo — só SUPER_ADMIN. */
  PASSWORD_RESET_BY_SUPER_ADMIN: "PASSWORD_RESET_BY_SUPER_ADMIN",
  /** Conclusão da troca obrigatória após login com credencial temporária. */
  PASSWORD_FORCED_CHANGE_COMPLETED: "PASSWORD_FORCED_CHANGE_COMPLETED",
  /** Credencial inicial atribuída na criação do usuário (temporária). */
  USER_INITIAL_PASSWORD_ASSIGNED: "USER_INITIAL_PASSWORD_ASSIGNED",
} as const;

export type SecurityAuditEvent =
  (typeof SECURITY_AUDIT_EVENTS)[keyof typeof SECURITY_AUDIT_EVENTS];

/** Origem da troca — entra no metadata, é metadado e não segredo. */
export type SecurityAuditSource =
  | "SELF_SERVICE"
  | "FORCED_CHANGE"
  | "ADMIN_RESET"
  | "USER_CREATION";

/**
 * Chaves proibidas no metadata. Comparação por substring minúscula: pega
 * `password`, `newPassword`, `temporaryPassword`, `passwordHash`, `tokenHash`,
 * `sessionToken`, `salt`, `secret` etc. sem precisar enumerar variações.
 */
const FORBIDDEN_METADATA_FRAGMENTS = [
  "password",
  "senha",
  "hash",
  "token",
  "salt",
  "secret",
  "credential",
];

export function isForbiddenAuditMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return FORBIDDEN_METADATA_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/**
 * Remove qualquer chave sensível antes de persistir. Só aceita escalares:
 * objeto aninhado poderia esconder um segredo em profundidade.
 */
export function sanitizeSecurityAuditMetadata(
  metadata: Record<string, unknown> | null | undefined
): Record<string, string | number | boolean> | null {
  if (!metadata) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (isForbiddenAuditMetadataKey(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Trunca o User-Agent: é telemetria, não precisa de payload arbitrário. */
export function normalizeUserAgent(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 512);
}

/**
 * IP de ORIGEM DE SOCKET apenas.
 *
 * Deliberadamente NÃO lê `X-Forwarded-For`, `X-Real-IP` nem `CF-Connecting-IP`:
 * a aplicação não habilita `trust proxy` e passar a confiar em header forjável
 * enfraqueceria outras superfícies. Sem cadeia de confiança, o peer real é a
 * única informação honesta — e ela é só auditoria, nunca autorização.
 */
export function resolveAuditIpAddress(socketAddress: unknown): string | null {
  if (typeof socketAddress !== "string") return null;
  const trimmed = socketAddress.trim();
  return trimmed ? trimmed.slice(0, 64) : null;
}

export type SecurityAuditEntry = {
  eventType: SecurityAuditEvent;
  actorUserId?: string | null;
  targetUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Cliente mínimo — satisfeito tanto pelo `prisma` quanto pela transação
 * (`tx`), porque é uma fatia do próprio tipo gerado. Não é uma interface
 * paralela: se o schema mudar, isto muda junto.
 */
export type SecurityAuditDb = Pick<Prisma.TransactionClient, "securityAuditLog">;

/**
 * Grava o evento. Chamada DENTRO da transação da operação de credencial —
 * não é "best effort": se a auditoria falhar, a troca inteira é revertida.
 */
export async function writeSecurityAuditLog(
  db: SecurityAuditDb,
  entry: SecurityAuditEntry
): Promise<void> {
  const metadata = sanitizeSecurityAuditMetadata(entry.metadata);
  await db.securityAuditLog.create({
    data: {
      eventType: entry.eventType,
      actorUserId: entry.actorUserId ?? null,
      targetUserId: entry.targetUserId ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      metadata: metadata === null ? undefined : (metadata as Prisma.InputJsonValue),
    },
  });
}
