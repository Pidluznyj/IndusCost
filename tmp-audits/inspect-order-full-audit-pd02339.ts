/**
 * Diagnóstico — Auditoria 360º do Pedido: PD 02339.
 * Uso: npx tsx tmp-audits/inspect-order-full-audit-pd02339.ts
 */
import "dotenv/config";
import { inspectOrderFullAudit } from "./_inspectOrderFullAudit.js";

async function main(): Promise<void> {
  await inspectOrderFullAudit("PD 02339");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
