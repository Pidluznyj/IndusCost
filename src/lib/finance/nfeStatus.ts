/**
 * Normalização oficial do status de NF-e (NomusNfe).
 *
 * Fonte estrutural: `NomusNfe.status` (Int).
 * Cancelada = 7 (`NOMUS_NFE_STATUS_CANCELLED`).
 * Autorizada = 4 (`NOMUS_NFE_STATUS_AUTHORIZED`).
 *
 * A Auditoria 360º e Status Pedidos devem consumir este helper —
 * não reinventar regra paralela de cancelamento.
 */
import {
  NOMUS_NFE_STATUS_AUTHORIZED,
  NOMUS_NFE_STATUS_CANCELLED,
} from "@/src/lib/nomusNfeClassification.js";

export type NormalizedNfeStatus =
  | "AUTHORIZED"
  | "CANCELED"
  | "DENIED"
  | "VOIDED"
  | "UNKNOWN";

export type NormalizedNfeStatusResult = {
  statusRaw: string | null;
  statusNormalized: NormalizedNfeStatus;
  isCanceled: boolean;
  isValidForBilling: boolean;
  label: string;
};

/** Status SEFAZ/Nomus conhecidos além de autorizada/cancelada. */
const NOMUS_NFE_STATUS_DENIED = 3;
const NOMUS_NFE_STATUS_VOIDED = 5;

function asObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readRawString(raw: unknown, keys: string[]): string | null {
  const obj = asObject(raw);
  if (!obj) return null;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function coerceStatusCode(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum) && /^-?\d+(\.\d+)?$/.test(trimmed)) return asNum;
  }
  return null;
}

function textLooksCanceled(text: string): boolean {
  const n = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  return (
    n.includes("CANCEL") ||
    n === "CANCELED" ||
    n === "CANCELLED" ||
    n === "CANCELADA" ||
    n === "CANCELADO"
  );
}

/**
 * Lê status estrutural preferindo `NomusNfe.status`.
 * Aceita número, string numérica ou texto ("Cancelada").
 */
export function resolveNomusNfeStatusCode(input: {
  status?: unknown;
  nfeStatus?: unknown;
  situacao?: unknown;
  statusNfe?: unknown;
  situacaoNfe?: unknown;
  rawPayload?: unknown;
}): number | null {
  const candidates = [
    input.status,
    input.nfeStatus,
    input.statusNfe,
    input.situacaoNfe,
    input.situacao,
  ];
  for (const c of candidates) {
    const code = coerceStatusCode(c);
    if (code != null) return code;
  }
  const fromRaw = coerceStatusCode(
    readRawString(input.rawPayload, [
      "status",
      "situacao",
      "statusNfe",
      "situacaoNfe",
      "nfeStatus",
    ])
  );
  return fromRaw;
}

export function isNomusNfeCancelled(status: unknown): boolean {
  const code = coerceStatusCode(status);
  if (code === NOMUS_NFE_STATUS_CANCELLED) return true;
  if (typeof status === "string" && textLooksCanceled(status)) return true;
  return false;
}

export function isNomusNfeAuthorized(status: unknown): boolean {
  const code = coerceStatusCode(status);
  return code === NOMUS_NFE_STATUS_AUTHORIZED;
}

export function isNomusNfeValidForBilling(status: unknown): boolean {
  if (isNomusNfeCancelled(status)) return false;
  const code = coerceStatusCode(status);
  if (code == null) {
    if (typeof status === "string" && textLooksCanceled(status)) return false;
    // Status ausente: não cancelada → elegível (motor fiscal exclui só 7).
    return true;
  }
  if (code === NOMUS_NFE_STATUS_DENIED || code === NOMUS_NFE_STATUS_VOIDED) {
    return false;
  }
  return code !== NOMUS_NFE_STATUS_CANCELLED;
}

/**
 * Preferência: campo estrutural `status` (Nomus = 7 cancelada).
 * Fallback textual só quando não há código.
 */
