/**
 * Diagnóstico read-only de integridade — Gestão de Frota.
 *
 * Uso:
 *   npm run fleet:integrity:diagnostic
 *   npm run fleet:integrity:diagnostic -- --out=docs/generated/fleet-integrity-report.json
 *
 * Requer DATABASE_URL. Não altera dados.
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import {
  printFleetIntegritySummary,
  runFleetIntegrityDiagnostic,
} from "../src/lib/fleetIntegrityDiagnostic.js";

function parseOutPath(): string | null {
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--out=(.+)$/);
    if (m) return resolve(m[1].trim());
  }
  return null;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[fleet-integrity] SKIP: DATABASE_URL não definida.");
    process.exit(0);
  }

  const prisma = new PrismaClient();
  try {
    const report = await runFleetIntegrityDiagnostic(prisma);
    printFleetIntegritySummary(report);

    const json = JSON.stringify(report, null, 2);
    console.log("\n--- JSON ---");
    console.log(json);

    const outPath = parseOutPath();
    if (outPath) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, json, "utf8");
      console.log(`\n[fleet-integrity] Relatório salvo em ${outPath}`);
    }

    if (report.critical > 0) {
      process.exitCode = 2;
    } else if (report.totalIssues > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    (err instanceof Error && err.message.includes("Can't reach database server"))
  ) {
    console.error(
      "[fleet-integrity] Não foi possível conectar ao banco. Verifique DATABASE_URL e se o PostgreSQL está ativo."
    );
    process.exit(3);
  }
  console.error("[fleet-integrity] falha:", err);
  process.exit(1);
});
