/**
 * QA — Comissão limitada ao valor original do CR (não ao recebido com juros).
 *
 * Uso: npx tsx scripts/qaCommissionReceivableOriginalBase.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  computeCommissionReleasedFromReceivablePrincipal,
  RECEIPT_AMOUNT_GREATER_THAN_RECEIVABLE_ORIGINAL,
  resolveReceivableCommissionPrincipal,
  roundMoney,
} from "../src/lib/commissions/commission-money.shared.ts";
import {
  releaseCommissionFromMaterializedSchedule,
  type CommissionReceiptReceivableInput,
} from "../src/lib/commissions/commissionReceiptEngine.ts";
import { computeScheduleReleaseTarget } from "../src/lib/commissions/commission-release-service.ts";

const ROOT = process.cwd();
let failed = 0;

function ok(id: string, msg: string) {
  console.log(`OK   ${id} — ${msg}`);
}
function fail(id: string, msg: string) {
  failed += 1;
  console.error(`FAIL ${id} — ${msg}`);
}

function checkCase1FullReceiptWithInterest() {
  const b = resolveReceivableCommissionPrincipal({
    receivableOriginalAmount: 10000,
    receivedAmount: 10350,
  });
  const released = computeCommissionReleasedFromReceivablePrincipal({
    commissionExpectedAmount: 500,
    receivableOriginalAmount: 10000,
    receivedAmount: 10350,
  });
  try {
    assert.equal(b.commissionPrincipalAmount, 10000);
    assert.equal(b.ignoredFinancialChargesAmount, 350);
    assert.equal(released, 500);
    assert.ok(b.auditFlags.includes(RECEIPT_AMOUNT_GREATER_THAN_RECEIVABLE_ORIGINAL));
    assert.notEqual(released, 517.5);
    ok("1-full-interest", "10.000 base → R$ 500 (não 517,50); juros 350 ignorados");
  } catch (e) {
    fail("1-full-interest", e instanceof Error ? e.message : String(e));
  }
}

function checkCase2PartialCapAtOriginal() {
  // Sem interestAmount separado: min(5100, 10000)=5100 → 51% de 500 = 255.
  // Documentado: não isola juros embutidos em parcial.
  const released = computeCommissionReleasedFromReceivablePrincipal({
    commissionExpectedAmount: 500,
    receivableOriginalAmount: 10000,
    receivedAmount: 5100,
  });
  try {
    assert.equal(released, 255);
    ok(
      "2-partial-min-cap",
      "parcial 5.100 / original 10.000 → 51% (min); sem campo de juros no settlement"
    );
  } catch (e) {
    fail("2-partial-min-cap", e instanceof Error ? e.message : String(e));
  }
}

function checkCase3Exact() {
  const released = computeCommissionReleasedFromReceivablePrincipal({
    commissionExpectedAmount: 500,
    receivableOriginalAmount: 10000,
    receivedAmount: 10000,
  });
  try {
    assert.equal(released, 500);
    ok("3-exact", "recebido = original → libera 100% do previsto");
  } catch (e) {
    fail("3-exact", e instanceof Error ? e.message : String(e));
  }
}

function checkCase4NeverExceedsExpected() {
  const a = computeCommissionReleasedFromReceivablePrincipal({
    commissionExpectedAmount: 500,
    receivableOriginalAmount: 10000,
    receivedAmount: 50000,
  });
  const b = computeScheduleReleaseTarget({
    releaseRule: "EACH_RECEIVABLE_PAID",
    schedule: {
      commissionExpectedAmount: 22.5,
      receivableAmount: 1000,
      receivedAmount: 9999,
    },
    receivable: {
      amountReceivable: 1000,
      amountReceived: 9999,
    } as never,
    isFirstReceivablePaidInOrder: true,
  });
  try {
    assert.equal(a, 500);
    assert.equal(b, 22.5);
    ok("4-cap-expected", "liberação acumulada/alvo nunca passa do previsto");
  } catch (e) {
    fail("4-cap-expected", e instanceof Error ? e.message : String(e));
  }
}

function checkCase5EngineUsesOriginal() {
  const schedule = {
    id: "sch-1",
    receivableId: 1,
    salesOrderId: null,
    orderCode: "PD 1",
    nfeId: null,
    customerId: null,
    installmentNumber: 1,
    receivableCode: "CR-1",
    receivableNominalAmount: 10000,
    dueDate: null,
    scheduledCommissionAmount: 500,
    scheduleStatus: "ACTIVE" as const,
    exclusionReason: null,
    grossScheduledCommissionAmount: null,
    canonicalSellerId: null,
    canonicalSellerName: null,
    rawSellerId: null,
    rawSellerName: null,
  };
  const receivable: CommissionReceiptReceivableInput = {
    nomusReceivableId: 1,
    receivableNumber: "CR-1",
    installmentNumber: 1,
    amountReceivable: 10000,
    amountReceived: 10350,
    balanceReceivable: 0,
    settlementDate: new Date("2026-06-15"),
    dueDate: new Date("2026-06-10"),
    customerExternalId: null,
    customerId: null,
    customerName: "Cliente",
    customerCnpj: null,
    nomusNfeId: null,
    nfeNumber: null,
  };
  const out = releaseCommissionFromMaterializedSchedule({ schedule, receivable });
  try {
    assert.equal(out.commissionableBaseAmount, 10000);
    assert.equal(out.ignoredFinancialChargesAmount, 350);
    assert.equal(out.expectedCommissionAmount, 500);
    ok("5-engine-original", "releaseCommissionFromMaterializedSchedule usa original do CR");
  } catch (e) {
    fail("5-engine-original", e instanceof Error ? e.message : String(e));
  }
}

function checkCase6PaidNotAutoMutated() {
  const docs = readFileSync(
    join(ROOT, "docs/commissions/commission-receivable-base-rule.md"),
    "utf8"
  );
  if (/não é recalculado automaticamente|não.*altera automaticamente/i.test(docs)) {
    ok("6-paid-safe", "docs: paidAmount/comissão paga não muda automaticamente");
  } else {
    fail("6-paid-safe", "docs sem política de comissão paga imutável");
  }
}

function checkCase7AuditFields() {
  const b = resolveReceivableCommissionPrincipal({
    receivableOriginalAmount: 10000,
    receivedAmount: 10350,
  });
  try {
    assert.equal(b.receivedGrossAmount, 10350);
    assert.equal(b.ignoredFinancialChargesAmount, 350);
    assert.ok(b.auditFlags.includes(RECEIPT_AMOUNT_GREATER_THAN_RECEIVABLE_ORIGINAL));
    ok("7-audit-ignored", "auditoria expõe receivedGross + ignored charges");
  } catch (e) {
    fail("7-audit-ignored", e instanceof Error ? e.message : String(e));
  }
}

function checkCase8FrontendNoPrisma() {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const src = readFileSync(full, "utf8");
      if (/from\s+["']@prisma\/client["']/.test(src)) offenders.push(full);
    }
  };
  walk(join(ROOT, "src/components/commissions"));
  if (offenders.length === 0) {
    ok("8-frontend-no-prisma", "src/components/commissions sem @prisma/client");
  } else {
    fail("8-frontend-no-prisma", offenders.join(", "));
  }
}

function checkStaticSourceGuards() {
  const engine = readFileSync(
    join(ROOT, "src/lib/commissions/commissionReceiptEngine.ts"),
    "utf8"
  );
  const money = readFileSync(
    join(ROOT, "src/lib/commissions/commission-money.shared.ts"),
    "utf8"
  );
  if (
    money.includes("resolveReceivableCommissionPrincipal") &&
    engine.includes("resolveReceivableCommissionPrincipal") &&
    engine.includes("ignoredFinancialChargesAmount")
  ) {
    ok("static-engine-base", "engine + money.shared com principal/encargos ignorados");
  } else {
    fail("static-engine-base", "helper/engine sem resolveReceivableCommissionPrincipal");
  }
  void roundMoney;
}

function main() {
  console.log("=== qaCommissionReceivableOriginalBase ===\n");
  checkCase1FullReceiptWithInterest();
  checkCase2PartialCapAtOriginal();
  checkCase3Exact();
  checkCase4NeverExceedsExpected();
  checkCase5EngineUsesOriginal();
  checkCase6PaidNotAutoMutated();
  checkCase7AuditFields();
  checkCase8FrontendNoPrisma();
  checkStaticSourceGuards();

  console.log("");
  if (failed === 0) {
    console.log("✔ Todos os checks da base original do CR passaram.");
    process.exit(0);
  }
  console.error(`✗ ${failed} check(s) falharam.`);
  process.exit(1);
}

main();
