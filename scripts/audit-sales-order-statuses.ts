/**
 * Auditoria read-only dos status reais em SalesOrder e nomusRawResponse.
 *
 * Uso local (requer DATABASE_URL):
 *   npm run audit:sales-order-statuses
 *   npx tsx scripts/audit-sales-order-statuses.ts
 *
 * Se não houver banco local, execute no servidor de produção/staging.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  extractNomusProductionOrders,
  extractNomusRawItems,
  extractNomusRawNfes,
  extractSalesOrderItemRawField,
  extractSalesOrderRawField,
} from "../src/lib/salesOrderNomusRaw.ts";
import { extractNomusHeaderStatusRaw } from "../src/lib/salesOrderStatusAudit.ts";

const prisma = new PrismaClient();

const HEADER_STATUS_KEYS = [
  "status",
  "situacao",
  "descricaoStatus",
  "situacaoPedido",
  "statusPedido",
] as const;

const ITEM_STATUS_KEYS = [
  "status",
  "situacao",
  "situacaoItem",
  "situacaoItemPedido",
  "descricaoStatus",
] as const;

function inc(map: Map<string, number>, key: string, delta = 1): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function labelValue(value: unknown): string {
  if (value == null || value === "") return "(vazio)";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 80);
  return String(value);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectStatusFieldPaths(raw: unknown, prefix: string, out: Set<string>): void {
  const root = asObject(raw);
  if (!root) return;
  for (const key of Object.keys(root)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("status") ||
      lower.includes("situacao") ||
      lower.includes("situacaoitem")
    ) {
      out.add(`${prefix}.${key}`);
    }
    const val = root[key];
    if (Array.isArray(val)) {
      val.slice(0, 3).forEach((entry, i) => {
        collectStatusFieldPaths(entry, `${prefix}.${key}[${i}]`, out);
      });
    } else if (val && typeof val === "object") {
      collectStatusFieldPaths(val, `${prefix}.${key}`, out);
    }
  }
}

function printMap(title: string, map: Map<string, number>): void {
  console.log(`\n${title}`);
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    console.log("  (nenhum)");
    return;
  }
  for (const [key, count] of entries) {
    console.log(`  - ${key}: ${count}`);
  }
}

async function main(): Promise<void> {
  console.log("=== IndusCost — Auditoria de status de pedidos de venda ===\n");

  let orders: Array<{
    id: string;
    status: string;
    nomusRawResponse: unknown;
  }>;

  try {
    orders = await prisma.salesOrder.findMany({
      select: { id: true, status: true, nomusRawResponse: true },
    });
  } catch (error) {
    console.error("Falha ao conectar ao banco. Execute este script no servidor com DATABASE_URL.");
    console.error(error);
    process.exit(1);
  }

  console.log(`Pedidos analisados: ${orders.length}`);

  const headerDbStatus = new Map<string, number>();
  const headerNomusStatus = new Map<string, number>();
  const itemNumericStatus = new Map<string, number>();
  const itemTextStatus = new Map<string, number>();
  const statusFieldPaths = new Set<string>();
  let withNfes = 0;
  let withProcessingDate = 0;
  let withoutNf = 0;
  let withOp = 0;

  for (const order of orders) {
    inc(headerDbStatus, order.status);

    const raw = order.nomusRawResponse;
    const headerRaw = extractNomusHeaderStatusRaw(raw);
    inc(headerNomusStatus, labelValue(headerRaw));

    for (const key of HEADER_STATUS_KEYS) {
      const root = asObject(raw);
      if (root && key in root) {
        statusFieldPaths.add(`nomusRawResponse.${key}`);
      }
    }

    collectStatusFieldPaths(raw, "nomusRawResponse", statusFieldPaths);

    const items = extractNomusRawItems(raw);
    for (const item of items) {
      const status = item.status ?? extractSalesOrderItemRawField(item.raw, "status");
      if (typeof status === "number" || (typeof status === "string" && /^\d+$/.test(status))) {
        inc(itemNumericStatus, String(status));
      } else {
        inc(itemTextStatus, labelValue(status));
      }
      for (const key of ITEM_STATUS_KEYS) {
        if (key in item.raw) statusFieldPaths.add(`itensPedido[].${key}`);
      }
    }

    const nfes = extractNomusRawNfes(raw);
    if (nfes.length > 0) {
      withNfes += 1;
      if (nfes.some((n) => n.dataProcessamento)) withProcessingDate += 1;
    } else {
      withoutNf += 1;
    }

    if (extractNomusProductionOrders(raw).length > 0) {
      withOp += 1;
    }
  }

  printMap("Status de cabeçalho (SalesOrder.status):", headerDbStatus);
  printMap("Status de cabeçalho no nomusRawResponse:", headerNomusStatus);
  printMap("Status numéricos de itens Nomus encontrados:", itemNumericStatus);
  printMap("Status textuais de itens encontrados:", itemTextStatus);

  console.log("\nPedidos com NF:");
  console.log(`  - com nfes[]: ${withNfes}`);
  console.log(`  - com dataProcessamento: ${withProcessingDate}`);
  console.log(`  - sem NF no raw: ${withoutNf}`);
  console.log(`  - com OP no raw: ${withOp}`);

  console.log("\nCampos de status encontrados no raw (amostra):");
  const paths = [...statusFieldPaths].sort().slice(0, 40);
  for (const p of paths) {
    console.log(`  - ${p}`);
  }
  if (statusFieldPaths.size > paths.length) {
    console.log(`  ... e mais ${statusFieldPaths.size - paths.length} caminhos`);
  }

  const aliasStatus = orders.filter((o) => extractSalesOrderRawField(o.nomusRawResponse, "status"));
  console.log(`\nPedidos com extractSalesOrderRawField(status): ${aliasStatus.length}`);

  console.log("\n=== Fim da auditoria ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
