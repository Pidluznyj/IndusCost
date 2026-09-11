#!/usr/bin/env npx tsx
/**
 * Diagnóstico read-only: InventoryItem × Material (caso PP-HS03 e similares).
 *
 *   npm run diagnose:raw-material-inventory-link -- --code=PP-HS03
 *
 * Não escreve. Não escolhe vínculo. Não aponta para produção.
 * Usa DATABASE_URL do ambiente onde for executado (homologação no servidor).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { diagnoseInventoryMaterialLink } from "../src/lib/inventory/diagnoseInventoryMaterialLink.server.ts";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return undefined;
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL ausente — diagnóstico requer PostgreSQL do ambiente alvo.");
    process.exit(1);
  }

  const report = await diagnoseInventoryMaterialLink(prisma, {
    itemCode: arg("code") ?? "PP-HS03",
    relatedToken: arg("related") ?? "503",
    aroundDate: arg("around") ?? "2026-09-02",
  });
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
