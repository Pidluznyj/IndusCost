#!/usr/bin/env npx tsx
/**
 * Auditoria read-only de drift entre Pedido de Venda no banco e Nomus.
 *
 * Uso:
 *   npx tsx scripts/audit-nomus-sales-order-sync-drift.ts --orderCode=PD02339
 *   npx tsx scripts/audit-nomus-sales-order-sync-drift.ts --orderCode=02339 --year=2026 --month=3
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  canonicalNomusOrderCodeKey,
  detectSalesOrderHeaderItemDrift,
  expandNomusOrderCodeLookupVariants,
  sumSalesOrderItemsNetValue,
} from "../src/lib/salesOrderNomusSync.server.ts";
import { parseNomusPtBrNumber } from "./nomusNumberParser.ts";

type JsonObject = Record<string, unknown>;

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function money(value: unknown): number {
  try {
    const parsed = parseNomusPtBrNumber(value);
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : Number(value) || 0;
  } catch {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
}

function buildNomusHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = (process.env.NOMUS_TOKEN ?? "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const customHeaderName = (process.env.NOMUS_AUTH_HEADER_NAME ?? "").trim();
  const customHeaderValue = (process.env.NOMUS_AUTH_HEADER_VALUE ?? "").trim();
  if (customHeaderName && customHeaderValue) headers[customHeaderName] = customHeaderValue;
  return headers;
}

async function tryFetchNomusPedido(input: {
  externalSalesOrderId: number | null;
  orderCode: string;
  year?: number;
  month?: number;
}): Promise<{ pedido: JsonObject | null; note: string }> {
  const baseUrl = (process.env.NOMUS_BASE_URL ?? "").trim();
  if (!baseUrl) {
    return { pedido: null, note: "NOMUS_BASE_URL ausente — comparação live omitida." };
  }

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const targetKey = canonicalNomusOrderCodeKey(input.orderCode);
  const maxPages = Math.max(1, Number(process.env.NOMUS_SALES_ORDERS_MAX_PAGES ?? 50));
  const pageSize = Math.max(1, Number(process.env.NOMUS_PAGE_SIZE ?? 500));

  let dataEmissaoInicial = "01/01/2023";
  let dataEmissaoFinal = "31/12/2030";
  if (input.year && input.month) {
    const mm = String(input.month).padStart(2, "0");
    const lastDay = new Date(input.year, input.month, 0).getDate();
    dataEmissaoInicial = `01/${mm}/${input.year}`;
    dataEmissaoFinal = `${String(lastDay).padStart(2, "0")}/${mm}/${input.year}`;
  }

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL("pedidos", normalizedBase);
    url.searchParams.set("pagina", String(page));
    url.searchParams.set("tamanhoPagina", String(pageSize));
    url.searchParams.set("dataEmissaoInicial", dataEmissaoInicial);
    url.searchParams.set("dataEmissaoFinal", dataEmissaoFinal);
    url.searchParams.set("dataVencimentoInicial", dataEmissaoInicial);
    url.searchParams.set("dataVencimentoFinal", dataEmissaoFinal);

    const res = await fetch(url, { headers: buildNomusHeaders() });
    if (!res.ok) {
      return { pedido: null, note: `Nomus HTTP ${res.status} na página ${page}.` };
    }

    const payload = (await res.json()) as JsonObject;
    const arr = (
      Array.isArray(payload)
        ? payload
        : Array.isArray(payload.pedidos)
          ? payload.pedidos
          : Array.isArray((payload.data as JsonObject | undefined)?.pedidos)
            ? ((payload.data as JsonObject).pedidos as unknown[])
            : []
    ).filter((x): x is JsonObject => !!x && typeof x === "object");

    for (const pedido of arr) {
      const id = Number(pedido.id);
      const codeKey = canonicalNomusOrderCodeKey(String(pedido.codigoPedido ?? ""));
      if (input.externalSalesOrderId != null && id === input.externalSalesOrderId) {
        return { pedido, note: `Encontrado por externalSalesOrderId=${id}.` };
      }
      if (targetKey && codeKey === targetKey) {
        return { pedido, note: `Encontrado por codigoPedido=${String(pedido.codigoPedido ?? "")}.` };
      }
    }

    if (arr.length < pageSize) break;
  }

  return { pedido: null, note: "Pedido não encontrado nas páginas consultadas do Nomus." };
}

async function main(): Promise<void> {
  const orderCodeArg = parseArg("orderCode");
  if (!orderCodeArg?.trim()) {
    throw new Error("Informe --orderCode=PD02339 ou --orderCode=02339");
  }

  const yearRaw = parseArg("year");
  const monthRaw = parseArg("month");
  const year = yearRaw ? Number(yearRaw) : undefined;
  const month = monthRaw ? Number(monthRaw) : undefined;

  const variants = expandNomusOrderCodeLookupVariants(orderCodeArg);
  const order = await prisma.salesOrder.findFirst({
    where: {
      OR: variants.flatMap((code) => [{ orderCode: code }, { externalSalesOrderCode: code }]),
    },
    include: {
      items: {
        orderBy: { skuSnapshot: "asc" },
      },
    },
  });

  if (!order) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          message: "Pedido não encontrado no banco.",
          searchedVariants: variants,
          canonicalKey: canonicalNomusOrderCodeKey(orderCodeArg),
        },
        null,
        2
      )
    );
    return;
  }

  const itemsSum = sumSalesOrderItemsNetValue(order.items);
  const headerDrift = detectSalesOrderHeaderItemDrift(order.totalNetValue, order.items);
  const raw = (order.nomusRawResponse ?? null) as JsonObject | null;
  const rawTotal = raw ? money(raw.valorTotal) : null;
  const rawItems = Array.isArray(raw?.itensPedido) ? raw.itensPedido : [];

  const nomusLive = await tryFetchNomusPedido({
    externalSalesOrderId: order.externalSalesOrderId,
    orderCode: order.orderCode,
    year,
    month,
  });

  const nomusLiveTotal = nomusLive.pedido ? money(nomusLive.pedido.valorTotal) : null;
  const nomusLiveItems = Array.isArray(nomusLive.pedido?.itensPedido)
    ? (nomusLive.pedido!.itensPedido as unknown[])
    : [];

  const report = {
    ok: true,
    status: "OK" as "OK" | "ALERTA" | "BLOQUEANTE",
    findings: [] as Array<{ area: string; status: "OK" | "ALERTA" | "BLOQUEANTE"; message: string }>,
    searched: { orderCodeArg, variants, year: year ?? null, month: month ?? null },
    database: {
      id: order.id,
      orderCode: order.orderCode,
      externalSalesOrderId: order.externalSalesOrderId,
      externalSalesOrderCode: order.externalSalesOrderCode,
      sourceSystem: order.sourceSystem,
      status: order.status,
      issueDate: order.issueDate.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      sentToNomusAt: order.sentToNomusAt?.toISOString() ?? null,
      totalItems: order.totalItems,
      totalNetValue: money(order.totalNetValue),
      totalGrossValue: money(order.totalGrossValue),
      itemsCount: order.items.length,
      itemsSumNetValue: itemsSum,
      headerVsItemsDrift: headerDrift,
      items: order.items.map((item) => ({
        id: item.id,
        sku: item.skuSnapshot,
        productName: item.productNameSnapshot,
        quantity: money(item.quantity),
        unitPrice: money(item.negotiatedPrice),
        totalNetValue: money(item.totalNetValue),
        unitCost: money(item.unitCost),
        notes: item.notes,
      })),
    },
    nomusRawResponseSummary: raw
      ? {
          valorTotal: rawTotal,
          itemCount: rawItems.length,
          codigoPedido: raw.codigoPedido ?? null,
          id: raw.id ?? null,
          dataEmissao: raw.dataEmissao ?? null,
        }
      : null,
    nomusLive: nomusLive.pedido
      ? {
          note: nomusLive.note,
          id: nomusLive.pedido.id ?? null,
          codigoPedido: nomusLive.pedido.codigoPedido ?? null,
          valorTotal: nomusLiveTotal,
          itemCount: nomusLiveItems.length,
          deltaVsDatabaseTotal: nomusLiveTotal != null ? nomusLiveTotal - money(order.totalNetValue) : null,
          deltaVsItemsSum: nomusLiveTotal != null ? nomusLiveTotal - itemsSum : null,
        }
      : { note: nomusLive.note },
    driftIndicators: {
      headerDiffersFromItems: headerDrift.hasDrift,
      rawDiffersFromHeader:
        rawTotal != null && Math.abs(rawTotal - money(order.totalNetValue)) > 0.01,
      liveDiffersFromHeader:
        nomusLiveTotal != null && Math.abs(nomusLiveTotal - money(order.totalNetValue)) > 0.01,
      liveDiffersFromRaw:
        nomusLiveTotal != null && rawTotal != null && Math.abs(nomusLiveTotal - rawTotal) > 0.01,
      possibleStaleImport:
        headerDrift.hasDrift ||
        (nomusLiveTotal != null && Math.abs(nomusLiveTotal - money(order.totalNetValue)) > 0.01) ||
        (rawTotal != null && Math.abs(rawTotal - money(order.totalNetValue)) > 0.01),
    },
  };

  if (report.driftIndicators.headerDiffersFromItems) {
    report.findings.push({
      area: "header-items",
      status: "ALERTA",
      message: `Cabeçalho R$ ${headerDrift.headerTotal} ≠ soma itens R$ ${headerDrift.itemsSum}.`,
    });
  }
  if (report.driftIndicators.liveDiffersFromHeader) {
    report.findings.push({
      area: "nomus-live",
      status: "BLOQUEANTE",
      message: `Nomus atual R$ ${nomusLiveTotal} ≠ banco R$ ${money(order.totalNetValue)} — sync apply necessário.`,
    });
  } else if (report.driftIndicators.rawDiffersFromHeader) {
    report.findings.push({
      area: "nomus-raw",
      status: "ALERTA",
      message: `nomusRawResponse R$ ${rawTotal} ≠ cabeçalho R$ ${money(order.totalNetValue)}.`,
    });
  }
  if (report.driftIndicators.possibleStaleImport) {
    report.status = report.findings.some((f) => f.status === "BLOQUEANTE") ? "BLOQUEANTE" : "ALERTA";
  }
  if (report.findings.length === 0) {
    report.findings.push({
      area: "sync",
      status: "OK",
      message: "Pedido alinhado com itens e payload Nomus conhecido.",
    });
  }

  const output = {
    ...report,
    status: report.status,
  };

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((err) => {
    console.error("[audit-nomus-sales-order-sync-drift]", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
