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

export type MobileChecklistItemInput = ChecklistItemLike & {
  itemName?: string;
  notes?: string | null;
  attachmentUrl?: string | null;
};

export type MobileChecklistStepStatus = {
  complete: boolean;
  answeredCount: number;
  totalCount: number;
  pendingItemNames: string[];
  blockReason: string | null;
  canAdvance: boolean;
};

const VALID_CHECKLIST_RESULTS = new Set(["OK", "NOT_OK", "NOT_APPLICABLE"]);

export function isChecklistItemAnswered(
  result: ChecklistItemLike["result"] | undefined
): boolean {
  return result != null && VALID_CHECKLIST_RESULTS.has(result);
}

export function getMobileChecklistStepStatus(
  items: MobileChecklistItemInput[],
  options: { required: boolean; mode: MobileUsageMode }
): MobileChecklistStepStatus {
  const totalCount = items.length;
  const answeredCount = items.filter((i) => isChecklistItemAnswered(i.result)).length;
  const pendingItemNames = items
    .filter((i) => !isChecklistItemAnswered(i.result))
    .map((i) => i.itemName?.trim() || "Item sem nome");

  if (totalCount === 0) {
    const blockReason = options.required ? "Checklist obrigatório sem itens." : null;
    return {
      complete: !options.required,
      answeredCount: 0,
      totalCount: 0,
      pendingItemNames: [],
      blockReason,
      canAdvance: !options.required,
    };
  }

  let blockReason: string | null = null;

  if (pendingItemNames.length > 0) {
    blockReason =
      pendingItemNames.length === 1
        ? "Falta 1 item do checklist"
        : `Faltam ${pendingItemNames.length} itens do checklist`;
  } else if (options.mode === "checkout" && hasCriticalNotOk(items)) {
    blockReason = "Item crítico Não OK bloqueia a retirada";
  }

  const complete = pendingItemNames.length === 0;
  const canAdvance = complete && !(options.mode === "checkout" && hasCriticalNotOk(items));

  return {
    complete,
    answeredCount,
    totalCount,
    pendingItemNames,
    blockReason,
    canAdvance,
  };
}

export function formatMobileChecklistBlockMessage(status: MobileChecklistStepStatus): string | null {
  if (status.canAdvance) return null;
  if (status.pendingItemNames.length > 0) {
    const pendingList = status.pendingItemNames.join(", ");
    return status.blockReason
      ? `${status.blockReason}: ${pendingList}`
      : `Itens pendentes: ${pendingList}`;
  }
  return status.blockReason;
}

export function isMobileChecklistStepComplete(
  items: ChecklistItemLike[],
  required: boolean
): boolean {
  return getMobileChecklistStepStatus(items, { required, mode: "checkin" }).complete;
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
