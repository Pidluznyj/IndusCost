/**
 * Diagnóstico read-only — pedidos de comissão com NO_MARGIN / sem tabela comercial.
 *
 * Uso:
 *   npx tsx tmp-audits/inspect-commission-no-margin-orders.ts
 *
 * Com DATABASE_URL: lê SalesOrder, snapshots, ledger, PriceTable.
 * Sem DATABASE_URL: imprime mapa de código (origem de NO_MARGIN) e sai 0.
 *
 * Não grava. Não recalcula. Não chama Nomus.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { expandNomusOrderCodeLookupVariants } from "../src/lib/salesOrderNomusSync.server.ts";
import { loadCommercialPriceTiersForProduct } from "../src/lib/commissions/commission-commercial-tier.server.ts";
import { COMMERCIAL_PRICE_TIER_CODES } from "../src/lib/commissions/commission-commercial-tier.ts";
import { mapSnapshotItemStatusesToLedgerDiagnosis } from "../src/lib/commissions/commissionReceiptEngine.ts";

const ORDER_CODES = [
  "PD 02488",
  "PD 02490",
  "PD 02480",
  "PD 02577",
  "PD 02566",
  "PD 02546",
] as const;

const PUBLISHED_JUL_13_2026 = new Date("2026-07-13T10:02:00-03:00");
const TODAY = new Date();

export type NoMarginCause =
  | "NO_PRICE_TABLE_FOR_ORDER_DATE"
  | "PRODUCT_SKU_NOT_MATCHED"
  | "PRODUCT_EXTERNAL_ID_NOT_MATCHED"
  | "PRICE_TABLE_NOT_PUBLISHED_AT_ORDER_DATE"
  | "MARGIN_RULE_NOT_FOUND"
  | "FISCAL_RULE_NOT_FOUND"
  | "COMMISSION_RULE_NOT_FOUND"
  | "CUSTOMER_EXCEPTION"
  | "SELLER_NOT_COMMISSIONABLE"
  | "ORDER_STATUS_BLOCKED"
  | "UNKNOWN";

type OrderDiagnosis = {
  orderCode: string;
  found: boolean;
  order?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  commission?: Record<string, unknown>;
  priceTables?: Record<string, unknown>;
  dateComparison?: Record<string, unknown>;
  cause: NoMarginCause;
  causeDetail: string;
  reprocess?: Record<string, unknown>;
};

function dec(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  const n = Number(String(value));
  return Number.isFinite(n) ? n : null;
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toISOString();
}

function printCodeMap(): void {
  console.log("\n=== Mapa de código — origem de NO_MARGIN ===\n");
  console.log(
    [
      "1) Materialização de itens (motor oficial):",
      "   src/lib/commissions/commissionOrderCalculation.ts → resolvePureCommissionRate / calculateItemCommission",
      "   Statuss persistidos no snapshot:",
      "   - NO_COMMERCIAL_PRICE_TABLE",
      "   - INVALID_COMMERCIAL_PRICE_RANGE",
      "   - NO_COMMISSION_TABLE_RATE",
      "",
      "2) Carga da tabela comercial (Formação de Preço):",
      "   src/lib/commissions/commission-commercial-tier.server.ts → loadCommercialPriceTiersForProduct",
      "   Consulta: PriceTable (ATACADO/VAREJO_1..3 ACTIVE) + PriceTableVersion PUBLISHED",
      "   Vigência: effectiveFrom <= referenceDate AND (effectiveTo IS NULL OR effectiveTo > referenceDate)",
      "   Match do produto: PriceTableItem.productId == SalesOrderItem.productId (UUID local)",
      "   NÃO usa SKU / externalProductId no lookup.",
      "",
      "3) Data de referência:",
      "   src/lib/commissions/commission-source-resolver.ts → resolveCommissionRuleReferenceDate",
      "   Prioridade: NF.dataProcessamento → senão SalesOrder.issueDate",
      "   NÃO usa data de hoje / data de publicação da tabela.",
      "",
      "4) Diagnóstico de ledger / UI NO_MARGIN:",
      "   src/lib/commissions/commissionReceiptEngine.ts → mapSnapshotItemStatusesToLedgerDiagnosis",
      "   Se todos (ou mistura com regra) os status do snapshot forem",
      "   NO_COMMERCIAL_PRICE_TABLE | INVALID_COMMERCIAL_PRICE_RANGE → status NO_MARGIN",
      "   Motivo: \"Margem ou tabela comercial indisponível para cálculo de comissão\"",
      "",
      "5) Reprocessamento:",
      "   preview/apply → materializeCommissionForSalesOrder (mesma data de referência)",
      "   Publicar tabela em 13/07/2026 NÃO altera automaticamente pedidos de maio/2026",
      "   salvo a versão publicada ter effectiveFrom cobrindo a data do pedido/NF.",
    ].join("\n")
  );
}

async function findOrder(prisma: PrismaClient, orderCode: string) {
  const variants = expandNomusOrderCodeLookupVariants(orderCode);
  return prisma.salesOrder.findFirst({
    where: {
      OR: [
        { orderCode: { in: variants } },
        { externalSalesOrderCode: { in: variants } },
      ],
    },
    include: {
      Customer: { select: { id: true, companyName: true, tradeName: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          Product: {
            select: {
              id: true,
              sku: true,
              name: true,
              sourceExternalId: true,
            },
          },
        },
      },
      nfeLinks: {
        select: {
          nfeExternalId: true,
          nfeNumber: true,
          dataProcessamento: true,
        },
        orderBy: { dataProcessamento: "asc" },
      },
    },
  });
}

async function inspectPriceTablesForProduct(
  prisma: PrismaClient,
  productId: string,
  sku: string | null,
  referenceDate: Date,
  label: string
) {
  const load = await loadCommercialPriceTiersForProduct(prisma, productId, referenceDate);

  const versions = await prisma.priceTableVersion.findMany({
    where: {
      status: "PUBLISHED",
      PriceTable: { code: { in: [...COMMERCIAL_PRICE_TIER_CODES] }, status: "ACTIVE" },
    },
    orderBy: [{ publishedAt: "desc" }, { versionNumber: "desc" }],
    take: 40,
    select: {
      id: true,
      versionNumber: true,
      status: true,
      publishedAt: true,
      effectiveFrom: true,
      effectiveTo: true,
      taxRuleId: true,
      PriceTable: { select: { code: true, name: true } },
      items: {
        where: {
          OR: [
            { productId },
            ...(sku ? [{ sku: { equals: sku, mode: "insensitive" as const } }] : []),
          ],
        },
        select: {
          productId: true,
          sku: true,
          salePrice: true,
          commissionPerc: true,
          productName: true,
        },
      },
    },
  });

  const julyish = versions.filter((v) => {
    if (!v.publishedAt) return false;
    const t = v.publishedAt.getTime();
    const start = PUBLISHED_JUL_13_2026.getTime() - 12 * 3600_000;
    const end = PUBLISHED_JUL_13_2026.getTime() + 12 * 3600_000;
    return t >= start && t <= end;
  });

  const byProductId = versions.flatMap((v) =>
    v.items
      .filter((i) => i.productId === productId)
      .map((i) => ({
        table: v.PriceTable.code,
        version: v.versionNumber,
        publishedAt: iso(v.publishedAt),
        effectiveFrom: iso(v.effectiveFrom),
        effectiveTo: iso(v.effectiveTo),
        sku: i.sku,
        salePrice: dec(i.salePrice),
        commissionPerc: dec(i.commissionPerc),
        productIdMatch: true,
      }))
  );

  const bySkuOnly = versions.flatMap((v) =>
    v.items
      .filter((i) => i.productId !== productId)
      .map((i) => ({
        table: v.PriceTable.code,
        version: v.versionNumber,
        publishedAt: iso(v.publishedAt),
        sku: i.sku,
        salePrice: dec(i.salePrice),
        commissionPerc: dec(i.commissionPerc),
        productIdMatch: false,
        note: "SKU encontrado em outro productId — motor NÃO usa este item",
      }))
  );

  return {
    label,
    referenceDate: iso(referenceDate),
    loadOk: load.ok,
    loadCode: load.ok ? null : load.code,
    missingCodes: load.ok ? [] : load.missingCodes,
    tiers: load.ok
      ? load.tiers.map((t) => ({
          code: t.code,
          salePrice: t.salePrice,
          commissionPercent: t.commissionPercent,
        }))
      : [],
    itemsMatchedByProductId: byProductId.slice(0, 20),
    itemsMatchedBySkuOnly: bySkuOnly.slice(0, 10),
    publishedAround2026_07_13: julyish.map((v) => ({
      table: v.PriceTable.code,
      version: v.versionNumber,
      publishedAt: iso(v.publishedAt),
      effectiveFrom: iso(v.effectiveFrom),
      effectiveTo: iso(v.effectiveTo),
      itemsForProduct: v.items.length,
    })),
  };
}

function classifyCause(input: {
  itemStatuses: string[];
  sellerStatus: string | null | undefined;
  exclusionReason: string | null | undefined;
  loadAtOrderDate: { ok: boolean; code?: string | null; missingCodes?: string[] };
  skuOnlyHits: number;
  productIdHitsAtOrderDate: number;
}): { cause: NoMarginCause; detail: string } {
  if (input.exclusionReason) {
    return { cause: "CUSTOMER_EXCEPTION", detail: input.exclusionReason };
  }
  if (
    input.sellerStatus &&
    /UNRESOLVED|NO_SELLER|SELLER_UNRESOLVED/i.test(input.sellerStatus)
  ) {
    return {
      cause: "SELLER_NOT_COMMISSIONABLE",
      detail: `sellerResolutionStatus=${input.sellerStatus}`,
    };
  }
  if (input.itemStatuses.every((s) => s === "NO_RULE" || s === "NO_COMMISSION_TABLE_RATE")) {
    return {
      cause: "COMMISSION_RULE_NOT_FOUND",
      detail: `itemStatuses=${input.itemStatuses.join(",")}`,
    };
  }
  if (input.itemStatuses.includes("INVALID_COMMERCIAL_PRICE_RANGE")) {
    return {
      cause: "NO_PRICE_TABLE_FOR_ORDER_DATE",
      detail: "Faixa comercial inconsistente (INVALID_COMMERCIAL_PRICE_RANGE)",
    };
  }
  if (!input.loadAtOrderDate.ok) {
    if (input.skuOnlyHits > 0 && input.productIdHitsAtOrderDate === 0) {
      return {
        cause: "PRODUCT_SKU_NOT_MATCHED",
        detail:
          "Há PriceTableItem com mesmo SKU, mas productId local do item do pedido não casa com o da tabela (motor só usa productId).",
      };
    }
    if ((input.loadAtOrderDate.missingCodes?.length ?? 0) > 0) {
      return {
        cause: "PRICE_TABLE_NOT_PUBLISHED_AT_ORDER_DATE",
        detail: `Sem versão PUBLISHED vigente na data do pedido/NF para: ${(input.loadAtOrderDate.missingCodes ?? []).join(", ")}`,
      };
    }
    return {
      cause: "NO_PRICE_TABLE_FOR_ORDER_DATE",
      detail: `loadCommercialPriceTiersForProduct falhou: ${input.loadAtOrderDate.code ?? "NO_COMMERCIAL_PRICE_TABLE"}`,
    };
  }
  if (input.itemStatuses.includes("NO_COMMERCIAL_PRICE_TABLE")) {
    return {
      cause: "NO_PRICE_TABLE_FOR_ORDER_DATE",
      detail: "Snapshot materializado com NO_COMMERCIAL_PRICE_TABLE",
    };
  }
  return {
    cause: "UNKNOWN",
    detail: `itemStatuses=${input.itemStatuses.join(",") || "(vazio)"}`,
  };
}

async function inspectReprocess(
  prisma: PrismaClient,
  orderCode: string,
  salesOrderId: string
) {
  const runs = await prisma.commissionCalculationRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
    select: {
      id: true,
      mode: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      summaryJson: true,
      ordersEvaluated: true,
      commissionsCreated: true,
      commissionsUpdated: true,
    },
  });

  const recent = runs.map((r) => {
    const summary = (r.summaryJson ?? {}) as Record<string, unknown>;
    const kind = String(summary.kind ?? summary.engine ?? r.mode ?? "");
    const text = JSON.stringify(summary);
    const mentions =
      text.includes(orderCode) ||
      text.includes(salesOrderId) ||
      text.includes(orderCode.replace(/\s+/g, ""));
    return {
      id: r.id,
      mode: r.mode,
      status: r.status,
      startedAt: iso(r.startedAt),
      finishedAt: iso(r.finishedAt),
      ordersEvaluated: r.ordersEvaluated,
      commissionsCreated: r.commissionsCreated,
      commissionsUpdated: r.commissionsUpdated,
      kind,
      mentionsOrder: mentions,
    };
  });

  const anyMention = recent.some((r) => r.mentionsOrder);
  return {
    recentRuns: recent,
    orderMentionedInRecentSummary: anyMention,
    note: anyMention
      ? "Pedido aparece em summaryJson de run recente — verificar se action=unchanged/blocked"
      : "Pedido não citado explicitamente nos summaryJson das runs recentes (filtro pode não ter incluído ou summary sem detalhe por pedido)",
  };
}

async function diagnoseOrder(
  prisma: PrismaClient,
  orderCode: string
): Promise<OrderDiagnosis> {
  const order = await findOrder(prisma, orderCode);
  if (!order) {
    return {
      orderCode,
      found: false,
      cause: "UNKNOWN",
      causeDetail: "SalesOrder não encontrado",
    };
  }

  const issueDate = order.issueDate;
  const nfeRef =
    order.nfeLinks.find((n) => n.dataProcessamento)?.dataProcessamento ?? null;
  const referenceDate = nfeRef ?? issueDate;

  const snapshots = await prisma.commissionOrderSnapshot.findMany({
    where: { salesOrderId: order.id },
    orderBy: { updatedAt: "desc" },
    include: {
      items: {
        include: {
          product: { select: { id: true, sku: true, sourceExternalId: true, name: true } },
          salesOrderItem: {
            select: {
              id: true,
              skuSnapshot: true,
              externalProductId: true,
              quantity: true,
              negotiatedPrice: true,
              totalNetValue: true,
            },
          },
        },
      },
      receivableSchedules: {
        select: {
          id: true,
          status: true,
          scheduledCommissionAmount: true,
          receivableId: true,
          nfeId: true,
        },
      },
    },
  });

  const activeSnapshot =
    snapshots.find((s) => s.status === "ACTIVE") ?? snapshots[0] ?? null;
  const itemStatuses = (activeSnapshot?.items ?? []).map((i) => String(i.status));
  const ledgerDiagnosis = mapSnapshotItemStatusesToLedgerDiagnosis(itemStatuses);

  const legacyRecords = await prisma.commissionRecord.findMany({
    where: {
      OR: [
        { orderCode: { contains: orderCode.replace(/^PD\s*/i, ""), mode: "insensitive" } },
        { orderCode: { equals: order.orderCode, mode: "insensitive" } },
      ],
    },
    take: 20,
    orderBy: { calculatedAt: "desc" },
    select: {
      id: true,
      status: true,
      orderCode: true,
      productCode: true,
      baseAmount: true,
      ratePercent: true,
      commissionAmount: true,
      calculatedAt: true,
      metadataJson: true,
    },
  });

  const ledgerLines = await prisma.commissionReceiptLedgerLine.findMany({
    where: {
      OR: [
        { orderCode: { contains: orderCode.replace(/^PD\s*/i, ""), mode: "insensitive" } },
        { orderCode: order.orderCode },
      ],
    },
    take: 20,
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: {
      id: true,
      status: true,
      exceptionReason: true,
      commissionRatePercent: true,
      expectedCommissionAmount: true,
      releasedCommissionAmount: true,
      year: true,
      month: true,
      productCode: true,
    },
  });

  const productIds = [
    ...new Set(
      order.items
        .map((i) => i.productId)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const priceByProduct: Array<Record<string, unknown>> = [];
  let skuOnlyHits = 0;
  let productIdHitsAtOrderDate = 0;
  let loadAtOrderDate: { ok: boolean; code?: string | null; missingCodes?: string[] } = {
    ok: true,
  };

  for (const productId of productIds) {
    const item = order.items.find((i) => i.productId === productId)!;
    const sku = item.Product?.sku ?? item.skuSnapshot ?? null;
    const atOrder = await inspectPriceTablesForProduct(
      prisma,
      productId,
      sku,
      referenceDate,
      "at_order_reference_date"
    );
    const atToday = await inspectPriceTablesForProduct(
      prisma,
      productId,
      sku,
      TODAY,
      "at_today"
    );
    const atJuly = await inspectPriceTablesForProduct(
      prisma,
      productId,
      sku,
      PUBLISHED_JUL_13_2026,
      "at_2026_07_13_publication"
    );

    skuOnlyHits += atOrder.itemsMatchedBySkuOnly.length;
    productIdHitsAtOrderDate += atOrder.itemsMatchedByProductId.length;
    if (!atOrder.loadOk) {
      loadAtOrderDate = {
        ok: false,
        code: atOrder.loadCode,
        missingCodes: atOrder.missingCodes,
      };
    }

    priceByProduct.push({
      productId,
      sku,
      externalProductId: item.Product?.sourceExternalId ?? item.externalProductId,
      atOrderReferenceDate: atOrder,
      atToday,
      atPublication2026_07_13: atJuly,
    });
  }

  const classified = classifyCause({
    itemStatuses,
    sellerStatus: activeSnapshot?.sellerResolutionStatus,
    exclusionReason:
      activeSnapshot?.items.find((i) => i.exclusionReason)?.exclusionReason ?? null,
    loadAtOrderDate,
    skuOnlyHits,
    productIdHitsAtOrderDate,
  });

  const reprocess = await inspectReprocess(prisma, order.orderCode, order.id);

  return {
    orderCode: order.orderCode,
    found: true,
    order: {
      id: order.id,
      orderCode: order.orderCode,
      issueDate: iso(order.issueDate),
      customerName: order.Customer.companyName ?? order.Customer.tradeName,
      externalCustomerId: order.externalCustomerId,
      sellerName: order.nomusSellerName,
      externalSellerId: order.externalSellerId,
      responsibleLegacy: order.responsible,
      status: order.status,
      totalNetValue: dec(order.totalNetValue),
      nfeLinks: order.nfeLinks.map((n) => ({
        nfeExternalId: n.nfeExternalId,
        nfeNumber: n.nfeNumber,
        dataProcessamento: iso(n.dataProcessamento),
      })),
    },
    items: order.items.map((i) => ({
      salesOrderItemId: i.id,
      productCode: i.Product?.sku ?? i.skuSnapshot,
      sku: i.skuSnapshot ?? i.Product?.sku,
      productId: i.productId,
      externalProductId: i.externalProductId ?? i.Product?.sourceExternalId ?? null,
      quantity: dec(i.quantity),
      unitPrice: dec(i.negotiatedPrice),
      totalNetValue: dec(i.totalNetValue),
      productName: i.Product?.name ?? i.productNameSnapshot,
    })),
    commission: {
      activeSnapshotId: activeSnapshot?.id ?? null,
      snapshotStatus: activeSnapshot?.status ?? null,
      saleDateUsedBySnapshot: iso(activeSnapshot?.saleDate),
      sellerResolutionStatus: activeSnapshot?.sellerResolutionStatus ?? null,
      canonicalSellerName: activeSnapshot?.canonicalSellerName ?? null,
      rawSellerName: activeSnapshot?.rawSellerName ?? null,
      totalSoldAmount: dec(activeSnapshot?.totalSoldAmount),
      totalFinalCommissionAmount: dec(activeSnapshot?.totalFinalCommissionAmount),
      itemSnapshots: (activeSnapshot?.items ?? []).map((it) => ({
        id: it.id,
        productId: it.productId,
        productSku: it.product.sku,
        status: it.status,
        marginPercent: dec(it.marginPercent),
        commissionRatePercent: dec(it.commissionRatePercent),
        soldAmount: dec(it.soldAmount),
        finalCommissionAmount: dec(it.finalCommissionAmount),
        exclusionReason: it.exclusionReason,
        ruleId: it.ruleId,
      })),
      schedules: (activeSnapshot?.receivableSchedules ?? []).map((s) => ({
        id: s.id,
        status: s.status,
        scheduledCommissionAmount: dec(s.scheduledCommissionAmount),
        receivableId: s.receivableId,
        nfeId: s.nfeId,
      })),
      ledgerDiagnosisFromItemStatuses: ledgerDiagnosis,
      ledgerLines,
      legacyCommissionRecords: legacyRecords.map((r) => ({
        id: r.id,
        status: r.status,
        productCode: r.productCode,
        baseAmount: dec(r.baseAmount),
        ratePercent: dec(r.ratePercent),
        commissionAmount: dec(r.commissionAmount),
        calculatedAt: iso(r.calculatedAt),
      })),
    },
    priceTables: { products: priceByProduct },
    dateComparison: {
      orderIssueDate: iso(issueDate),
      nfeDataProcessamento: iso(nfeRef),
      motorReferenceDate: iso(referenceDate),
      motorUsesIssueDateWhenNoNfe: nfeRef == null,
      motorUsesNfeProcessingDateWhenPresent: nfeRef != null,
      motorUsesToday: false,
      publication2026_07_13: iso(PUBLISHED_JUL_13_2026),
      publicationShouldImpactMay2026Orders:
        "Somente se a versão PUBLISHED tiver effectiveFrom <= data de referência do pedido/NF e effectiveTo > essa data. Publicar em 13/07/2026 com vigência a partir de julho NÃO cobre maio/2026.",
    },
    cause: classified.cause,
    causeDetail: classified.detail,
    reprocess,
  };
}

async function main(): Promise<void> {
  printCodeMap();

  if (!process.env.DATABASE_URL) {
    console.log("\nSKIP live DB — DATABASE_URL ausente.\n");
    const outDir = join(process.cwd(), "tmp-audits");
    mkdirSync(outDir, { recursive: true });
    const payload = {
      generatedAt: new Date().toISOString(),
      liveDb: false,
      orderCodes: ORDER_CODES,
      note: "Sem DATABASE_URL — apenas mapa de código. Reexecutar no servidor com banco.",
    };
    writeFileSync(
      join(outDir, "inspect-commission-no-margin-orders.result.json"),
      JSON.stringify(payload, null, 2),
      "utf8"
    );
    return;
  }

  const prisma = new PrismaClient();
  const results: OrderDiagnosis[] = [];

  try {
    for (const code of ORDER_CODES) {
      console.log(`\n========== ${code} ==========`);
      const d = await diagnoseOrder(prisma, code);
      results.push(d);
      console.log(JSON.stringify(d, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }

  const outDir = join(process.cwd(), "tmp-audits");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "inspect-commission-no-margin-orders.result.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        liveDb: true,
        results,
        causeSummary: results.map((r) => ({
          orderCode: r.orderCode,
          found: r.found,
          cause: r.cause,
          causeDetail: r.causeDetail,
        })),
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`\nResultado escrito: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
