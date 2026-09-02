/**
 * Auditoria READ ONLY da competência por recebimento.
 *
 * Reporta as duas inconsistências que a nova regra torna visíveis — e que
 * antes ficavam escondidas atrás do fallback silencioso para a data de baixa:
 *
 *   1. SETTLED_WITHOUT_RECEIPT       — CR baixado no mês sem evento de recebimento.
 *   2. RECEIPT_WITHOUT_LOCAL_RECEIVABLE — recebimento cujo `idContaReceber` não tem
 *      Conta a Receber local (os "35 sem CR" do probe de homologação).
 *
 * Nenhuma escrita. Nenhum join aproximado — só o vínculo determinístico
 * `recebimentos.idContaReceber` = `NomusAccountsReceivable.externalId`.
 *
 * Uso:
 *   tsx scripts/auditCommissionReceiptCompetence.ts --year 2026 --month 7
 *   tsx scripts/auditCommissionReceiptCompetence.ts --year 2026 --month 7 --json
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  loadCommissionReceiptCompetenceForPeriod,
  loadReceivableIdsWithAnyReceipt,
  loadReceiptsWithoutLocalReceivable,
  loadSettledWithoutReceiptInconsistencies,
} from "@/src/lib/commissions/commissionReceiptCompetence.server.js";
import {
  classifyReceivableSettlement,
  resolveCompetencePeriodUtcBounds,
} from "@/src/lib/commissions/commissionReceiptCompetence.js";
import { isCommissionInternalGroupReceivable } from "@/src/lib/commissions/commissionInternalGroupExclusion.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";

const prisma = new PrismaClient();

function parseCli(argv: string[]): { year: number; month: number; json: boolean; limit: number } {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let limit = 200;

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
    }
  }
  if (month < 1 || month > 12) throw new Error(`--month inválido: ${month}`);
  return { year, month, json: argv.includes("--json"), limit };
}

async function main() {
  const { year, month, json, limit } = parseCli(process.argv.slice(2));

  const [competence, settledWithoutReceipt, receiptsWithoutReceivable] = await Promise.all([
    loadCommissionReceiptCompetenceForPeriod(prisma, year, month),
    loadSettledWithoutReceiptInconsistencies(prisma, year, month),
    loadReceiptsWithoutLocalReceivable(prisma, { limit: 5000 }),
  ]);

  const periodReceived = [...competence.values()].reduce(
    (sum, row) => sum + row.periodReceivedAmount,
    0
  );

  // Classificação dos títulos BAIXADOS no período (observabilidade agregada).
  // Duas queries em lote: os baixados do mês e, para eles, a existência global
  // de receipt. Nada por título.
  const bounds = resolveCompetencePeriodUtcBounds(year, month);
  const settledInPeriod = await prisma.nomusAccountsReceivable.findMany({
    where: { settlementDate: { gte: bounds.from, lte: bounds.to }, amountReceived: { gt: 0 } },
    select: { externalId: true, personName: true, personCnpj: true },
  });
  const withAnyReceipt = await loadReceivableIdsWithAnyReceipt(
    prisma,
    settledInPeriod.map((row) => row.externalId)
  );
  let comReceiptReal = 0;
  let semReceipt = 0;
  let intercompany = 0;
  for (const row of settledInPeriod) {
    // Intercompany é apenas CONTADO aqui; a política de elegibilidade não muda.
    if (
      isCommissionInternalGroupReceivable({
        customerName: row.personName,
        customerCnpj: row.personCnpj,
      })
    ) {
      intercompany += 1;
    }
    const classification = classifyReceivableSettlement({
      hasAnyReceipt: withAnyReceipt.has(row.externalId),
      isSettled: true,
    });
    if (classification === "FINANCIAL_RECEIPT") comReceiptReal += 1;
    else if (classification === "SETTLED_WITHOUT_RECEIPT") semReceipt += 1;
  }

  const report = {
    periodo: `${year}-${String(month).padStart(2, "0")}`,
    titulos_com_recebimento_no_periodo: competence.size,
    eventos_de_recebimento_no_periodo: [...competence.values()].reduce(
      (sum, row) => sum + row.receiptIds.length,
      0
    ),
    valor_recebido_no_periodo: Number(periodReceived.toFixed(2)),
    titulos_baixados_no_periodo: settledInPeriod.length,
    titulos_baixados_com_receipt_real: comReceiptReal,
    titulos_baixados_intercompany: intercompany,
    titulos_com_baixa_no_periodo_sem_recebimento: semReceipt,
    // Conferência: as duas contagens vêm da mesma regra e têm de bater.
    conferencia_sem_recebimento_bate: semReceipt === settledWithoutReceipt.length,
    titulos_com_baixa_no_periodo_sem_recebimento_ids: settledWithoutReceipt
      .slice(0, limit)
      .map((row) => row.receivableExternalId),
    recebimentos_sem_cr_local: receiptsWithoutReceivable.length,
    recebimentos_sem_cr_local_detalhe: receiptsWithoutReceivable.slice(0, limit).map((row) => ({
      idContaReceber: row.receivableExternalId,
      eventos: row.receiptCount,
      valor: Number(row.receivedAmount.toFixed(2)),
      primeiro_recebimento: toCivilDateKey(row.firstReceiptDate),
      ultimo_recebimento: toCivilDateKey(row.lastReceiptDate),
    })),
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  for (const [key, value] of Object.entries(report)) {
    console.log(`${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  }
}

main()
  .catch((error) => {
    console.error(
      "[audit-commission-receipt-competence] falhou:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
