/**
 * Validação profunda do banco — Gestão de Frota (read-only).
 * Uso: npm run fleet:db-validate
 *
 * Requer DATABASE_URL. Não altera dados.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const FLEET_MIGRATIONS = [
  "20260603120000_add_fleet_management_module",
  "20260604120000_fix_fleet_schema_alignment",
] as const;

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

const EXPECTED_ENUMS = [
  "FleetVehicleOrigin",
  "FleetVehicleStatus",
  "FleetDriverStatus",
  "FleetDocumentStatus",
  "FleetReservationStatus",
  "FleetMaintenanceStatus",
  "FleetCostStatus",
  "FleetChecklistResult",
  "FleetIncidentStatus",
  "FleetFineStatus",
  "FleetUsageStatus",
  "FleetChecklistType",
  "FleetChecklistStatus",
] as const;

const REQUIRED_INDEXES = [
  "FleetVehicle_plate_active_key",
  "FleetDriver_cpf_active_key",
  "FleetSettings_key_key",
  "FleetUsage_reservationId_key",
  "FleetDriver_cnhExpirationDate_idx",
  "FleetMaintenance_openedAt_idx",
] as const;

const MIN_FLEET_FKS = 20;

function fail(msg: string): never {
  console.error(`[fleet-db-validate] FALHA: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[fleet-db-validate] SKIP: DATABASE_URL não definida.");
    return;
  }

  const prisma = new PrismaClient();
  try {
    const migrationRows = await prisma.$queryRaw<
      {
        migration_name: string;
        finished_at: Date | null;
        rolled_back_at: Date | null;
        logs: string | null;
      }[]
    >`
      SELECT migration_name, finished_at, rolled_back_at, logs
      FROM "_prisma_migrations"
      WHERE migration_name LIKE '%fleet%'
         OR migration_name = '20260603120000_add_fleet_management_module'
         OR migration_name = '20260604120000_fix_fleet_schema_alignment'
      ORDER BY started_at DESC
    `;

    for (const name of FLEET_MIGRATIONS) {
      const row = migrationRows.find((m) => m.migration_name === name);
      if (!row?.finished_at) {
        fail(`migration ${name} não aplicada ou sem finished_at. Rode: npx prisma migrate deploy`);
      }
      if (row.rolled_back_at) {
        fail(`migration ${name} consta rolled_back_at=${row.rolled_back_at.toISOString()}`);
      }
      if (row.logs && /error/i.test(row.logs)) {
        fail(`migration ${name} com erro em logs: ${row.logs.slice(0, 300)}`);
      }
      console.warn(`[fleet-db-validate] OK migration ${name}`);
    }

    for (const table of FLEET_TABLES) {
      const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
        `SELECT to_regclass('"${table}"') IS NOT NULL AS exists`
      );
      if (!rows[0]?.exists) fail(`tabela ${table} não encontrada.`);
    }
    console.warn(`[fleet-db-validate] OK ${FLEET_TABLES.length} tabelas Fleet*`);

    const enumRows = await prisma.$queryRaw<{ enum_name: string }[]>`
      SELECT t.typname AS enum_name
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typtype = 'e'
        AND t.typname LIKE 'Fleet%'
    `;
    const enumSet = new Set(enumRows.map((r) => r.enum_name));
    const missingEnums = EXPECTED_ENUMS.filter((e) => !enumSet.has(e));
    if (missingEnums.length > 0) {
      fail(`enums Fleet ausentes: ${missingEnums.join(", ")}`);
    }
    console.warn(`[fleet-db-validate] OK ${EXPECTED_ENUMS.length} enums Fleet`);

    const fkRows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM information_schema.table_constraints tc
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name LIKE 'Fleet%'
    `;
    const fkCount = Number(fkRows[0]?.count ?? 0);
    if (fkCount < MIN_FLEET_FKS) {
      fail(`FKs Fleet insuficientes: ${fkCount} (mínimo ${MIN_FLEET_FKS})`);
    }
    console.warn(`[fleet-db-validate] OK ${fkCount} FKs Fleet`);

    const indexRows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename LIKE 'Fleet%'
    `;
    const indexSet = new Set(indexRows.map((r) => r.indexname));
    const missingIdx = REQUIRED_INDEXES.filter((i) => !indexSet.has(i));
    if (missingIdx.length > 0) {
      fail(
        `índices Fleet ausentes: ${missingIdx.join(", ")}. Rode: npx prisma migrate deploy`
      );
    }
    console.warn(`[fleet-db-validate] OK índices essenciais`);

    const settings = await prisma.fleetSettings.findMany({ orderBy: { key: "asc" } });
    const keys = new Set(settings.map((s) => s.key));
    const missingSettings = EXPECTED_SETTINGS.filter((k) => !keys.has(k));
    if (missingSettings.length > 0) {
      fail(`FleetSettings sem chaves: ${missingSettings.join(", ")}`);
    }
    console.warn(`[fleet-db-validate] OK FleetSettings (${settings.length} registros)`);

    const counts = {
      fleetVehicle: await prisma.fleetVehicle.count(),
      fleetDriver: await prisma.fleetDriver.count(),
      fleetReservation: await prisma.fleetReservation.count(),
      fleetMaintenance: await prisma.fleetMaintenance.count(),
      fleetSettings: await prisma.fleetSettings.count(),
      fleetUsage: await prisma.fleetUsage.count(),
    };
    console.warn(`[fleet-db-validate] Contagens Prisma Client: ${JSON.stringify(counts)}`);
    console.warn("[fleet-db-validate] OK");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
