/**
 * Seed opcional de homologação — frota.
 * Não roda sem confirmação explícita. Não apaga dados existentes.
 *
 * Uso:
 *   npm run fleet:seed-demo -- --confirm="CRIAR DADOS DEMO FROTA"
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const CONFIRM = "CRIAR DADOS DEMO FROTA";

function hasConfirm(): boolean {
  return process.argv.includes(`--confirm=${CONFIRM}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[fleet-seed] DATABASE_URL não definida.");
    process.exit(1);
  }
  if (!hasConfirm()) {
    console.error(`[fleet-seed] Abortado. Informe --confirm="${CONFIRM}"`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.fleetVehicle.count({
      where: { plate: { startsWith: "DEMO-" } },
    });
    if (existing > 0) {
      console.warn(`[fleet-seed] SKIP: já existem ${existing} veículo(s) DEMO-. Nenhum dado criado.`);
      return;
    }

    const anyFleet = await prisma.fleetVehicle.count();
    if (anyFleet > 0) {
      console.warn(
        `[fleet-seed] SKIP: banco já possui ${anyFleet} veículo(s). Seed demo não executado para evitar mistura.`
      );
      return;
    }

    const now = new Date();
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);
    const in7 = new Date(now);
    in7.setDate(in7.getDate() + 7);
    const past = new Date(now);
    past.setDate(past.getDate() - 10);
    const comp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const owned = await prisma.fleetVehicle.create({
      data: {
        plate: "DEMO-1001",
        brand: "Demo",
        model: "Próprio",
        origin: "OWNED",
        status: "AVAILABLE",
        currentKm: 5000,
        initialKm: 0,
      },
    });

    const rented = await prisma.fleetVehicle.create({
      data: {
        plate: "DEMO-2002",
        brand: "Demo",
        model: "Alugado",
        origin: "RENTED",
        status: "AVAILABLE",
        currentKm: 12000,
        initialKm: 10000,
      },
    });

    await prisma.fleetVehicleContract.create({
      data: {
        vehicleId: rented.id,
        supplierName: "Locadora Demo",
        contractType: "LOCACAO",
        startDate: past,
        endDate: in30,
        monthlyValue: 3500,
        status: "ACTIVE",
      },
    });

    await prisma.fleetVehicleDocument.create({
      data: {
        vehicleId: owned.id,
        documentType: "CRLV",
        expirationDate: in30,
        status: "VALID",
      },
    });
    await prisma.fleetVehicleDocument.create({
      data: {
        vehicleId: owned.id,
        documentType: "SEGURO",
        expirationDate: in7,
        status: "EXPIRING",
      },
    });

    const driverOk = await prisma.fleetDriver.create({
      data: {
        name: "Motorista Demo OK",
        cpf: "00000000191",
        cnhNumber: "12345678901",
        cnhCategory: "B",
        cnhExpirationDate: in30,
        status: "AUTHORIZED",
      },
    });

    await prisma.fleetDriver.create({
      data: {
        name: "Motorista Demo CNH",
        cpf: "00000000272",
        cnhNumber: "98765432100",
        cnhCategory: "B",
        cnhExpirationDate: in7,
        status: "AUTHORIZED",
      },
    });

    const start = new Date(now);
    start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setHours(end.getHours() + 4);

    await prisma.fleetReservation.create({
      data: {
        vehicleId: owned.id,
        driverId: driverOk.id,
        startDateTime: start,
        endDateTime: end,
        status: "APPROVED",
        approvalStatus: "APPROVED",
        destination: "Homologação",
      },
    });

    await prisma.fleetMaintenance.create({
      data: {
        vehicleId: rented.id,
        maintenanceType: "CORRETIVA",
        status: "OPEN",
        priority: "MEDIA",
        description: "Manutenção demo aberta",
        blocksVehicle: false,
      },
    });

    await prisma.fleetCost.create({
      data: {
        vehicleId: owned.id,
        costType: "OUTRO",
        costDate: now,
        competence: comp,
        amount: 150,
        status: "ACTIVE",
        notes: "Custo demo seed",
      },
    });

    console.warn("[fleet-seed] Dados demo criados com sucesso (prefixo DEMO-).");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
