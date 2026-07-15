/**
 * Auditoria estruturada de RH / vínculos — nunca grava PII completa.
 */

export type EmployeeHrAuditEvent =
  | "employee.create"
  | "employee.update"
  | "employee.status_change"
  | "employee.delete"
  | "employee.corporate_email.set"
  | "employee.corporate_email.change"
  | "employee.manager.change"
  | "employee.person_link"
  | "employee.person_unlink"
  | "employee.person_conflict_resolve"
  | "employee.user_link"
  | "employee.user_unlink"
  | "employee.admin_access";

export type EmployeeHrAuditPayload = {
  event: EmployeeHrAuditEvent;
  actorUserId?: string | null;
  employeeId?: string | null;
  personId?: string | null;
  details?: Record<string, unknown>;
};

const SENSITIVE_DETAIL_KEYS = new Set([
  "cpf",
  "cpfNormalized",
  "rg",
  "phone",
  "phoneNormalized",
  "personalEmail",
  "corporateEmail",
  "email",
  "address",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactRelationship",
  "salary",
  "bankAccount",
  "pixKey",
  "password",
]);

function sanitizeDetails(
  details: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_DETAIL_KEYS.has(key)) {
      out[`${key}Present`] = value != null && String(value).trim() !== "";
      continue;
    }
    if (key.toLowerCase().includes("email") && typeof value === "string") {
      out[`${key}Present`] = value.trim().length > 0;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function logEmployeeHrAudit(payload: EmployeeHrAuditPayload): void {
  const line = {
    audit: payload.event,
    at: new Date().toISOString(),
    actorUserId: payload.actorUserId ?? null,
    employeeId: payload.employeeId ?? null,
    personId: payload.personId ?? null,
    details: sanitizeDetails(payload.details),
  };
  console.info(JSON.stringify(line));
}

export function summarizeConflictResolutions(
  resolutions: unknown
): { fieldCount: number; fields: string[] } {
  if (!resolutions || typeof resolutions !== "object") {
    return { fieldCount: 0, fields: [] };
  }
  const fields = Object.keys(resolutions as Record<string, unknown>).slice(0, 20);
  return { fieldCount: fields.length, fields };
}
