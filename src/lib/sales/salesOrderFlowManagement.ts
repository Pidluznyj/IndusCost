/**
 * OP-62 — Contrato puro das ações manuais do overlay de gestão do Fluxo de Pedidos.
 * Não altera currentStage / snapshots / SalesOrder oficial.
 */

import { SALES_ORDER_FLOW_SUMMARY_PRIORITIES } from "./salesOrderFlowSummary.js";
import { isUuidLike } from "./salesOrderFlowRebuild.js";

export const SALES_ORDER_FLOW_MANAGEMENT_ENTITY =
  "SalesOrderFlowManagement" as const;

export const SALES_ORDER_FLOW_MANAGEMENT_EVENT_TYPE =
  "MANAGEMENT_UPDATED" as const;

export const SALES_ORDER_FLOW_MANAGEMENT_TEXT_MAX = 500;
export const SALES_ORDER_FLOW_MANAGEMENT_AREA_MAX = 120;

export const SALES_ORDER_FLOW_MANAGEMENT_PATCH_KEYS = [
  "expectedUpdatedAt",
  "priority",
  "responsibleUserId",
  "responsibleArea",
  "isBlocked",
  "blockReason",
  "expectedResolutionAt",
  "internalNote",
] as const;

const FORBIDDEN_BODY_KEYS = new Set([
  "currentStage",
  "stage",
  "responsibleName",
  "reason",
  "salesOrderId",
  "id",
  "createdAt",
  "updatedAt",
]);

export class SalesOrderFlowManagementError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field?: string;

  constructor(
    message: string,
    options: { code: string; status: number; field?: string }
  ) {
    super(message);
    this.name = "SalesOrderFlowManagementError";
    this.code = options.code;
    this.status = options.status;
    this.field = options.field;
  }
}

export type SalesOrderFlowManagementSnapshot = {
  priority: string;
  responsibleUserId: string | null;
  responsibleName: string | null;
  responsibleArea: string | null;
  isBlocked: boolean;
  blockReason: string | null;
  reason: string | null;
  expectedResolutionAt: Date | null;
  internalNote: string | null;
  updatedAt: Date | null;
};

export type SalesOrderFlowManagementParsedPatch = {
  expectedUpdatedAt: Date | null;
  priority?: string;
  responsibleUserId?: string | null;
  responsibleArea?: string | null;
  isBlocked?: boolean;
  blockReason?: string | null;
  expectedResolutionAt?: Date | null;
  internalNote?: string | null;
};

export type SalesOrderFlowManagementApi = {
  priority: string;
  responsibleUserId: string | null;
  responsibleName: string | null;
  responsibleArea: string | null;
  isBlocked: boolean;
  blockReason: string | null;
  reason: string | null;
  expectedResolutionAt: string | null;
  internalNote: string | null;
  updatedAt: string | null;
};

export function defaultSalesOrderFlowManagementSnapshot(): SalesOrderFlowManagementSnapshot {
  return {
    priority: "NORMAL",
    responsibleUserId: null,
    responsibleName: null,
    responsibleArea: null,
    isBlocked: false,
    blockReason: null,
    reason: null,
    expectedResolutionAt: null,
    internalNote: null,
    updatedAt: null,
  };
}

function rejectControlChars(value: string, field: string): string {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    throw new SalesOrderFlowManagementError(
      `${field} contém caracteres de controle inválidos.`,
      { code: "VALIDATION", status: 400, field }
    );
  }
  return value;
}

function parseOptionalText(
  value: unknown,
  field: string,
  max: number
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new SalesOrderFlowManagementError(`${field} deve ser texto ou null.`, {
      code: "VALIDATION",
      status: 400,
      field,
    });
  }
  const trimmed = rejectControlChars(value.replace(/\r\n/g, "\n").trim(), field);
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new SalesOrderFlowManagementError(
      `${field} excede ${max} caracteres.`,
      { code: "VALIDATION", status: 400, field }
    );
  }
  return trimmed;
}

function parseOptionalDate(
  value: unknown,
  field: string
): Date | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new SalesOrderFlowManagementError(
      `${field} deve ser ISO-8601 ou null.`,
      { code: "VALIDATION", status: 400, field }
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new SalesOrderFlowManagementError(`${field} inválida.`, {
      code: "VALIDATION",
      status: 400,
      field,
    });
  }
  return date;
}

function parseExpectedUpdatedAt(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new SalesOrderFlowManagementError(
      "expectedUpdatedAt deve ser ISO-8601 ou null.",
      { code: "VALIDATION", status: 400, field: "expectedUpdatedAt" }
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new SalesOrderFlowManagementError("expectedUpdatedAt inválida.", {
      code: "VALIDATION",
      status: 400,
      field: "expectedUpdatedAt",
    });
  }
  return date;
}

/**
 * Valida e normaliza o body do PATCH de management.
 * Rejeita chaves proibidas (ex.: currentStage) e exige ao menos um campo mutável.
 */
