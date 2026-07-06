#!/usr/bin/env npx tsx
/**
 * Auditoria read-only de liberação financeira de comissões vs recebimentos.
 *
 * Uso:
 *   npx tsx scripts/audit-commission-financial-release.ts --year=2026
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { decimalToNumber, roundMoney } from "../src/lib/commissions/commission-money.ts";
import {
  activeCommissionRecordWhere,
  parseYearPeriod,
  requireDatabaseUrl,
  warnCommissionLegacyMode,
} from "./commission-script-utils.ts";

type ReleaseIssue = {
  tipo: string;
  recordId: string;
  orderCode: string | null;
  detalhe: string;
};

function fmtBrl(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  warnCommissionLegacyMode("audit-commission-financial-release");
  const range = parseYearPeriod();

  console.log("=== Auditoria de liberação financeira — Comissões ===");
  console.log(`Período: ${range.label}`);
  console.log("Modo: read-only\n");

  const records = await prisma.commissionRecord.findMany({
    where: activeCommissionRecordWhere({ from: range.from, to: range.to }),
    select: {
      id: true,
      orderCode: true,
      status: true,
      commissionAmount: true,
      releasedAmount: true,
      paidAmount: true,
      balanceAmount: true,
      paymentSchedules: {
        where: { source: "ACCOUNTS_RECEIVABLE" },
        select: {
          nomusReceivableId: true,
          receivableAmount: true,
          receivedAmount: true,
          commissionReleasedAmount: true,
          commissionExpectedAmount: true,
        },
      },
    },
  });

  let totalCommission = 0;
  let totalReleased = 0;
  let totalPaid = 0;
  let totalBalance = 0;
  let paidWithoutRelease = 0;
  let releasedAboveCommission = 0;
  let releasedWithReceivableGap = 0;
  let scheduleReleasedAboveExpected = 0;
  const issues: ReleaseIssue[] = [];

  for (const record of records) {
    const commission = decimalToNumber(record.commissionAmount);
    const released = decimalToNumber(record.releasedAmount);
    const paid = decimalToNumber(record.paidAmount);
    const balance = decimalToNumber(record.balanceAmount);

    totalCommission = roundMoney(totalCommission + commission);
    totalReleased = roundMoney(totalReleased + released);
    totalPaid = roundMoney(totalPaid + paid);
    totalBalance = roundMoney(totalBalance + balance);

    if (paid > 0 && released <= 0) {
      paidWithoutRelease += 1;
      if (issues.filter((i) => i.tipo === "PAGO_SEM_LIBERACAO").length < 5) {
        issues.push({
          tipo: "PAGO_SEM_LIBERACAO",
          recordId: record.id,
          orderCode: record.orderCode,
          detalhe: `paid=${fmtBrl(paid)} released=${fmtBrl(released)} status=${record.status}`,
        });
      }
    }

    if (released > commission + 0.01) {
      releasedAboveCommission += 1;
      if (issues.filter((i) => i.tipo === "LIBERADO_ACIMA_COMISSAO").length < 5) {
        issues.push({
          tipo: "LIBERADO_ACIMA_COMISSAO",
          recordId: record.id,
          orderCode: record.orderCode,
          detalhe: `released=${fmtBrl(released)} commission=${fmtBrl(commission)}`,
        });
      }
    }

    if (paid > released + 0.01) {
      if (issues.filter((i) => i.tipo === "PAGO_ACIMA_LIBERADO").length < 5) {
        issues.push({
          tipo: "PAGO_ACIMA_LIBERADO",
          recordId: record.id,
          orderCode: record.orderCode,
          detalhe: `paid=${fmtBrl(paid)} released=${fmtBrl(released)}`,
        });
      }
    }

    const expectedBalance = roundMoney(Math.max(0, commission - released));
    if (Math.abs(balance - expectedBalance) > 0.02) {
      if (issues.filter((i) => i.tipo === "SALDO_DIVERGENTE").length < 5) {
        issues.push({
          tipo: "SALDO_DIVERGENTE",
          recordId: record.id,
          orderCode: record.orderCode,
          detalhe: `balance=${fmtBrl(balance)} esperado=${fmtBrl(expectedBalance)}`,
        });
      }
    }

    for (const schedule of record.paymentSchedules) {
      const scheduleReleased = decimalToNumber(schedule.commissionReleasedAmount);
      const scheduleExpected = decimalToNumber(schedule.commissionExpectedAmount);
      const received = decimalToNumber(schedule.receivedAmount);
      const receivable = decimalToNumber(schedule.receivableAmount);
      if (scheduleReleased > scheduleExpected + 0.01) {
        scheduleReleasedAboveExpected += 1;
        if (issues.filter((i) => i.tipo === "LIBERADO_ACIMA_ESPERADO_PARCELA").length < 5) {
          issues.push({
            tipo: "LIBERADO_ACIMA_ESPERADO_PARCELA",
            recordId: record.id,
            orderCode: record.orderCode,
            detalhe: `AR ${schedule.nomusReceivableId}: released=${fmtBrl(scheduleReleased)} expected=${fmtBrl(scheduleExpected)}`,
          });
        }
      }
      if (received > 0 && scheduleReleased <= 0) {
        releasedWithReceivableGap += 1;
        if (issues.filter((i) => i.tipo === "RECEBIDO_SEM_LIBERACAO_PARCELA").length < 5) {
          issues.push({
            tipo: "RECEBIDO_SEM_LIBERACAO_PARCELA",
            recordId: record.id,
            orderCode: record.orderCode,
            detalhe: `AR ${schedule.nomusReceivableId}: received=${fmtBrl(received)} released=${fmtBrl(scheduleReleased)}`,
          });
        }
      }
      if (receivable > 0 && received > receivable + 0.01) {
        if (issues.filter((i) => i.tipo === "RECEBIDO_ACIMA_TITULO").length < 5) {
          issues.push({
            tipo: "RECEBIDO_ACIMA_TITULO",
            recordId: record.id,
            orderCode: record.orderCode,
            detalhe: `AR ${schedule.nomusReceivableId}: received=${fmtBrl(received)} receivable=${fmtBrl(receivable)}`,
          });
        }
      }
    }
  }

  const releasedRecords = await prisma.commissionRecord.count({
    where: {
      calculatedAt: { gte: range.from, lte: range.to },
      status: { in: ["PARTIALLY_RELEASED", "RELEASED", "PAID_PARTIAL", "PAID_TOTAL"] },
    },
  });

  console.log("--- Totais financeiros ---");
  console.log(`Registros analisados: ${records.length}`);
  console.log(`Comissão total: ${fmtBrl(totalCommission)}`);
  console.log(`Liberado total: ${fmtBrl(totalReleased)}`);
  console.log(`Pago total: ${fmtBrl(totalPaid)}`);
  console.log(`Saldo total (balanceAmount): ${fmtBrl(totalBalance)}`);
  console.log(`Registros com liberação/pagamento: ${releasedRecords}`);
  console.log(`Pagos sem liberação: ${paidWithoutRelease}`);
  console.log(`Liberado acima da comissão: ${releasedAboveCommission}`);
  console.log(`Parcelas AR recebidas sem liberação: ${releasedWithReceivableGap}`);
  console.log(`Parcelas liberadas acima do commissionExpectedAmount: ${scheduleReleasedAboveExpected}`);

  console.log("\n--- Amostras de inconsistências (até 5 por tipo) ---");
  if (issues.length === 0) {
    console.log("Nenhuma inconsistência financeira amostrada no recorte.");
  } else {
    const byType = new Map<string, ReleaseIssue[]>();
    for (const item of issues) {
      const list = byType.get(item.tipo) ?? [];
      list.push(item);
      byType.set(item.tipo, list);
    }
    for (const [tipo, items] of byType) {
      console.log(`\n[${tipo}]`);
      for (const item of items) {
        console.log(
          `  • record=${item.recordId} pedido=${item.orderCode ?? "—"} | ${item.detalhe}`
        );
      }
    }
  }

  console.log("\n=== Fim da auditoria de liberação financeira ===");
}

main()
  .catch((err) => {
    console.error("Erro na auditoria:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
