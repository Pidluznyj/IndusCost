#!/usr/bin/env npx tsx
/**
 * T03 — Backfill seguro de tributos fiscais a partir de NomusNfe.xmlRaw.
 *
 * NÃO executar apply em produção sem dry-run revisado.
 *
 * Dry-run / preview:
 *   npx tsx scripts/nomus-nfe-fiscal-backfill.ts --dry-run
 *   npx tsx scripts/nomus-nfe-fiscal-backfill.ts --preview --limit=200 --out=tmp/nfe-fiscal
 *   npx tsx scripts/nomus-nfe-fiscal-backfill.ts --dry-run --order="PD 02457"
 *   npx tsx scripts/nomus-nfe-fiscal-backfill.ts --dry-run --from=2025-01-01 --to=2025-12-31
 *
 * Auditoria de inconsistências:
 *   npx tsx scripts/nomus-nfe-fiscal-backfill.ts --audit --out=tmp/nfe-fiscal-audit
 *
 * Apply (exige confirmação explícita):
 *   npx tsx scripts/nomus-nfe-fiscal-backfill.ts --apply --confirm-apply --limit=100
 *   npx tsx scripts/nomus-nfe-fiscal-backfill.ts --apply --confirm-apply --batch=50 --force
 *
 * Resume (continua após lastExternalId do arquivo):
 *   npx tsx scripts/nomus-nfe-fiscal-backfill.ts --apply --confirm-apply --resume=tmp/nfe-fiscal.resume.json --write-resume
 *
 * Rollback: DELETE NomusNfeFiscalSummary pelos IDs do relatório apply (TaxLine em cascade).
 * Não altera xmlRaw, pedido, CR ou comissão.
 */

import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import {
  emptyResumeState,
  mergeResumeProgress,
  parseNfeFiscalBackfillCli,
  rowsToCsv,
  type NfeFiscalBackfillResumeState,
  type NfeFiscalBackfillRowResult,
} from "../src/lib/nfeFiscalBackfill.ts";
import {
  applyNfeFiscalBackfill,
  auditNfeFiscalBackfill,
  previewNfeFiscalBackfill,
} from "../src/lib/nfeFiscalBackfill.server.ts";

function requireDatabaseUrl(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL ausente. Use .env de teste — não rode apply em produção.");
  }
}

function defaultOutBase(mode: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join("tmp", `nfe-fiscal-backfill-${mode}-${stamp}`);
}

function stripHeavyRows(rows: NfeFiscalBackfillRowResult[]) {
  return rows.map(({ parse: _parse, ...rest }) => rest);
}

