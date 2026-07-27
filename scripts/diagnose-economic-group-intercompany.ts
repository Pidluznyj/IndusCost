/**
 * Diagnóstico somente leitura — operações intercompany do grupo econômico.
 * Não altera nem exclui dados.
 *
 * Uso: npx tsx scripts/diagnose-economic-group-intercompany.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  ECONOMIC_GROUP_CNPJ_DIGITS,
  ECONOMIC_GROUP_EXCLUSION_RULE_VERSION,
  ECONOMIC_GROUP_INTERCOMPANY,
  classifyIntercompanyPayable,
  classifyIntercompanyReceivable,
  classifyIntercompanySalesOrder,
  normalizeFinanceCnpj,
} from "../src/lib/financeInternalGroupExclusions.js";

const SAMPLE_LIMIT = 8;

function money(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function main() {
  const prisma = new PrismaClient();
  console.log("=== Diagnóstico intercompany (somente leitura) ===");
  console.log(`Regra: ${ECONOMIC_GROUP_INTERCOMPANY} v${ECONOMIC_GROUP_EXCLUSION_RULE_VERSION}`);
  console.log(`CNPJs: ${ECONOMIC_GROUP_CNPJ_DIGITS.join(", ")}`);
  console.log("");

  try {
    const orders = await prisma.salesOrder.findMany({
      select: {
        id: true,
        orderCode: true,
        totalNetValue: true,
        companyIssuer: true,
        Customer: { select: { taxId: true, companyName: true, tradeName: true } },
      },
      take: 50_000,
    });

    const interSo = orders
      .map((o) => ({
        order: o,
        classification: classifyIntercompanySalesOrder(o),
      }))
      .filter((x) => x.classification.excluded);

    const soValue = interSo.reduce(
      (acc, x) => acc + Number(x.order.totalNetValue ?? 0),
      0
    );

    console.log(`Pedidos de Venda intercompany: ${interSo.length}`);
    console.log(`Valor total (amostra carregada): ${money(soValue)}`);
    console.log("Exemplos:");
    for (const row of interSo.slice(0, SAMPLE_LIMIT)) {
      console.log(
        `  - ${row.order.orderCode} | emitente=${row.order.companyIssuer ?? "?"} | cliente=${row.order.Customer?.companyName ?? "?"} | cnpj=${normalizeFinanceCnpj(row.order.Customer?.taxId) || "?"} | ${row.classification.reason}`
      );
    }
    console.log("");

    const arRows = await prisma.nomusAccountsReceivable.findMany({
      select: {
        id: true,
        externalId: true,
        personName: true,
        personCnpj: true,
        balanceReceivable: true,
        amountReceivable: true,
      },
      take: 50_000,
    });
    const interAr = arRows
      .map((r) => ({ row: r, classification: classifyIntercompanyReceivable(r) }))
      .filter((x) => x.classification.excluded);
    const arValue = interAr.reduce(
      (acc, x) => acc + Number(x.row.balanceReceivable ?? x.row.amountReceivable ?? 0),
      0
    );
    console.log(`Contas a Receber intercompany: ${interAr.length}`);
    console.log(`Valor (saldo/amount amostra): ${money(arValue)}`);
    for (const row of interAr.slice(0, SAMPLE_LIMIT)) {
      console.log(
        `  - ext=${row.row.externalId} | ${row.row.personName ?? "?"} | ${normalizeFinanceCnpj(row.row.personCnpj) || "?"} | ${row.classification.reason}`
      );
    }
    console.log("");

    const apRows = await prisma.nomusAccountsPayable.findMany({
      select: {
        id: true,
        externalId: true,
        companyName: true,
        personName: true,
        personCnpj: true,
        balancePayable: true,
        amountPayable: true,
      },
      take: 50_000,
    });
    const interAp = apRows
      .map((r) => ({ row: r, classification: classifyIntercompanyPayable(r) }))
      .filter((x) => x.classification.excluded);
    const apValue = interAp.reduce(
      (acc, x) => acc + Number(x.row.balancePayable ?? x.row.amountPayable ?? 0),
      0
    );
    console.log(`Contas a Pagar intercompany: ${interAp.length}`);
    console.log(`Valor (saldo/amount amostra): ${money(apValue)}`);
    for (const row of interAp.slice(0, SAMPLE_LIMIT)) {
      console.log(
        `  - ext=${row.row.externalId} | pagador=${row.row.companyName ?? "?"} | credor=${row.row.personName ?? "?"} | ${normalizeFinanceCnpj(row.row.personCnpj) || "?"} | ${row.classification.reason}`
      );
    }
    console.log("");
    console.log("Indicadores que NÃO devem mais contar esses registros (após correção):");
    console.log("  - Motor oficial SO / listagem Comercial / Financeiro Pedidos / Presidencial");
    console.log("  - Motor oficial AR / aging / inadimplência / fluxo de caixa");
    console.log("  - Motor oficial AP / aging / fluxo de caixa (somente pagador+credor do grupo)");
    console.log("");
    console.log("Registros permanecem no banco para auditoria (HISTORICAL_AUDIT / sync Nomus).");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Diagnóstico falhou (verifique DATABASE_URL):", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
