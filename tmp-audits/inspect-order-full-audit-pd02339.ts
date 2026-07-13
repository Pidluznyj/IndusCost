/**
 * Diagnóstico — Auditoria Completa do Pedido para PD 02339 (ou --order=<code>).
 * Uso: npx tsx tmp-audits/inspect-order-full-audit-pd02339.ts [--order=PD 02339]
 */
import "dotenv/config";
import { loadOrderFullAudit } from "../src/lib/finance/orderFullAuditService.js";

function parseArgs(argv: string[]): { order?: string } {
  const args: { order?: string } = {};
  for (const raw of argv.slice(2)) {
    const m = /^--([a-zA-Z]+)=(.*)$/.exec(raw);
    if (m && m[1] === "order") args.order = m[2];
  }
  return args;
}

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const orderCode = args.order?.trim() || "PD 02339";
  console.log(`=== inspect-order-full-audit — ${orderCode} ===\n`);

  const url = process.env.DATABASE_URL ?? "";
  if (!url || /localhost|127\.0\.0\.1|dummy/i.test(url)) {
    console.log(
      "Sem DATABASE_URL real — rode este inspect no servidor com DB para ver dados de PD 02339."
    );
    return;
  }

  const { prisma } = await import("../src/lib/prisma.js");
  const so = await prisma.salesOrder.findFirst({
    where: { orderCode },
    select: { id: true, orderCode: true },
  });
  if (!so) {
    console.log(`Pedido ${orderCode} não encontrado.`);
    await prisma.$disconnect();
    return;
  }

  const payload = await loadOrderFullAudit({ salesOrderId: so.id });
  if (!("ok" in payload) || !payload.ok) {
    console.log("Falha ao carregar auditoria:", payload);
    await prisma.$disconnect();
    return;
  }

  console.log("Resumo:", {
    orderCode: payload.summary.orderCode,
    customer: payload.summary.customerName,
    original: money(payload.summary.originalOrderValue),
    canceled: money(payload.summary.canceledOrderValue),
    cut: money(payload.summary.cutOrderValue),
    active: money(payload.summary.activeOrderValue),
    allocated: money(payload.summary.allocatedOrderValue),
    pending: money(payload.summary.pendingActiveOrderValue),
    percent: `${payload.summary.fulfillmentPercentActive.toFixed(2)}%`,
    crTotal: money(payload.summary.receivableTotalValue),
    crOpen: money(payload.summary.receivableOpenValue),
    received: money(payload.summary.receivableReceivedValue),
  });

  console.log(`\nItens (${payload.items.length}):`);
  for (const it of payload.items) {
    console.log(
      `  #${it.itemSequence ?? "?"} · ${it.productCode ?? "—"} · qty=${it.quantity ?? "?"} · net=${money(it.totalNetValue)} · status=${it.itemStatus ?? "—"} · cancel=${it.nomusIsCanceled} · cut=${it.nomusIsCut} · stale=${it.nomusIsStale} · match=${it.matchConfidence ?? "—"}`
    );
  }

  console.log(`\nCR títulos (${payload.receivables.length}):`);
  for (const r of payload.receivables) {
    console.log(
      `  Ref ${r.receivableExternalId} · NF ${r.sourceInvoiceNumber ?? r.sourceInvoiceId ?? "—"} · venc ${r.dueDate ?? "—"} · valor ${money(r.amountReceivable)} · aberto ${money(r.balanceReceivable)} · recebido ${money(r.amountReceived)} · baixa ${r.settlementDate ?? "—"} · ${r.status}`
    );
  }
  console.log("\nTotais CR:", payload.receivablesTotal);

  console.log(`\nDocumentos de saída (${payload.stockDocuments.length}):`);
  for (const d of payload.stockDocuments) {
    console.log(
      `  Doc ${d.stockDocumentExternalId} · ${d.tipoDocumentoEstoque ?? "—"} · ${d.dataDocumento ?? "—"} · qtd=${d.quantityDocument} · usada=${d.quantityUsedForOrder} · excesso=${d.excessQuantity} · valor=${money(d.totalValue)} · alocado=${money(d.allocatedValue)}`
    );
  }

  console.log(`\nNF-e (${payload.nfes.length}):`);
  for (const n of payload.nfes) {
    console.log(
      `  NF ${n.numero ?? "?"} série ${n.serie ?? "—"} · valor ${money(n.valorTotal)} · alocado ${money(n.allocatedValueToOrder)} · headerGT? ${n.headerGreaterThanOrder} · CR? ${n.hasReceivable}`
    );
  }

  console.log(`\nAlertas (${payload.alerts.length}):`);
  for (const a of payload.alerts) {
    console.log(`  [${a.severity}] ${a.code} — ${a.title}: ${a.description}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