export function parseSalesOrderFlowManagementPatch(
  body: unknown
): SalesOrderFlowManagementParsedPatch {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new SalesOrderFlowManagementError("Body JSON inválido.", {
      code: "VALIDATION",
      status: 400,
    });
  }

  const raw = body as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_BODY_KEYS.has(key)) {
      throw new SalesOrderFlowManagementError(
        `Campo não permitido neste endpoint: ${key}.`,
        { code: "VALIDATION", status: 400, field: key }
      );
    }
    if (
      !(SALES_ORDER_FLOW_MANAGEMENT_PATCH_KEYS as readonly string[]).includes(
        key
      )
    ) {
      throw new SalesOrderFlowManagementError(`Campo desconhecido: ${key}.`, {
        code: "VALIDATION",
        status: 400,
        field: key,
      });
    }
  }

  const patch: SalesOrderFlowManagementParsedPatch = {
    expectedUpdatedAt: parseExpectedUpdatedAt(raw.expectedUpdatedAt),
  };

  if ("priority" in raw) {
    if (typeof raw.priority !== "string" || !raw.priority.trim()) {
      throw new SalesOrderFlowManagementError(
        "Prioridade inválida (LOW|NORMAL|HIGH|URGENT).",
        { code: "VALIDATION", status: 400, field: "priority" }
      );
    }
    const priority = raw.priority.trim().toUpperCase();
    if (
      !(SALES_ORDER_FLOW_SUMMARY_PRIORITIES as readonly string[]).includes(
        priority
      )
    ) {
      throw new SalesOrderFlowManagementError(
        "Prioridade inválida (LOW|NORMAL|HIGH|URGENT).",
        { code: "VALIDATION", status: 400, field: "priority" }
      );
    }
    patch.priority = priority;
  }

  if ("responsibleUserId" in raw) {
    if (raw.responsibleUserId === null) {
      patch.responsibleUserId = null;
    } else if (
      typeof raw.responsibleUserId === "string" &&
      isUuidLike(raw.responsibleUserId)
    ) {
      patch.responsibleUserId = raw.responsibleUserId.trim();
    } else {
      throw new SalesOrderFlowManagementError(
        "responsibleUserId deve ser UUID de AppUser ativo ou null.",
        { code: "VALIDATION", status: 400, field: "responsibleUserId" }
      );
    }
  }

  if ("responsibleArea" in raw) {
    patch.responsibleArea = parseOptionalText(
      raw.responsibleArea,
      "responsibleArea",
      SALES_ORDER_FLOW_MANAGEMENT_AREA_MAX
    );
  }

  if ("isBlocked" in raw) {
    if (typeof raw.isBlocked !== "boolean") {
      throw new SalesOrderFlowManagementError("isBlocked deve ser boolean.", {
        code: "VALIDATION",
        status: 400,
        field: "isBlocked",
      });
    }
    patch.isBlocked = raw.isBlocked;
  }

  if ("blockReason" in raw) {
    patch.blockReason = parseOptionalText(
      raw.blockReason,
      "blockReason",
      SALES_ORDER_FLOW_MANAGEMENT_TEXT_MAX
    );
  }

  if ("expectedResolutionAt" in raw) {
    patch.expectedResolutionAt = parseOptionalDate(
      raw.expectedResolutionAt,
      "expectedResolutionAt"
    );
  }

  if ("internalNote" in raw) {
    patch.internalNote = parseOptionalText(
      raw.internalNote,
      "internalNote",
      SALES_ORDER_FLOW_MANAGEMENT_TEXT_MAX
    );
  }

  const mutableKeys = [
    "priority",
    "responsibleUserId",
    "responsibleArea",
    "isBlocked",
    "blockReason",
    "expectedResolutionAt",
    "internalNote",
  ] as const;
  const hasMutation = mutableKeys.some((key) => key in patch);
  if (!hasMutation) {
    throw new SalesOrderFlowManagementError(
      "Informe ao menos uma ação de gestão (prioridade, responsável, área, bloqueio, previsão ou nota).",
      { code: "VALIDATION", status: 400 }
    );
  }

  return patch;
}

/**
 * Aplica o patch sobre o estado atual, com invariantes de bloqueio.
 * Não altera currentStage.
 */
