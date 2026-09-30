/**
 * Auditoria READ-ONLY da Previsão de comissões, CR a CR.
 *
 * Compara, para cada schedule, a previsão da regra ANTIGA (comissão atribuída −
 * realizada pelos eventos de recebimento, contando também schedules de versões
 * substituídas do pedido) com a regra NOVA (só a versão vigente do pedido, um
 * schedule por título, comissão futura proporcional ao saldo em aberto do
 * título na origem) e fecha a conciliação:
 *
 *   PREVISÃO REGRA ANTIGA − PREVISÃO REGRA NOVA = DIFERENÇA REMOVIDA
 *   SOMA DAS DIFERENÇAS POR CAUSA + NÃO EXPLICADA = DIFERENÇA REMOVIDA
 *
 * O cálculo está em src/lib/commissions/commissionPortfolioOutlookAudit.ts.
 *
 * SOMENTE LEITURA. As únicas chamadas ao banco são `findMany` (em
 * loadCommissionPortfolioOutlookFacts e loadActiveCustomerExclusionRuleSnapshots).
 * Não altera schedule, não reprocessa, não fecha competência, não cobre
 * recebimento e não paga. A única escrita é o arquivo CSV local com o detalhe.
 *
 * Uso (no servidor, com DATABASE_URL da base que se quer conferir):
 *
 *   npx tsx scripts/auditCommissionOutlookOpenBalance.ts [--seller=<id Nomus ou parte do nome>]
 *        [--from=2026-09] [--to=AAAA-MM] [--top=40] [--csv=caminho.csv]
 *
 * Sem DATABASE_URL o script só explica o que lê e encerra.
 */
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma.js";
import { toCivilDateKey } from "../src/lib/financeCivilDate.js";
import { clampOutlookFromMonth } from "../src/lib/commissions/commissionPortfolioOutlook.js";
import {
  auditCommissionPortfolioOutlook,
  buildOutlookAuditCsv,
  formatOutlookAuditReport,
} from "../src/lib/commissions/commissionPortfolioOutlookAudit.js";
import { loadCommissionPortfolioOutlookFacts } from "../src/lib/commissions/commissionPortfolioOutlook.server.js";

const READS = [
  "CommissionReceivableSchedule (+ SalesOrder, Customer, CommissionPerson, CommissionOrderSnapshot)",
  "CommissionCustomerExclusionRule",
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

async function main() {
  console.log("Previsão de comissões — auditoria CR a CR. SOMENTE LEITURA: nenhuma tabela é alterada.");
  console.log(`Lê (findMany): ${READS.join("; ")}.`);
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL ausente. Rode no servidor com a base que deseja conferir.");
    return;
  }

  const fromMonth = clampOutlookFromMonth(arg("from"));
  const toMonth = arg("to");
  const seller = arg("seller");
  const top = Math.max(1, Number(arg("top")) || 40);
  const today = toCivilDateKey(new Date()) ?? new Date().toISOString().slice(0, 10);
  const csvPath = arg("csv") ?? `commission-outlook-audit-${today}.csv`;

  const loaded = await loadCommissionPortfolioOutlookFacts({}, { includeSupersededSnapshots: true });
  const facts = loaded.facts.filter((fact) => {
    if (!seller) return true;
    if (/^\d+$/.test(seller)) return fact.rawSellerId === Number(seller);
    return (fact.canonicalSellerName ?? "").toLowerCase().includes(seller.toLowerCase());
  });
  const audit = auditCommissionPortfolioOutlook(facts, loaded.titles, { fromMonth, toMonth, today });

  for (const line of formatOutlookAuditReport(audit, { today, fromMonth, toMonth, seller, top, totalSchedules: loaded.facts.length })) {
    console.log(line);
  }
  writeFileSync(csvPath, buildOutlookAuditCsv(audit), "utf8");
  console.log(`\nDetalhe CR a CR gravado em ${csvPath} (${audit.rows.length} linha(s)). Nenhum dado do banco foi alterado.`);
  if (!audit.reconciliation.balanced) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