function writeJson(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function loadResume(path: string): NfeFiscalBackfillResumeState {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as NfeFiscalBackfillResumeState;
  if (parsed?.version !== 1) {
    throw new Error(`Resume inválido: ${path}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  const cli = parseNfeFiscalBackfillCli(process.argv.slice(2));

  let afterExternalId = cli.afterExternalId;
  let resume = emptyResumeState();
  if (cli.resumeFile) {
    try {
      resume = loadResume(cli.resumeFile);
      if (afterExternalId == null && resume.lastExternalId != null) {
        afterExternalId = resume.lastExternalId;
      }
      console.warn(
        `[nfe-fiscal-backfill] resume loaded lastExternalId=${resume.lastExternalId} processed=${resume.processed}`
      );
    } catch (err) {
      if (cli.mode === "apply" && cli.writeResume) {
        console.warn(
          `[nfe-fiscal-backfill] resume file ausente — iniciando do zero (${err instanceof Error ? err.message : err})`
        );
      } else {
        throw err;
      }
    }
  }

  const filters = {
    limit: cli.limit,
    batchSize: cli.batchSize,
    force: cli.force,
    onlyMissing: cli.onlyMissing,
    includeCancelled: cli.includeCancelled,
    fromDate: cli.fromDate,
    toDate: cli.toDate,
    nfeNumber: cli.nfeNumber,
    externalId: cli.externalId,
    orderCode: cli.orderCode,
    customerQuery: cli.customerQuery,
    afterExternalId,
  };

  const outBase = cli.outBase || defaultOutBase(cli.mode);
  const jsonPath = outBase.endsWith(".json") ? outBase : `${outBase}.json`;
  const csvPath = jsonPath.replace(/\.json$/i, ".csv");
  const resumePath =
    cli.resumeFile ||
    (cli.writeResume ? jsonPath.replace(/\.json$/i, ".resume.json") : null);

  console.warn("=== Nomus NF-e fiscal backfill (T03) ===");
  console.warn(`Modo: ${cli.mode.toUpperCase()}`);
  console.warn(`Parser: ${resume.parserVersion}`);
  console.warn(`Filtros: ${JSON.stringify(filters)}`);

  if (cli.mode === "dry-run") {
    const report = await previewNfeFiscalBackfill(prisma, filters);
    const payload = {
      ...report,
      rows: stripHeavyRows(report.rows),
    };
    writeJson(jsonPath, payload);
    writeText(csvPath, rowsToCsv(report.rows));
    console.warn(`Relatório JSON: ${jsonPath}`);
    console.warn(`Relatório CSV:  ${csvPath}`);
    console.warn("Inventário:");
    console.warn(JSON.stringify(report.inventory, null, 2));
    console.warn(`Totais HEADER: ${JSON.stringify(report.taxTotalsHeader)}`);
    console.warn(
      `Residual>0: count=${report.residualCount} sum=${report.residualSum}`
    );
    console.warn(`Findings: ${report.findings.length}`);
    console.warn(`Pedidos afetados: ${report.affectedOrderCodes.length}`);
    console.warn("\nDry-run concluído. Nenhuma alteração no banco.");
    return;
  }

  if (cli.mode === "audit") {
    const report = await auditNfeFiscalBackfill(prisma, filters);
    const payload = {
      ...report,
      rows: stripHeavyRows(
        report.rows.filter(
          (r) =>
            r.watchOrderHit ||
            r.nfGreaterThanOrder ||
            r.taxesWithoutComposition ||
            r.multiOrder ||
            r.cancelledWithCr ||
            r.classes.includes("missing_xml")
        )
      ),
    };
    writeJson(jsonPath, payload);
    writeText(csvPath, rowsToCsv(report.rows));
    console.warn(`Auditoria JSON: ${jsonPath}`);
    console.warn(`Findings: ${report.findings.length}`);
    for (const f of report.findings.slice(0, 30)) {
      console.warn(`- [${f.severity}] ${f.code}: ${f.message} (ext=${f.externalId})`);
    }
    if (report.findings.length > 30) {
      console.warn(`... +${report.findings.length - 30} findings`);
    }
    return;
  }

  // APPLY
  const result = await applyNfeFiscalBackfill(prisma, filters);

  // Snapshot da DRE: summaries (re)persistidos mudam as deduções oficiais —
  // marca dirty pelas notas realmente alteradas (UUIDs do relatório do apply).
  // Soft-fail: falha de invalidação não derruba nem reverte o backfill.
  if (result.persistedNomusNfeIds.length > 0) {
    const { markFinanceDreSnapshotsDirtyForNfeIds } = await import(
      "../src/lib/financeDreSnapshot.server.ts"
    );
    await markFinanceDreSnapshotsDirtyForNfeIds(
      prisma,
      result.persistedNomusNfeIds,
      "nfe-fiscal-backfill"
    );
  }

  writeJson(jsonPath, result);
  writeText(
    csvPath,
    [
      "nomusNfeId",
      ...result.persistedNomusNfeIds.map((id) => `"${id}"`),
    ].join("\n") + "\n"
  );
  console.warn(`Apply JSON: ${jsonPath}`);
  console.warn(
    JSON.stringify(
      {
        attempted: result.attempted,
        persisted: result.persisted,
        skipped: result.skipped,
        errors: result.errors,
        lastExternalId: result.lastExternalId,
      },
      null,
      2
    )
  );
  if (result.errorSamples.length) {
    console.warn("Erros (amostra):");
    console.warn(JSON.stringify(result.errorSamples, null, 2));
  }

  if (resumePath) {
    const next = mergeResumeProgress(resume, {
      lastExternalId: result.lastExternalId,
      processed: result.attempted,
      persisted: result.persisted,
      skipped: result.skipped,
      errors: result.errors,
    });
    writeJson(resumePath, next);
    console.warn(`Resume salvo: ${resumePath}`);
  }

  console.warn("\nRollback:", result.rollback);
  if (result.errors > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
