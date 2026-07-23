/**
 * KAN-LINK-03 — Auditoria read-only de vínculos operacionais PV↔OP↔DS↔NF.
 *
 * Uso:
 *   npm run audit:sales-order:operational-links -- --order="PD 02757"
 *   npm run audit:sales-order:operational-links -- --active --limit=100
 *   npm run audit:sales-order:operational-links -- --order="PD 02757" --json --markdown --output=tmp-audits/operational-links
 *
 * Não escreve no banco. Não chama Nomus.
 * Sem --output: só terminal (mesmo com --json/--markdown).
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  formatOperationalLinkageAuditMarkdown,
  parseSalesOrderOperationalLinkageAuditArgs,
  printSalesOrderOperationalLinkageAuditHelp,
  resolveOperationalLinkageAuditOutputFiles,
  resolveSalesOrderOperationalLinkageAuditExitCode,
  sanitizeSalesOrderTaxesDatabaseUrl,
  stringifyOperationalLinkageAuditReport,
  SALES_ORDER_OPERATIONAL_LINKAGE_AUDIT_LOG_PREFIX,
} from "../src/lib/sales/salesOrderOperationalLinkageAudit.js";
import { runSalesOrderOperationalLinkageAudit } from "../src/lib/sales/salesOrderOperationalLinkageAudit.server.js";

const LOG = SALES_ORDER_OPERATIONAL_LINKAGE_AUDIT_LOG_PREFIX;

function writeTextFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

async function main(): Promise<void> {
  let args;
  try {
    args = parseSalesOrderOperationalLinkageAuditArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof Error && error.message === "HELP") {
      console.log(printSalesOrderOperationalLinkageAuditHelp());
      process.exitCode = 0;
      return;
    }
    console.error(
      `${LOG} falha técnica nos argumentos: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    console.error(printSalesOrderOperationalLinkageAuditHelp());
    process.exitCode = 2;
    return;
  }

  const database = sanitizeSalesOrderTaxesDatabaseUrl(process.env.DATABASE_URL);
  if (!database) {
    console.error(`${LOG} falha técnica: DATABASE_URL ausente ou inválida.`);
    process.exitCode = 2;
    return;
  }

  console.warn(`${LOG} modo READ_ONLY`);
  console.warn(`${LOG} banco: ${database.display}`);
  console.warn(
    `${LOG} auditMode=${args.mode} order=${args.order ?? "—"} limit=${args.limit ?? "—"}`
  );

  const prisma = new PrismaClient();
  try {
    const report = await runSalesOrderOperationalLinkageAudit(prisma, args);
    const stamp = report.generatedAt.replace(/[:.]/g, "-");
    const outputs = resolveOperationalLinkageAuditOutputFiles({
      outputDir: args.outputDir,
      emitJson: args.emitJson,
      emitMarkdown: args.emitMarkdown,
      stamp,
    });

    console.log(`${LOG} ${report.summary}`);

    if (report.orderReport) {
      const o = report.orderReport;
      if (!o.orderFound) {
        console.log(`${LOG} pedido não encontrado`);
      } else {
        console.log(
          `${LOG} pedido=${o.orderCode} id=${o.salesOrderId} ext=${o.externalSalesOrderId ?? "—"} status=${o.status ?? "—"}`
        );
        console.log(
          `${LOG} calc=${o.calculatedStage ?? "—"} snap=${o.persistedStage ?? "—"} críticos=${o.criticalDivergenceCount}`
        );
        console.log(
          `${LOG} DS candidatos=${o.candidateDocuments.length} ligados=${o.linkedDocuments.length} NfeLink=${o.salesOrderNfeLinks.length} OP ligadas=${o.linkedProductionOrders.length}`
        );
        for (const obs of o.observations.slice(0, 40)) {
          console.log(`${LOG} · [${obs.kind}] ${obs.code}: ${obs.detail}`);
        }
        if (o.observations.length > 40) {
          console.log(`${LOG} … +${o.observations.length - 40} observações`);
        }
      }
    }

    if (report.mass) {
      console.log(
        `${LOG} massa: scanned=${report.mass.ordersScanned} críticos=${report.mass.criticalCount}`
      );
      for (const f of report.mass.findings.filter((x) => x.critical).slice(0, 40)) {
        console.log(`${LOG} · ${f.orderCode} [${f.kind}] ${f.detail}`);
      }
    }

    const jsonText = stringifyOperationalLinkageAuditReport(report);
    const mdText = formatOperationalLinkageAuditMarkdown(report);

    if (args.emitJson && !outputs.writeFiles) {
      console.log(jsonText);
    }
    if (args.emitMarkdown && !outputs.writeFiles) {
      console.log(mdText);
    }

    if (outputs.writeFiles) {
      if (outputs.jsonPath) {
        writeTextFile(resolve(outputs.jsonPath), jsonText);
        console.log(`${LOG} JSON: ${resolve(outputs.jsonPath)}`);
      }
      if (outputs.markdownPath) {
        writeTextFile(resolve(outputs.markdownPath), mdText);
        console.log(`${LOG} Markdown: ${resolve(outputs.markdownPath)}`);
      }
    }

    const critical =
      report.orderReport?.criticalDivergenceCount ??
      report.mass?.criticalCount ??
      0;
    process.exitCode = resolveSalesOrderOperationalLinkageAuditExitCode({
      criticalDivergenceCount: critical,
    });
  } catch (error) {
    console.error(
      `${LOG} falha técnica: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
