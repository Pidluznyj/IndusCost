import type {
  FleetDocumentStatus,
  FleetDriver,
  FleetDriverStatus,
  FleetReservationStatus,
  FleetVehicle,
  FleetVehicleOrigin,
  FleetVehicleStatus,
} from "@prisma/client";

export const FLEET_NON_RESERVABLE_VEHICLE_STATUSES: FleetVehicleStatus[] = [
  "BLOCKED",
  "MAINTENANCE",
  "IN_USE",
  "INACTIVE",
  "RETURNED",
  "SOLD",
  "CLAIMED",
  "RESERVED",
];

export const ORIGINS_REQUIRING_CONTRACT: FleetVehicleOrigin[] = [
  "RENTED",
  "LEASING",
  "COMODATO",
];

export const FLEET_DISPOSAL_BLOCKED_STATUSES: FleetVehicleStatus[] = ["IN_USE"];

export const FLEET_ACTIVE_RESERVATION_STATUSES: FleetReservationStatus[] = [
  "REQUESTED",
  "PENDING_APPROVAL",
  "APPROVED",
  "IN_USE",
];

export function parseDecimalKm(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return n;
}

export function assertNonNegativeKm(km: number, label = "Quilometragem"): void {
  if (km < 0) throw new FleetValidationError(`${label} não pode ser negativa.`);
}

export function assertKmRange(checkoutKm: number, checkinKm: number): void {
  assertNonNegativeKm(checkoutKm, "Km de retirada");
  assertNonNegativeKm(checkinKm, "Km de devolução");
  if (checkinKm < checkoutKm) {
    throw new FleetValidationError("Km final não pode ser menor que km inicial.");
  }
}

export function assertDateRange(start: Date, end: Date, label = "Período"): void {
  if (end.getTime() <= start.getTime()) {
    throw new FleetValidationError(`${label}: data final deve ser maior que a inicial.`);
  }
}

export function assertContractDateRange(start: Date, end: Date | null | undefined): void {
  if (end && end.getTime() < start.getTime()) {
    throw new FleetValidationError("Data final do contrato não pode ser menor que a inicial.");
  }
}

export function assertNonNegativeAmount(amount: number, label = "Valor"): void {
  if (amount < 0) throw new FleetValidationError(`${label} não pode ser negativo.`);
}

export function isVehicleReservable(status: FleetVehicleStatus): boolean {
  return !FLEET_NON_RESERVABLE_VEHICLE_STATUSES.includes(status);
}

export function assertVehicleReservable(vehicle: Pick<FleetVehicle, "status" | "plate">): void {
  if (!isVehicleReservable(vehicle.status)) {
    throw new FleetValidationError(
      `Veículo não disponível para reserva (status: ${vehicle.status}).`
    );
  }
}

export function isCnhValid(
  driver: Pick<FleetDriver, "cnhExpirationDate" | "status">,
  at: Date = new Date()
): boolean {
  if (driver.status !== "AUTHORIZED") return false;
  if (!driver.cnhExpirationDate) return false;
  const exp = new Date(driver.cnhExpirationDate);
  exp.setHours(23, 59, 59, 999);
  return exp.getTime() >= at.getTime();
}

export type CnhComputedStatus = "VALID" | "EXPIRING" | "EXPIRED" | "MISSING";

export function computeCnhStatus(
  cnhExpirationDate: Date | string | null | undefined,
  alertDays: number,
  now: Date = new Date()
): CnhComputedStatus {
  if (!cnhExpirationDate) return "MISSING";
  const exp = new Date(cnhExpirationDate);
  if (Number.isNaN(exp.getTime())) return "MISSING";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const expDay = new Date(exp);
  expDay.setHours(23, 59, 59, 999);
  if (expDay.getTime() < today.getTime()) return "EXPIRED";
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() + alertDays);
  if (expDay.getTime() <= threshold.getTime()) return "EXPIRING";
  return "VALID";
}

/** Matriz mínima categoria CNH × tipo veículo (expansível via settings no futuro). */
export const VEHICLE_TYPE_MIN_CNH_CATEGORY: Record<string, string> = {
  CARRO: "B",
  VAN: "B",
  CAMINHAO: "C",
  MOTO: "A",
  UTILITARIO: "B",
};

const CNH_CATEGORY_RANK: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5 };

export function parseCnhCategoryRank(category: string | null | undefined): number {
  if (!category) return 0;
  const letter = category.toUpperCase().replace(/[^A-E]/g, "").charAt(0);
  return CNH_CATEGORY_RANK[letter] ?? 0;
}

