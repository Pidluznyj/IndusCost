/**
 * Auditoria READ-ONLY da Previsão de comissões, CR a CR.
 *
 * Compara, para cada schedule, a previsão da regra ANTIGA (comissão atribuída −
 * realizada pelos eventos de recebimento, contando também schedules de versões
 * substituídas do pedido) com a regra NOVA (só a versão vigente do pedido, um
 * schedule por título, comissão futura proporcional ao saldo em aberto do
 * título na origem). O cálculo está em
 * src/lib/commissions/commissionPortfolioOutlookAudit.ts.
 *
 * NÃO grava no banco: só `findMany`. Não altera schedule, não reprocessa, não
 * fecha competência, não cobre recebimento e não paga. A única escrita é o
 * arquivo CSV local com o detalhe.
 *
 * Uso (no servidor, com DATABASE_URL da base que se quer conferir):
 *
 *   npx tsx scripts/auditCommissionOutlookOpenBalance.ts [--seller=<id Nomus ou parte do nome>]
 *        [--from=2026-09] [--to=AAAA-MM] [--top=30] [--csv=caminho.csv]
 *
 * Sem DATABASE_URL o script só explica o que lê e encerra.
 */
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma.js";
import { toCivilDateKey } from "../src/lib/financeCivilDate.js";
import { clampOutlookFromMonth } from "../src/lib/commissions/commissionPortfolioOutlook.js";
import { auditCommissionPortfolioOutlook } from "../src/lib/commissions/commissionPortfolioOutlookAudit.js";
import { loadCommissionPortfolioOutlookFacts } from "../src/lib/commissions/commissionPortfolioOutlook.server.js";

const READS = [
  "CommissionReceivableSchedule (+ SalesOrder, Customer, CommissionPerson, CommissionOrderSnapshot)",
  "NomusAccountsReceivable",
  "NomusReceivableReceipt",
  "CommissionReceiptCoverage",
  "CommissionPaymentSchedule (+ itens de lote PAID)",
];

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() || null : null;
}

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (value: number | null | undefined) => (value == null ? "" : value.toFixed(2).replace(".", ","));

