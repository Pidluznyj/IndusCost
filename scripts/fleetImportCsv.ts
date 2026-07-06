/**
 * Importação CSV de frota via linha de comando.
 *
 * Uso:
 *   npx tsx scripts/fleetImportCsv.ts vehicles preview --file=./veiculos.csv
 *   npx tsx scripts/fleetImportCsv.ts vehicles apply --file=./veiculos.csv --confirm="APLICAR_IMPORTACAO_FROTA"
 *   npx tsx scripts/fleetImportCsv.ts drivers preview --file=./motoristas.csv
 *   npx tsx scripts/fleetImportCsv.ts drivers apply --file=./motoristas.csv --confirm="APLICAR_IMPORTACAO_FROTA" [--allow-update]
 */
import "dotenv/config";
import fs from "fs";
import {
  FLEET_IMPORT_CONFIRM_TOKEN,
  applyDriverCsvImport,
  applyVehicleCsvImport,
  previewDriverCsvImport,
  previewVehicleCsvImport,
} from "../src/lib/fleetCsvImport.ts";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[fleet-import] DATABASE_URL não definida.");
    process.exit(1);
  }

  const entity = process.argv[2];
  const mode = process.argv[3];
  if (!entity || !["vehicles", "drivers"].includes(entity)) {
    console.error("Uso: fleetImportCsv.ts <vehicles|drivers> <preview|apply> --file=... [--confirm=...]");
    process.exit(1);
  }
  if (!mode || !["preview", "apply"].includes(mode)) {
    console.error("Modo deve ser preview ou apply.");
    process.exit(1);
  }

  const file = arg("file");
  if (!file) {
    console.error("--file= caminho do CSV é obrigatório.");
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`Arquivo não encontrado: ${file}`);
    process.exit(1);
  }

  const csv = fs.readFileSync(file, "utf8");
  const allowUpdate = hasFlag("allow-update");

  if (mode === "apply") {
    const confirm = arg("confirm");
    if (confirm !== FLEET_IMPORT_CONFIRM_TOKEN) {
      console.error(`Apply exige --confirm="${FLEET_IMPORT_CONFIRM_TOKEN}"`);
      process.exit(1);
    }
  }

  const result =
    entity === "vehicles"
      ? mode === "preview"
        ? await previewVehicleCsvImport(csv, { allowUpdate })
        : await applyVehicleCsvImport(csv, { allowUpdate })
      : mode === "preview"
        ? await previewDriverCsvImport(csv, { allowUpdate })
        : await applyDriverCsvImport(csv, { allowUpdate });

  if ("error" in result) {
    console.error("[fleet-import]", result.error);
    process.exit(1);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error("[fleet-import]", e);
  process.exit(1);
});
