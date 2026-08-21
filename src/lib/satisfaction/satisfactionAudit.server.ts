/**
 * Trilha de auditoria da Satisfação.
 *
 * Reutiliza o `CommercialAuditLog` oficial do domínio Comercial — não existe
 * log paralelo. Registra a AÇÃO administrativa e o que mudou em termos de
 * negócio; nunca token, cookie, telefone, CNPJ completo, comentário ou resposta.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

export const SATISFACTION_AUDIT_ENTITIES = {
  campaign: "SATISFACTION_CAMPAIGN",
  invitation: "SATISFACTION_INVITATION",
  import: "SATISFACTION_IMPORT",
  export: "SATISFACTION_EXPORT",
} as const;

export type SatisfactionAuditEntity =
  (typeof SATISFACTION_AUDIT_ENTITIES)[keyof typeof SATISFACTION_AUDIT_ENTITIES];

export const SATISFACTION_AUDIT_ACTIONS = [
  "CREATED",
  "UPDATED",
  "PUBLISHED",
  "CLOSED",
  "ARCHIVED",
  "DELETED",
  "AUDIENCE_CHANGED",
  "LINK_GENERATED",
  "LINK_REGENERATED",
  "LINK_REVOKED",
  "IMPORT_PREVIEWED",
  "IMPORT_APPLIED",
  "EXPORTED",
] as const;

export type SatisfactionAuditAction = (typeof SATISFACTION_AUDIT_ACTIONS)[number];

/**
 * Campos cujo valor jamais pode ir para o log, mesmo que alguém os passe por
 * engano em `oldValue`/`newValue`.
 */
const REDACTED_FIELDS = new Set([
  "token",
  "tokenhash",
  "tokenprefix",
  "cookie",
  "phone",
  "respondentphone",
  "contactphone",
  "taxid",
  "declaredtaxid",
  "customertaxidsnapshot",
  "comment",
  "openfeedback",
  "textvalue",
  "answers",
  "secret",
  "password",
  "authorization",
]);

export function isRedactedAuditField(fieldName: string | null | undefined): boolean {
  if (!fieldName) return false;
  const key = fieldName.toLowerCase().replace(/[^a-z]/g, "");
  return REDACTED_FIELDS.has(key);
}

/** Trunca e neutraliza valores antes de persistir. */
export function sanitizeAuditValue(
  fieldName: string | null | undefined,
  value: unknown
): string | null {
  if (value == null) return null;
  if (isRedactedAuditField(fieldName)) return "[REDACTED]";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text == null) return null;
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

export type SatisfactionAuditEntry = {
  entityType: SatisfactionAuditEntity;
  entityId: string;
  action: SatisfactionAuditAction;
  fieldName?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  performedBy?: string | null;
};

type AuditClient = Pick<PrismaClient, "commercialAuditLog"> | Prisma.TransactionClient;

/**
 * Grava uma entrada. Falha de auditoria não derruba a operação de negócio —
 * mas é registrada no console para não passar silenciosamente.
 */
export async function recordSatisfactionAudit(
  client: AuditClient,
  entry: SatisfactionAuditEntry
): Promise<void> {
  try {
    await (client as PrismaClient).commercialAuditLog.create({
      data: {
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        fieldName: entry.fieldName ?? null,
        oldValue: sanitizeAuditValue(entry.fieldName, entry.oldValue),
        newValue: sanitizeAuditValue(entry.fieldName, entry.newValue),
        performedBy: entry.performedBy ?? null,
      },
    });
  } catch (error) {
    console.error(
      "[satisfaction] falha ao registrar auditoria",
      entry.entityType,
      entry.action,
      error instanceof Error ? error.message : "erro desconhecido"
    );
  }
}

/** Várias entradas na mesma transação (ex.: publicação altera vários campos). */
export async function recordSatisfactionAuditMany(
  client: AuditClient,
  entries: readonly SatisfactionAuditEntry[]
): Promise<void> {
  for (const entry of entries) {
    await recordSatisfactionAudit(client, entry);
  }
}