export function assertCnhCategoryForVehicle(
  cnhCategory: string | null | undefined,
  vehicleType: string | null | undefined
): void {
  if (!cnhCategory?.trim() || !vehicleType?.trim()) return;
  const minCat = VEHICLE_TYPE_MIN_CNH_CATEGORY[vehicleType.trim().toUpperCase()];
  if (!minCat) return;
  const driverRank = parseCnhCategoryRank(cnhCategory);
  const minRank = parseCnhCategoryRank(minCat);
  if (driverRank < minRank) {
    throw new FleetValidationError(
      `Categoria CNH (${cnhCategory}) incompatível com tipo de veículo (${vehicleType}); mínimo exigido: ${minCat}.`
    );
  }
}

export function assertReasonRequired(reason: unknown, label = "Motivo"): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (!r) throw new FleetValidationError(`${label} é obrigatório.`);
  return r;
}

export function assertDriverAuthorizedForReservation(
  driver: Pick<FleetDriver, "cnhExpirationDate" | "cnhCategory" | "status" | "name">,
  options?: {
    blockExpiredCnh?: boolean;
    at?: Date;
    vehicleType?: string | null;
    requireAuthorized?: boolean;
  }
): void {
  const at = options?.at ?? new Date();
  if (driver.status === "BLOCKED" || driver.status === "INACTIVE") {
    throw new FleetValidationError("Motorista bloqueado ou inativo não pode ser vinculado à reserva.");
  }
  if (options?.requireAuthorized !== false && driver.status !== "AUTHORIZED") {
    throw new FleetValidationError("Motorista precisa estar autorizado para reserva.");
  }
  const blockExpired = options?.blockExpiredCnh ?? true;
  if (blockExpired && !isCnhValid(driver, at)) {
    throw new FleetValidationError("CNH vencida: motorista não pode ser vinculado à reserva/retirada.");
  }
  if (options?.vehicleType) {
    assertCnhCategoryForVehicle(driver.cnhCategory, options.vehicleType);
  }
}

/** Interval overlap: [aStart, aEnd) overlaps [bStart, bEnd) when aStart < bEnd && bStart < aEnd */
export function reservationPeriodsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function findReservationConflict<T extends { id: string; startDateTime: Date; endDateTime: Date }>(
  existing: T[],
  start: Date,
  end: Date,
  excludeId?: string
): T | undefined {
  return existing.find((r) => {
    if (excludeId && r.id === excludeId) return false;
    return reservationPeriodsOverlap(start, end, r.startDateTime, r.endDateTime);
  });
}

export function normalizePlate(plate: string | null | undefined): string | null {
  if (!plate) return null;
  const p = plate.trim().toUpperCase().replace(/\s+/g, "");
  return p || null;
}

export function isActiveVehicleStatus(status: FleetVehicleStatus): boolean {
  return status !== "INACTIVE" && status !== "SOLD" && status !== "RETURNED";
}

export function isActiveDriverStatus(status: FleetDriverStatus): boolean {
  return status !== "INACTIVE";
}

export function assertBlockReason(reason: unknown): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (!r) throw new FleetValidationError("Motivo é obrigatório para bloqueio/desbloqueio.");
  return r;
}

export function assertVehicleCanDispose(status: FleetVehicleStatus): void {
  if (FLEET_DISPOSAL_BLOCKED_STATUSES.includes(status)) {
    throw new FleetValidationError("Veículo em uso não pode ser inativado, vendido ou devolvido.");
  }
}

export function originRequiresContract(origin: FleetVehicleOrigin): boolean {
  return ORIGINS_REQUIRING_CONTRACT.includes(origin);
}

/** Calcula status do documento com base no vencimento e dias de alerta. */
export function computeDocumentStatus(
  expirationDate: Date | string | null | undefined,
  alertDays: number,
  now: Date = new Date()
): FleetDocumentStatus {
  if (!expirationDate) return "VALID";
  const exp = new Date(expirationDate);
  if (Number.isNaN(exp.getTime())) return "VALID";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const expDay = new Date(exp);
  expDay.setHours(23, 59, 59, 999);
  if (expDay.getTime() < today.getTime()) return "EXPIRED";
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() + alertDays);
  if (expDay.getTime() <= threshold.getTime()) return "EXPIRING";
  return "VALID";
}

export function isContractExpired(endDate: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!endDate) return false;
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime())) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return end.getTime() < today.getTime();
}

export function isContractExpiringSoon(
  endDate: Date | string | null | undefined,
  alertDays: number,
  now: Date = new Date()
): boolean {
  if (!endDate) return false;
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime())) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (end.getTime() < today.getTime()) return false;
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() + alertDays);
  return end.getTime() <= threshold.getTime();
}

export class FleetValidationError extends Error {
  readonly code = "FLEET_VALIDATION";

  constructor(message: string) {
    super(message);
    this.name = "FleetValidationError";
  }
}
