#!/usr/bin/env npx tsx
/**
 * Auditoria read-only de vínculos de comissões (pedido → NF-e → doc saída → AR).
 *
 * Uso:
 *   npx tsx scripts/audit-commission-links.ts --year=2026
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { parseYearPeriod, requireDatabaseUrl } from "./commission-audit-args.ts";

type LinkIssue = {
  tipo: string;
  recordId: string;
  orderCode: string | null;
  detalhe: string;
};

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  const range = parseYearPeriod();
  const dryRun = true;

  console.log("=== Auditoria de vínculos — Comissões ===");
  console.log(`Período: ${range.label}`);
  console.log(`Modo: read-only${dryRun ? " (dry-run)" : ""}\n`);

  const records = await prisma.commissionRecord.findMany({
    where: { calculatedAt: { gte: range.from, lte: range.to } },
    select: {
      id: true,
      orderCode: true,
      originStage: true,
      status: true,
      nomusOrderId: true,
      nomusNfeId: true,
      nomusOutputDocumentId: true,
      paymentSchedules: {
        select: { source: true, nomusReceivableId: true, nomusNfeId: true },
      },
    },
    orderBy: { calculatedAt: "asc" },
  });

  const forecastStatuses = new Set(["FORECAST_FROM_ORDER", "WAITING_NFE"]);
  const confirmedStatuses = new Set([
    "CONFIRMED",
    "WAITING_PAYMENT",
    "PARTIALLY_RELEASED",
    "RELEASED",
    "PAID_PARTIAL",
    "PAID_TOTAL",
  ]);

  let forecastCount = 0;
  let confirmedCount = 0;
  let withOrderInstallments = 0;
  let withArSchedules = 0;
  const issues: LinkIssue[] = [];

  for (const record of records) {
    if (forecastStatuses.has(record.status)) forecastCount += 1;
    if (confirmedStatuses.has(record.status) || record.originStage === "OUTPUT_DOCUMENT") {
      confirmedCount += 1;
    }

    const orderSchedules = record.paymentSchedules.filter(
      (s) => s.source === "SALES_ORDER_INSTALLMENT"
    );
    const arSchedules = record.paymentSchedules.filter(
      (s) => s.source === "ACCOUNTS_RECEIVABLE"
    );
    if (orderSchedules.length > 0) withOrderInstallments += 1;
    if (arSchedules.length > 0) withArSchedules += 1;

    if (forecastStatuses.has(record.status) && orderSchedules.length === 0) {
      if (issues.filter((i) => i.tipo === "PREVISTA_SEM_PARCELA_PEDIDO").length < 5) {
        issues.push({
          tipo: "PREVISTA_SEM_PARCELA_PEDIDO",
          recordId: record.id,
          orderCode: record.orderCode,
          detalhe: `Status ${record.status} sem parcelas SALES_ORDER_INSTALLMENT.`,
        });
      }
    }

    if (record.status === "WAITING_NFE" && record.nomusNfeId != null) {
      if (issues.filter((i) => i.tipo === "WAITING_NFE_COM_NFE").length < 5) {
        issues.push({
          tipo: "WAITING_NFE_COM_NFE",
          recordId: record.id,
          orderCode: record.orderCode,
          detalhe: `Status WAITING_NFE mas nomusNfeId=${record.nomusNfeId} preenchido.`,
        });
      }
    }

    if (record.originStage === "OUTPUT_DOCUMENT" && record.nomusNfeId == null) {
      if (issues.filter((i) => i.tipo === "CONFIRMADA_SEM_NFE").length < 5) {
        issues.push({
          tipo: "CONFIRMADA_SEM_NFE",
          recordId: record.id,
          orderCode: record.orderCode,
          detalhe: "originStage OUTPUT_DOCUMENT sem nomusNfeId.",
        });
      }
    }

    if (
      (confirmedStatuses.has(record.status) || record.originStage === "OUTPUT_DOCUMENT") &&
      arSchedules.length === 0
    ) {
      if (issues.filter((i) => i.tipo === "CONFIRMADA_SEM_AR").length < 5) {
        issues.push({
          tipo: "CONFIRMADA_SEM_AR",
          recordId: record.id,
          orderCode: record.orderCode,
          detalhe: `Status ${record.status} / stage ${record.originStage} sem parcelas ACCOUNTS_RECEIVABLE.`,
        });
      }
    }

    if (record.nomusOutputDocumentId != null && record.nomusNfeId == null) {
      if (issues.filter((i) => i.tipo === "DOC_SAIDA_SEM_NFE").length < 5) {
        issues.push({
          tipo: "DOC_SAIDA_SEM_NFE",
          recordId: record.id,
          orderCode: record.orderCode,
          detalhe: `nomusOutputDocumentId=${record.nomusOutputDocumentId} sem nomusNfeId.`,
        });
      }
    }
  }

  console.log("--- Resumo de registros ---");
  console.log(`Total de CommissionRecord no período: ${records.length}`);
  console.log(`Previstas (FORECAST/WAITING_NFE): ${forecastCount}`);
  console.log(`Confirmadas / pós-NF-e: ${confirmedCount}`);
  console.log(`Com parcelas de pedido: ${withOrderInstallments}`);
  console.log(`Com parcelas de Contas a Receber: ${withArSchedules}`);

  const commissionTotal = records.reduce(
    (sum, row) => sum + toNumber(row.status === "SUPERSEDED" ? 0 : 1),
    0
  );
  console.log(`Registros ativos (não SUPERSEDED): ${commissionTotal}`);

  console.log("\n--- Amostras de inconsistências (até 5 por tipo) ---");
  if (issues.length === 0) {
    console.log("Nenhuma inconsistência amostrada no recorte.");
  } else {
    const byType = new Map<string, LinkIssue[]>();
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

  console.log("\n=== Fim da auditoria de vínculos ===");
}

main()
  .catch((err) => {
    console.error("Erro na auditoria:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
