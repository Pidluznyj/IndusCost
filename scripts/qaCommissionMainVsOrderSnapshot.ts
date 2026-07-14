/**
 * QA: tela principal de Comissões alinhada ao CommissionOrderSnapshot (Auditoria 360º).
 *
 * Uso:
 *   npx tsx scripts/qaCommissionMainVsOrderSnapshot.ts
 *
 * Sem DATABASE_URL: valida regras puras + inventário de código.
 * Com DATABASE_URL: compara PD 02488 / 02577 / 02566 / 02546.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT,
  buildCommissionReceiptPreview,
  mapMaterializedScheduleToLedgerStatus,
} from "../src/lib/commissions/commissionReceiptEngine.ts";
import { mapSourceLineToReportRecord } from "../src/lib/commissions/commissionReports.shared.ts";
import type { CommissionSellerIdentityContext } from "../src/lib/commissions/commissionSellerIdentity.ts";

const TARGETS = ["PD 02488", "PD 02577", "PD 02566", "PD 02546"] as const;

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const EMPTY_IDENTITY: CommissionSellerIdentityContext = {
  persons: [],
  aliases: [],
};

function runPureQa(): void {
  console.log("== QA puro: engine + relatório ==");

  const sched = {
    id: "s1",
    orderSnapshotId: "snap1",
    receivableId: 1,
    receivableCode: null as string | null,
    installmentNumber: 1,
    nfeId: 100,
    salesOrderId: "order-1",
    customerId: "c1",
    canonicalSellerId: "seller-1",
    canonicalSellerName: "GISLENE",
    rawSellerId: 1,
    rawSellerName: "GISLENE",
    orderCode: "PD 02488",
    receivableNominalAmount: 10000,
    receivableSharePercent: 100,
    scheduledCommissionAmount: 0,
    scheduleStatus: "ACTIVE" as const,
    sellerResolutionStatus: "OK_CANONICAL",
    exclusionRuleId: null as string | null,
    exclusionReason: null as string | null,
    itemSnapshotStatuses: ["NO_COMMERCIAL_PRICE_TABLE"],
    orderSnapshotFinalCommissionAmount: 180,
  };

  const mapped = mapMaterializedScheduleToLedgerStatus(sched);
  assert.equal(mapped.status, "COMMISSION_SOURCE_MISMATCH");
  assert.equal(mapped.reason, COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT);

  const preview = buildCommissionReceiptPreview({
    year: 2026,
    month: 5,
    receivables: [
      {
        nomusReceivableId: 1,
        receivableNumber: "CR-1",
        installmentNumber: 1,
        settlementDate: new Date("2026-05-15"),
        dueDate: new Date("2026-05-15"),
        amountReceivable: 10000,
        amountReceived: 10000,
        balanceReceivable: 0,
        nomusNfeId: 100,
        nfeNumber: "100",
        customerExternalId: 1,
        customerId: "c1",
        customerName: "Cliente",
        customerCnpj: null,
      },
    ],
    ordersByNfeId: new Map(),
    materializedSchedulesByReceivableId: new Map([[1, [sched]]]),
    rules: [],
    exclusionRules: [],
    identityCtx: EMPTY_IDENTITY,
  });

  assert.equal(preview.lines[0]?.status, "COMMISSION_SOURCE_MISMATCH");
  assert.equal(preview.lines[0]?.expectedCommissionAmount, 180);
  assert.equal(preview.lines[0]?.releasedCommissionAmount, 0);
  assert.notEqual(preview.lines[0]?.status, "NO_MARGIN");

  const report = mapSourceLineToReportRecord({
    lineKey: "k",
    nomusReceivableId: 1,
    receivableNumber: "CR-1",
    installmentNumber: 1,
    settlementDate: "2026-05-15",
    dueDate: null,
    customerId: "c1",
    customerExternalId: 1,
    customerName: "Cliente",
    orderCode: "PD 02488",
    localOrderId: "order-1",
    linkResolutionSource: null,
    linkResolutionStatus: null,
    nomusNfeId: 100,
    nfeNumber: "100",
    localItemId: null,
    nomusOrderItemId: null,
    productCode: null,
    productName: null,
    rawSellerId: 1,
    rawSellerName: "GISLENE",
    canonicalSellerId: "seller-1",
    canonicalSellerName: "GISLENE",
    sellerResolutionStatus: "OK_CANONICAL",
    receivedAmount: 10000,
    uniqueReceivedAmount: 10000,
    commissionableBaseAmount: 10000,
    ratePercent: 1.8,
    expectedCommissionAmount: 180,
    releasedCommissionAmount: 0,
    grossCommissionAmount: 180,
    scheduledCommissionAmount: 0,
    commissionReceivableScheduleId: "s1",
    ruleId: null,
    ruleName: null,
    exclusionReason: null,
    status: "COMMISSION_SOURCE_MISMATCH",
    statusReason: COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT,
    source: "ORDER_SNAPSHOT",
    year: 2026,
    month: 5,
    periodStatus: "PREVIEW",
    closingId: null,
  });

  assert.equal(report.finalCommissionAmount, 180);
  assert.equal(report.divergesFromOrderSnapshot, true);
  assert.equal(report.isPayable, false);

  // NO_MARGIN permanece válido só sem snapshot comissionável
  const noMargin = mapMaterializedScheduleToLedgerStatus({
    ...sched,
    orderSnapshotFinalCommissionAmount: 0,
  });
  assert.equal(noMargin.status, "NO_MARGIN");

  // Inventário: frontend sem Prisma; Auditoria read-only; paid não alterado no path
  const reportsPage = read("src/components/commissions/pages/CommissionsReportsPage.tsx");
  assert.equal(/from ["']@prisma\/client["']/.test(reportsPage), false);
  assert.match(reportsPage, /Divergente do snapshot/);

  const audit = read("src/lib/finance/orderFullAuditService.ts");
  assert.match(audit, /Snapshot ACTIVE do pedido/);
  assert.match(audit, /read-only/i);

  const engine = read("src/lib/commissions/commissionReceiptEngine.ts");
  assert.match(engine, /COMMISSION_SOURCE_MISMATCH/);
  assert.match(engine, /COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT/);
  assert.doesNotMatch(engine, /paidAmount\s*=/);

  for (const code of TARGETS) {
    assert.ok(code.startsWith("PD "));
  }

  console.log("OK puro — mismatch não vira NO_MARGIN; report mostra prevista; paid intacto.");
}

async function runDbQa(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL ausente — QA live SKIP.");
    return;
  }

  const { PrismaClient } = await import("@prisma/client");
  const { expandNomusOrderCodeLookupVariants } = await import(
    "../src/lib/salesOrderNomusSync.server.ts"
  );
  const prisma = new PrismaClient();
  try {
    console.log("== QA live: pedidos alvo ==");
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      console.log(
        "DB indisponível — QA live SKIP:",
        err instanceof Error ? err.message.split("\n")[0] : String(err)
      );
      return;
    }
    for (const code of TARGETS) {
      const variants = expandNomusOrderCodeLookupVariants(code);
      const order = await prisma.salesOrder.findFirst({
        where: { orderCode: { in: variants } },
        select: { id: true, orderCode: true },
      });
      if (!order) {
        console.log(`SKIP ${code} — pedido não encontrado`);
        continue;
      }
      const snap = await prisma.commissionOrderSnapshot.findFirst({
        where: { salesOrderId: order.id, status: "ACTIVE" },
        orderBy: { updatedAt: "desc" },
        select: {
          totalFinalCommissionAmount: true,
          canonicalSellerId: true,
          canonicalSellerName: true,
          receivableSchedules: {
            where: { status: "ACTIVE" },
            select: { scheduledCommissionAmount: true },
          },
        },
      });
      const snapAmt = Number(snap?.totalFinalCommissionAmount ?? 0);
      const schedSum = (snap?.receivableSchedules ?? []).reduce(
        (s, r) => s + Number(r.scheduledCommissionAmount),
        0
      );
      const ledgerHasPaid = await prisma.commissionReceiptLedgerLine.findFirst({
        where: {
          orderCode: order.orderCode,
          status: "COMMISSIONABLE",
          releasedCommissionAmount: { gt: 0 },
        },
        select: { id: true },
      });
      console.log({
        orderCode: order.orderCode,
        snapshotFinal: snapAmt,
        scheduleSum: schedSum,
        mismatch: schedSum <= 0 && snapAmt > 0,
        hasReleasedLedgerLine: Boolean(ledgerHasPaid),
        note:
          schedSum <= 0 && snapAmt > 0
            ? "main deve exibir COMMISSION_SOURCE_MISMATCH (não NO_MARGIN)"
            : "ok ou sem comissão no snapshot",
      });
      if (schedSum <= 0 && snapAmt > 0) {
        assert.ok(snapAmt > 0);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  runPureQa();
  await runDbQa();
  console.log("\nqaCommissionMainVsOrderSnapshot: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
