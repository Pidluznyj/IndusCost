/**
 * Smoke test E2E da frota via camada de domínio (Prisma + ops).
 * Requer DATABASE_URL. Não substitui testes HTTP com auth.
 *
 * Uso: npm run test:fleet:e2e
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { FleetValidationError, isVehicleReservable } from "../src/lib/fleetValidation.ts";
import { validateReservationFull } from "../src/lib/fleetReservationOps.ts";
import { performCheckout, performCheckin } from "../src/lib/fleetUsageOps.ts";
import { createMaintenance, startMaintenance, completeMaintenance } from "../src/lib/fleetMaintenanceOps.ts";
import { createFleetCostFromSource } from "../src/lib/fleetFinancialOps.ts";
import { buildFleetAlerts, buildFleetDashboardCards } from "../src/lib/fleetManagementOps.ts";
import { listRelatedVehicleAudit } from "../src/lib/fleetVehicleOps.ts";
import { loadFleetSettings } from "../src/lib/fleetService.ts";

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function expectThrows(fn: () => Promise<unknown>, msg: string) {
  let threw = false;
  try {
    await fn();
  } catch (e) {
    threw = true;
    if (!(e instanceof FleetValidationError)) {
      throw new Error(`${msg}: esperava FleetValidationError, recebeu ${e}`);
    }
  }
  if (!threw) throw new Error(msg);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[fleet-e2e] SKIP: DATABASE_URL não definida.");
    return;
  }

  const tag = `E2E${Date.now().toString(36).toUpperCase()}`;
  console.warn(`[fleet-e2e] Início ${tag}`);

  const vehicle = await prisma.fleetVehicle.create({
    data: {
      plate: `TST-${tag}`,
      brand: "Teste",
      model: "E2E",
      origin: "OWNED",
      status: "AVAILABLE",
      currentKm: 1000,
      initialKm: 1000,
    },
  });

  const driver = await prisma.fleetDriver.create({
    data: {
      name: `Motorista ${tag}`,
      cpf: String(10000000000 + (Date.now() % 89999999999)).slice(0, 11),
      cnhCategory: "B",
      cnhExpirationDate: new Date(Date.now() + 365 * 86400000),
      status: "AUTHORIZED",
    },
  });

  const start = new Date();
  start.setDate(start.getDate() + 2);
  const end = new Date(start);
  end.setHours(end.getHours() + 3);

  await validateReservationFull({
    vehicleId: vehicle.id,
    driverId: driver.id,
    startDateTime: start,
    endDateTime: end,
  });

  const reservation = await prisma.fleetReservation.create({
    data: {
      vehicleId: vehicle.id,
      driverId: driver.id,
      startDateTime: start,
      endDateTime: end,
      status: "PENDING_APPROVAL",
      destination: "Smoke E2E",
    },
  });

  await expectThrows(
    () =>
      validateReservationFull({
        vehicleId: vehicle.id,
        driverId: driver.id,
        startDateTime: start,
        endDateTime: end,
      }),
    "Conflito de reserva deveria bloquear"
  );

  await prisma.fleetReservation.update({
    where: { id: reservation.id },
    data: { status: "APPROVED", approvalStatus: "APPROVED" },
  });
  await prisma.fleetVehicle.update({
    where: { id: vehicle.id },
    data: { status: "RESERVED" },
  });

  await performCheckout({
    reservationId: reservation.id,
    body: { checkoutKm: 1000, checkoutFuelLevel: "CHEIO" },
    userId: "e2e-smoke",
  });

  let v = await prisma.fleetVehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
  assert(v.status === "IN_USE", "Veículo deveria estar IN_USE após retirada");
  assert(Number(v.currentKm) === 1000, "Km após retirada");

  await performCheckin({
    reservationId: reservation.id,
    body: { checkinKm: 1250, checkinFuelLevel: "3/4" },
    userId: "e2e-smoke",
  });

  v = await prisma.fleetVehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
  assert(Number(v.currentKm) === 1250, "Km após devolução deveria ser 1250");

  const maint = await createMaintenance({
    vehicleId: vehicle.id,
    body: {
      description: `Bloqueio ${tag}`,
      maintenanceType: "CORRETIVA",
      priority: "CRITICA",
      blocksVehicle: true,
    },
    userId: "e2e-smoke",
  });

  v = await prisma.fleetVehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
  assert(
    v.status === "BLOCKED" || v.status === "MAINTENANCE",
    `Veículo deveria bloquear manutenção, status=${v.status}`
  );
  assert(!isVehicleReservable(v.status), "Não reservável em manutenção");

  await startMaintenance(maint.id, "e2e-smoke");
  await completeMaintenance(
    maint.id,
    {
      finalValue: 500,
      currentKm: 1250,
      servicePerformed: "Serviço E2E",
      generateCost: true,
    },
    "e2e-smoke"
  );

  const expiredDoc = await prisma.fleetVehicleDocument.create({
    data: {
      vehicleId: vehicle.id,
      documentType: "IPVA",
      expirationDate: new Date(Date.now() - 86400000),
      status: "EXPIRED",
    },
  });

  const settings = await loadFleetSettings();
  const alerts = await buildFleetAlerts(settings);
  assert(
    alerts.some(
      (a) => a.code === "DOCUMENT_EXPIRED" && a.entityId === expiredDoc.id
    ),
    "Alerta de documento vencido"
  );

  const comp = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  await createFleetCostFromSource({
    vehicleId: vehicle.id,
    costType: "OUTRO",
    amount: 99.5,
    costDate: new Date(),
    competence: comp,
    userId: "e2e-smoke",
  });

  const cards = await buildFleetDashboardCards(settings);
  assert(cards.totalVehicles >= 1, "Dashboard com veículos");

  const audit = await listRelatedVehicleAudit(vehicle.id, 50);
  assert(audit.length >= 3, "Auditoria da ficha do veículo");

  console.warn(`[fleet-e2e] OK — veículo ${vehicle.plate} reserva ${reservation.id}`);
  console.warn(`[fleet-e2e] Dados de teste mantidos no banco (plate TST-${tag}).`);
}

main()
  .catch((e) => {
    console.error("[fleet-e2e] FALHA", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
