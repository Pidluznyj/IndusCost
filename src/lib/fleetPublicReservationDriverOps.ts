import type { FleetDriver, FleetPublicReservationRequestStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { assertUniqueActiveDriverCpf, writeFleetAuditLog } from "@/src/lib/fleetService.js";
import { normalizeCpf } from "@/src/lib/fleetDriverOps.js";
import { FleetValidationError, computeCnhStatus } from "@/src/lib/fleetValidation.js";
import { isValidCpf, normalizeCpfDigits } from "@/src/lib/fleetCpfUtils.js";

export type DriverPublicApprovalStatus = "APPROVED" | "PENDING_REVIEW" | "REJECTED";

export type DriverPublicApprovalFields = Pick<
  FleetDriver,
  | "status"
  | "cnhNumber"
  | "cnhExpirationDate"
  | "createdFromPublicReservation"
  | "publicRegistrationRejectionReason"
>;

export function driverPublicApprovalStatus(
  driver: DriverPublicApprovalFields
): DriverPublicApprovalStatus {
  if (driver.status === "BLOCKED" && driver.publicRegistrationRejectionReason?.trim()) {
    return "REJECTED";
  }
  if (driverNeedsPublicApproval(driver)) return "PENDING_REVIEW";
  return "APPROVED";
}

/** Motorista precisa de aprovação interna antes de liberar aprovação da reserva. */
export function driverNeedsPublicApproval(driver: DriverPublicApprovalFields): boolean {
  if (driver.status === "BLOCKED" || driver.status === "INACTIVE") return true;
  if (!driverHasCnhRegistered(driver)) return true;
  if (computeCnhStatus(driver.cnhExpirationDate, 0) === "EXPIRED") return true;
  if (driver.status !== "AUTHORIZED") return true;
  return false;
}

export function resolveInitialPublicRequestStatus(
  driver: DriverPublicApprovalFields
): FleetPublicReservationRequestStatus {
  return driverNeedsPublicApproval(driver)
    ? "PENDING_DRIVER_APPROVAL"
    : "PENDING_RESERVATION_APPROVAL";
}

export function publicRequestAwaitingReservationApproval(
  status: FleetPublicReservationRequestStatus
): boolean {
  return status === "PENDING_RESERVATION_APPROVAL" || status === "PENDING";
}

export function publicRequestAwaitingDriverApproval(
  status: FleetPublicReservationRequestStatus
): boolean {
  return status === "PENDING_DRIVER_APPROVAL";
}

export function assertValidPublicCpf(cpf: unknown): string {
  const raw = typeof cpf === "string" ? cpf.trim() : "";
  if (!raw) throw new FleetValidationError("CPF é obrigatório.");
  if (!isValidCpf(raw)) throw new FleetValidationError("CPF inválido. Verifique os dígitos informados.");
  return normalizeCpfDigits(raw);
}

export function driverHasCnhRegistered(driver: Pick<FleetDriver, "cnhNumber">): boolean {
  return Boolean(driver.cnhNumber?.trim());
}

export function driverNeedsCnhData(driver: Pick<FleetDriver, "cnhNumber">): boolean {
  return !driverHasCnhRegistered(driver);
}

export function publicCnhStatusLabel(
  driver: Pick<FleetDriver, "cnhNumber" | "cnhExpirationDate">,
  alertDays = 30
): "cadastrada" | "pendente" | "vencida" {
  if (!driverHasCnhRegistered(driver)) return "pendente";
  const st = computeCnhStatus(driver.cnhExpirationDate, alertDays);
  if (st === "EXPIRED") return "vencida";
  return "cadastrada";
}

export async function findFleetDriverByCpf(cpfDigits: string): Promise<FleetDriver | null> {
  const masked = `${cpfDigits.slice(0, 3)}.${cpfDigits.slice(3, 6)}.${cpfDigits.slice(6, 9)}-${cpfDigits.slice(9)}`;
  const hit = await prisma.fleetDriver.findFirst({
    where: { OR: [{ cpf: cpfDigits }, { cpf: masked }] },
  });
  if (hit) return hit;

  const candidates = await prisma.fleetDriver.findMany({
    where: { cpf: { endsWith: cpfDigits.slice(-4) } },
    take: 30,
  });
  return candidates.find((d) => normalizeCpf(d.cpf) === cpfDigits) ?? null;
}

export type PublicIdentifyResult =
  | { found: false; needsRegistration: true }
  | {
      found: true;
      driverId: string;
      name: string;
      phone: string | null;
      email: string | null;
      department: string | null;
      hasDriverLicense: boolean;
      needsDriverLicense: boolean;
      cnhStatus: "cadastrada" | "pendente" | "vencida";
    };

export async function identifyPublicDriverByCpf(cpf: unknown): Promise<PublicIdentifyResult> {
  const cpfDigits = assertValidPublicCpf(cpf);
  const driver = await findFleetDriverByCpf(cpfDigits);
  if (!driver) {
    return { found: false, needsRegistration: true };
  }

  const hasDriverLicense = driverHasCnhRegistered(driver);
  return {
    found: true,
    driverId: driver.id,
    name: driver.name,
    phone: driver.phone,
    email: driver.email,
    department: driver.unit,
    hasDriverLicense,
    needsDriverLicense: driverNeedsCnhData(driver),
    cnhStatus: publicCnhStatusLabel(driver),
  };
}

export type PublicRegisterInput = {
  cpf: string;
  driverId?: string | null;
  name?: string;
  phone?: string;
  email?: string | null;
  department?: string | null;
  cnhNumber?: string;
  cnhCategory?: string | null;
  cnhExpirationDate?: string | null;
};

export async function registerPublicDriver(input: PublicRegisterInput): Promise<{
  driverId: string;
  created: boolean;
  hasDriverLicense: boolean;
  needsDriverLicense: boolean;
  cnhStatus: "cadastrada" | "pendente" | "vencida";
}> {
  const cpfDigits = assertValidPublicCpf(input.cpf);
  const existing = await findFleetDriverByCpf(cpfDigits);

  const cnhNumber = typeof input.cnhNumber === "string" ? input.cnhNumber.trim() : "";
  const cnhCategory =
    typeof input.cnhCategory === "string" ? input.cnhCategory.trim() || null : null;
  let cnhExpirationDate: Date | null = null;
  if (input.cnhExpirationDate) {
    cnhExpirationDate = new Date(String(input.cnhExpirationDate));
    if (Number.isNaN(cnhExpirationDate.getTime())) {
      throw new FleetValidationError("Validade da CNH inválida.");
    }
  }

  if (existing) {
    const driverId = input.driverId?.trim();
    if (driverId && driverId !== existing.id) {
      throw new FleetValidationError("CPF não corresponde ao cadastro informado.");
    }
    if (driverHasCnhRegistered(existing) && !cnhNumber) {
      throw new FleetValidationError("Cadastro já existe para este CPF.");
    }
    if (!cnhNumber) {
      throw new FleetValidationError("Informe os dados da CNH para continuar.");
    }

    const hadCnhGap = driverNeedsCnhData(existing) || computeCnhStatus(existing.cnhExpirationDate, 0) === "EXPIRED";
    const updated = await prisma.fleetDriver.update({
      where: { id: existing.id },
      data: {
        cnhNumber,
        cnhCategory: cnhCategory ?? existing.cnhCategory,
        cnhExpirationDate: cnhExpirationDate ?? existing.cnhExpirationDate,
        ...(hadCnhGap && existing.status === "AUTHORIZED" ? { status: "PENDING" as const } : {}),
      },
    });

    await writeFleetAuditLog({
      entityType: "FleetDriver",
      entityId: updated.id,
      action: "PUBLIC_CNH_UPDATE",
      newValue: "CNH atualizada via QR público",
      userId: null,
    });

    return {
      driverId: updated.id,
      created: false,
      hasDriverLicense: true,
      needsDriverLicense: false,
      cnhStatus: publicCnhStatusLabel(updated),
    };
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  if (!name || name.length < 3) throw new FleetValidationError("Nome completo é obrigatório.");
  if (!phone || phone.length < 8) throw new FleetValidationError("Telefone/WhatsApp é obrigatório.");
  if (!cnhNumber) throw new FleetValidationError("Número da CNH é obrigatório.");

  await assertUniqueActiveDriverCpf(cpfDigits);

  const email = typeof input.email === "string" ? input.email.trim() || null : null;
  const department = typeof input.department === "string" ? input.department.trim() || null : null;

  const created = await prisma.fleetDriver.create({
    data: {
      name,
      cpf: cpfDigits,
      phone,
      email,
      unit: department,
      cnhNumber,
      cnhCategory,
      cnhExpirationDate,
      status: "PENDING",
      createdFromPublicReservation: true,
      notes: "[Cadastro público QR — aguardando validação interna]",
    },
  });

  await writeFleetAuditLog({
    entityType: "FleetDriver",
    entityId: created.id,
    action: "PUBLIC_REGISTER",
    newValue: cpfDigits,
    userId: null,
  });

  return {
    driverId: created.id,
    created: true,
    hasDriverLicense: true,
    needsDriverLicense: false,
    cnhStatus: publicCnhStatusLabel(created),
  };
}

export async function getPublicDriverOrThrow(driverId: string, cpfDigits: string) {
  const driver = await prisma.fleetDriver.findUnique({ where: { id: driverId } });
  if (!driver) throw new FleetValidationError("Cadastro não encontrado.");
  if (normalizeCpf(driver.cpf) !== cpfDigits) {
    throw new FleetValidationError("CPF não corresponde ao cadastro.");
  }
  if (driverNeedsCnhData(driver)) {
    throw new FleetValidationError("Complete os dados da CNH antes de continuar.");
  }
  return driver;
}
