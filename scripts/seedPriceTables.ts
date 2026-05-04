/**
 * Seed idempotente das tabelas de preço comerciais padrão (Fase 1).
 * Cria ou atualiza name/defaultMarginPct; não cria versões nem itens.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_TABLES: ReadonlyArray<{ code: string; name: string; defaultMarginPct: string }> = [
  { code: "ATACADO", name: "Atacado", defaultMarginPct: "30" },
  { code: "VAREJO_1", name: "Varejo 1", defaultMarginPct: "40" },
  { code: "VAREJO_2", name: "Varejo 2", defaultMarginPct: "50" },
  { code: "VAREJO_3", name: "Varejo 3", defaultMarginPct: "60" },
];

async function main(): Promise<void> {
  for (const row of DEFAULT_TABLES) {
    await prisma.priceTable.upsert({
      where: { code: row.code },
      create: {
        code: row.code,
        name: row.name,
        defaultMarginPct: row.defaultMarginPct,
        status: "ACTIVE",
      },
      update: {
        name: row.name,
        defaultMarginPct: row.defaultMarginPct,
      },
    });
    console.log(`OK price table: ${row.code}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
