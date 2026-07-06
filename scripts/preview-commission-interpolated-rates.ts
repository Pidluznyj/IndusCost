#!/usr/bin/env npx tsx
/**
 * Preview/apply comissão proporcional interpolada entre faixas comerciais.
 *
 * Uso:
 *   npx tsx scripts/preview-commission-interpolated-rates.ts --preview --year=2026 --month=6 --seller="GISLENE LIMA"
 *   npx tsx scripts/preview-commission-interpolated-rates.ts --apply --year=2026 --month=6 --commissionPersonId=UUID
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  allocateProportional,
  computeCommissionAmount,
  decimalToNumber,
  roundMoney,
} from "../src/lib/commissions/commission-money.ts";
import {
  buildCommercialTierMetadata,
  commercialTiersFromMetadata,
  resolveCommercialPriceTier,
  type ResolveCommercialTierSuccess,
} from "../src/lib/commissions/commission-commercial-tier.ts";
import { isPaidCommissionStatus } from "../src/lib/commissions/commission-calculation-hash.ts";
import {
  computeBalanceAfterRelease,
  recomputeCommissionRecordRelease,
  resolveEffectiveReleaseRule,
} from "../src/lib/commissions/commission-release-service.ts";
import { loadCommissionSettings } from "../src/lib/commissions/commission-settings.server.ts";
import { buildCommissionRecordPeriodWhere } from "../src/lib/commissions/commissionQuery.ts";
import {
  fmtBrl,
  parseArg,
  parseScriptMode,
  requireDatabaseUrl,
  warnCommissionLegacyMode,
} from "./commission-script-utils.ts";

type SimRow = {
  recordId: string;
  orderCode: string | null;
  nfeNumber: string | null;
  productCode: string | null;
  customerName: string | null;
  commissionPersonName: string;
  status: string;
  baseAmount: number;
  oldRate: number;
  newRate: number;
  oldCommission: number;
  newCommission: number;
  diff: number;
  oldTierCode: string | null;
  newTierCode: string | null;
  outOfTable: boolean;
  ceilingTier: boolean;
  insufficient: boolean;
};

function parseOptionalNum(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function metaStr(metadataJson: unknown, key: string): string | null {
  if (!metadataJson || typeof metadataJson !== "object") return null;
  const v = (metadataJson as Record<string, unknown>)[key];
  return typeof v === "string" ? v : v != null ? String(v) : null;
}

function simulateRecord(record: {
  id: string;
  orderCode: string | null;
  nfeNumber: string | null;
  productCode: string | null;
  customerName: string | null;
  status: string;
  baseAmount: unknown;
  ratePercent: unknown;
  commissionAmount: unknown;
  metadataJson: unknown;
  commissionPerson: { name: string };
}): SimRow | null {
  const baseAmount = decimalToNumber(record.baseAmount);
  const oldRate = decimalToNumber(record.ratePercent);
  const oldCommission = decimalToNumber(record.commissionAmount);
  const meta = record.metadataJson as Record<string, unknown> | null;
  const soldUnitPrice =
    meta?.soldUnitPrice != null ? Number(meta.soldUnitPrice) : null;
  const tiers = commercialTiersFromMetadata(record.metadataJson);

  if (!tiers || soldUnitPrice == null || !Number.isFinite(soldUnitPrice)) {
    return {
      recordId: record.id,
      orderCode: record.orderCode,
      nfeNumber: record.nfeNumber,
      productCode: record.productCode,
      customerName: record.customerName,
      commissionPersonName: record.commissionPerson.name,
      status: record.status,
      baseAmount,
      oldRate,
      newRate: oldRate,
      oldCommission,
      newCommission: oldCommission,
      diff: 0,
      oldTierCode: metaStr(record.metadataJson, "tierCode"),
      newTierCode: null,
      outOfTable: false,
      ceilingTier: false,
      insufficient: true,
    };
  }

  const tierResult = resolveCommercialPriceTier({ soldUnitPrice, tiers });
  if (!tierResult.ok) {
    return {
      recordId: record.id,
      orderCode: record.orderCode,
      nfeNumber: record.nfeNumber,
      productCode: record.productCode,
      customerName: record.customerName,
      commissionPersonName: record.commissionPerson.name,
      status: record.status,
      baseAmount,
      oldRate,
      newRate: oldRate,
      oldCommission,
      newCommission: oldCommission,
      diff: 0,
      oldTierCode: metaStr(record.metadataJson, "tierCode"),
      newTierCode: null,
      outOfTable: false,
      ceilingTier: false,
      insufficient: true,
    };
  }

  const newRate = tierResult.ratePercent;
  const newCommission = computeCommissionAmount(baseAmount, newRate);

  return {
    recordId: record.id,
    orderCode: record.orderCode,
    nfeNumber: record.nfeNumber,
    productCode: record.productCode,
    customerName: record.customerName,
    commissionPersonName: record.commissionPerson.name,
    status: record.status,
    baseAmount,
    oldRate,
    newRate,
    oldCommission,
    newCommission,
    diff: roundMoney(newCommission - oldCommission),
    oldTierCode: metaStr(record.metadataJson, "tierCode"),
    newTierCode: tierResult.tierCode,
    outOfTable: Boolean(tierResult.outOfTablePrice),
    ceilingTier: Boolean(tierResult.ceilingTier),
    insufficient: false,
  };
}

async function applyRecordUpdate(
  recordId: string,
  tierResult: ResolveCommercialTierSuccess,
  baseAmount: number,
  newCommission: number,
  settings: Awaited<ReturnType<typeof loadCommissionSettings>>
): Promise<void> {
  const record = await prisma.commissionRecord.findUnique({
    where: { id: recordId },
    include: {
      paymentSchedules: { where: { source: "ACCOUNTS_RECEIVABLE" } },
    },
  });
  if (!record) return;
  if (isPaidCommissionStatus(record.status)) return;

  const paidAmount = decimalToNumber(record.paidAmount);
  const metadataJson = {
    ...(record.metadataJson as Record<string, unknown> | null),
    ...buildCommercialTierMetadata(tierResult),
  };

  await prisma.commissionRecord.update({
    where: { id: recordId },
    data: {
      ratePercent: tierResult.ratePercent,
      commissionAmount: newCommission,
      metadataJson,
      balanceAmount: computeBalanceAfterRelease(newCommission, decimalToNumber(record.releasedAmount), paidAmount),
    },
  });

  const arSchedules = record.paymentSchedules;
  if (arSchedules.length > 0) {
    const parts = arSchedules.map((s) => ({
      key: s.id,
      weight: decimalToNumber(s.receivableAmount) || 1,
    }));
    const allocations = allocateProportional(newCommission, parts);
    for (let i = 0; i < arSchedules.length; i += 1) {
      const schedule = arSchedules[i]!;
      const expected = allocations[i]?.amount ?? 0;
      await prisma.commissionPaymentSchedule.update({
        where: { id: schedule.id },
        data: { commissionExpectedAmount: expected },
      });
    }
  }

  const refreshed = await prisma.commissionRecord.findUnique({
    where: { id: recordId },
    include: { paymentSchedules: true },
  });
  if (!refreshed) return;

  const releaseRule = resolveEffectiveReleaseRule(refreshed.releaseRule, settings);
  const recomputed = recomputeCommissionRecordRelease({
    releaseRule,
    commissionAmount: newCommission,
    paidAmount,
    receivableAsDefinitiveReleaseSource: settings.receivableAsDefinitiveReleaseSource,
    schedules: refreshed.paymentSchedules
      .filter((s) => s.source === "ACCOUNTS_RECEIVABLE")
      .map((schedule) => ({
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
    where: { id: recordId },
    data: {
      releasedAmount: recomputed.releasedAmount,
      status: recomputed.status,
      balanceAmount: recomputed.balanceAmount,
      releasedAt: recomputed.releasedAmount > 0 ? new Date() : refreshed.releasedAt,
    },
  });
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  warnCommissionLegacyMode("preview-commission-interpolated-rates");
  const mode = parseScriptMode();
  const year = parseArg("year") ?? "2026";
  const month = parseArg("month") ?? "6";
  const commissionPersonId = parseArg("commissionPersonId");
  const sellerName = parseArg("seller");
  const nomusBase = parseOptionalNum(parseArg("nomusBase")) ?? 808107.32;
  const nomusCommission = parseOptionalNum(parseArg("nomusCommission")) ?? 20926.56;

  let personFilter = commissionPersonId;
  if (!personFilter && sellerName) {
    const person = await prisma.commissionPerson.findFirst({
      where: { name: { contains: sellerName.trim(), mode: "insensitive" }, active: true },
      select: { id: true, name: true },
    });
    if (!person) {
      console.error(`Pessoa não encontrada: ${sellerName}`);
      process.exit(1);
    }
    personFilter = person.id;
    console.log(`Vendedor: ${person.name} (${person.id})\n`);
  }

  const periodWhere = buildCommissionRecordPeriodWhere(
    { year: Number(year), month: Number(month), page: 1, pageSize: 1, periodBasis: "confirmedAt" },
    "confirmedAt"
  );

  const records = await prisma.commissionRecord.findMany({
    where: {
      AND: [periodWhere, ...(personFilter ? [{ commissionPersonId: personFilter }] : [])],
    },
    include: { commissionPerson: { select: { name: true } } },
  });

  console.log("=== Preview comissão proporcional interpolada ===");
  console.log(`Modo: ${mode.toUpperCase()} | Período: ${month}/${year}`);
  console.log(`Registros: ${records.length}\n`);

  const rows: SimRow[] = records.map((r) => simulateRecord(r)!);
  const valid = rows.filter((r) => !r.insufficient);

  let baseTotal = 0;
  let oldCommissionTotal = 0;
  let newCommissionTotal = 0;

  const byOldTier = new Map<string, { base: number; commission: number; count: number }>();
  const byNewTier = new Map<string, { base: number; commission: number; count: number }>();

  for (const row of valid) {
    baseTotal = roundMoney(baseTotal + row.baseAmount);
    oldCommissionTotal = roundMoney(oldCommissionTotal + row.oldCommission);
    newCommissionTotal = roundMoney(newCommissionTotal + row.newCommission);

    const oldKey = row.oldTierCode ?? "—";
    const newKey = row.newTierCode ?? "—";
    const ob = byOldTier.get(oldKey) ?? { base: 0, commission: 0, count: 0 };
    ob.base = roundMoney(ob.base + row.baseAmount);
    ob.commission = roundMoney(ob.commission + row.oldCommission);
    ob.count += 1;
    byOldTier.set(oldKey, ob);
    const nb = byNewTier.get(newKey) ?? { base: 0, commission: 0, count: 0 };
    nb.base = roundMoney(nb.base + row.baseAmount);
    nb.commission = roundMoney(nb.commission + row.newCommission);
    nb.count += 1;
    byNewTier.set(newKey, nb);
  }

  const avgOldRate = baseTotal > 0 ? roundMoney((oldCommissionTotal / baseTotal) * 100) : 0;
  const avgNewRate = baseTotal > 0 ? roundMoney((newCommissionTotal / baseTotal) * 100) : 0;

  console.log("--- Totais ---");
  console.log(`Base total: ${fmtBrl(baseTotal)}`);
  console.log(`Comissão atual: ${fmtBrl(oldCommissionTotal)} (${avgOldRate}%)`);
  console.log(`Comissão proporcional simulada: ${fmtBrl(newCommissionTotal)} (${avgNewRate}%)`);
  console.log(`Diferença: ${fmtBrl(roundMoney(newCommissionTotal - oldCommissionTotal))}`);
  console.log(`Referência Nomus: base ${fmtBrl(nomusBase)} | comissão ${fmtBrl(nomusCommission)}`);
  console.log(
    `Gap vs Nomus (simulado): ${fmtBrl(roundMoney(newCommissionTotal - nomusCommission))}`
  );

  console.log("\n--- Contagens ---");
  console.log(`Linhas válidas: ${valid.length}`);
  console.log(`Dados insuficientes: ${rows.filter((r) => r.insufficient).length}`);
  console.log(`Preço fora da tabela: ${valid.filter((r) => r.outOfTable).length}`);
  console.log(`Teto Varejo 3: ${valid.filter((r) => r.ceilingTier).length}`);

  console.log("\n--- Resumo por faixa (atual → simulada) ---");
  for (const [tier, agg] of byOldTier) {
    console.log(`  [atual ${tier}] base ${fmtBrl(agg.base)} comissão ${fmtBrl(agg.commission)} (${agg.count} linhas)`);
  }
  for (const [tier, agg] of byNewTier) {
    console.log(`  [nova ${tier}] base ${fmtBrl(agg.base)} comissão ${fmtBrl(agg.commission)} (${agg.count} linhas)`);
  }

  const increases = [...valid].sort((a, b) => b.diff - a.diff).slice(0, 30);
  const decreases = [...valid].filter((r) => r.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 30);

  console.log("\n--- Top 30 maiores aumentos ---");
  for (const row of increases.filter((r) => r.diff > 0.001)) {
    console.log(
      `${row.productCode ?? "—"} | pedido ${row.orderCode ?? "—"} | NF ${row.nfeNumber ?? "—"} | ${row.oldRate}% → ${row.newRate}% | ${fmtBrl(row.diff)}`
    );
  }

  if (decreases.length > 0) {
    console.log("\n--- Top reduções ---");
    for (const row of decreases) {
      console.log(
        `${row.productCode ?? "—"} | ${row.oldRate}% → ${row.newRate}% | ${fmtBrl(row.diff)}`
      );
    }
  }

  if (mode === "apply") {
    const settings = await loadCommissionSettings(prisma);
    let applied = 0;
    for (const record of records) {
      const meta = record.metadataJson as Record<string, unknown> | null;
      const soldUnitPrice = meta?.soldUnitPrice != null ? Number(meta.soldUnitPrice) : null;
      const tiers = commercialTiersFromMetadata(record.metadataJson);
      if (!tiers || soldUnitPrice == null || isPaidCommissionStatus(record.status)) continue;
      const tierResult = resolveCommercialPriceTier({ soldUnitPrice, tiers });
      if (!tierResult.ok) continue;
      const baseAmount = decimalToNumber(record.baseAmount);
      const newCommission = computeCommissionAmount(baseAmount, tierResult.ratePercent);
      const oldCommission = decimalToNumber(record.commissionAmount);
      if (
        Math.abs(oldCommission - newCommission) < 0.001 &&
        Math.abs(decimalToNumber(record.ratePercent) - tierResult.ratePercent) < 0.0001
      ) {
        continue;
      }
      await applyRecordUpdate(record.id, tierResult, baseAmount, newCommission, settings);
      applied += 1;
    }
    console.log(`\n✓ ${applied} registro(s) atualizado(s). Liberação reprocessada.`);
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
