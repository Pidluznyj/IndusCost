/**
 * QA estático do reprocessamento de comissões.
 *
 * Uso: npx tsx scripts/qaCommissionReprocess.ts
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  COMMISSION_REPROCESS_ENGINE,
  assertCanReprocessCommission,
  resolveReprocessRowDecision,
} from "../src/lib/commissions/commissionReprocess.ts";

const root = process.cwd();

type Check = { id: string; ok: boolean; detail: string };
const checks: Check[] = [];

function check(id: string, ok: boolean, detail: string) {
  checks.push({ id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id} — ${detail}`);
}

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function main() {
  const routes = read("src/lib/commissionsRoutes.ts");
  check(
    "endpoint-preview",
    routes.includes('/api/commissions/reprocess/preview'),
    "POST /api/commissions/reprocess/preview registrado"
  );
  check(
    "endpoint-apply",
    routes.includes('/api/commissions/reprocess/apply'),
    "POST /api/commissions/reprocess/apply registrado"
  );

  const server = read("src/lib/commissions/commissionReprocess.server.ts");
  check(
    "uses-official-engine",
    server.includes("materializeCommissionForSalesOrder") &&
      server.includes("rebuildCommissionReceivableSchedule") &&
      COMMISSION_REPROCESS_ENGINE.includes("materializeCommissionForSalesOrder"),
    "Service usa motor oficial de materialização"
  );
  check(
    "preview-dry-run",
    server.includes("dryRun: true") && server.includes("previewCommissionReprocess"),
    "Preview chama materialize em dryRun"
  );
  check(
    "apply-audit",
    server.includes("COMMISSION_REPROCESS_APPLY_KIND") &&
      server.includes("commissionCalculationRun.create"),
    "Apply grava auditoria em CommissionCalculationRun"
  );

  const paid = resolveReprocessRowDecision({
    lifecycle: "paid",
    difference: 10,
    includeConfirmedNotPaid: true,
    includeReleasedNotPaid: true,
    includePaid: true,
  });
  check("paid-blocked", paid.blocked && !paid.changed, "Comissões pagas bloqueadas");

  const sellerGuard = read("src/lib/commissions/commissionReprocess.server.ts");
  check(
    "seller-from-order",
    sellerGuard.includes("externalSellerId") &&
      !sellerGuard.includes("accountOwner") &&
      !sellerGuard.includes("CrmCustomerCommercialOwner"),
    "Filtro de vendedor usa Pedido (externalSellerId), não CRM"
  );

  check(
    "no-proposal-source",
    !server.includes("proposalItemEstimatedCommission") &&
      !server.includes("from Proposal as commission source"),
    "Proposal não é fonte oficial de comissão"
  );

  const panel = read("src/components/commissions/CommissionReprocessPanel.tsx");
  check(
    "no-prisma-frontend",
    !panel.includes("@prisma/client") && !panel.includes("from \"@/src/lib/prisma"),
    "Frontend sem import Prisma"
  );

  check(
    "admin-apply",
    assertCanReprocessCommission({ role: "SUPER_ADMIN" }).ok &&
      assertCanReprocessCommission({ role: "ADMIN" }).ok &&
      !assertCanReprocessCommission({ role: "SELLER" }).ok,
    "SUPER_ADMIN/ADMIN podem aplicar; SELLER não"
  );

  check(
    "runbook",
    existsSync(path.join(root, "docs/commissions/commission-reprocess-runbook.md")),
    "Runbook documentado"
  );

  check(
    "script",
    existsSync(path.join(root, "scripts/reprocessCommissions.ts")),
    "Script CLI presente"
  );

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks OK`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main();
