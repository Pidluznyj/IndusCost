import {
  assertKmRange,
  assertNonNegativeKm,
  FleetValidationError,
  hasCriticalNotOk,
  parseDecimalKm,
  type ChecklistItemLike,
} from "./fleetValidation.js";

export type MobileUsageMode = "checkout" | "checkin";

export const MOBILE_USAGE_STEPS = [
  "reservation",
  "km",
  "checklist",
  "photos",
  "confirm",
] as const;

export type MobileUsageStep = (typeof MOBILE_USAGE_STEPS)[number];

export const MOBILE_USAGE_STEP_LABELS: Record<MobileUsageStep, string> = {
  reservation: "Reserva",
  km: "Km e combustível",
  checklist: "Checklist",
  photos: "Fotos e observações",
  confirm: "Confirmação",
};

export function resolveMobileUsageMode(
  status: string
): MobileUsageMode | null {
  if (status === "APPROVED") return "checkout";
  if (status === "IN_USE") return "checkin";
  return null;
}

export function isFleetChecklistRequiredForMode(
  settings: Record<string, string>,
  mode: MobileUsageMode
): boolean {
  if (mode === "checkout") return settings.checklistRetiradaObrigatorio === "true";
  return settings.checklistDevolucaoObrigatorio === "true";
}

export function validateMobileKmInput(input: {
  mode: MobileUsageMode;
  kmRaw: string;
  vehicleCurrentKm: number;
  checkoutKm: number | null;
}): { valid: true; km: number; kmDrivenPreview?: number } | { valid: false; error: string } {
  const km = parseDecimalKm(input.kmRaw);
  if (km == null) {
    return { valid: false, error: "Informe a quilometragem." };
  }
  try {
    assertNonNegativeKm(km);
  } catch (e) {
    return {
      valid: false,
      error: e instanceof FleetValidationError ? e.message : "Quilometragem inválida.",
    };
  }

  if (input.mode === "checkout") {
    if (km < input.vehicleCurrentKm) {
      return {
        valid: false,
        error: "Km de retirada não pode ser menor que km atual do veículo.",
      };
    }
    return { valid: true, km };
  }

  if (input.checkoutKm == null) {
    return { valid: false, error: "Km de retirada não encontrado para esta reserva." };
  }
  try {
    assertKmRange(input.checkoutKm, km);
    return { valid: true, km, kmDrivenPreview: km - input.checkoutKm };
  } catch (e) {
    return {
      valid: false,
      error: e instanceof FleetValidationError ? e.message : "Km final inválido.",
    };
  }
}

export function isMobileChecklistStepComplete(
  items: ChecklistItemLike[],
  required: boolean
): boolean {
  if (items.length === 0) return !required;
  return items.every((i) => i.result != null);
}

export function resolveCheckinPendingOutcome(input: {
  hasDamage: boolean;
  manualPending: boolean;
  checklistItems: ChecklistItemLike[];
}): {
  hasPending: boolean;
  criticalFail: boolean;
  summary: string;
} {
  const criticalFail = hasCriticalNotOk(input.checklistItems);
  const hasPending = input.manualPending || input.hasDamage || criticalFail;
  const parts: string[] = [];
  if (input.hasDamage) parts.push("avaria informada");
  if (input.manualPending) parts.push("pendência manual");
  if (criticalFail) parts.push("item crítico não conforme");
  const summary =
    parts.length > 0
      ? `Devolução com pendência (${parts.join(", ")}).`
      : "Devolução sem pendências.";
  return { hasPending, criticalFail, summary };
}

export function mobileCheckoutBlockedByCritical(items: ChecklistItemLike[]): boolean {
  return hasCriticalNotOk(items);
}
