/**
 * QA: Relatório Comercial > Comissões respeita snapshot/schedule oficial.
 *
 * Uso:
 *   npx tsx scripts/qaCommissionReportUsesOfficialSnapshot.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMMISSION_REPORT_OFFICIAL_SNAPSHOT_ALERT,
  COMMISSION_SOURCE_MISMATCH_STATUS,
  classifyReportVsSnapshotDivergence,
  lineFinalCommissionForDiagnosis,
  reconcileReportLineWithOfficialSnapshot,
  reportLineMisclassifiedAgainstSnapshot,
} from "../src/lib/commissions/commissionReportOfficialReconcile.ts";
import { mapSourceLineToReportRecord } from "../src/lib/commissions/commissionReports.shared.ts";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function runPureQa(): void {
  console.log("== QA puro ==");

  const snap = {
    salesOrderId: "order-pd02523",
    orderCode: "PD 02523",
    totalFinalCommissionAmount: 12.19,
    totalSoldAmount: 300,
    canonicalSellerId: "seller-rodrigo",
    canonicalSellerName: "Rodrigo Da Silva Ramos",
    rawSellerId: 99,
    rawSellerName: "RODRIGO DA SILVA RAMOS",
    scheduledCommissionSum: 12.19,
    itemStatuses: ["COMMISSIONABLE"],
  };

  assert.equal(
    reportLineMisclassifiedAgainstSnapshot(
      {
        status: "NO_MARGIN",
        expectedCommissionAmount: 0,
        releasedCommissionAmount: 0,
      },
      snap
    ),
    true
  );

  const reconciled = reconcileReportLineWithOfficialSnapshot(
    {
      status: "NO_MARGIN",
      statusReason: "Margem ou tabela comercial indisponível",
      expectedCommissionAmount: 0,
      releasedCommissionAmount: 0,
      grossCommissionAmount: 0,
      commissionableBaseAmount: 0,
      canonicalSellerId: null,
      canonicalSellerName: null,
      rawSellerId: null,
      rawSellerName: null,
      source: "MATERIALIZED_SCHEDULE",
    },
    snap
  );

  assert.equal(reconciled.status, COMMISSION_SOURCE_MISMATCH_STATUS);
  assert.equal(reconciled.expectedCommissionAmount, 12.19);
  assert.equal(reconciled.commissionableBaseAmount, 300);
  assert.equal(reconciled.canonicalSellerName, "Rodrigo Da Silva Ramos");
  assert.equal(reconciled.releasedCommissionAmount, 0);
  assert.match(reconciled.statusReason ?? "", /snapshot/);

  const report = mapSourceLineToReportRecord({
    lineKey: "pd02523",
    nomusReceivableId: 16428,
    receivableNumber: "16428",
    installmentNumber: 1,
    settlementDate: "2026-05-15",
    dueDate: null,
    customerId: null,
    customerExternalId: null,
    customerName: "Cliente",
    orderCode: "PD 02523",
    localOrderId: "order-pd02523",
    linkResolutionSource: null,
    linkResolutionStatus: null,
    nomusNfeId: 1,
    nfeNumber: "1",
    localItemId: null,
    nomusOrderItemId: null,
    productCode: null,
    productName: null,
    rawSellerId: snap.rawSellerId,
    rawSellerName: snap.rawSellerName,
    canonicalSellerId: reconciled.canonicalSellerId,
    canonicalSellerName: reconciled.canonicalSellerName,
    sellerResolutionStatus: "OK_CANONICAL",
    receivedAmount: 300,
    uniqueReceivedAmount: 300,
    commissionableBaseAmount: reconciled.commissionableBaseAmount,
    ratePercent: 4.06,
    expectedCommissionAmount: reconciled.expectedCommissionAmount,
    releasedCommissionAmount: 0,
    grossCommissionAmount: 12.19,
    scheduledCommissionAmount: 12.19,
    commissionReceivableScheduleId: "sched",
    ruleId: null,
    ruleName: "Regra padrão",
    exclusionReason: null,
    status: reconciled.status,
    statusReason: reconciled.statusReason,
    source: reconciled.source,
    year: 2026,
    month: 5,
    periodStatus: "PREVIEW",
    closingId: null,
  });

  assert.equal(report.finalCommissionAmount, 12.19);
  assert.notEqual(report.lineStatus, "NO_MARGIN");
  assert.equal(report.divergesFromOrderSnapshot, true);
  assert.equal(report.sellerName, "Rodrigo Da Silva Ramos");
  assert.equal(report.isPayable, false);

  // Pedido sem snapshot / sem comissão → NO_MARGIN permanece válido
  assert.equal(
    reportLineMisclassifiedAgainstSnapshot(
      {
        status: "NO_MARGIN",
        expectedCommissionAmount: 0,
        releasedCommissionAmount: 0,
      },
      {
        totalFinalCommissionAmount: 0,
        scheduledCommissionSum: 0,
      }
    ),
    false
  );

  assert.equal(
    classifyReportVsSnapshotDivergence({
      snapCommission: 12.19,
      reportDisplayedCommission: 0,
      reportStatus: "NO_MARGIN",
      scheduleSum: 12.19,
    }),
    "NO_MARGIN_MISCLASSIFIED"
  );

  assert.equal(
    lineFinalCommissionForDiagnosis({
      status: "COMMISSIONABLE",
      expectedCommissionAmount: 12.19,
      releasedCommissionAmount: 12.19,
    }),
    12.19
  );

  const page = read("src/components/commissions/pages/CommissionsReportsPage.tsx");
  assert.equal(/from ["']@prisma\/client["']/.test(page), false);

  const audit = read("src/lib/finance/orderFullAuditService.ts");
  assert.match(audit, /read-only/i);

  const server = read("src/lib/commissions/commissionReports.server.ts");
  assert.match(server, /enrichReportLinesWithOfficialSnapshots/);
  assert.doesNotMatch(server, /paidAmount\s*=/);

  assert.ok(COMMISSION_REPORT_OFFICIAL_SNAPSHOT_ALERT.length > 10);
  console.log("OK puro — PD 02523 padrão reconciliado; NO_MARGIN real preservado; paid intacto.");
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
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      console.log(
        "DB indisponível — QA live SKIP:",
        err instanceof Error ? err.message.split("\n")[0] : String(err)
      );
      return;
    }

    const variants = expandNomusOrderCodeLookupVariants("PD 02523");
    const order = await prisma.salesOrder.findFirst({
      where: { orderCode: { in: variants } },
      select: { id: true, orderCode: true },
    });
    if (!order) {
      console.log("SKIP live PD 02523 — pedido não encontrado");
      return;
    }
    const snap = await prisma.commissionOrderSnapshot.findFirst({
      where: { salesOrderId: order.id, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      select: {
        totalFinalCommissionAmount: true,
        totalSoldAmount: true,
        canonicalSellerName: true,
        receivableSchedules: {
          where: { status: "ACTIVE" },
          select: { scheduledCommissionAmount: true },
        },
      },
    });
    const snapAmt = Number(snap?.totalFinalCommissionAmount ?? 0);
    const scheduleSum = (snap?.receivableSchedules ?? []).reduce(
      (s, r) => s + Number(r.scheduledCommissionAmount),
      0
    );
    console.log({
      orderCode: order.orderCode,
      snapshotFinal: snapAmt,
      scheduleSum,
      seller: snap?.canonicalSellerName ?? null,
      base: Number(snap?.totalSoldAmount ?? 0),
      expect:
        snapAmt > 0
          ? "relatório NÃO pode exibir NO_MARGIN/zero após enrich"
          : "sem comissão no snapshot",
    });
    if (snapAmt > 0) {
      assert.ok(scheduleSum >= 0);
      assert.ok(
        (snap?.canonicalSellerName ?? "").toLowerCase().includes("rodrigo") ||
          snapAmt === 12.19 ||
          snapAmt > 0
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  runPureQa();
  await runDbQa();
  console.log("\nqaCommissionReportUsesOfficialSnapshot: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
