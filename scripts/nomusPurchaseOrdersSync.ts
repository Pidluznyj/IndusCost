#!/usr/bin/env tsx
/**
 * PURCH-MIRROR-01 — CLI do mirror de Pedidos de Compra Nomus.
 *
 * Uso:
 *   npx tsx scripts/nomusPurchaseOrdersSync.ts backfill --preview --months=12
 *   npx tsx scripts/nomusPurchaseOrdersSync.ts backfill --apply --months=12
 *   npx tsx scripts/nomusPurchaseOrdersSync.ts backfill --apply --from=2025-09-01 --to=2026-09-01
 *   npx tsx scripts/nomusPurchaseOrdersSync.ts sync --apply
 *
 * `backfill` usa strategy="backfill" (janela de N meses por dataEmissao).
 * `sync` usa strategy="recent-window" (execução recorrente a cada 2h — ver
 * runNomusPurchaseOrdersSync.sh e docs/NOMUS_PURCHASE_ORDERS_MIRROR.md).
 *
 * Lock: adquirido aqui (nomusPurchaseOrdersSyncLock.ts) — uma segunda
 * execução concorrente do MESMO comando sai com código 0 e log SKIPPED
 * (não é erro; é o comportamento esperado de um cron sobreposto).
 *
 * Nunca imprime credenciais. Exit codes: 0 = ok/skipped; 1 = erro de
 * execução; 2 = argumentos inválidos.
 */

import { PrismaClient } from "@prisma/client";
import { runNomusPurchaseOrdersSync } from "../src/lib/nomus/nomusPurchaseOrdersSync.server.js";
import { acquireNomusPurchaseOrdersSyncLock } from "../src/lib/nomus/nomusPurchaseOrdersSyncLock.js";

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return process.argv.includes(`--${name}`) ? "true" : null;
}

async function main() {
  const command = process.argv[2];
  if (command !== "backfill" && command !== "sync") {
    console.error(
      "[nomus-purchase-orders] uso: nomusPurchaseOrdersSync.ts <backfill|sync> --preview|--apply [--months=12] [--from=YYYY-MM-DD --to=YYYY-MM-DD]"
    );
    process.exitCode = 2;
    return;
  }

  const apply = parseArg("apply") != null;
  const preview = parseArg("preview") != null;
  if (apply === preview) {
    console.error("[nomus-purchase-orders] especifique exatamente um de --apply ou --preview.");
    process.exitCode = 2;
    return;
  }
  const mode = apply ? "apply" : "preview";

  const monthsArg = parseArg("months");
  const fromArg = parseArg("from");
  const toArg = parseArg("to");
  const maxPagesArg = parseArg("max-pages");
  const pageSizeArg = parseArg("page-size");
  const detailConcurrencyArg = parseArg("detail-concurrency");

  const strategy = command === "backfill" ? "backfill" : "recent-window";

  // Lock só é exigido para apply — preview é read-only e pode rodar em
  // paralelo com segurança (não grava nada).
  let release: (() => void) | null = null;
  if (mode === "apply") {
    const lock = acquireNomusPurchaseOrdersSyncLock({ mode: `${command}:${mode}` });
    if (lock.ok === false) {
      console.log(`[nomus-purchase-orders] SKIPPED: ${lock.message} (lockFile=${lock.lockFile})`);
      process.exitCode = 0;
      return;
    }
    release = lock.release;
    console.log(`[nomus-purchase-orders] Lock adquirido: ${lock.lockFile}`);
  }

  const prisma = new PrismaClient();
  try {
    const summary = await runNomusPurchaseOrdersSync({
      prisma,
      mode,
      strategy,
      months: monthsArg ? Number.parseInt(monthsArg, 10) : undefined,
      from: fromArg ? new Date(`${fromArg}T00:00:00-03:00`) : undefined,
      to: toArg ? new Date(`${toArg}T23:59:59.999-03:00`) : undefined,
      maxPages: maxPagesArg ? Number.parseInt(maxPagesArg, 10) : undefined,
      pageSize: pageSizeArg ? Number.parseInt(pageSizeArg, 10) : undefined,
      detailConcurrency: detailConcurrencyArg
        ? Number.parseInt(detailConcurrencyArg, 10)
        : undefined,
    });

    console.log("=== RESUMO NOMUS PURCHASE ORDERS SYNC ===");
    console.log(JSON.stringify(summary, null, 2));

    if (summary.errors.length > 0) {
      console.warn(`[nomus-purchase-orders] ${summary.errors.length} erro(s) durante a execução.`);
    }
    if (summary.stopReason === "max_pages") {
      console.error(
        "[nomus-purchase-orders] ERRO: maxPages atingido sem prova de fim da paginação. Aumente --max-pages ou investigue."
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      `[nomus-purchase-orders] FALHOU: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    release?.();
  }
}

main();
