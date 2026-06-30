#!/usr/bin/env npx tsx
/**
 * Auditoria read-only da semântica de SalesOrderItem.unitCost vs custo de produção.
 *
 * Uso:
 *   npx tsx scripts/audit-sales-order-cost-semantics.ts
 */
import "dotenv/config";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  BLOCKING_UNIT_COST_AS_PRODUCTION_PATTERNS,
  COST_SEMANTICS_AUDIT_ALLOWLIST,
  SALES_ORDER_ITEM_UNIT_COST_IS_SALE_PRICE,
  SALES_ORDER_PRODUCTION_COST_SOURCE_NOTE,
  classifyUnitCostFieldUsage,
  type SalesOrderCostSemanticsFinding,
} from "../src/lib/salesOrderCostSemantics.ts";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "scripts"];
const EXT = new Set([".ts", ".tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walk(full, out);
    } else if (EXT.has(entry.slice(entry.lastIndexOf(".")))) {
      out.push(full);
    }
  }
  return out;
}

function auditFile(relPath: string, content: string): SalesOrderCostSemanticsFinding[] {
  if (COST_SEMANTICS_AUDIT_ALLOWLIST.has(relPath.replace(/\\/g, "/"))) return [];

  const findings: SalesOrderCostSemanticsFinding[] = [];
  const lines = content.split(/\r?\n/);

  for (const rule of BLOCKING_UNIT_COST_AS_PRODUCTION_PATTERNS) {
    if (rule.pattern.test(content)) {
      const idx = lines.findIndex((line) => rule.pattern.test(line) || rule.pattern.test(content.slice(0, 5000)));
      findings.push({
        file: relPath,
        line: idx >= 0 ? idx + 1 : 1,
        snippet: (lines[idx >= 0 ? idx : 0] ?? "").trim().slice(0, 160),
        usage: rule.usage,
        classification: "CUSTO_PRODUÇÃO",
        status: relPath.includes(".test.") ? "ALERTA" : "BLOQUEANTE",
      });
    }
  }

  lines.forEach((line, i) => {
    if (!/\bunitCost\b/i.test(line)) return;
    if (findings.some((f) => f.line === i + 1 && f.file === relPath)) return;

    const classification = classifyUnitCostFieldUsage(line);
    let status: SalesOrderCostSemanticsFinding["status"] = "OK";
    if (
      /custo congelado|frozen.*unitCost|useFrozenUnitCostFirst|SALES_ORDER_ITEM_SNAPSHOT.*custo|preserv.*unitCost.*custo|buildPreservationMapFromExistingItems|resolveSalesOrderItemUnitCostSnapshot/i.test(
        line
      ) &&
      !relPath.includes("SimulationModule") &&
      !relPath.includes("projects/")
    ) {
      status = "BLOQUEANTE";
    } else if (classification === "AMBIGUO") {
      status = "ALERTA";
    }

    findings.push({
      file: relPath,
      line: i + 1,
      snippet: line.trim().slice(0, 160),
      usage: "Referência a unitCost",
      classification,
      status,
    });
  });

  return findings;
}

async function main(): Promise<void> {
  const files = SCAN_DIRS.flatMap((dir) => walk(join(ROOT, dir)));
  const allFindings: SalesOrderCostSemanticsFinding[] = [];

  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const content = readFileSync(file, "utf8");
    allFindings.push(...auditFile(rel, content));
  }

  const blocking = allFindings.filter((f) => f.status === "BLOQUEANTE");
  const alerts = allFindings.filter((f) => f.status === "ALERTA");
  const ok = allFindings.filter((f) => f.status === "OK");

  const marginResolver = readFileSync("src/lib/salesOrderMarginResolver.ts", "utf8");
  const marginUsesEngine =
    /getProductCostAnalysis|LIVE_PRODUCT_COST|resolveOfficialProductFinalCostFromAnalysis/.test(
      marginResolver
    ) && !/useFrozenUnitCostFirst && storedSnapshot/.test(marginResolver);

  console.log(
    JSON.stringify(
      {
        policy: {
          salePriceField: SALES_ORDER_ITEM_UNIT_COST_IS_SALE_PRICE,
          productionCost: SALES_ORDER_PRODUCTION_COST_SOURCE_NOTE,
        },
        summary: {
          filesScanned: files.length,
          findingsTotal: allFindings.length,
          blocking: blocking.length,
          alerts: alerts.length,
          ok: ok.length,
          marginUsesIndusCostEngine: marginUsesEngine,
          unitCostExcludedFromMarginCost: !/storedUnitCost: item\.unitCost/.test(marginResolver),
        },
        blocking: blocking.slice(0, 100),
        alertsSample: alerts.slice(0, 50),
        marginEngineCheck: {
          usesGetProductCostAnalysis: marginUsesEngine,
          ignoresSalesOrderItemUnitCostAsProductionCost: !marginResolver.includes(
            "Custo unitário congelado de SalesOrderItem.unitCost"
          ),
        },
      },
      null,
      2
    )
  );

  if (blocking.some((f) => !f.file.includes(".test."))) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[audit-sales-order-cost-semantics]", err);
  process.exitCode = 1;
});
