import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("=== INICIANDO AUDITORIA 630.xx ===");
  
  const products = await db.product.findMany({
    where: { sku: { in: ["630.03AA", "630.04AA", "630.01AA"] } },
    select: { id: true, sku: true, status: true, type: true }
  });
  console.log("\n1. PRODUTOS ENCONTRADOS:");
  console.dir(products, { depth: null });
  
  const productIds = products.map(p => p.id);
  
  const pricings = await db.productPricing.findMany({
    where: { productId: { in: productIds } }
  });
  console.log("\n2. PRODUCT PRICING ENCONTRADOS (deveria ser vazio para a família 630):");
  console.dir(pricings, { depth: null });

  const productionCosts = await db.productionCostTableItem.findMany({
    where: { productId: { in: productIds } },
    include: {
      ProductionCostTableVersion: {
        select: { id: true, code: true, revision: true, status: true, effectiveDate: true, publishedAt: true }
      }
    },
    orderBy: { ProductionCostTableVersion: { publishedAt: 'desc' } }
  });
  
  console.log("\n3. PRODUCTION COST ITEMS (últimos 5 por produto):");
  for (const p of products) {
    const items = productionCosts.filter(c => c.productId === p.id).slice(0, 5);
    console.log(`\n--- ${p.sku} ---`);
    items.forEach(i => {
      console.log(`Version: ${i.ProductionCostTableVersion.code} (Rev: ${i.ProductionCostTableVersion.revision}) | Status: ${i.ProductionCostTableVersion.status} | ItemId: ${i.id} | Cost: ${i.unitProductionCost} | Hash: ${i.calculationHash}`);
    });
  }

  const latestBatchVersion = await db.productionCostTableVersion.findFirst({
    where: { status: "PUBLISHED", code: { not: { contains: "AA" } } },
    orderBy: { publishedAt: "desc" }
  });
  console.log("\n4. ÚLTIMO LOTE DE CUSTO DE PRODUÇÃO PUBLICADO:");
  console.dir(latestBatchVersion, { depth: null });

  const commercialTables = await db.priceTableVersion.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    include: { PriceTable: { select: { code: true, name: true } } }
  });
  console.log("\n5. TABELAS DE PREÇO COMERCIAL PUBLICADAS VIGENTES:");
  commercialTables.forEach(t => console.log(`${t.PriceTable.code} - ${t.PriceTable.name} | Version: ${t.versionNumber} | ID: ${t.id} | Published: ${t.publishedAt}`));

  if (commercialTables.length > 0) {
    const commercialItems = await db.priceTableItem.findMany({
      where: { 
        priceTableVersionId: { in: commercialTables.map(t => t.id) },
        productId: { in: productIds }
      }
    });
    console.log("\n6. ITENS NA TABELA DE PREÇO COMERCIAL (630.01, 630.03, 630.04):");
    console.dir(commercialItems.map(i => ({ sku: i.sku, tableId: i.priceTableVersionId, price: i.salePrice })), { depth: null });
  }

  console.log("\n=== FIM DA AUDITORIA ===");
}

main().catch(console.error).finally(() => db.$disconnect());
