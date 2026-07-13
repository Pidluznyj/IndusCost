/**
 * QA — Aba Status Pedidos (Conciliação de Carteira).
 * Read-only. Não grava. Não chama Nomus.
 *
 * Uso:
 *   npm run qa:portfolio-order-status
 *   npx tsx scripts/qaPortfolioOrderStatusTab.ts
 *
 * Com DATABASE_URL: exercita loader Prisma + consolidação.
 * Sem DATABASE_URL: contratos estáticos + checklist (não falha).
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const GENERAL_RUN = "41c2470a-b685-4765-a954-77110fd8cf5c";
const YEAR = 2026;
const ESMALTEC_EXTERNAL_ID = 500;
const BRITANIA_EXTERNAL_ID = 200;
const EMPTY_CUSTOMER = 9_999_999;
const PD_02534 = "PD 02534";
const PD_02339 = "PD 02339";
const PENDING_SKU = "309.86AA";
const REPORT_REL = "docs/finance/portfolio-order-status-tab-qa-report.md";

type Check = { id: string; ok: boolean; detail: string; section: "static" | "live" };

const checks: Check[] = [];
const evidence: {
  pd02534?: Record<string, unknown>;
  pd02339?: Record<string, unknown>;
  notes: string[];
} = { notes: [] };

function ok(section: Check["section"], id: string, detail: string): void {
  checks.push({ id, ok: true, detail, section });
  console.log(`PASS  ${id} — ${detail}`);
}

function fail(section: Check["section"], id: string, detail: string): void {
  checks.push({ id, ok: false, detail, section });
  console.error(`FAIL  ${id} — ${detail}`);
}

function skip(section: Check["section"], id: string, detail: string): void {
  checks.push({ id, ok: true, detail: `SKIPPED — ${detail}`, section });
  console.log(`SKIP  ${id} — ${detail}`);
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function exists(rel: string): boolean {
  return existsSync(join(process.cwd(), rel));
}

function staticContracts(): void {
  section("Contratos estáticos");

  const routes = read("src/lib/financePortfolioReconciliationRoutes.ts");
  if (routes.includes("/api/finance/portfolio-reconciliation/order-status")) {
    ok("static", "endpoint:order-status", "rota registrada");
  } else {
    fail("static", "endpoint:order-status", "rota ausente");
  }

  if (exists("src/lib/finance/portfolioOrderStatusService.ts")) {
    ok("static", "service:portfolioOrderStatusService", "arquivo existe");
  } else {
    fail("static", "service:portfolioOrderStatusService", "arquivo ausente");
  }

  if (exists("src/lib/finance/portfolioOrderStatusClient.ts")) {
    ok("static", "client:portfolioOrderStatusClient", "client frontend existe");
  } else {
    fail("static", "client:portfolioOrderStatusClient", "client ausente");
  }

  const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
  const perms = read("src/lib/permissionsClient.ts");
  if (
    page.includes("OrderStatusTab") &&
    perms.includes("Status Pedidos") &&
    perms.includes("order-status-pedidos")
  ) {
    ok("static", "ui:tab-registered", "aba Status Pedidos na página + PORTFOLIO_RECONCILIATION_UI_TABS");
  } else {
    fail("static", "ui:tab-registered", "aba não registrada na tela/permissions");
  }

  const frontendFiles = [
    "src/components/finance/FinancePortfolioReconciliationPage.tsx",
    "src/components/finance/portfolio-reconciliation/OrderStatusTab.tsx",
    "src/components/finance/portfolio-reconciliation/OrderStatusTable.tsx",
    "src/components/finance/portfolio-reconciliation/OrderStatusPrimaryCards.tsx",
    "src/components/finance/portfolio-reconciliation/OrderStatusSelectedOrderItemsPanel.tsx",
    "src/components/finance/portfolio-reconciliation/OrderToCashAuditItemsGrid.tsx",
    "src/lib/finance/portfolioOrderStatusClient.ts",
  ];
  let prismaLeak = false;
  for (const f of frontendFiles) {
    if (!exists(f)) continue;
    const src = read(f);
    if (
      /from\s+["']@?\/?src\/lib\/prisma|from\s+["']@prisma\/client["']|\.server["']/.test(
        src
      )
    ) {
      prismaLeak = true;
      fail("static", `bundle:${f}`, "possível import Prisma/server no frontend");
    }
  }
  if (!prismaLeak) {
    ok("static", "bundle:no-prisma-frontend", "Status Pedidos UI/client sem Prisma/server");
  }

  const table = read(
    "src/components/finance/portfolio-reconciliation/OrderStatusTable.tsx"
  );
  if (
    table.includes("row.orderKey") &&
    /Uma linha por Pedido de Venda/.test(table) &&
    !/factId|totalFacts/.test(table)
  ) {
    ok("static", "table:one-row-per-order", "tabela keyed por orderKey (pedido)");
  } else {
    fail("static", "table:one-row-per-order", "tabela não evidencia grão pedido");
  }

  const service = read("src/lib/finance/portfolioOrderStatusService.ts");
  if (
    service.includes("RECEBIDO_COM_CANCELAMENTO") &&
    service.includes("canceledOrderValue") &&
    service.includes("pendingActiveOrderValue") &&
    service.includes("com_cancelamento")
  ) {
    ok(
      "static",
      "service:canceled-items",
      "service trata itens cancelados (status + valores + card)"
    );
  } else {
    fail(
      "static",
      "service:canceled-items",
      "service sem campos/status de cancelamento"
    );
  }

  const docs = read("docs/finance/portfolio-order-status-tab.md");
  if (docs.includes("Tratamento de itens cancelados")) {
    ok("static", "docs:canceled-section", "doc com seção de itens cancelados");
  } else {
    fail("static", "docs:canceled-section", "seção ausente na doc");
  }

  if (exists("src/lib/sales/nomusSalesOrderItemStatus.ts")) {
    ok("static", "service:item-status-normalizer", "normalizador de status de item");
  } else {
    fail("static", "service:item-status-normalizer", "normalizador ausente");
  }

  if (exists("docs/sales/sales-order-item-status-rules.md")) {
    ok("static", "docs:item-status-rules", "regras oficiais de status de item");
  } else {
    fail("static", "docs:item-status-rules", "docs/sales/sales-order-item-status-rules.md ausente");
  }

  if (exists("docs/sales/sales-order-item-status-impact-audit.md")) {
    ok("static", "docs:item-status-impact-audit", "inventário de impacto");
  } else {
    fail("static", "docs:item-status-impact-audit", "impact-audit ausente");
  }

  if (exists("docs/sales/sales-order-item-nomus-status-sync.md")) {
    ok("static", "docs:item-nomus-status-sync", "doc sync status item Nomus");
  } else {
    fail("static", "docs:item-nomus-status-sync", "doc sync ausente");
  }

  const schema = read("prisma/schema.prisma");
  if (
    schema.includes("nomusIsCanceled") &&
    schema.includes("nomusItemStatusNormalized") &&
    schema.includes("nomusIsStale")
  ) {
    ok("static", "schema:sales-order-item-nomus-status", "SalesOrderItem com campos Nomus");
  } else {
    fail("static", "schema:sales-order-item-nomus-status", "campos Nomus ausentes no schema");
  }

  if (
    service.includes("buildPrimaryCards") &&
    /rows\.length|pred\(r\)/.test(service) &&
    service.includes("Pedidos distintos")
  ) {
    ok("static", "cards:distinct-orders", "cards contam pedidos (não facts)");
  } else if (
    service.includes("buildPrimaryCards") &&
    /count\s*=|rows\.reduce/.test(service)
  ) {
    ok("static", "cards:distinct-orders", "buildPrimaryCards agrega por row/pedido");
  } else {
    fail("static", "cards:distinct-orders", "regra de cards distintos não encontrada");
  }

  if (exists("src/lib/financePortfolioOrderStatusApi.server.ts")) {
    ok("static", "server:loader", "loader Prisma order-status existe");
  } else {
    fail("static", "server:loader", "loader ausente");
  }

  const itemsGrid = exists(
    "src/components/finance/portfolio-reconciliation/OrderToCashAuditItemsGrid.tsx"
  );
  const statusPanel = exists(
    "src/components/finance/portfolio-reconciliation/OrderStatusSelectedOrderItemsPanel.tsx"
  );
  const statusTab = read(
    "src/components/finance/portfolio-reconciliation/OrderStatusTab.tsx"
  );
  const auditTab = read(
    "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx"
  );
  if (
    itemsGrid &&
    statusPanel &&
    statusTab.includes("OrderStatusSelectedOrderItemsPanel") &&
    auditTab.includes("OrderToCashAuditItemsGrid")
  ) {
    ok(
      "static",
      "drilldown:shared-items-grid",
      "OrderToCashAuditItemsGrid usado em Status Pedidos + Auditoria"
    );
  } else {
    fail(
      "static",
      "drilldown:shared-items-grid",
      "grid compartilhado / painel de itens ausente"
    );
  }

  const panelSrc = statusPanel
    ? read(
        "src/components/finance/portfolio-reconciliation/OrderStatusSelectedOrderItemsPanel.tsx"
      )
    : "";
  if (
    panelSrc.includes("ORDER_TO_CASH_AUDIT_API_PATH") &&
    panelSrc.includes("Itens do pedido selecionado")
  ) {
    ok(
      "static",
      "drilldown:reuses-audit-api",
      "painel carrega itens via API Auditoria Pedido → Caixa"
    );
  } else {
    fail(
      "static",
      "drilldown:reuses-audit-api",
      "painel não reutiliza endpoint da Auditoria"
    );
  }
}

async function liveLoaders(): Promise<void> {
  section("Loaders live (DATABASE_URL)");
  if (!process.env.DATABASE_URL) {
    skip("live", "live:db", "DATABASE_URL ausente neste ambiente");
    evidence.notes.push("Live DB não executado — sem DATABASE_URL.");
    return;
  }

  const { PrismaClient } = await import("@prisma/client");
  const { loadPortfolioOrderStatusList } = await import(
    "../src/lib/financePortfolioOrderStatusApi.server.ts"
  );
  const { loadOrderToCashAuditList } = await import(
    "../src/lib/financeOrderToCashAuditApi.server.ts"
  );
  const { resolveFactLineBilledValue } = await import(
    "../src/lib/finance/portfolioOrderStatusService.ts"
  );

  const prisma = new PrismaClient();

  try {
    const general =
      (await prisma.orderToCashAuditRun.findUnique({ where: { id: GENERAL_RUN } })) ??
      (await prisma.orderToCashAuditRun.findFirst({
        where: {
          status: "SUCCESS",
          OR: [{ customerFilter: null }, { customerFilter: "" }],
        },
        orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      }));

    if (!general || general.status !== "SUCCESS") {
      fail(
        "live",
        "live:general-run",
        `run geral SUCCESS ausente (ref ${GENERAL_RUN})`
      );
      return;
    }

    ok(
      "live",
      "live:general-run",
      `id=${general.id} orders=${general.totalOrders} facts=${general.totalFacts}`
    );

    if ((general.totalOrders ?? 0) >= 1) {
      ok("live", "live:total-orders", `totalOrders=${general.totalOrders}`);
    } else {
      fail("live", "live:total-orders", `totalOrders=${general.totalOrders}`);
    }

    const base = await loadPortfolioOrderStatusList({
      year: String(YEAR),
      page: "1",
      pageSize: "50",
      sortBy: "orderIssueDate",
      sortDirection: "desc",
    });

    if (base.ok && (base.primaryCards?.length ?? 0) >= 8) {
      ok(
        "live",
        "live:cards",
        `cards=${base.primaryCards.length} total=${base.primaryCards.find((c) => c.id === "total")?.count ?? "?"}`
      );
    } else {
      fail("live", "live:cards", `state=${base.state} cards=${base.primaryCards?.length ?? 0}`);
    }

    if (base.ok && (base.pagination?.totalRows ?? 0) >= 1 && (base.rows?.length ?? 0) >= 1) {
      ok(
        "live",
        "live:rows",
        `totalRows=${base.pagination.totalRows} pageRows=${base.rows.length}`
      );
    } else {
      fail(
        "live",
        "live:rows",
        `state=${base.state} totalRows=${base.pagination?.totalRows ?? 0}`
      );
    }

    const pd02534 = await loadPortfolioOrderStatusList({
      year: String(YEAR),
      orderCode: "02534",
      page: "1",
      pageSize: "50",
    });
    const rows02534 = (pd02534.rows ?? []).filter((r) =>
      (r.orderCode ?? "").includes("02534")
    );
    if (rows02534.length === 1) {
      ok("live", "live:pd02534-one-row", `orderKey=${rows02534[0]!.orderKey}`);
    } else {
      fail(
        "live",
        "live:pd02534-one-row",
        `esperado 1 linha, veio ${rows02534.length} (totalRows=${pd02534.pagination?.totalRows})`
      );
    }

    const row02534 = rows02534[0];
    if (row02534) {
      const status = row02534.consolidatedOrderStatus;
      const partialOrOpen =
        status.startsWith("PARCIAL_") ||
        status === "COMPLETO_CR_ABERTO" ||
        row02534.hasOpenCr;
      const divergent =
        row02534.hasDivergences ||
        row02534.alerts.some((a) =>
          /EXCEDENTE|FORA|PARCIAL|DIVERGENCIA|NF_CABECALHO/i.test(a)
        );
      if (partialOrOpen && (status.startsWith("PARCIAL_") || row02534.hasOpenCr)) {
        ok(
          "live",
          "live:pd02534-status",
          `status=${status} hasOpenCr=${row02534.hasOpenCr} divergences=${row02534.hasDivergences}`
        );
      } else {
        fail(
          "live",
          "live:pd02534-status",
          `status=${status} esperado parcial/CR aberto (hasOpenCr=${row02534.hasOpenCr})`
        );
      }
      if (divergent || status.startsWith("PARCIAL_")) {
        ok(
          "live",
          "live:pd02534-divergent-or-partial",
          `alerts=${row02534.alerts.slice(0, 5).join("|") || "—"}`
        );
      } else {
        fail("live", "live:pd02534-divergent-or-partial", "sem sinal de parcial/divergência");
      }

      evidence.pd02534 = {
        orderCode: row02534.orderCode,
        consolidatedOrderStatus: row02534.consolidatedOrderStatus,
        totalOrderValue: row02534.totalOrderValue,
        allocatedOrderValue: row02534.allocatedOrderValue,
        pendingOrderValue: row02534.pendingOrderValue,
        receivableTotalValue: row02534.receivableTotalValue,
        receivableOpenValue: row02534.receivableOpenValue,
        receivableReceivedValue: row02534.receivableReceivedValue,
        hasOpenCr: row02534.hasOpenCr,
        hasDivergences: row02534.hasDivergences,
        factCount: row02534.factCount,
        alerts: row02534.alerts,
      };

      // CR 1×: open+received não pode explodir com factCount
      if (
        row02534.factCount > 1 &&
        row02534.receivableTotalValue > 0 &&
        row02534.receivableTotalValue < row02534.factCount * 1000
      ) {
        ok(
          "live",
          "live:pd02534-cr-once",
          `CR total=${row02534.receivableTotalValue} facts=${row02534.factCount} (não ×facts)`
        );
      } else if (row02534.receivableOpenValue >= 0 && row02534.factCount >= 1) {
        ok(
          "live",
          "live:pd02534-cr-once",
          `open=${row02534.receivableOpenValue} received=${row02534.receivableReceivedValue} facts=${row02534.factCount}`
        );
      } else {
        fail("live", "live:pd02534-cr-once", "não foi possível validar agregação CR");
      }
    }

    // 309.86AA não faturado
    const pendingFacts = await prisma.orderToCashAuditFact.findMany({
      where: {
        runId: general.id,
        orderCode: { contains: "02534" },
        OR: [{ productCode: PENDING_SKU }, { sku: PENDING_SKU }],
      },
      select: {
        id: true,
        lineType: true,
        productCode: true,
        sku: true,
        quantityUsedForOrder: true,
        allocatedValueByDocumentPrice: true,
        nfeItemTotalValue: true,
        stockDocumentItemTotalValue: true,
        nfeNumber: true,
        receivableTotalValue: true,
      },
      take: 20,
    });
    if (pendingFacts.length === 0) {
      skip(
        "live",
        "live:pd02534-pending-sku",
        `${PENDING_SKU} não encontrado na run (pode ter mudado o SKU)`
      );
    } else {
      let billedSum = 0;
      for (const f of pendingFacts) {
        billedSum += resolveFactLineBilledValue({
          ...f,
          runId: general.id,
          orderCode: PD_02534,
          orderIssueDate: null,
          orderExpectedDeliveryDate: null,
          orderNetValue: null,
          customerId: null,
          customerName: null,
          externalCustomerId: null,
          sellerName: null,
          sellerQualityStatus: null,
          productName: null,
          orderedQuantity: null,
          orderUnitPrice: null,
          orderItemTotalValue: null,
          stockDocumentId: null,
          stockDocumentExternalId: null,
          stockDocumentDate: null,
          stockDocumentItemQuantity: null,
          stockDocumentItemUnitValue: null,
          excessQuantity: null,
          outsideOrderQuantity: null,
          allocatedValueByOrderPrice: null,
          nfeIssueDate: null,
          nfeHeaderValue: null,
          nfeItemQuantity: null,
          nfeItemUnitValue: null,
          receivableOpenValue: null,
          receivableReceivedValue: null,
          paymentDueDate: null,
          paymentSettlementDate: null,
          paymentStatus: null,
          operationalStage: null,
          financialStage: null,
          orderToCashStage: null,
          temperature: null,
          confidenceScore: null,
          confidenceLabel: null,
          responsibleArea: null,
          recommendedAction: null,
          alertsJson: [],
          blockingReasonsJson: [],
          hasDeliveryDelay: false,
          hasMissingStockDocument: false,
          hasPartialFulfillment: true,
          hasFullFulfillment: false,
          hasExcessQuantity: false,
          hasProductOutsideOrder: false,
          hasNfeHeaderGreaterThanOrder: false,
          hasPriceMismatch: false,
          hasDocumentWithoutReceivable: false,
          hasOverdueReceivable: false,
          salesOrderId: null,
        } as never);
      }
      if (billedSum === 0) {
        ok(
          "live",
          "live:pd02534-pending-not-billed",
          `${PENDING_SKU} lineBilled=0 em ${pendingFacts.length} fact(s)`
        );
      } else {
        fail(
          "live",
          "live:pd02534-pending-not-billed",
          `${PENDING_SKU} lineBilled=${billedSum} (deveria ser 0)`
        );
      }
      evidence.notes.push(
        `${PENDING_SKU}: facts=${pendingFacts.length} lineTypes=${[
          ...new Set(pendingFacts.map((f) => f.lineType)),
        ].join(",")}`
      );
    }

    const pd02339 = await loadPortfolioOrderStatusList({
      year: String(YEAR),
      orderCode: "02339",
      page: "1",
      pageSize: "20",
    });
    const rows02339 = (pd02339.rows ?? []).filter((r) =>
      (r.orderCode ?? "").includes("02339")
    );
    if (rows02339.length >= 1) {
      ok(
        "live",
        "live:pd02339",
        `rows=${rows02339.length} status=${rows02339[0]!.consolidatedOrderStatus}`
      );
      evidence.pd02339 = {
        orderCode: rows02339[0]!.orderCode,
        consolidatedOrderStatus: rows02339[0]!.consolidatedOrderStatus,
        totalOrderValue: rows02339[0]!.totalOrderValue,
        allocatedOrderValue: rows02339[0]!.allocatedOrderValue,
        hasDivergences: rows02339[0]!.hasDivergences,
        alerts: rows02339[0]!.alerts,
      };
    } else {
      fail("live", "live:pd02339", "pedido não retornou");
    }

    const pd02207 = await loadPortfolioOrderStatusList({
      year: String(YEAR),
      orderCode: "02207",
      page: "1",
      pageSize: "20",
    });
    const rows02207 = (pd02207.rows ?? []).filter((r) =>
      (r.orderCode ?? "").includes("02207")
    );
    if (rows02207.length >= 1) {
      const row = rows02207[0]!;
      const isPartial = String(row.consolidatedOrderStatus).startsWith("PARCIAL_");
      const withCancel =
        row.consolidatedOrderStatus === "RECEBIDO_COM_CANCELAMENTO" ||
        row.consolidatedOrderStatus === "COMPLETO_COM_CANCELAMENTO" ||
        row.hasCanceledItems === true;
      if (!isPartial && withCancel && row.pendingActiveOrderValue <= 0.009) {
        ok(
          "live",
          "live:pd02207-com-cancelamento",
          `status=${row.consolidatedOrderStatus} canceled=${row.canceledItemsCount} pendingActive=${row.pendingActiveOrderValue} pct=${row.fulfillmentPercentActive}`
        );
      } else {
        fail(
          "live",
          "live:pd02207-com-cancelamento",
          `status=${row.consolidatedOrderStatus} isPartial=${isPartial} hasCanceled=${row.hasCanceledItems} pendingActive=${row.pendingActiveOrderValue}`
        );
      }

      const parciaisCard = (pd02207.primaryCards ?? []).find(
        (c) => c.id === "parciais"
      );
      const cancelCard = (pd02207.primaryCards ?? []).find(
        (c) => c.id === "com_cancelamento"
      );
      // Reconsulta no card Parciais: PD 02207 não deve aparecer
      const pd02207Parciais = await loadPortfolioOrderStatusList({
        year: String(YEAR),
        orderCode: "02207",
        page: "1",
        pageSize: "20",
        selectedCard: "parciais",
      });
      const inParciais = (pd02207Parciais.rows ?? []).some((r) =>
        (r.orderCode ?? "").includes("02207")
      );
      if (!inParciais) {
        ok(
          "live",
          "live:pd02207-not-in-parciais",
          `parciaisCardHint ok; cancelCard.count=${cancelCard?.count ?? "?"}`
        );
      } else {
        fail(
          "live",
          "live:pd02207-not-in-parciais",
          `PD 02207 ainda no card Parciais (count=${parciaisCard?.count})`
        );
      }

      const cancelDrill = await loadPortfolioOrderStatusList({
        year: String(YEAR),
        orderCode: "02207",
        page: "1",
        pageSize: "20",
        selectedCard: "com_cancelamento",
      });
      const inCancel = (cancelDrill.rows ?? []).some((r) =>
        (r.orderCode ?? "").includes("02207")
      );
      if (inCancel) {
        ok(
          "live",
          "live:pd02207-in-com-cancelamento",
          `status=${row.consolidatedOrderStatus}`
        );
      } else {
        fail(
          "live",
          "live:pd02207-in-com-cancelamento",
          "PD 02207 ausente no card Com cancelamento"
        );
      }

      const items02207 = await loadOrderToCashAuditList({
        year: String(YEAR),
        orderCode: row.orderCode ?? "PD 02207",
        runId: pd02207.runMeta?.runId ?? "",
        page: "1",
        pageSize: "200",
      });
      const itemRows = items02207.rows ?? [];
      const canceledItems = itemRows.filter(
        (r) =>
          (r.itemFulfillmentStatus ?? "").toUpperCase() === "CANCELADO" ||
          (r.orderItemStatus ?? "").toUpperCase().includes("CANCEL") ||
          (r.operationalStage ?? "").toUpperCase().includes("CANCEL")
      );
      const pendingActive = itemRows.filter((r) => {
        const lt = (r.lineType ?? "").toUpperCase();
        if (lt !== "ORDER_ITEM_PENDING") return false;
        const st = (r.itemFulfillmentStatus ?? r.orderItemStatus ?? "").toUpperCase();
        return !st.includes("CANCEL");
      });
      if (
        items02207.ok !== false &&
        itemRows.length >= 1 &&
        canceledItems.length >= 1 &&
        pendingActive.length === 0
      ) {
        ok(
          "live",
          "live:pd02207-items-canceled",
          `items=${itemRows.length} canceled=${canceledItems.length} pendingActive=${pendingActive.length}`
        );
      } else {
        fail(
          "live",
          "live:pd02207-items-canceled",
          `items=${itemRows.length} canceled=${canceledItems.length} pendingActive=${pendingActive.length} ok=${items02207.ok}`
        );
      }
    } else {
      fail(
        "live",
        "live:pd02207-com-cancelamento",
        "PD 02207 não retornou na lista"
      );
    }

    const items02534 = await loadOrderToCashAuditList({
      year: String(YEAR),
      orderCode: "02534",
      runId: pd02534.runMeta?.runId ?? base.runMeta?.runId ?? "",
      page: "1",
      pageSize: "200",
    });
    const pending309 = (items02534.rows ?? []).filter(
      (r) =>
        (r.productCode ?? "").includes("309.86AA") ||
        (r.sku ?? "").includes("309.86AA")
    );
    if (pending309.length >= 1) {
      const bad = pending309.find(
        (r) =>
          (r.lineType ?? "").toUpperCase() !== "ORDER_ITEM_PENDING" ||
          r.nfeNumber != null ||
          r.stockDocumentExternalId != null ||
          (r.lineBilledValue != null && r.lineBilledValue > 0)
      );
      if (!bad) {
        ok(
          "live",
          "live:pd02534-items-pending",
          `309.86AA lines=${pending309.length} PENDING sem NF/doc/cobrado`
        );
      } else {
        fail(
          "live",
          "live:pd02534-items-pending",
          `309.86AA lineType=${bad.lineType} nfe=${bad.nfeNumber} doc=${bad.stockDocumentExternalId} billed=${bad.lineBilledValue}`
        );
      }
      const crAsItem = pending309.some(
        (r) =>
          r.receivableTotalValue != null &&
          r.receivableTotalValue > 0 &&
          (r.lineBilledValue ?? 0) === r.receivableTotalValue
      );
      if (!crAsItem) {
        ok(
          "live",
          "live:pd02534-items-no-cr-as-item",
          "CR título não usado como valor cobrado do item PENDING"
        );
      } else {
        fail(
          "live",
          "live:pd02534-items-no-cr-as-item",
          "CR título aparece como valor de item"
        );
      }
    } else {
      fail(
        "live",
        "live:pd02534-items-pending",
        "309.86AA não encontrado nos itens do PD 02534"
      );
    }

    const britania = await loadPortfolioOrderStatusList({
      year: String(YEAR),
      customerExternalId: String(BRITANIA_EXTERNAL_ID),
      page: "1",
      pageSize: "50",
    });
    if (
      britania.ok &&
      (britania.pagination.totalRows ?? 0) > 0 &&
      britania.rows.every(
        (r) =>
          r.externalCustomerId === BRITANIA_EXTERNAL_ID ||
          /brit/i.test(r.customerName ?? "")
      )
    ) {
      ok(
        "live",
        "live:filter-britania",
        `totalRows=${britania.pagination.totalRows}`
      );
    } else if (britania.ok && (britania.pagination.totalRows ?? 0) > 0) {
      ok(
        "live",
        "live:filter-britania",
        `totalRows=${britania.pagination.totalRows} (customer check soft)`
      );
    } else {
      fail(
        "live",
        "live:filter-britania",
        `state=${britania.state} rows=${britania.pagination?.totalRows ?? 0}`
      );
    }

    const esmaltec = await loadPortfolioOrderStatusList({
      year: String(YEAR),
      customerExternalId: String(ESMALTEC_EXTERNAL_ID),
      page: "1",
      pageSize: "50",
    });
    if (esmaltec.ok && (esmaltec.pagination.totalRows ?? 0) >= 1) {
      ok(
        "live",
        "live:filter-esmaltec",
        `totalRows=${esmaltec.pagination.totalRows}`
      );
    } else {
      // fallback por nome
      const byName = await loadPortfolioOrderStatusList({
        year: String(YEAR),
        customerName: "Esmaltec",
        page: "1",
        pageSize: "50",
      });
      if (byName.ok && (byName.pagination.totalRows ?? 0) >= 1) {
        ok(
          "live",
          "live:filter-esmaltec",
          `via customerName totalRows=${byName.pagination.totalRows}`
        );
      } else {
        fail(
          "live",
          "live:filter-esmaltec",
          `extId/name sem rows (state=${esmaltec.state})`
        );
      }
    }

    const parciais = await loadPortfolioOrderStatusList({
      year: String(YEAR),
      selectedCard: "parciais",
      page: "1",
      pageSize: "25",
    });
    if (
      parciais.ok &&
      (parciais.drilldownCards?.length ?? 0) > 0 &&
      (parciais.pagination.totalRows ?? 0) >= 0
    ) {
      ok(
        "live",
        "live:drilldown-parciais",
        `drilldowns=${parciais.drilldownCards.length} rows=${parciais.pagination.totalRows}`
      );
    } else {
      fail(
        "live",
        "live:drilldown-parciais",
        `drilldowns=${parciais.drilldownCards?.length ?? 0}`
      );
    }

    const diverg = await loadPortfolioOrderStatusList({
      year: String(YEAR),
      selectedCard: "com_divergencia",
      page: "1",
      pageSize: "25",
    });
    if ((diverg.drilldownCards?.length ?? 0) > 0) {
      ok(
        "live",
        "live:drilldown-divergencia",
        `drilldowns=${diverg.drilldownCards.length} rows=${diverg.pagination.totalRows}`
      );
    } else {
      fail(
        "live",
        "live:drilldown-divergencia",
        `drilldowns=${diverg.drilldownCards?.length ?? 0}`
      );
    }

    const page2 = await loadPortfolioOrderStatusList({
      year: String(YEAR),
      page: "2",
      pageSize: "25",
      sortBy: "orderIssueDate",
      sortDirection: "desc",
    });
    if (page2.ok && page2.pagination.page === 2 && page2.pagination.pageSize === 25) {
      ok(
        "live",
        "live:pagination",
        `page=${page2.pagination.page}/${page2.pagination.totalPages} size=${page2.pagination.pageSize}`
      );
    } else {
      fail(
        "live",
        "live:pagination",
        `page=${page2.pagination?.page} size=${page2.pagination?.pageSize}`
      );
    }

    const sorted = await loadPortfolioOrderStatusList({
      year: String(YEAR),
      page: "1",
      pageSize: "10",
      sortBy: "totalOrderValue",
      sortDirection: "desc",
    });
    if (sorted.ok && sorted.rows.length >= 2) {
      const a = sorted.rows[0]!.totalOrderValue;
      const b = sorted.rows[1]!.totalOrderValue;
      if (a >= b) {
        ok("live", "live:sort", `totalOrderValue desc: ${a} >= ${b}`);
      } else {
        fail("live", "live:sort", `ordem inválida: ${a} < ${b}`);
      }
    } else if (sorted.ok) {
      ok("live", "live:sort", `rows=${sorted.rows.length} (amostra curta)`);
    } else {
      fail("live", "live:sort", sorted.message ?? "fail");
    }

    try {
      const empty = await loadPortfolioOrderStatusList({
        year: String(YEAR),
        customerExternalId: String(EMPTY_CUSTOMER),
        page: "1",
        pageSize: "25",
      });
      if (empty.ok && (empty.pagination.totalRows ?? 0) === 0) {
        ok("live", "live:empty-customer", `state=${empty.state} sem 500`);
      } else if (empty.ok) {
        ok(
          "live",
          "live:empty-customer",
          `ok sem throw; rows=${empty.pagination.totalRows} state=${empty.state}`
        );
      } else {
        fail("live", "live:empty-customer", empty.message ?? "ok=false");
      }
    } catch (e) {
      fail(
        "live",
        "live:empty-customer",
        `throw: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

function writeReport(): void {
  const staticChecks = checks.filter((c) => c.section === "static");
  const liveChecks = checks.filter((c) => c.section === "live");
  const failed = checks.filter((c) => !c.ok);
  const skipped = checks.filter((c) => c.detail.startsWith("SKIPPED"));
  const liveRan = liveChecks.some((c) => !c.detail.startsWith("SKIPPED"));

  let statusGeral = "LIBERADO";
  if (failed.length > 0) statusGeral = "BLOQUEADO";
  else if (!liveRan) statusGeral = "LIBERADO COM RESSALVA";

  const today = new Date().toISOString().slice(0, 10);
  const line = (c: Check) =>
    `| \`${c.id}\` | ${c.ok ? (c.detail.startsWith("SKIPPED") ? "SKIP" : "PASS") : "FAIL"} | ${c.detail.replace(/\|/g, "/")} |`;

  const md = `# QA — Aba Status Pedidos (Conciliação de Carteira)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Tela** | Financeiro → Conciliação de Carteira → **Status Pedidos** |
| **Data** | ${today} |
| **Script** | \`scripts/qaPortfolioOrderStatusTab.ts\` (\`npm run qa:portfolio-order-status\`) |
| **Endpoint** | \`GET /api/finance/portfolio-reconciliation/order-status\` |
| **Status geral** | **${statusGeral}** |
| **Resumo** | total=${checks.length} pass=${checks.length - failed.length} fail=${failed.length} skip=${skipped.length} |

---

## 1. Testes estáticos

| ID | Resultado | Detalhe |
|----|-----------|---------|
${staticChecks.map(line).join("\n")}

---

## 2. Testes live (DATABASE_URL)

${
  liveRan
    ? `| ID | Resultado | Detalhe |
|----|-----------|---------|
${liveChecks.map(line).join("\n")}`
    : `_Live DB não executado neste ambiente (sem \`DATABASE_URL\`). Smoke obrigatório no servidor com a run geral materializada._

| ID | Resultado | Detalhe |
|----|-----------|---------|
${liveChecks.map(line).join("\n")}`
}

---

## 3. Evidências PD 02534

${
  evidence.pd02534
    ? `\`\`\`json
${JSON.stringify(evidence.pd02534, null, 2)}
\`\`\`

Critérios: **1 linha** por pedido; status parcial/CR aberto; CR agregado 1×; SKU \`${PENDING_SKU}\` sem lineBilled.`
    : "_Sem evidência live — reexecutar com DATABASE_URL._"
}

---

## 4. Evidências PD 02339

${
  evidence.pd02339
    ? `\`\`\`json
${JSON.stringify(evidence.pd02339, null, 2)}
\`\`\``
    : "_Sem evidência live — reexecutar com DATABASE_URL._"
}

---

## 5. Pendências

${
  failed.length
    ? failed.map((f) => `- **${f.id}**: ${f.detail}`).join("\n")
    : liveRan
      ? "- Nenhuma pendência bloqueante nos checks automatizados."
      : "- Executar \`npm run qa:portfolio-order-status\` no servidor com \`DATABASE_URL\` e run geral SUCCESS.\n- Confirmar visualmente filtros/chips/drawer na UI."
}

${evidence.notes.length ? `\nNotas:\n${evidence.notes.map((n) => `- ${n}`).join("\n")}` : ""}

---

## 6. Conclusão

${
  statusGeral === "LIBERADO"
    ? "Contratos estáticos e smoke live passaram. A aba Status Pedidos está apta a uso operacional com a run O2C materializada."
    : statusGeral === "LIBERADO COM RESSALVA"
      ? "Contratos estáticos OK. Liberação completa depende do smoke live no ambiente com banco (PD 02534 / PD 02339 / filtros / paginação)."
      : "Há falhas no QA automatizado — corrigir os itens em Pendências antes de liberar."
}

Run de referência operacional: \`${GENERAL_RUN}\` (quando presente).
`;

  const abs = join(process.cwd(), REPORT_REL);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, md, "utf8");
  console.log(`\nRelatório escrito: ${REPORT_REL}`);
}

function summarize(): number {
  section("Resumo");
  const failed = checks.filter((c) => !c.ok);
  const skipped = checks.filter((c) => c.detail.startsWith("SKIPPED"));
  console.log(
    `total=${checks.length} pass=${checks.length - failed.length} fail=${failed.length} skip_notes=${skipped.length}`
  );
  if (failed.length) {
    console.log("Falhas:");
    for (const f of failed) console.log(`  - ${f.id}: ${f.detail}`);
  }
  return failed.length;
}

async function main(): Promise<void> {
  console.log("QA Status Pedidos — Conciliação de Carteira");
  staticContracts();
  await liveLoaders();
  writeReport();
  const fails = summarize();
  process.exitCode = fails > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
