#!/usr/bin/env npx tsx
/**
 * Cobertura de regras de comissão para um período.
 *
 * Uso:
 *   npx tsx scripts/audit-commission-rules-coverage.ts --year=2026 --month=6
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { previewCommissionCalculation } from "../src/lib/commissions/commission-preview-calculation.server.ts";
import { decimalToNumber } from "../src/lib/commissions/commission-money.ts";
import {
  fmtBrl,
  parseYearPeriod,
  requireDatabaseUrl,
} from "./commission-script-utils.ts";

async function main(): Promise<void> {
  requireDatabaseUrl();
  const range = parseYearPeriod();

  console.log("=== Cobertura de regras — Comissões ===");
  console.log(`Período: ${range.label}\n`);

  const rules = await prisma.commissionRule.findMany({
    where: { active: true },
    include: { conditions: true },
    orderBy: [{ priority: "asc" }, { name: "asc" }],
  });

  console.log("--- Regras ativas ---");
  if (rules.length === 0) {
    console.log("Nenhuma regra ativa. Cadastre regras antes do cálculo.");
    process.exit(2);
  }

  for (const rule of rules) {
    const valid =
      (!rule.validFrom || rule.validFrom <= range.to) &&
      (!rule.validTo || rule.validTo >= range.from);
    console.log(
      `  • ${rule.name} | ${rule.beneficiaryType} | ${decimalToNumber(rule.ratePercent)}% | prioridade ${rule.priority} | vigência ${valid ? "OK" : "FORA"} | condições ${rule.conditions.length}`
    );
  }

  const preview = await previewCommissionCalculation(prisma, {
    from: range.from,
    to: range.to,
    label: range.label,
  });

  const coveredLines = preview.sampleLines.filter((l) => l.mode !== "blocked");
  const ruleTotals = new Map<string, { amount: number; count: number }>();
  for (const line of preview.sampleLines) {
    if (!line.ruleName || line.commissionAmount <= 0) continue;
    const cur = ruleTotals.get(line.ruleName) ?? { amount: 0, count: 0 };
    ruleTotals.set(line.ruleName, {
      amount: cur.amount + line.commissionAmount,
      count: cur.count + 1,
    });
  }

  console.log("\n--- Cobertura (preview motor) ---");
  console.log(`Pedidos ativos: ${preview.ordersActive}`);
  console.log(`Linhas com regra (amostra+totais): prev=${preview.forecastLines} conf=${preview.confirmedLines}`);
  console.log(`Linhas sem regra: ${preview.noRuleLines} (base ${fmtBrl(preview.noRuleAmount)})`);
  console.log(`Comissão prevista: ${fmtBrl(preview.forecastAmount + preview.waitingNfeAmount)}`);
  console.log(`Comissão confirmada: ${fmtBrl(preview.confirmedAmount)}`);

  if (ruleTotals.size > 0) {
    console.log("\n--- Comissão estimada por regra (amostra preview) ---");
    for (const [name, v] of [...ruleTotals.entries()].sort((a, b) => b[1].amount - a[1].amount)) {
      console.log(`  • ${name}: ${fmtBrl(v.amount)} (${v.count} linha(s) na amostra)`);
    }
  }

  if (preview.topSellers.length > 0) {
    console.log("\n--- Pessoas cobertas (top) ---");
    for (const s of preview.topSellers) {
      console.log(`  • ${s.name}: ${fmtBrl(s.amount)}`);
    }
  }

  console.log(`\nLinhas calculáveis na amostra: ${coveredLines.length}`);
  console.log("\n=== Fim cobertura de regras ===");
}

main()
  .catch((err) => {
    console.error("Erro:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
