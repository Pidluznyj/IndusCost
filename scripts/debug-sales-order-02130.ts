/**
 * Diagnóstico read-only do pedido PD 02130 (ou código informado).
 *
 * Uso:
 *   npx tsx scripts/debug-sales-order-02130.ts
 *   npx tsx scripts/debug-sales-order-02130.ts --code=02130
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  extractNomusRawItems,
  extractSalesOrderItemRawField,
  matchRawItemToDbItem,
  normalizeSalesOrderItemNomusStatus,
} from "../src/lib/salesOrderNomusRaw.ts";
import { buildSalesOrderLifecycleSummary } from "../src/lib/salesOrderLifecycleStatus.ts";
import { buildManagementRowsFromOrders } from "../src/lib/salesOrderManagement.ts";

const prisma = new PrismaClient();

const SEARCH_TERMS = [
  "Cancelado",
  "cancelado",
  "descricaoStatus",
  "situacaoItem",
  "status",
  "itensPedido",
  "quantidadeCancelada",
  "item",
  "00010",
  "630.01AA",
] as const;

function parseCode(): string {
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--code=(.+)$/);
    if (m) return m[1].trim();
  }
  return "02130";
}

function jsonReplacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function collectKeys(obj: unknown, depth = 0, maxDepth = 4): string[] {
  if (depth > maxDepth || obj == null) return [];
  if (Array.isArray(obj)) {
    return obj.flatMap((v) => collectKeys(v, depth + 1, maxDepth));
  }
  if (typeof obj !== "object") return [];
  const keys = Object.keys(obj as Record<string, unknown>);
  const nested = keys.flatMap((k) =>
    collectKeys((obj as Record<string, unknown>)[k], depth + 1, maxDepth)
  );
  return [...new Set([...keys, ...nested])];
}

function findSearchHits(obj: unknown, path = "$"): Array<{ path: string; value: string }> {
  const hits: Array<{ path: string; value: string }> = [];
  if (obj == null) return hits;
  if (typeof obj === "string" || typeof obj === "number") {
    const text = String(obj);
    for (const term of SEARCH_TERMS) {
      if (text.toLowerCase().includes(term.toLowerCase())) {
        hits.push({ path, value: text });
      }
    }
    return hits;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => hits.push(...findSearchHits(v, `${path}[${i}]`)));
    return hits;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (SEARCH_TERMS.some((t) => k.toLowerCase().includes(t.toLowerCase()))) {
        hits.push({ path: `${path}.${k}`, value: JSON.stringify(v) });
      }
      hits.push(...findSearchHits(v, `${path}.${k}`));
    }
  }
  return hits;
}

async function main(): Promise<void> {
  const code = parseCode();
  console.warn(`[debug-sales-order] Buscando pedido contendo: ${code}`);

  const orders = await prisma.salesOrder.findMany({
    where: {
      OR: [
        { orderCode: { contains: code, mode: "insensitive" } },
        { externalSalesOrderCode: { contains: code, mode: "insensitive" } },
      ],
    },
    include: {
      items: true,
      Customer: { select: { companyName: true, tradeName: true, taxId: true } },
    },
    take: 5,
  });

  if (orders.length === 0) {
    console.warn(
      "[debug-sales-order] Nenhum pedido encontrado. Verifique DATABASE_URL e se o sync já rodou."
    );
    process.exitCode = 1;
    return;
  }

  for (const order of orders) {
    console.log("\n" + "=".repeat(72));
    console.log("PEDIDO", order.orderCode);
    console.log("=".repeat(72));
    console.log(
      JSON.stringify(
        {
          id: order.id,
          orderCode: order.orderCode,
          externalSalesOrderId: order.externalSalesOrderId,
          externalSalesOrderCode: order.externalSalesOrderCode,
          status: order.status,
          issueDate: order.issueDate,
          expectedDeliveryDate: order.expectedDeliveryDate,
          totalNetValue: order.totalNetValue,
          totalItems: order.totalItems,
          responsible: order.responsible,
          customer:
            order.Customer?.tradeName?.trim() ||
            order.Customer?.companyName?.trim() ||
            null,
          itemsCount: order.items.length,
        },
        jsonReplacer,
        2
      )
    );

    console.log("\n--- ITENS DB ---");
    for (const item of order.items) {
      console.log(
        JSON.stringify(
          {
            id: item.id,
            externalProductId: item.externalProductId,
            skuSnapshot: item.skuSnapshot,
            productNameSnapshot: item.productNameSnapshot,
            quantity: item.quantity,
            totalNetValue: item.totalNetValue,
          },
          jsonReplacer,
          2
        )
      );
    }

    const raw = order.nomusRawResponse;
    const rootKeys = raw && typeof raw === "object" ? Object.keys(raw as object) : [];
    console.log("\n--- nomusRawResponse (chaves raiz) ---");
    console.log(rootKeys.join(", ") || "(vazio)");

    const rawItems = extractNomusRawItems(raw);
    console.log(`\n--- itensPedido extraídos: ${rawItems.length} ---`);
    rawItems.forEach((ri, idx) => {
      const statusRaw = extractSalesOrderItemRawField(ri.raw, "status");
      const normalizedFinal = normalizeSalesOrderItemNomusStatus(statusRaw ?? ri.status);
      console.log(`\n[item ${idx}]`);
      console.log(
        JSON.stringify(
          {
            item: ri.item,
            idProduto: ri.idProduto,
            codigoProduto: ri.codigoProduto,
            status: ri.status,
            quantidade: ri.quantidade,
            quantidadeCancelada: ri.quantidadeCancelada,
            rawKeys: collectKeys(ri.raw),
          },
          jsonReplacer,
          2
        )
      );
      console.log("status raw:", statusRaw);
      console.log("status aliases:", extractSalesOrderItemRawField(ri.raw, "status"));
      console.log("normalized:", normalizeSalesOrderItemNomusStatus(ri.status));
      console.log("normalized status final:", normalizedFinal);
    });

    console.log("\n--- MATCH item DB ↔ raw ---");
    order.items.forEach((dbItem, itemIndex) => {
      const matched = matchRawItemToDbItem(rawItems, dbItem, {
        itemIndex,
        totalDbItems: order.items.length,
      });
      console.log(
        JSON.stringify(
          {
            dbSku: dbItem.skuSnapshot,
            dbExternalProductId: dbItem.externalProductId,
            matched: matched
              ? {
                  codigoProduto: matched.codigoProduto,
                  status: matched.status,
                  normalized: normalizeSalesOrderItemNomusStatus(matched.status),
                }
              : null,
          },
          jsonReplacer,
          2
        )
      );
    });

    console.log("\n--- BUSCA textual no raw ---");
    const hits = findSearchHits(raw);
    for (const h of hits.slice(0, 40)) {
      console.log(`${h.path}: ${h.value.slice(0, 200)}`);
    }
    if (hits.length > 40) console.log(`... +${hits.length - 40} ocorrências`);

    const { lifecycle } = buildSalesOrderLifecycleSummary({
      salesOrderId: order.id,
      salesOrderNumber: order.orderCode,
      originalStatus: order.status,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      nomusRawResponse: raw,
      items: order.items.map((i) => ({
        id: i.id,
        externalProductId: i.externalProductId,
        skuSnapshot: i.skuSnapshot,
        productNameSnapshot: i.productNameSnapshot,
        quantity: i.quantity,
      })),
      referenceDate: new Date(),
    });

    console.log("\n--- LIFECYCLE ATUAL ---");
    console.log(
      JSON.stringify(
        {
          operationalStatus: lifecycle.operationalStatus,
          completionStatus: lifecycle.completionStatus,
          executiveStatusLabel: lifecycle.executiveStatusLabel,
          deadlineStatus: lifecycle.deadlineStatus,
          daysOverdue: lifecycle.daysOverdue,
          riskFlags: lifecycle.riskFlags,
          itemsCancelled: lifecycle.itemsCancelled,
          missingItemStatusCount: lifecycle.dataQuality.missingItemStatusCount,
          warnings: lifecycle.dataQuality.warnings,
        },
        jsonReplacer,
        2
      )
    );

    const { rows, cards } = buildManagementRowsFromOrders(
      [
        {
          id: order.id,
          orderCode: order.orderCode,
          status: order.status,
          issueDate: order.issueDate,
          expectedDeliveryDate: order.expectedDeliveryDate,
          totalNetValue: order.totalNetValue,
          responsible: order.responsible,
          nomusRawResponse: raw,
          Customer: order.Customer,
          items: order.items.map((i) => ({
            id: i.id,
            externalProductId: i.externalProductId,
            skuSnapshot: i.skuSnapshot,
            productNameSnapshot: i.productNameSnapshot,
            quantity: i.quantity,
          })),
        },
      ],
      {},
      new Date()
    );

    console.log("\n--- ROW GESTÃO ---");
    console.log(JSON.stringify(rows[0] ?? null, jsonReplacer, 2));
    console.log("\n--- CARDS ---");
    console.log(JSON.stringify(cards, jsonReplacer, 2));
    console.log("\n--- RESUMO ESPERADO PÓS-FIX ---");
    console.log(
      `executiveStatusLabel: ${lifecycle.executiveStatusLabel}`,
      `\noverduePending: ${cards.overduePending}`,
      `\nreviewData: ${cards.reviewData}`,
      `\nfinishedOrCancelled: ${cards.finishedOrCancelled}`
    );
  }
}

main()
  .catch((err) => {
    console.error("[debug-sales-order] ERRO:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
