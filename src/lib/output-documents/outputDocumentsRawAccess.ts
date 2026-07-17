/**
 * DS-04.4 — Gate e auditoria de rawJson de Documentos de Saída.
 * Nunca liberar só porque includeRaw=true.
 */

import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  authorizeRequireResource,
  type RequireResourceDecision,
} from "@/src/lib/security/requireResource.js";
import { COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";

export type OutputDocumentRawAccessDecision =
  | { allowed: true; source: string }
  | { allowed: false; status: 403; body: Record<string, unknown> };

/**
 * Decide se o usuário pode ver rawJson.
 * `includeRaw` sozinho nunca autoriza.
 */
export function decideOutputDocumentRawAccess(input: {
  user: AppAuthContext;
  includeRaw: boolean;
}): OutputDocumentRawAccessDecision {
  if (!input.includeRaw) {
    return {
      allowed: false,
      status: 403,
      body: {
        error: "Raw não solicitado.",
        code: "OUTPUT_DOCUMENTS_RAW_NOT_REQUESTED",
      },
    };
  }

  const decision: RequireResourceDecision = authorizeRequireResource(
    input.user,
    COMMERCIAL_RESOURCE_KEYS.outputDocumentsRaw,
    "view",
    { legacyCompatMode: true }
  );

  if (!decision.ok) {
    logOutputDocumentRawAccess({
      userId: input.user.id,
      role: input.user.role,
      allowed: false,
      includeRaw: true,
      reason: "FORBIDDEN",
    });
    return {
      allowed: false,
      status: 403,
      body: {
        error: "Sem permissão para visualizar rawJson do Documento de Saída.",
        code: "OUTPUT_DOCUMENTS_RAW_FORBIDDEN",
        resourceKey: COMMERCIAL_RESOURCE_KEYS.outputDocumentsRaw,
      },
    };
  }

  return { allowed: true, source: decision.source };
}

export function parseIncludeRawFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    return t === "1" || t === "true" || t === "yes" || t === "sim";
  }
  return false;
}

/**
 * Registro de uso conforme padrão de auditoria existente (metadados seguros).
 */
export function logOutputDocumentRawAccess(event: {
  userId: string;
  role: string;
  allowed: boolean;
  includeRaw: boolean;
  documentExternalId?: number | null;
  reason?: string;
}): void {
  const line = JSON.stringify({
    type: "output_documents.raw_access",
    userId: event.userId,
    role: event.role,
    allowed: event.allowed,
    includeRaw: event.includeRaw,
    documentExternalId: event.documentExternalId ?? null,
    reason: event.reason ?? null,
    at: new Date().toISOString(),
  });
  if (event.allowed) {
    console.info("[audit]", line);
  } else {
    console.warn("[audit]", line);
  }
}