async function main() {
  console.log("Previsão de comissões — auditoria CR a CR. SOMENTE LEITURA: nenhuma tabela é alterada.");
  console.log(`Lê: ${READS.join("; ")}.`);
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL ausente. Rode no servidor com a base que deseja conferir.");
    return;
  }

  const fromMonth = clampOutlookFromMonth(arg("from"));
  const toMonth = arg("to");
  const seller = arg("seller");
  const top = Math.max(1, Number(arg("top")) || 30);
  const today = toCivilDateKey(new Date()) ?? new Date().toISOString().slice(0, 10);
  const csvPath = arg("csv") ?? `commission-outlook-audit-${today}.csv`;

  const loaded = await loadCommissionPortfolioOutlookFacts({}, { includeSupersededSnapshots: true });
  const facts = loaded.facts.filter((fact) => {
    if (!seller) return true;
    if (/^\d+$/.test(seller)) return fact.rawSellerId === Number(seller);
    return (fact.canonicalSellerName ?? "").toLowerCase().includes(seller.toLowerCase());
  });
  const audit = auditCommissionPortfolioOutlook(facts, loaded.titles, { fromMonth, toMonth, today });

  console.log(`\nData de referência: ${today} · período: ${fromMonth} a ${toMonth ?? "sem fim"} · vendedor: ${seller ?? "todos"}`);
  console.log(`Schedules lidos: ${facts.length} (de ${loaded.facts.length}) · títulos: ${new Set(facts.map((fact) => fact.receivableId)).size}`);
  console.log("\nPREVISÃO ATUAL (regra antiga)");
  console.log(`  ${brl(audit.legacyForecastTotal)}`);
  console.log("PREVISÃO RECALCULADA PELO SALDO ECONÔMICO (regra nova)");
  console.log(`  ${brl(audit.newForecastTotal)}`);
  console.log("DIFERENÇA");
  console.log(`  ${brl(audit.difference)}`);

  console.log("\nDiferença por causa:");
  for (const entry of audit.byCause) {
    console.log(`  ${brl(entry.difference).padStart(16)} · ${String(entry.count).padStart(4)} CR(s) · ${entry.cause}`);
  }
  if (audit.byCause.length === 0) console.log("  (nenhuma diferença acima de R$ 0,01)");

  console.log("\nPor vendedor (antiga → nova):");
  for (const entry of audit.bySeller) {
    console.log(
      `  ${entry.seller.padEnd(36)} ${brl(entry.legacy).padStart(16)} → ${brl(entry.next).padStart(16)}  (diferença ${brl(entry.legacy - entry.next)})`
    );
  }

  console.log(`\nTOP ${top} CRs responsáveis pela diferença:`);
  for (const row of [...audit.rows].sort((a, b) => b.difference - a.difference).slice(0, top)) {
    if (row.difference <= 0.01) break;
    console.log(
      `  ${brl(row.difference).padStart(14)} · PV ${row.fact.orderCode} · NF ${row.fact.nfeNumber ?? "—"} · CR ${row.fact.receivableCode ?? row.fact.receivableId}/${row.fact.installmentNumber}` +
        ` · venc ${row.fact.dueDate ?? "—"} · original ${num(row.title?.amountReceivable)} · saldo ${num(row.title?.balanceRaw)}` +
        ` · receipts ${num(row.receiptsSum)} · ${row.classification}`
    );
  }

  const { cards } = audit;
  console.log("\nUniversos pela regra nova (mesmo cálculo da tela):");
  console.log(`  Comissão futura de CR em aberto ......... ${brl(cards.forecast)}`);
  console.log(`    da qual vencida em aberto ............. ${brl(cards.overdueForecast)}`);
  console.log(`  Realizada aguardando fechamento ......... ${brl(cards.awaitingClosing)}`);
  console.log(`  Liberada e ainda não paga ............... ${brl(cards.balanceToPay)}`);
  console.log(`  Paga .................................... ${brl(cards.paid)}`);
  console.log(`  Realizado no período (histórico) ........ ${brl(cards.realized)}`);
  console.log(`  Fora da previsão (sem saldo e sem evento)  ${brl(cards.unreconciled)}`);
  console.log(
    `\nInformativo: comissão futura de títulos em aberto vencidos antes de ${fromMonth} (fora do período da tela): ${brl(audit.forecastBeforePeriod)}`
  );

  const header = [
    "vendedor", "pedido", "nf", "cr", "parcela", "vencimento", "status_schedule", "status_snapshot_pedido",
    "valor_original_cr", "nominal_schedule", "saldo_atual_cr", "amount_received_titulo", "soma_receipts",
    "dif_baixa_titulo_menos_receipts", "comissao_atribuida", "realizada_regra_antiga", "prevista_regra_antiga",
    "realizada_regra_nova", "futura_regra_nova", "fora_da_previsao", "no_periodo", "diferenca_prevista", "classificacao", "motivo",
  ];
  const csv = [header.join(";")];
  for (const row of audit.rows) {
    csv.push(
      [
        row.fact.canonicalSellerName ?? (row.fact.rawSellerId != null ? `Nomus ${row.fact.rawSellerId}` : ""),
        row.fact.orderCode,
        row.fact.nfeNumber ?? "",
        row.fact.receivableCode ?? String(row.fact.receivableId),
        String(row.fact.installmentNumber),
        row.fact.dueDate ?? "",
        row.fact.scheduleStatus,
        row.fact.orderSnapshotStatus ?? "",
        num(row.title?.amountReceivable),
        num(row.fact.nominalAmount),
        num(row.title?.balanceRaw),
        num(row.title?.amountReceived),
        num(row.receiptsSum),
        num(row.receiptGap),
        num(row.legacyAllocated),
        num(row.legacyRealized),
        num(row.legacyForecast),
        num(row.line.realizedCommission),
        num(row.line.forecastCommission),
        num(row.line.unreconciledCommission),
        row.inPeriod ? "sim" : "não",
        num(row.difference),
        row.classification,
        (row.line.inconsistency ?? "").replace(/;/g, ","),
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(";")
    );
  }
  writeFileSync(csvPath, `﻿${csv.join("\r\n")}\r\n`, "utf8");
  console.log(`\nDetalhe CR a CR gravado em ${csvPath} (${audit.rows.length} linha(s)). Nenhum dado do banco foi alterado.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
