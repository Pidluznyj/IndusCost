#!/usr/bin/env npx tsx
/**
 * Diagnóstico SOMENTE LEITURA da data-base dos prazos de pagamento dos Pedidos de Compra Nomus.
 *
 *   npx tsx scripts/auditPurchaseOrderPaymentTermsBase.ts [--out=relatorio.json]
 *
 * Lê o espelho local (NomusPurchaseOrder.rawPayload). Não chama o Nomus, não grava nada.
 * Resultado: para cada data-base candidata (emissão do pedido × entrega prevista), quantas
 * condições (idCondicaoPagamento) produzem os MESMOS prazos em todos os pedidos.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parsePurchaseOrderPlannedInstallments, extractPurchaseOrderHeaderFields } from "../src/lib/nomus/nomusPurchaseOrder360.ts";
import { auditPaymentTermsBase, type BaseAuditOrder } from "../src/lib/purchasing/purchasePaymentTermsBaseAudit.ts";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL ausente.");
    process.exit(1);
  }
  const orders: BaseAuditOrder[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.nomusPurchaseOrder.findMany({
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, orderNumber: true, externalId: true, issuedAt: true, expectedAt: true, paymentTerms: true, rawPayload: true },
    });
    if (page.length === 0) break;
    for (const row of page) {
      const header = extractPurchaseOrderHeaderFields(row.rawPayload);
      orders.push({
        orderNumber: row.orderNumber ?? `#${row.externalId}`,
        issuedAt: row.issuedAt,
        expectedAt: row.expectedAt,
        conditionId: typeof header.paymentConditionId === "number" ? header.paymentConditionId : null,
        conditionText: row.paymentTerms,
        installments: parsePurchaseOrderPlannedInstallments(row.rawPayload),
      });
    }
    cursor = page[page.length - 1].id;
  }

  const report = auditPaymentTermsBase(orders);
  console.log(`Pedidos: ${report.totalOrders} | com parcelas: ${report.withInstallments} | parcelas completas: ${report.withCompleteInstallments} | com idCondicaoPagamento: ${report.withConditionId}`);
  for (const c of report.candidates) {
    const pct = c.ordersInComparedConditions ? ((c.ordersMatchingConditionMode / c.ordersInComparedConditions) * 100).toFixed(1) : "—";
    console.log(
      `\nBase ${c.base}: ${c.measurableOrders} pedidos mensuráveis; condições comparadas ${c.conditionsCompared}, consistentes ${c.conditionsConsistent}; aderência ao padrão da condição ${pct}%`,
    );
    console.log(`  padrões mais comuns: ${c.topPatterns.slice(0, 8).map((p) => `${p.pattern} (${p.orders})`).join(", ")}`);
  }
  console.log(`\nBase com maior aderência (evidência, decisão é humana): ${report.suggestedBase ?? "inconclusivo"}`);
  console.log(`Textos de condição mais frequentes: ${report.conditionTexts.slice(0, 10).map((t) => `"${t.text}" (${t.orders})`).join(", ")}`);
  const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
  if (out) {
    writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));
    console.log(`\nRelatório completo: ${out}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
