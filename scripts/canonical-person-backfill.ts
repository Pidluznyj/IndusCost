#!/usr/bin/env npx tsx
/**
 * Diagnóstico e backfill seguro Person ↔ papéis.
 *
 * NÃO executar apply em produção sem revisão humana do dry-run.
 *
 * Dry-run (obrigatório por padrão — grava relatório, não altera banco):
 *   npx tsx scripts/canonical-person-backfill.ts --dry-run
 *   npx tsx scripts/canonical-person-backfill.ts --dry-run --out tmp/person-backfill
 *   npx tsx scripts/canonical-person-backfill.ts --dry-run --limit 500
 *
 * Apply (só unequivocos; explícito):
 *   npx tsx scripts/canonical-person-backfill.ts --apply --confirm-apply
 *   npx tsx scripts/canonical-person-backfill.ts --apply --confirm-apply --limit 100
 *
 * Rollback documentado: personId é nullable; reverter = SET personId = NULL
 * nos IDs listados em linkedIds do JSON de apply (nunca apaga Person/papéis).
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import {
  applyCanonicalPersonBackfill,
  scanCanonicalPersonBackfill,
} from "../src/lib/canonicalPersonBackfill.server.ts";
import {
  BACKFILL_CSV_HEADER,
  candidateToSafeCsvRow,
  filterApplyCandidates,
  type BackfillEntityKind,
} from "../src/lib/canonicalPersonBackfill.ts";

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

function requireDatabaseUrl(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL ausente. Use .env de teste — não rodar apply em produção.");
  }
}

function parseKinds(): BackfillEntityKind[] | undefined {
  const raw = parseArg("kinds");
  if (!raw) return undefined;
  return raw.split(",").map((s) => s.trim()) as BackfillEntityKind[];
}

function writeReports(basePath: string, payload: unknown, candidatesCsv: string): void {
  const jsonPath = basePath.endsWith(".json") ? basePath : `${basePath}.json`;
  const csvPath = jsonPath.replace(/\.json$/i, ".csv");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  writeFileSync(csvPath, candidatesCsv, "utf8");
  console.log(`Relatório JSON: ${jsonPath}`);
  console.log(`Relatório CSV:  ${csvPath}`);
}

function toCsv(candidates: Parameters<typeof candidateToSafeCsvRow>[0][]): string {
  const lines = [
    BACKFILL_CSV_HEADER.join(","),
    ...candidates.map((c) =>
      candidateToSafeCsvRow(c)
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(",")
    ),
  ];
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  requireDatabaseUrl();

  const wantApply = hasFlag("apply");
  const wantDryRun = hasFlag("dry-run") || hasFlag("preview") || !wantApply;

  if (wantApply && wantDryRun && hasFlag("dry-run")) {
    throw new Error("Use apenas --dry-run ou --apply.");
  }
  if (wantApply && !hasFlag("confirm-apply")) {
    throw new Error(
      "Apply exige --confirm-apply após revisar o dry-run. Não use em produção sem aprovação."
    );
  }

  const limit = Number(parseArg("limit") || "2000");
  const kinds = parseKinds();
  const outBase =
    parseArg("out") ||
    join("tmp", `person-backfill-${new Date().toISOString().replace(/[:.]/g, "-")}`);

  console.log("=== Canonical Person backfill ===");
  console.log(`Modo: ${wantApply ? "APPLY" : "DRY-RUN"}`);
  console.log("Riscos: apply só seta personId; não funde/apaga. Unique Employee/AppUser pode falhar.");

  if (!wantApply) {
    const report = await scanCanonicalPersonBackfill(prisma, {
      limitPerKind: limit,
      kinds,
    });
    const applyReady = filterApplyCandidates(report.candidates);
    const payload = {
      ...report,
      applyReadyCount: applyReady.length,
      risks: [
        "Não executar apply em produção sem revisão.",
        "Nome e telefone nunca auto-link.",
        "Contatos de cliente ficam só no relatório.",
        "CPF completo nunca é escrito nos artefatos — só máscara.",
      ],
      rollback:
        "Para desfazer apply: UPDATE ... SET personId = NULL WHERE id IN (linkedIds). Person e papéis permanecem.",
    };
    writeReports(outBase, payload, toCsv(report.candidates));
    console.log("\nResumo por categoria:");
    console.log(JSON.stringify(report.summary.byCategory, null, 2));
    console.log(`Prontos para apply (unequivocal): ${applyReady.length}`);
    console.log("\nDry-run concluído. Nenhuma alteração no banco.");
    return;
  }

  // Apply: dry-run embutido no applyCanonicalPersonBackfill
  const result = await applyCanonicalPersonBackfill(prisma, {
    limitPerKind: limit,
    kinds,
    batchSize: Number(parseArg("batch") || "50"),
  });
  writeReports(`${outBase}-apply`, result, toCsv([]));
  console.log("\nResultado apply:");
  console.log(JSON.stringify(result, null, 2));
  console.log(
    "\nRollback: SET personId = NULL nos entityIds de linkedIds. Não apaga Person."
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
