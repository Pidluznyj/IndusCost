/**
 * Auditoria READ ONLY da composição de `amountReceived` por título — decompõe
 * a diferença entre o valor recebido acumulado do Contas a Receber
 * (`NomusAccountsReceivable.amountReceived`) e os eventos reais de
 * recebimento (`NomusReceivableReceipt`), SEM tentar "zerar" a diferença.
 *
 * Cálculo puro e testado em `src/lib/financeArReceivedDecomposition.ts` —
 * este script só carrega os dados (Prisma) e formata a saída.
 *
 * População: mesma carteira gerencial oficial (`filterFinanceArManagementReportRows`)
 * usada pela tela Contas a Receber — coorte de VENCIMENTO (--year/--month
 * filtram `dueDate`, não `receiptDate`/`settlementDate`), já com as exclusões
 * canônicas aplicadas (intercompany, título fantasma, stale, source-presence,
 * vencido sem NF, dedup pré-NF).
 *
 * Nenhuma escrita. Nenhuma tentativa de "fechar" a diferença — apenas expõe a
 * composição para julgamento humano.
 *
 * Uso:
 *   tsx scripts/auditFinanceArReceivedDecomposition.ts --year 2026 --month 8
 *   tsx scripts/auditFinanceArReceivedDecomposition.ts --year 2026 --month 8 --json
 *   tsx scripts/auditFinanceArReceivedDecomposition.ts --year 2026 --month 8 --all   (inclui títulos sem divergência)
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { loadFinanceArManagementRowsFromPrisma } from "@/src/lib/financeAccountsReceivableManagement.server.js";
import {
  filterFinanceArManagementReportRows,
  type FinanceArDashboardFilters,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import { listReceiptEventsByReceivables } from "@/src/lib/financeReceiptsCanonical.server.js";
import {
  buildFinanceArReceivedDecompositionReport,
  FINANCE_AR_RECEIVED_DECOMPOSITION_EPSILON,
} from "@/src/lib/financeArReceivedDecomposition.js";

const prisma = new PrismaClient();

function parseCli(argv: string[]): {
  year: number;
  month: number | null;
  json: boolean;
  limit: number;
  all: boolean;
} {
  const now = new Date();
  let year = now.getFullYear();
  let month: number | null = now.getMonth() + 1;
  let limit = 500;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--year" && argv[i + 1]) {
      year = Number.parseInt(argv[i + 1], 10) || year;
      i += 1;
    } else if (argv[i] === "--month" && argv[i + 1]) {
      month = Number.parseInt(argv[i + 1], 10) || month;
      i += 1;
    } else if (argv[i] === "--limit" && argv[i + 1]) {
      limit = Number.parseInt(argv[i + 1], 10) || limit;
      i += 1;
    } else if (argv[i] === "--no-month") {
      month = null;
    }
  }
  if (month != null && (month < 1 || month > 12)) throw new Error(`--month inválido: ${month}`);
  return { year, month, json: argv.includes("--json"), limit, all: argv.includes("--all") };
}

async function main() {
  const { year, month, json, limit, all } = parseCli(process.argv.slice(2));
  const filters: FinanceArDashboardFilters = { status: "all", year, month: month ?? undefined };
  const referenceDate = new Date();

  const { rows, syncCutoff } = await loadFinanceArManagementRowsFromPrisma(
    prisma,
    filters,
    referenceDate
  );
  const eligible = filterFinanceArManagementReportRows(rows, filters, referenceDate, syncCutoff);

  const receiptEventsByReceivable = await listReceiptEventsByReceivables(
    prisma,
    eligible.map((row) => row.externalId)
  );

  const report = buildFinanceArReceivedDecompositionReport(eligible, receiptEventsByReceivable, {
    year,
    month,
    limit,
    includeAll: all,
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(
    `=== AUDITORIA DE COMPOSIÇÃO amountReceived — coorte vencimento ${year}${month ? `-${String(month).padStart(2, "0")}` : ""} ===`
  );
  console.log(`população: ${report.populacaoQtdTitulos} títulos`);
  console.log(`valor original total: R$ ${report.totais.valorOriginalTotal.toFixed(2)}`);
  console.log(`amountReceived acumulado total: R$ ${report.totais.amountReceivedAcumuladoTotal.toFixed(2)}`);
  console.log(`saldo total: R$ ${report.totais.saldoTotal.toFixed(2)}`);
  console.log(`soma receipts reais total: R$ ${report.totais.somaReceiptsReaisTotal.toFixed(2)}`);
  console.log(`diferença (a) amountReceived − (original − saldo): R$ ${report.totais.diferencaDecomposicaoATotal.toFixed(2)}`);
  console.log(`diferença (b) amountReceived − Σ receipts reais: R$ ${report.totais.diferencaDecomposicaoBTotal.toFixed(2)}`);
  console.log(`títulos com divergência (> R$ ${FINANCE_AR_RECEIVED_DECOMPOSITION_EPSILON.toFixed(2)}): ${report.titulosComDivergenciaQtd}`);
  console.log("");
  console.log(
    "externalId | pessoa | amountReceivable | amountReceived | balance | decompA | somaReceipts | qtdReceipts | decompB | juros | desconto | taxaBanco"
  );
  for (const t of report.titulos) {
    console.log(
      [
        t.externalId,
        t.personName ?? "",
        t.amountReceivable.toFixed(2),
        t.amountReceived.toFixed(2),
        t.balanceReceivable.toFixed(2),
        t.decompositionAInternal.toFixed(2),
        t.sumRealReceipts.toFixed(2),
        t.receiptCount,
        t.decompositionBAgainstReceipts.toFixed(2),
        t.receiptsFeeComposition?.lateFeeInterestAmount.toFixed(2) ?? "-",
        t.receiptsFeeComposition?.discountAmount.toFixed(2) ?? "-",
        t.receiptsFeeComposition?.bankFeeAmount.toFixed(2) ?? "-",
      ].join(" | ")
    );
  }
}

main()
  .catch((error) => {
    console.error(
      "[audit-finance-ar-received-decomposition] falhou:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
