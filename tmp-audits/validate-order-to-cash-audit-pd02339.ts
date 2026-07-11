/**
 * Validação OrderToCashAudit — PD 02339.
 *
 * Uso:
 *   npx tsx tmp-audits/validate-order-to-cash-audit-pd02339.ts
 *
 * Pré-requisito: apply com --orderCode "PD 02339".
 * Read-only — não altera tabelas oficiais.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const ORDER_CODE = "PD 02339";
const MAX_ATTRIBUTED = 158_000;
const MONEY_TOL = 0.05;

const prisma = new PrismaClient();

type Check = { name: string; pass: boolean; detail: string };

function dec(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : 0;
}

function ok(name: string, pass: boolean, detail: string): Check {
  return { name, pass, detail };
}

async function main(): Promise<void> {
  const checks: Check[] = [];

  const fact = await prisma.orderToCashAuditFact.findFirst({
    where: {
      orderCode: ORDER_CODE,
      run: { status: "SUCCESS" },
    },
    orderBy: { createdAt: "desc" },
    select: { runId: true },
  });

  if (!fact) {
    console.log("FAIL — nenhuma run SUCCESS com PD 02339 encontrada.");
    console.log("Rode: npx tsx scripts/rebuildOrderToCashAudit.ts --mode apply --orderCode \"PD 02339\"");
    process.exitCode = 1;
    return;
  }

  const runId = fact.runId;
  const run = await prisma.orderToCashAuditRun.findUnique({ where: { id: runId } });
  const rows = await prisma.orderToCashAuditFact.findMany({
    where: { runId, orderCode: ORDER_CODE },
    orderBy: { createdAt: "asc" },
  });

  console.log(`=== validate OrderToCashAudit ${ORDER_CODE} ===`);
  console.log(`runId: ${runId}`);
  console.log(`run.status: ${run?.status}`);
  console.log(`facts: ${rows.length}`);

  checks.push(ok("pedido encontrado", rows.length > 0, `rows=${rows.length}`));

  const itemIds = new Set(
    rows.map((r) => r.salesOrderItemId).filter((id): id is string => Boolean(id))
  );
  checks.push(
    ok("itens encontrados", itemIds.size > 0, `distinct salesOrderItemId=${itemIds.size}`)
  );

  const sellerOk = rows.every(
    (r) =>
      r.sellerSource === "SALES_ORDER" ||
      r.sellerQualityStatus === "NO_SELLER" ||
      (r.sellerName != null && r.sellerName.length > 0)
  );
  checks.push(
    ok(
      "vendedor vem do pedido",
      sellerOk,
      `sellerName=${rows[0]?.sellerName ?? "—"} source=${rows[0]?.sellerSource ?? "—"} quality=${rows[0]?.sellerQualityStatus ?? "—"}`
    )
  );

  const hasPaymentCondition = rows.some(
    (r) =>
      (r.paymentConditionName != null && r.paymentConditionName.trim() !== "") ||
      r.plannedPaymentStatus === "MISSING_PAYMENT_CONDITION"
  );
  checks.push(
    ok(
      "condição de pagamento aparece se existir (ou MISSING)",
      hasPaymentCondition,
      `plannedPaymentStatus=${rows[0]?.plannedPaymentStatus ?? "—"} name=${rows[0]?.paymentConditionName ?? "—"}`
    )
  );

  const hasNfe = rows.some((r) => r.nfeExternalId != null || r.nfeNumber != null);
  checks.push(ok("NFs aparecem (se houver vínculo)", true, hasNfe ? "NF presente" : "sem NF neste pedido — aceito se não houver vínculo"));

  const hasDoc = rows.some((r) => r.stockDocumentId != null);
  checks.push(
    ok(
      "documentos de saída aparecem (se houver)",
      true,
      hasDoc ? "documento presente" : "sem documento — aceito se pedido pending"
    )
  );

  const hasDocItem = rows.some((r) => r.stockDocumentItemId != null);
  checks.push(
    ok(
      "itens dos documentos aparecem (se houver doc)",
      !hasDoc || hasDocItem,
      hasDocItem ? "item de documento presente" : hasDoc ? "doc sem item" : "n/a"
    )
  );

  const attributed = rows
    .filter((r) => r.lineType === "ORDER_ITEM_ALLOCATED")
    .reduce((s, r) => s + dec(r.allocatedValueByOrderPrice), 0);
  checks.push(
    ok(
      "valor atribuído não passa de R$ 158.000,00",
      attributed <= MAX_ATTRIBUTED + MONEY_TOL,
      `attributed=${attributed.toFixed(2)}`
    )
  );

  const orderNet = Math.max(...rows.map((r) => dec(r.orderNetValue)), 0);
  const headerInflates = rows.some(
    (r) =>
      r.hasNfeHeaderGreaterThanOrder &&
      dec(r.allocatedValueByOrderPrice) > orderNet + MONEY_TOL
  );
  checks.push(
    ok(
      "cabeçalho de NF não infla pedido",
      orderNet === 0 ||
        (!headerInflates && attributed <= orderNet + MONEY_TOL + 0.01),
      `orderNet=${orderNet} attributed=${attributed} headerGreaterFlag=${rows.some((r) => r.hasNfeHeaderGreaterThanOrder)}`
    )
  );

  const hasCr = rows.some((r) => (r.receivableCount ?? 0) > 0 || dec(r.receivableTotalValue) > 0);
  checks.push(
    ok(
      "CR aparece se existir",
      true,
      hasCr ? `receivableTotal=${rows.find((r) => dec(r.receivableTotalValue) > 0)?.receivableTotalValue}` : "sem CR seguro — ok"
    )
  );

  checks.push(
    ok(
      "paymentStatus aparece",
      rows.every((r) => r.paymentStatus != null && String(r.paymentStatus).length > 0),
      `sample=${rows[0]?.paymentStatus ?? "—"}`
    )
  );

  checks.push(
    ok(
      "orderToCashStage aparece",
      rows.every((r) => r.orderToCashStage != null && String(r.orderToCashStage).length > 0),
      `sample=${rows[0]?.orderToCashStage ?? "—"}`
    )
  );

  const hasAlertsField = rows.every((r) => Array.isArray(r.alertsJson) || r.alertsJson == null);
  checks.push(ok("alertas aparecem (campo alertsJson)", hasAlertsField, "alertsJson presente"));

  const rebuildSrc = readFileSync(
    join(process.cwd(), "scripts/rebuildOrderToCashAudit.ts"),
    "utf8"
  );
  const builderSrc = readFileSync(
    join(process.cwd(), "src/lib/sales/orderToCashAuditBuilder.ts"),
    "utf8"
  );
  checks.push(
    ok(
      "proposta não foi usada",
      !/from ["'].*proposal/i.test(rebuildSrc) && !/from ["'].*proposal/i.test(builderSrc),
      "sem import de proposal"
    )
  );
  checks.push(
    ok(
      "comissão não foi usada",
      !/from ["'].*commission/i.test(rebuildSrc) && !/from ["'].*commission/i.test(builderSrc),
      "sem import de commission"
    )
  );

  console.log("\nChecks:");
  let failed = 0;
  for (const c of checks) {
    const mark = c.pass ? "PASS" : "FAIL";
    if (!c.pass) failed += 1;
    console.log(`  [${mark}] ${c.name} — ${c.detail}`);
  }

  console.log("\nAmostra de linhas:");
  for (const row of rows.slice(0, 8)) {
    console.log(
      `  - ${row.lineType} | item=${row.salesOrderItemId ?? "—"} | alloc=${row.allocatedValueByOrderPrice} | stage=${row.orderToCashStage} | pay=${row.paymentStatus}`
    );
  }

  if (failed > 0) {
    console.log(`\nFAIL (${failed} checks)`);
    process.exitCode = 1;
  } else {
    console.log("\nPASS");
  }
}

main()
  .catch((error) => {
    console.error("FAIL — erro na validação", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
