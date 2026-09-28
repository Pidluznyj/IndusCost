/**
 * Conferência READ-ONLY da previsão de comissões.
 *
 * Não grava, não fecha, não cobre recebimento e não roda migration.
 * Uso posterior em homologação, com DATABASE_URL apontando para a base de leitura:
 *
 *   npx tsx scripts/auditCommissionPortfolioOutlook.ts
 *
 * Sem DATABASE_URL o script só imprime as consultas e encerra.
 */
import { prisma } from "../src/lib/prisma.js";

const QUERIES = [
  {
    name: "PV com um CR ativo",
    sql: `
      SELECT s."salesOrderId", COUNT(*) AS crs
      FROM "CommissionReceivableSchedule" s
      WHERE s.status = 'ACTIVE'
      GROUP BY s."salesOrderId"
      HAVING COUNT(*) = 1
      LIMIT 5
    `,
  },
  {
    name: "PV com vários CRs",
    sql: `
      SELECT s."salesOrderId", COUNT(*) AS crs,
             SUM(s."scheduledCommissionAmount") AS comissao
      FROM "CommissionReceivableSchedule" s
      WHERE s.status = 'ACTIVE'
      GROUP BY s."salesOrderId"
      HAVING COUNT(*) > 1
      LIMIT 5
    `,
  },
  {
    name: "CR com recebimento parcial",
    sql: `
      SELECT r."receivableExternalId",
             SUM(r."receivedAmount") AS recebido,
             ar."amountReceivable" AS nominal
      FROM "NomusReceivableReceipt" r
      JOIN "NomusAccountsReceivable" ar ON ar."externalId" = r."receivableExternalId"
      GROUP BY r."receivableExternalId", ar."amountReceivable"
      HAVING SUM(r."receivedAmount") > 0
         AND SUM(r."receivedAmount") < ar."amountReceivable"
      LIMIT 5
    `,
  },
  {
    name: "CR futuro sem recebimento",
    sql: `
      SELECT ar."externalId", ar."dueDate", ar."balanceReceivable"
      FROM "NomusAccountsReceivable" ar
      WHERE ar."dueDate" > NOW()
        AND COALESCE(ar."balanceReceivable", 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM "NomusReceivableReceipt" r
          WHERE r."receivableExternalId" = ar."externalId"
        )
      LIMIT 5
    `,
  },
  {
    name: "CR vencido sem recebimento",
    sql: `
      SELECT ar."externalId", ar."dueDate", ar."balanceReceivable"
      FROM "NomusAccountsReceivable" ar
      WHERE ar."dueDate" < CURRENT_DATE
        AND COALESCE(ar."balanceReceivable", 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM "NomusReceivableReceipt" r
          WHERE r."receivableExternalId" = ar."externalId"
        )
      LIMIT 5
    `,
  },
  {
    name: "receiptDate diferente de settlementDate",
    sql: `
      SELECT r."externalId", r."receiptDate", ar."settlementDate"
      FROM "NomusReceivableReceipt" r
      JOIN "NomusAccountsReceivable" ar ON ar."externalId" = r."receivableExternalId"
      WHERE ar."settlementDate" IS NOT NULL
        AND r."receiptDate" <> (ar."settlementDate" AT TIME ZONE 'UTC')::date
      LIMIT 5
    `,
  },
  {
    name: "título baixado sem evento de recebimento",
    sql: `
      SELECT ar."externalId", ar."balanceReceivable", ar."amountReceived", ar."settlementDate"
      FROM "NomusAccountsReceivable" ar
      WHERE COALESCE(ar."balanceReceivable", 0) = 0
        AND COALESCE(ar."amountReceived", 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM "NomusReceivableReceipt" r
          WHERE r."receivableExternalId" = ar."externalId"
        )
      LIMIT 5
    `,
  },
  {
    name: "recebimento já coberto",
    sql: `
      SELECT c."receiptExternalId", c."coverageSource", c."coveredCommissionAmount",
             c."naturalYear", c."naturalMonth"
      FROM "CommissionReceiptCoverage" c
      WHERE c."coverageStatus" = 'COVERED'
      LIMIT 5
    `,
  },
] as const;

async function main() {
  console.log("Previsão de comissões — conferência somente leitura.");
  console.log("Nenhuma tabela é alterada.");
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL ausente. Consultas para rodar depois:");
    for (const query of QUERIES) {
      console.log(`\n-- ${query.name}\n${query.sql.trim()}`);
    }
    return;
  }

  for (const query of QUERIES) {
    const rows = await prisma.$queryRawUnsafe(query.sql);
    const list = Array.isArray(rows) ? rows : [];
    console.log(`\n${query.name}: ${list.length} linha(s)`);
    console.log(JSON.stringify(list, null, 2));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
