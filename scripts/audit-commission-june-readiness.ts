#!/usr/bin/env npx tsx
/**
 * Auditoria de prontidão para cálculo de comissões em um mês.
 *
 * Uso:
 *   npx tsx scripts/audit-commission-june-readiness.ts --year=2026 --month=6
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { extractSellerFromOrder } from "../src/lib/commissions/commission-source-resolver.ts";
import { previewCommissionCalculation } from "../src/lib/commissions/commission-preview-calculation.server.ts";
import { previewCommissionPersonsForPeriod } from "../src/lib/commissions/commissionPersons.server.ts";
import { NOMUS_NFE_STATUS_CANCELLED } from "../src/lib/nomusNfeClassification.ts";
import {
  activeCommissionRecordWhere,
  fmtBrl,
  fmtPct,
  hasBlockingFindings,
  parseYearPeriod,
  printFindings,
  requireDatabaseUrl,
  warnCommissionLegacyMode,
  toNumber,
  type ReadinessFinding,
} from "./commission-script-utils.ts";

async function main(): Promise<void> {
  requireDatabaseUrl();
  warnCommissionLegacyMode("audit-commission-june-readiness");
  const range = parseYearPeriod();
  const findings: ReadinessFinding[] = [];

  console.log("=== Auditoria de prontidão — Comissões ===");
  console.log(`Período: ${range.label}\n`);

  const orders = await prisma.salesOrder.findMany({
    where: { issueDate: { gte: range.from, lte: range.to } },
    select: {
      id: true,
      orderCode: true,
      issueDate: true,
      status: true,
      externalSellerId: true,
      responsible: true,
      totalNetValue: true,
      nfeLinks: { select: { nfeExternalId: true, nfeStatus: true } },
    },
  });

  const totalOrders = orders.length;
  const totalNet = orders.reduce((s, o) => s + toNumber(o.totalNetValue), 0);
  const withSeller = orders.filter(
    (o) => o.externalSellerId != null || Boolean(o.responsible?.trim())
  );
  const withoutSeller = totalOrders - withSeller.length;
  const withNfe = orders.filter((o) => o.nfeLinks.length > 0);
  const withoutNfe = totalOrders - withNfe.length;
  const cancelledNfeLinks = orders.reduce(
    (s, o) =>
      s + o.nfeLinks.filter((l) => l.nfeStatus === NOMUS_NFE_STATUS_CANCELLED).length,
    0
  );

  const sellerIds = new Set<number>();
  for (const order of orders) {
    const seller = extractSellerFromOrder({
      externalSellerId: order.externalSellerId,
      responsible: order.responsible,
    });
    if (seller.nomusSellerId != null) sellerIds.add(seller.nomusSellerId);
  }

  const [personCount, activeRules, existingRecords, existingActive, arAgg, preview, personPreview] =
    await Promise.all([
      prisma.commissionPerson.count({ where: { active: true } }),
      prisma.commissionRule.count({ where: { active: true } }),
      prisma.commissionRecord.count({
        where: { calculatedAt: { gte: range.from, lte: range.to } },
      }),
      prisma.commissionRecord.count({
        where: activeCommissionRecordWhere({ from: range.from, to: range.to }),
      }),
      prisma.nomusAccountsReceivable.aggregate({
        _sum: { amountReceivable: true, amountReceived: true, balanceReceivable: true },
        where: {
          dueDate: { gte: range.from, lte: range.to },
        },
      }),
      previewCommissionCalculation(prisma, {
        from: range.from,
        to: range.to,
        label: range.label,
      }),
      previewCommissionPersonsForPeriod({ from: range.from, to: range.to }),
    ]);

  const sellersWithoutPerson = personPreview.candidates.filter((c) => c.wouldCreate);

  console.log("--- Pedidos de venda ---");
  console.log(`Total pedidos: ${totalOrders}`);
  console.log(`Valor líquido: ${fmtBrl(totalNet)}`);
  console.log(`Com vendedor/responsável: ${withSeller.length} (${fmtPct(withSeller.length, totalOrders)})`);
  console.log(`Sem vendedor: ${withoutSeller}`);
  console.log(`Com NF-e vinculada: ${withNfe.length}`);
  console.log(`Sem NF-e: ${withoutNfe}`);
  console.log(`Vínculos NF-e cancelados: ${cancelledNfeLinks}`);

  console.log("\n--- Pessoas e regras ---");
  console.log(`Vendedores distintos (Nomus ID): ${sellerIds.size}`);
  console.log(`Pessoas comissionadas ativas: ${personCount}`);
  console.log(`Candidatos a criar no período: ${personPreview.created}`);
  console.log(`Regras ativas: ${activeRules}`);

  console.log("\n--- Contas a receber (vencimento no mês) ---");
  console.log(`Valor a receber: ${fmtBrl(toNumber(arAgg._sum.amountReceivable))}`);
  console.log(`Valor recebido: ${fmtBrl(toNumber(arAgg._sum.amountReceived))}`);
  console.log(`Saldo: ${fmtBrl(toNumber(arAgg._sum.balanceReceivable))}`);

  console.log("\n--- CommissionRecord existentes ---");
  console.log(`Total (incl. superseded): ${existingRecords}`);
  console.log(`Ativos: ${existingActive}`);

  console.log("\n--- Preview motor (sem gravar) ---");
  console.log(`Linhas previstas: ${preview.forecastLines} (${fmtBrl(preview.forecastAmount)})`);
  console.log(`Confirmadas: ${preview.confirmedLines} (${fmtBrl(preview.confirmedAmount)})`);
  console.log(`Sem regra: ${preview.noRuleLines}`);
  console.log(`Upserts estimados: ${preview.wouldUpsertLines}`);

  if (activeRules === 0) {
    findings.push({
      level: "BLOQUEANTE",
      code: "NO_ACTIVE_RULES",
      message: "Nenhuma regra de comissão ativa — cadastre em Regras de Comissão antes do apply.",
    });
  } else {
    findings.push({
      level: "OK",
      code: "ACTIVE_RULES",
      message: `${activeRules} regra(s) ativa(s).`,
    });
  }

  if (sellersWithoutPerson.length > 0) {
    findings.push({
      level: personPreview.created > 0 ? "ALERTA" : "OK",
      code: "PERSONS_TO_BACKFILL",
      message: `${personPreview.created} pessoa(s) seriam criadas via backfill no período.`,
    });
  }

  if (withoutSeller > 0) {
    findings.push({
      level: "ALERTA",
      code: "ORDERS_WITHOUT_SELLER",
      message: `${withoutSeller} pedido(s) sem vendedor/responsável.`,
    });
  }

  if (preview.noRuleLines > 0) {
    findings.push({
      level: preview.forecastLines + preview.confirmedLines > 0 ? "ALERTA" : "BLOQUEANTE",
      code: "ORDERS_WITHOUT_RULE",
      message: `${preview.noRuleLines} linha(s) de item sem regra aplicável (base ${fmtBrl(preview.noRuleAmount)}).`,
    });
  }

  if (existingActive > 0 && preview.wouldUpsertLines === 0) {
    findings.push({
      level: "OK",
      code: "IDEMPOTENT",
      message: "Registros ativos existem; motor usa calculationHash (upsert idempotente).",
    });
  }

  if (preview.existingPaidRecords > 0) {
    findings.push({
      level: "ALERTA",
      code: "PAID_RECORDS",
      message: `${preview.existingPaidRecords} registro(s) pago(s) no período — alteração automática bloqueada por configuração.`,
    });
  }

  const overall = hasBlockingFindings(findings) ? "BLOQUEANTE" : "OK/ALERTA";
  console.log(`\n=== Resultado geral: ${overall} ===`);
  printFindings(findings);

  if (hasBlockingFindings(findings)) process.exit(2);
}

main()
  .catch((err) => {
    console.error("Erro na auditoria:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