export function normalizeNfeStatus(rawNfe: {
  status?: unknown;
  nfeStatus?: unknown;
  situacao?: unknown;
  statusNfe?: unknown;
  situacaoNfe?: unknown;
  rawPayload?: unknown;
  xmlCancelamento?: string | null;
  justificativaCancelamento?: string | null;
}): NormalizedNfeStatusResult {
  const code = resolveNomusNfeStatusCode(rawNfe);
  const statusRaw =
    code != null
      ? String(code)
      : readRawString(rawNfe.rawPayload, [
          "status",
          "situacao",
          "statusNfe",
          "situacaoNfe",
        ]) ??
        (typeof rawNfe.status === "string" ? rawNfe.status.trim() : null) ??
        null;

  const hasCancelEvidence = Boolean(
    (rawNfe.xmlCancelamento && String(rawNfe.xmlCancelamento).trim()) ||
      (rawNfe.justificativaCancelamento &&
        String(rawNfe.justificativaCancelamento).trim())
  );

  if (code === NOMUS_NFE_STATUS_CANCELLED || isNomusNfeCancelled(statusRaw)) {
    return {
      statusRaw,
      statusNormalized: "CANCELED",
      isCanceled: true,
      isValidForBilling: false,
      label: "Cancelada",
    };
  }

  if (code === NOMUS_NFE_STATUS_DENIED) {
    return {
      statusRaw,
      statusNormalized: "DENIED",
      isCanceled: false,
      isValidForBilling: false,
      label: "Denegada",
    };
  }

  if (code === NOMUS_NFE_STATUS_VOIDED) {
    return {
      statusRaw,
      statusNormalized: "VOIDED",
      isCanceled: false,
      isValidForBilling: false,
      label: "Inutilizada",
    };
  }

  if (code === NOMUS_NFE_STATUS_AUTHORIZED) {
    return {
      statusRaw,
      statusNormalized: "AUTHORIZED",
      isCanceled: false,
      isValidForBilling: true,
      label: "Autorizada",
    };
  }

  // Evidência forte de cancelamento sem status 7 (payload / xml).
  if (hasCancelEvidence && code == null) {
    return {
      statusRaw: statusRaw ?? "cancel_evidence",
      statusNormalized: "CANCELED",
      isCanceled: true,
      isValidForBilling: false,
      label: "Cancelada",
    };
  }

  if (code != null) {
    return {
      statusRaw,
      statusNormalized: "UNKNOWN",
      isCanceled: false,
      isValidForBilling: isNomusNfeValidForBilling(code),
      label: `Status ${code}`,
    };
  }

  if (statusRaw && textLooksCanceled(statusRaw)) {
    return {
      statusRaw,
      statusNormalized: "CANCELED",
      isCanceled: true,
      isValidForBilling: false,
      label: "Cancelada",
    };
  }

  // Sem evidência de cancelamento: alerta UNKNOWN, mas não remove do faturamento
  // (motor fiscal oficial só exclui status 7).
  return {
    statusRaw,
    statusNormalized: "UNKNOWN",
    isCanceled: false,
    isValidForBilling: true,
    label: "Status desconhecido",
  };
}

export function extractNfeCancellationMeta(input: {
  justificativaCancelamento?: string | null;
  xmlCancelamento?: string | null;
  rawPayload?: unknown;
}): { cancellationDate: string | null; cancellationReason: string | null } {
  const reason =
    (input.justificativaCancelamento &&
      String(input.justificativaCancelamento).trim()) ||
    readRawString(input.rawPayload, [
      "justificativaCancelamento",
      "motivoCancelamento",
      "motivoCancel",
      "xJust",
    ]) ||
    null;

  const dateRaw =
    readRawString(input.rawPayload, [
      "dataCancelamento",
      "dhCancelamento",
      "dhEvento",
      "dataEventoCancelamento",
    ]) || null;

  return {
    cancellationDate: dateRaw,
    cancellationReason: reason,
  };
}
