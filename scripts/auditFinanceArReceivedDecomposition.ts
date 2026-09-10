/**
 * Auditoria READ ONLY da composição de `amountReceived` por título — decompõe
 * a diferença entre o valor recebido acumulado do Contas a Receber
 * (`NomusAccountsReceivable.amountReceived`) e os eventos reais de
 * recebimento (`NomusReceivableReceipt`), SEM tentar "zerar" a diferença.
 *
 * Duas decomposições, nunca confundidas:
 *
 *   (a) amountReceived − (amountReceivable − balanceReceivable)
 *       Conferência INTERNA do próprio título (os três campos do CR batem
 *       entre si?). Não depende de receipts. Divergência aqui é inconsistência
 *       de dado no próprio Nomus, não falta de sincronização de recebimentos.
 *
 *   (b) amountReceived − Σ NomusReceivableReceipt.receivedAmount
 *       Conferência do valor acumulado do CR contra a soma dos eventos reais
 *       de recebimento sincronizados localmente. Divergência aqui pode ser
 *       gap de sincronização, evento ainda não coberto pelo full scan, ou
 *       composição diferente (juros/desconto/taxa incluídos de forma distinta
 *       no `amountReceived` do ERP vs no(s) receipt(s)).
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
  roundMoney,
  type FinanceArDashboardFilters,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  listReceiptEventsByReceivables,
  sumReceivedAmountForEvents,
} from "@/src/lib/financeReceiptsCanonical.server.js";

const prisma = new PrismaClient();

const DIVERGENCE_EPSILON = 0.01;

function parseCli(argv: string[]): {
  year: number;
  month: number | undefined;
  json: boolean;
  limit: number;
  all: boolean;
} {
  const now = new Date();
  let year = now.getFullYear();
  let month: number | undefined = now.getMonth() + 1;
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
      month = undefined;
    }
  }
  if (month != null && (month < 1 || month > 12)) throw new Error(`--month inválido: ${month}`);
  return { year, month, json: argv.includes("--json"), limit, all: argv.includes("--all") };
}

type TitleDecomposition = {
  externalId: number;
  personName: string | null;
  personCnpj: string | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  decomposicaoA_internal_amountReceived_menos_implicito: number;
  somaReceiptsReais: number;
  qtdReceipts: number;
  decomposicaoB_amountReceived_menos_soma_receipts: number;
  receiptsFeeComposition: {
    lateFeeInterestAmount: number;
    discountAmount: number;
    bankFeeAmount: number;
  } | null;
};

async function main() {
  const { year, month, json, limit, all } = parseCli(process.argv.slice(2));
  const filters: FinanceArDashboardFilters = { status: "all", year, month };
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

  let totalOriginal = 0;
  let totalAmountReceived = 0;
  let totalBalance = 0;
  let totalReceiptSum = 0;

  const perTitle: TitleDecomposition[] = eligible.map((row) => {
    const impliedPaidFromBalance = roundMoney(row.amountReceivable - row.balanceReceivable);
    const decompA = roundMoney(row.amountReceived - impliedPaidFromBalance);

    const events = receiptEventsByReceivable.get(row.externalId) ?? [];
    const receiptSum = sumReceivedAmountForEvents(events);
    const decompB = roundMoney(row.amountReceived - receiptSum);

    totalOriginal += row.amountReceivable;
    totalAmountReceived += row.amountReceived;
    totalBalance += row.balanceReceivable;
    totalReceiptSum += receiptSum;

    const feeComposition =
      events.length > 0
        ? {
            lateFeeInterestAmount: roundMoney(
              events.reduce((sum, e) => sum + e.lateFeeInterestAmount, 0)
            ),
            discountAmount: roundMoney(events.reduce((sum, e) => sum + e.discountAmount, 0)),
            bankFeeAmount: roundMoney(events.reduce((sum, e) => sum + e.bankFeeAmount, 0)),
          }
        : null;

    return {
      externalId: row.externalId,
      personName: row.personName,
      personCnpj: row.personCnpj,
      amountReceivable: roundMoney(row.amountReceivable),
      amountReceived: roundMoney(row.amountReceived),
      balanceReceivable: roundMoney(row.balanceReceivable),
      decomposicaoA_internal_amountReceived_menos_implicito: decompA,
      somaReceiptsReais: roundMoney(receiptSum),
      qtdReceipts: events.length,
      decomposicaoB_amountReceived_menos_soma_receipts: decompB,
      receiptsFeeComposition: feeComposition,
    };
  });

  const divergent = perTitle.filter(
    (t) =>
      Math.abs(t.decomposicaoA_internal_amountReceived_menos_implicito) > DIVERGENCE_EPSILON ||
      Math.abs(t.decomposicaoB_amountReceived_menos_soma_receipts) > DIVERGENCE_EPSILON
  );
  const listed = (all ? perTitle : divergent)
    .slice()
    .sort(
      (a, b) =>
        Math.abs(b.decomposicaoB_amountReceived_menos_soma_receipts) -
        Math.abs(a.decomposicaoB_amountReceived_menos_soma_receipts)
    )
    .slice(0, limit);

  const report = {
    coorte: {
      criterio: "dueDate (coorte de vencimento) — NÃO é caixa recebido no período",
      ano: year,
      mes: month ?? null,
    },
    populacao_qtd_titulos: eligible.length,
    totais: {
      valor_original_total: roundMoney(totalOriginal),
      amount_received_acumulado_total: roundMoney(totalAmountReceived),
      saldo_total: roundMoney(totalBalance),
      soma_receipts_reais_total: roundMoney(totalReceiptSum),
      // Mesma equação do caso R$563,54: amountReceived − (original − saldo).
      diferenca_decomposicao_a_total: roundMoney(
        totalAmountReceived - (totalOriginal - totalBalance)
      ),
      // amountReceived acumulado vs soma real dos eventos de recebimento.
      diferenca_decomposicao_b_total: roundMoney(totalAmountReceived - totalReceiptSum),
    },
    titulos_com_divergencia_qtd: divergent.length,
    titulos: listed,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`=== AUDITORIA DE COMPOSIÇÃO amountReceived — coorte vencimento ${year}${month ? `-${String(month).padStart(2, "0")}` : ""} ===`);
  console.log(`população: ${report.populacao_qtd_titulos} títulos`);
  console.log(`valor original total: R$ ${report.totais.valor_original_total.toFixed(2)}`);
  console.log(`amountReceived acumulado total: R$ ${report.totais.amount_received_acumulado_total.toFixed(2)}`);
  console.log(`saldo total: R$ ${report.totais.saldo_total.toFixed(2)}`);
  console.log(`soma receipts reais total: R$ ${report.totais.soma_receipts_reais_total.toFixed(2)}`);
  console.log(`diferença (a) amountReceived − (original − saldo): R$ ${report.totais.diferenca_decomposicao_a_total.toFixed(2)}`);
  console.log(`diferença (b) amountReceived − Σ receipts reais: R$ ${report.totais.diferenca_decomposicao_b_total.toFixed(2)}`);
  console.log(`títulos com divergência (> R$ ${DIVERGENCE_EPSILON.toFixed(2)}): ${report.titulos_com_divergencia_qtd}`);
  console.log("");
  console.log(
    "externalId | pessoa | amountReceivable | amountReceived | balance | decompA | somaReceipts | qtdReceipts | decompB | juros | desconto | taxaBanco"
  );
  for (const t of listed) {
    console.log(
      [
        t.externalId,
        t.personName ?? "",
        t.amountReceivable.toFixed(2),
        t.amountReceived.toFixed(2),
        t.balanceReceivable.toFixed(2),
        t.decomposicaoA_internal_amountReceived_menos_implicito.toFixed(2),
        t.somaReceiptsReais.toFixed(2),
        t.qtdReceipts,
        t.decomposicaoB_amountReceived_menos_soma_receipts.toFixed(2),
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
