/**
 * Diagnóstico read-only Nomus × IndusCost para importação simulada (ex.: 611.48AA).
 *
 * Uso:
 *   npm run sync:nomus:product-import-diagnostic -- --parentCode=611.48AA
 */
import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const jsonReplacer = (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;

function parseParentCode(): string {
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--parentCode=(.+)$/);
    if (m) return m[1].trim();
  }
  return "611.48AA";
}

async function main(): Promise<void> {
  const parentCode = parseParentCode();
  const childCode = "311.25AA";

  console.warn(`[nomus-product-import-diagnostic] parentCode=${parentCode}`);

  const products = await prisma.$queryRaw<
    { id: string; sku: string; name: string; type: string }[]
  >(
    Prisma.sql`
      SELECT id, sku, name, type::text AS type
      FROM "Product"
      WHERE sku IN (${parentCode}, ${childCode})
    `
  );
  console.log("\n=== Product ===");
  console.log(JSON.stringify(products, jsonReplacer, 2));

  const materials = await prisma.$queryRaw<
    { id: string; code: string; description: string }[]
  >(
    Prisma.sql`
      SELECT id, code, description
      FROM "Material"
      WHERE code IN (${parentCode}, ${childCode})
    `
  );
  console.log("\n=== Material ===");
  console.log(JSON.stringify(materials, jsonReplacer, 2));

  const stageGrouped = await prisma.$queryRaw<
    {
      parentCode: string;
      parentDescription: string | null;
      componentCode: string;
      componentDescription: string | null;
      qtd_total: unknown;
      linhas: bigint;
      tem_opcional: boolean;
      tem_alternativo: boolean;
      tem_preferencial: boolean;
      external_line_ids: number[];
    }[]
  >(
    Prisma.sql`
      SELECT
        "parentCode",
        "parentDescription",
        "componentCode",
        "componentDescription",
        SUM("qtdeNecessaria") AS qtd_total,
        COUNT(*)::bigint AS linhas,
        bool_or(opcional) AS tem_opcional,
        bool_or(alternativo) AS tem_alternativo,
        bool_or(preferencial) AS tem_preferencial,
        ARRAY_AGG("externalLineId" ORDER BY "externalLineId") AS external_line_ids
      FROM "NomusBomComponentStage"
      WHERE "parentCode" IN (${parentCode}, ${childCode})
      GROUP BY "parentCode", "parentDescription", "componentCode", "componentDescription"
      ORDER BY "parentCode", "componentCode"
    `
  );
  console.log("\n=== NomusBomComponentStage (agrupado) ===");
  console.log(JSON.stringify(stageGrouped, jsonReplacer, 2));

  const bomResolution = await prisma.$queryRaw<
    {
      componentCode: string;
      product_id: string | null;
      product_sku: string | null;
      material_id: string | null;
      material_code: string | null;
    }[]
  >(
    Prisma.sql`
      WITH bom AS (
        SELECT DISTINCT "componentCode"
        FROM "NomusBomComponentStage"
        WHERE "parentCode" = ${parentCode}
      )
      SELECT
        b."componentCode",
        p.id AS product_id,
        p.sku AS product_sku,
        m.id AS material_id,
        m.code AS material_code
      FROM bom b
      LEFT JOIN "Product" p ON p.sku = b."componentCode"
      LEFT JOIN "Material" m ON m.code = b."componentCode"
      ORDER BY b."componentCode"
    `
  );
  console.log("\n=== Resolução componentes BOM 611.48AA ===");
  console.log(JSON.stringify(bomResolution, jsonReplacer, 2));

  const subBom311 = await prisma.$queryRaw<
    {
      parentCode: string;
      componentCode: string;
      componentDescription: string | null;
      qtd_total: unknown;
    }[]
  >(
    Prisma.sql`
      SELECT
        "parentCode",
        "componentCode",
        "componentDescription",
        SUM("qtdeNecessaria") AS qtd_total
      FROM "NomusBomComponentStage"
      WHERE "parentCode" = ${childCode}
      GROUP BY "parentCode", "componentCode", "componentDescription"
      ORDER BY "componentCode"
    `
  );
  console.log(`\n=== Subestrutura Nomus ${childCode} ===`);
  console.log(JSON.stringify(subBom311, jsonReplacer, 2));
}

main()
  .catch((err) => {
    console.error("[nomus-product-import-diagnostic] erro:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