export function applySalesOrderFlowManagementPatch(
  current: SalesOrderFlowManagementSnapshot,
  patch: SalesOrderFlowManagementParsedPatch,
  derivedResponsibleName?: string | null
): SalesOrderFlowManagementSnapshot {
  const next: SalesOrderFlowManagementSnapshot = { ...current };

  if (patch.priority !== undefined) next.priority = patch.priority;

  if (patch.responsibleUserId !== undefined) {
    next.responsibleUserId = patch.responsibleUserId;
    if (patch.responsibleUserId === null) {
      next.responsibleName = null;
    } else if (derivedResponsibleName !== undefined) {
      next.responsibleName = derivedResponsibleName;
    }
  }

  if (patch.responsibleArea !== undefined) {
    next.responsibleArea = patch.responsibleArea;
  }

  if (patch.isBlocked === false) {
    next.isBlocked = false;
    next.blockReason = null;
    next.expectedResolutionAt = null;
  } else {
    if (patch.isBlocked === true) next.isBlocked = true;
    if (patch.blockReason !== undefined) next.blockReason = patch.blockReason;
    if (patch.expectedResolutionAt !== undefined) {
      next.expectedResolutionAt = patch.expectedResolutionAt;
    }
  }

  if (patch.internalNote !== undefined) {
    next.internalNote = patch.internalNote;
  }

  if (
    patch.blockReason !== undefined &&
    !next.isBlocked
  ) {
    throw new SalesOrderFlowManagementError(
      "blockReason só pode ser definido com bloqueio ativo.",
      { code: "VALIDATION", status: 400, field: "blockReason" }
    );
  }

  if (next.isBlocked) {
    const reason = next.blockReason?.trim() ?? "";
    if (!reason) {
      throw new SalesOrderFlowManagementError(
        "blockReason é obrigatório ao registrar bloqueio.",
        { code: "VALIDATION", status: 400, field: "blockReason" }
      );
    }
  }

  return next;
}

export function listChangedManagementFields(
  before: SalesOrderFlowManagementSnapshot,
  after: SalesOrderFlowManagementSnapshot
): string[] {
  const fields: string[] = [];
  if (before.priority !== after.priority) fields.push("priority");
  if (before.responsibleUserId !== after.responsibleUserId) {
    fields.push("responsibleUserId");
  }
  if (before.responsibleName !== after.responsibleName) {
    fields.push("responsibleName");
  }
  if (before.responsibleArea !== after.responsibleArea) {
    fields.push("responsibleArea");
  }
  if (before.isBlocked !== after.isBlocked) fields.push("isBlocked");
  if (before.blockReason !== after.blockReason) fields.push("blockReason");
  if (
    (before.expectedResolutionAt?.getTime() ?? null) !==
    (after.expectedResolutionAt?.getTime() ?? null)
  ) {
    fields.push("expectedResolutionAt");
  }
  if (before.internalNote !== after.internalNote) fields.push("internalNote");
  return fields;
}

export function serializeManagementForApi(
  row: SalesOrderFlowManagementSnapshot
): SalesOrderFlowManagementApi {
  return {
    priority: row.priority,
    responsibleUserId: row.responsibleUserId,
    responsibleName: row.responsibleName,
    responsibleArea: row.responsibleArea,
    isBlocked: row.isBlocked,
    blockReason: row.blockReason,
    reason: row.reason,
    expectedResolutionAt: row.expectedResolutionAt
      ? row.expectedResolutionAt.toISOString()
      : null,
    internalNote: row.internalNote,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/** Snapshot sanitizado para timeline (sem conteúdo de nota interna). */
export function sanitizeManagementAuditSnapshot(
  row: SalesOrderFlowManagementSnapshot
): Record<string, unknown> {
  return {
    priority: row.priority,
    responsibleUserId: row.responsibleUserId,
    responsibleName: row.responsibleName,
    responsibleArea: row.responsibleArea,
    isBlocked: row.isBlocked,
    blockReason: row.blockReason,
    expectedResolutionAt: row.expectedResolutionAt
      ? row.expectedResolutionAt.toISOString()
      : null,
    internalNotePresent: Boolean(row.internalNote?.trim()),
  };
}

export function auditActionForField(field: string): string {
  switch (field) {
    case "priority":
      return "SET_PRIORITY";
    case "responsibleUserId":
    case "responsibleName":
      return "ASSIGN_RESPONSIBLE";
    case "responsibleArea":
      return "ASSIGN_AREA";
    case "isBlocked":
      return "TOGGLE_BLOCK";
    case "blockReason":
      return "SET_BLOCK_REASON";
    case "expectedResolutionAt":
      return "SET_EXPECTED_RESOLUTION";
    case "internalNote":
      return "ADD_INTERNAL_NOTE";
    default:
      return "MANAGEMENT_UPDATE";
  }
}

export function fieldValueForAudit(
  field: string,
  row: SalesOrderFlowManagementSnapshot
): string | null {
  switch (field) {
    case "priority":
      return row.priority;
    case "responsibleUserId":
      return row.responsibleUserId;
    case "responsibleName":
      return row.responsibleName;
    case "responsibleArea":
      return row.responsibleArea;
    case "isBlocked":
      return row.isBlocked ? "true" : "false";
    case "blockReason":
      return row.blockReason;
    case "expectedResolutionAt":
      return row.expectedResolutionAt
        ? row.expectedResolutionAt.toISOString()
        : null;
    case "internalNote":
      return row.internalNote;
    default:
      return null;
  }
}
