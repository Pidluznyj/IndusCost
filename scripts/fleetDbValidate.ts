/**
 * Valida migration de frota, tabelas Fleet* e parâmetros FleetSettings.
 * Uso: npm run fleet:db-validate
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const FLEET_MIGRATION = "20260603120000_add_fleet_management_module";

const EXPECTED_SETTINGS = [
  "bloquearReservaDocumentoVencido",
  "bloquearRetiradaCnhVencida",
  "checklistRetiradaObrigatorio",
  "checklistDevolucaoObrigatorio",
  "diasAlertaDocumento",
  "diasAlertaCnh",
  "percentualAlertaFranquiaKm",
] as const;

const FLEET_TABLES = [
  "FleetVehicle",
  "FleetDriver",
  "FleetVehicleContract",
  "FleetVehicleDocument",
  "FleetReservation",
  "FleetUsage",
  "FleetChecklist",
  "FleetChecklistItem",
  "FleetMaintenance",
  "FleetCost",
  "FleetFueling",
  "FleetFine",
  "FleetIncident",
  "FleetAttachment",
  "FleetAuditLog",
  "FleetSettings",
] as const;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[fleet-db-validate] SKIP: DATABASE_URL não definida.");
    process.exitCode = 0;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const migrations = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    const applied = new Set(migrations.map((m) => m.migration_name));
    if (!applied.has(FLEET_MIGRATION)) {
      console.error(`[fleet-db-validate] FALHA: migration ${FLEET_MIGRATION} não aplicada.`);
      console.error("Execute: npx prisma migrate deploy");
      process.exitCode = 1;
      return;
    }
    console.warn(`[fleet-db-validate] OK migration ${FLEET_MIGRATION}`);

    for (const table of FLEET_TABLES) {
      const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
        `SELECT to_regclass('"${table}"') IS NOT NULL AS exists`
      );
      if (!rows[0]?.exists) {
        console.error(`[fleet-db-validate] FALHA: tabela ${table} não encontrada.`);
        process.exitCode = 1;
        return;
      }
    }
    console.warn(`[fleet-db-validate] OK ${FLEET_TABLES.length} tabelas Fleet*`);

    const settings = await prisma.fleetSettings.findMany();
    const keys = new Set(settings.map((s) => s.key));
    const missing = EXPECTED_SETTINGS.filter((k) => !keys.has(k));
    if (missing.length > 0) {
      console.error(`[fleet-db-validate] FALHA: FleetSettings sem chaves: ${missing.join(", ")}`);
      process.exitCode = 1;
      return;
    }
    console.warn(`[fleet-db-validate] OK FleetSettings (${settings.length} registros)`);

    const counts = {
      vehicles: await prisma.fleetVehicle.count(),
      drivers: await prisma.fleetDriver.count(),
      reservations: await prisma.fleetReservation.count(),
    };
    console.warn(`[fleet-db-validate] Contagens: veículos=${counts.vehicles} motoristas=${counts.drivers} reservas=${counts.reservations}`);
    console.warn("[fleet-db-validate] OK");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
