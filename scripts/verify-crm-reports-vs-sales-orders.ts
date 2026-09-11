/**
 * Verificador de reconciliação: CRM > Relatórios × Pedidos de Venda (oficial).
 *
 * SOMENTE LEITURA. Não escreve, não migra, não cria cache — só consulta e
 * imprime a conferência. Feito para rodar em homologação antes de liberar a
 * aba CRM > Relatórios. A lógica mora em
 * `src/lib/commercial/crmReportsVerification.server.ts` (testada com
 * fixtures); aqui só CLI e impressão.
 *
 * Uso:
 *   npx tsx scripts/verify-crm-reports-vs-sales-orders.ts
 *   npx tsx scripts/verify-crm-reports-vs-sales-orders.ts --customer=<uuid>[,<uuid>…]
 *   npx tsx scripts/verify-crm-reports-vs-sales-orders.ts --today=2026-09-11
 *   npx tsx scripts/verify-crm-reports-vs-sales-orders.ts --max-rows=100
 *   npx tsx scripts/verify-crm-reports-vs-sales-orders.ts --json
 *
 * Lado oficial: `buildSalesOrderListWhere(…, { excludeEconomicGroupCustomers: true })`
 * agregado no banco. Lado relatório: `runCrmReportsAnalysis` (pipeline do
 * endpoint). Critérios por cliente: quantidade delta 0 · dinheiro delta
 * R$ 0,00 · data igual — para pedidos 60d, valor 60d, última compra,
 * pedidos 12m e valor 12m. Sai com código 1 se divergir.
 */

import type { PrismaClient } from "@prisma/client";
import { isValidBusinessDate } from "../src/lib/commercial/crmRepurchaseEngine.ts";
import {
  verifyCrmReportsAgainstSalesOrders,
  type CrmReportsVerificationRow,
} from "../src/lib/commercial/crmReportsVerification.server.ts";
import { openReadOnlyAuditPrisma } from "../src/lib/commercial/crmReportsReadOnlyPrisma.server.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sessão somente leitura garantida pelo banco (aberta em main()).
let prisma: PrismaClient;

function parseArgs(argv: string[]): {
  json: boolean;
  customerIds: string[];
  today: string | null;
  maxRows: number;
} {
  const json = argv.includes("--json");
  const get = (name: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const customerIds = (get("customer") ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  for (const id of customerIds) {
    if (!UUID_RE.test(id)) throw new Error(`--customer inválido (esperado UUID): ${id}`);
  }
  const today = get("today");
  if (today != null && !isValidBusinessDate(today)) {
    throw new Error(`--today inválido (esperado YYYY-MM-DD): ${today}`);
  }
  const maxRowsRaw = Number(get("max-rows") ?? "200");
  const maxRows = Number.isInteger(maxRowsRaw) && maxRowsRaw > 0 ? maxRowsRaw : 200;
  return { json, customerIds: [...new Set(customerIds)], today, maxRows };
}

/** `--today` vira meio-dia local desse dia (o relatório trabalha em dia civil). */
function referenceNow(today: string | null): Date {
  if (!today) return new Date();
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function formatCell(row: CrmReportsVerificationRow, value: number | string | null): string {
  if (value == null) return "—";
  if (row.kind === "money" && typeof value === "number") return money(value);
  return String(value);
}

function printTable(header: string[], body: string[][]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((line) => (line[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const cells of body) console.log(line(cells));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  ({ prisma } = await openReadOnlyAuditPrisma());
  const result = await verifyCrmReportsAgainstSalesOrders(prisma, {
    now: referenceNow(args.today),
    customerIds: args.customerIds,
  });
  const { summary, totals, rows, divergences, warnings } = result;
  const byCustomer = args.customerIds.length > 0;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          summary,
          totals,
          divergences: divergences.slice(0, args.maxRows),
          rows: byCustomer ? rows : undefined,
          inactiveOutsideUniverse: result.inactiveOutsideUniverse,
          warnings,
        },
        null,
        2
      )
    );
  } else {
    const w = summary.windows;
    console.log(`CRM > Relatórios × Pedidos de Venda — hoje ${w.today}`);
    console.log(`Janelas: 60d ${w.recent60d.from}…${w.recent60d.to} · 12m ${w.rolling12m.from}…${w.rolling12m.to}`);
    console.log(`Clientes comparados: ${summary.customersCompared} · comparações: ${summary.comparisons}\n`);
    printTable(
      ["indicador", "PV", "Relatório", "delta", "status"],
      totals.map((t) => [
        t.indicator,
        t.kind === "money" ? money(t.pv) : String(t.pv),
        t.kind === "money" ? money(t.crm) : String(t.crm),
        t.kind === "money" ? money(t.delta) : String(t.delta),
        t.status,
      ])
    );
    const detail = byCustomer ? rows : divergences.slice(0, args.maxRows);
    if (detail.length > 0) {
      console.log(byCustomer ? "\nDetalhe por cliente:" : "\nDivergências por cliente:");
      printTable(
        ["cliente", "indicador", "PV", "Relatório", "delta", "status"],
        detail.map((r) => [
          `${r.customerName} (${r.customerId.slice(0, 8)})`,
          r.indicator,
          formatCell(r, r.pv),
          formatCell(r, r.crm),
          r.kind === "money" && typeof r.delta === "number" ? money(r.delta) : String(r.delta),
          r.status,
        ])
      );
      if (!byCustomer && divergences.length > detail.length) {
        console.log(`… mais ${divergences.length - detail.length} divergência(s) (use --max-rows= ou --json).`);
      }
    }
    for (const warning of warnings) console.log(`\nAVISO: ${warning}`);
  }

  if (!summary.approved) {
    console.log(
      `\n${summary.divergentComparisons} comparação(ões) e ${summary.divergentTotals} total(is) DIVERGENTE(S) — reconciliação NÃO aprovada.`
    );
    process.exitCode = 1;
    return;
  }
  console.log("\nTodos os indicadores reconciliam (delta zero, datas iguais). Reconciliação aprovada.");
}

main()
  .catch((error) => {
    console.error("Falha no verificador:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma?.$disconnect();
  });
