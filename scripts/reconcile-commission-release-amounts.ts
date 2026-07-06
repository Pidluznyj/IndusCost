#!/usr/bin/env npx tsx
/**
 * Recalcula liberação de comissões (schedules + releasedAmount) de forma idempotente.
 *
 * Uso:
 *   npx tsx scripts/reconcile-commission-release-amounts.ts --preview --year=2026 --month=6
 *   npx tsx scripts/reconcile-commission-release-amounts.ts --apply --year=2026 --month=6 --commissionPersonId=UUID
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { decimalToNumber, roundMoney } from "../src/lib/commissions/commission-money.ts";
import { resolveEffectiveReleaseRule } from "../src/lib/commissions/commission-release-service.ts";
import { recomputeCommissionRecordRelease } from "../src/lib/commissions/commission-release-service.ts";
import { loadCommissionSettings } from "../src/lib/commissions/commission-settings.server.ts";
import {
  fmtBrl,
  parseArg,
  parseScriptMode,
  requireDatabaseUrl,
  warnCommissionLegacyMode,
} from "./commission-script-utils.ts";
import { buildCommissionRecordPeriodWhere } from "../src/lib/commissions/commissionQuery.ts";

type ChangeRow = {
  recordId: string;
  orderCode: string | null;
  commissionPersonName: string;
  scheduleId: string;
  nomusReceivableId: number | null;
  commissionExpectedAmount: number;
  oldReleased: number;
  newReleased: number;
  diff: number;
  oldRecordReleased: number;
  newRecordReleased: number;
};

async function main(): Promise<void> {
  requireDatabaseUrl();
  warnCommissionLegacyMode("reconcile-commission-release-amounts");
  const mode = parseScriptMode();
  const year = parseArg("year") ?? "2026";
  const month = parseArg("month") ?? "6";
  const commissionPersonId = parseArg("commissionPersonId");
  const sellerName = parseArg("seller");

  let personFilter = commissionPersonId;
  if (!personFilter && sellerName) {
    const person = await prisma.commissionPerson.findFirst({
      where: { name: { contains: sellerName.trim(), mode: "insensitive" }, active: true },
      select: { id: true, name: true },
    });
    if (!person) {
      console.error(`Pessoa comissionada não encontrada: ${sellerName}`);
      process.exit(1);
    }
    personFilter = person.id;
    console.log(`Vendedor: ${person.name} (${person.id})\n`);
  }

  const periodWhere = buildCommissionRecordPeriodWhere(
    {
      year: Number(year),
      month: Number(month),
      page: 1,
      pageSize: 1,
      periodBasis: "confirmedAt",
    },
    "confirmedAt"
  );

  const where = {
    AND: [
      periodWhere,
      ...(personFilter ? [{ commissionPersonId: personFilter }] : []),
    ],
  };

  const settings = await loadCommissionSettings(prisma);
  const records = await prisma.commissionRecord.findMany({
    where,
    include: {
      commissionPerson: { select: { name: true } },
      paymentSchedules: {
        where: { source: "ACCOUNTS_RECEIVABLE" },
        orderBy: [{ dueDate: "asc" }, { installmentNumber: "asc" }],
      },
    },
  });

  console.log("=== Reconciliação liberação de comissões ===");
  console.log(`Modo: ${mode.toUpperCase()}`);
  console.log(`Período: ${month}/${year}`);
  console.log(`Registros: ${records.length}\n`);

  const changes: ChangeRow[] = [];
  let totalOldRecordReleased = 0;
  let totalNewRecordReleased = 0;
  let totalCommission = 0;
  let excessBefore = 0;
  const bySeller = new Map<string, { commission: number; before: number; after: number }>();

  for (const record of records) {
    const commissionAmount = decimalToNumber(record.commissionAmount);
    const oldRecordReleased = decimalToNumber(record.releasedAmount);
    totalCommission = roundMoney(totalCommission + commissionAmount);
    totalOldRecordReleased = roundMoney(totalOldRecordReleased + oldRecordReleased);

    const personName = record.commissionPerson.name;
    const sellerBucket = bySeller.get(personName) ?? { commission: 0, before: 0, after: 0 };
    sellerBucket.commission = roundMoney(sellerBucket.commission + commissionAmount);
    sellerBucket.before = roundMoney(sellerBucket.before + oldRecordReleased);
    bySeller.set(personName, sellerBucket);

    const releaseRule = resolveEffectiveReleaseRule(record.releaseRule, settings);
    const arSchedules = record.paymentSchedules;

    const recomputed = recomputeCommissionRecordRelease({
      releaseRule,
      commissionAmount,
      paidAmount: decimalToNumber(record.paidAmount),
      receivableAsDefinitiveReleaseSource: settings.receivableAsDefinitiveReleaseSource,
      schedules: arSchedules.map((schedule) => ({
        id: schedule.id,
        commissionExpectedAmount: decimalToNumber(schedule.commissionExpectedAmount),
        commissionReleasedAmount: decimalToNumber(schedule.commissionReleasedAmount),
        receivableAmount:
          schedule.receivableAmount != null ? decimalToNumber(schedule.receivableAmount) : null,
        receivedAmount:
          schedule.receivedAmount != null ? decimalToNumber(schedule.receivedAmount) : null,
        receivable:
          schedule.nomusReceivableId != null
            ? {
                nomusReceivableId: schedule.nomusReceivableId,
                nomusNfeId: schedule.nomusNfeId,
                installmentNumber: schedule.installmentNumber,
                dueDate: schedule.dueDate,
                amountReceivable: decimalToNumber(schedule.receivableAmount),
                amountReceived: decimalToNumber(schedule.receivedAmount),
                balanceReceivable: decimalToNumber(schedule.openBalance),
                settlementDate: null,
              }
            : null,
      })),
    });

    totalNewRecordReleased = roundMoney(totalNewRecordReleased + recomputed.releasedAmount);
    sellerBucket.after = roundMoney(sellerBucket.after + recomputed.releasedAmount);
    bySeller.set(personName, sellerBucket);

    for (const scheduleUpdate of recomputed.scheduleUpdates) {
      const schedule = arSchedules.find((s) => s.id === scheduleUpdate.id);
      if (!schedule) continue;
      const expected = decimalToNumber(schedule.commissionExpectedAmount);
      const oldReleased = decimalToNumber(schedule.commissionReleasedAmount);
      const newReleased = scheduleUpdate.commissionReleasedAmount;

      if (oldReleased > expected + 0.001) {
        excessBefore = roundMoney(excessBefore + (oldReleased - expected));
      }

      if (Math.abs(oldReleased - newReleased) > 0.001) {
        changes.push({
          recordId: record.id,
          orderCode: record.orderCode,
          commissionPersonName: record.commissionPerson.name,
          scheduleId: schedule.id,
          nomusReceivableId: schedule.nomusReceivableId,
          commissionExpectedAmount: expected,
          oldReleased,
          newReleased,
          diff: roundMoney(newReleased - oldReleased),
          oldRecordReleased,
          newRecordReleased: recomputed.releasedAmount,
        });
      }
    }

    if (
      mode === "apply" &&
      (Math.abs(oldRecordReleased - recomputed.releasedAmount) > 0.001 ||
        recomputed.scheduleUpdates.some((u) => {
          const sch = arSchedules.find((s) => s.id === u.id);
          return (
            sch &&
            Math.abs(decimalToNumber(sch.commissionReleasedAmount) - u.commissionReleasedAmount) >
              0.001
          );
        }))
    ) {
      for (const scheduleUpdate of recomputed.scheduleUpdates) {
        await prisma.commissionPaymentSchedule.update({
          where: { id: scheduleUpdate.id },
          data: {
            commissionReleasedAmount: scheduleUpdate.commissionReleasedAmount,
            status: scheduleUpdate.scheduleStatus,
          },
        });
      }
      await prisma.commissionRecord.update({
        where: { id: record.id },
        data: {
          releasedAmount: recomputed.releasedAmount,
          status: recomputed.status,
          balanceAmount: recomputed.balanceAmount,
          releasedAt: recomputed.releasedAmount > 0 ? new Date() : record.releasedAt,
        },
      });
    }
  }

  console.log("--- Totais ---");
  console.log(`Comissão calculada: ${fmtBrl(totalCommission)}`);
  console.log(`Liberado antes (records): ${fmtBrl(totalOldRecordReleased)}`);
  console.log(`Liberado depois (estimado): ${fmtBrl(totalNewRecordReleased)}`);
  console.log(`Diferença: ${fmtBrl(roundMoney(totalNewRecordReleased - totalOldRecordReleased))}`);
  console.log(`Excesso schedule > expected (antes): ${fmtBrl(excessBefore)}`);
  console.log(`Linhas alteradas: ${changes.length}`);

  console.log("\n--- Por vendedor ---");
  for (const [name, totals] of bySeller) {
    console.log(
      `  ${name}: comissão ${fmtBrl(totals.commission)} | liberado ${fmtBrl(totals.before)} → ${fmtBrl(totals.after)}`
    );
  }

  if (changes.length > 0) {
    console.log("\n--- Amostra de alterações (até 20) ---");
    for (const row of changes.slice(0, 20)) {
      console.log(
        [
          row.commissionPersonName,
          `pedido=${row.orderCode ?? "—"}`,
          `AR=${row.nomusReceivableId ?? "—"}`,
          `expected=${row.commissionExpectedAmount.toFixed(2)}`,
          `old=${row.oldReleased.toFixed(2)}`,
          `new=${row.newReleased.toFixed(2)}`,
          `diff=${row.diff.toFixed(2)}`,
        ].join(" | ")
      );
    }
  }

  if (mode === "apply") {
    console.log("\n✓ Alterações aplicadas.");
  } else {
    console.log("\nModo preview — use --apply para persistir.");
  }
}

main()
  .catch((err) => {
    console.error("Erro:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
