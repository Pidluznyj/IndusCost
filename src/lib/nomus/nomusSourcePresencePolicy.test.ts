import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOMUS_OPS_EXCLUDE_MISSING_AP_ENV,
  NOMUS_OPS_EXCLUDE_MISSING_AR_ENV,
  NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV,
  canAuditConfirmedMissingPresence,
  isFinanceApExcludedBySourcePresence,
  isFinanceArExcludedBySourcePresence,
  isNomusOpsExcludeMissingApEnabled,
  isNomusOpsExcludeMissingArEnabled,
  isNomusOpsExcludeMissingSalesOrdersEnabled,
  isNomusSourceOperationallyPresent,
  isNomusSourcePresenceAdminAlert,
  isNomusSourcePresenceVisibleForAudit,
  mergeAccountsPayableOperationalPresenceWhere,
  mergeAccountsReceivableOperationalPresenceWhere,
  mergeSalesOrderOperationalPresenceWhere,
  shouldExcludeConfirmedMissingFromOpenOperations,
} from "./nomusSourcePresencePolicy.js";
import {
  accountsPayableOperationalPresenceSql,
  accountsReceivableOperationalPresenceSql,
  salesOrderOperationalPresenceSql,
} from "./nomusSourcePresencePolicy.server.js";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("nomusSourcePresencePolicy — regra central", () => {
  it("1. PRESENT é operacional", () => {
    assert.equal(isNomusSourceOperationallyPresent("PRESENT"), true);
    assert.equal(
      shouldExcludeConfirmedMissingFromOpenOperations({
        sourcePresenceStatus: "PRESENT",
        openBalance: 100,
      }),
      false
    );
  });

  it("2. MISSING_CANDIDATE aparece com alerta administrativo", () => {
    assert.equal(isNomusSourceOperationallyPresent("MISSING_CANDIDATE"), true);
    assert.equal(isNomusSourcePresenceAdminAlert("MISSING_CANDIDATE"), true);
    assert.equal(isNomusSourcePresenceAdminAlert("PRESENT"), false);
  });

  it("3. MISSING_CONFIRMED não participa da operação aberta", () => {
    assert.equal(isNomusSourceOperationallyPresent("MISSING_CONFIRMED"), false);
    assert.equal(
      shouldExcludeConfirmedMissingFromOpenOperations({
        sourcePresenceStatus: "MISSING_CONFIRMED",
        openBalance: 50,
      }),
      true
    );
    assert.equal(
      shouldExcludeConfirmedMissingFromOpenOperations({
        sourcePresenceStatus: "MISSING_CONFIRMED",
        treatAsOpenOperational: true,
      }),
      true
    );
  });

  it("4. histórico liquidados permanece acessível", () => {
    assert.equal(
      shouldExcludeConfirmedMissingFromOpenOperations({
        sourcePresenceStatus: "MISSING_CONFIRMED",
        openBalance: 0,
      }),
      false
    );
    assert.equal(isNomusSourcePresenceVisibleForAudit("MISSING_CONFIRMED"), true);
  });

  it("5. Pedido ausente não esconde CR real (independência)", () => {
    // Policy de CR só olha sourcePresenceStatus do próprio CR.
    assert.equal(
      isFinanceArExcludedBySourcePresence(
        { sourcePresenceStatus: "PRESENT", balanceReceivable: 200 },
        { [NOMUS_OPS_EXCLUDE_MISSING_AR_ENV]: "true" }
      ),
      false
    );
  });

  it("6. CR ausente não apaga recebimento histórico", () => {
    assert.equal(
      isFinanceArExcludedBySourcePresence(
        { sourcePresenceStatus: "MISSING_CONFIRMED", balanceReceivable: 0 },
        { [NOMUS_OPS_EXCLUDE_MISSING_AR_ENV]: "true" }
      ),
      false
    );
  });

  it("7. CP ausente não apaga pagamento histórico", () => {
    assert.equal(
      isFinanceApExcludedBySourcePresence(
        { sourcePresenceStatus: "MISSING_CONFIRMED", balancePayable: 0 },
        { [NOMUS_OPS_EXCLUDE_MISSING_AP_ENV]: "true" }
      ),
      false
    );
  });

  it("8. comissão paga / histórico não depende de presença operacional", () => {
    // Presença só exclui saldo aberto; evidência liquidada permanece.
    assert.equal(
      shouldExcludeConfirmedMissingFromOpenOperations({
        sourcePresenceStatus: "MISSING_CONFIRMED",
        openBalance: 0,
      }),
      false
    );
  });

  it("9. Fluxo de Caixa exclui somente ausências confirmadas abertas", () => {
    const env = { [NOMUS_OPS_EXCLUDE_MISSING_AR_ENV]: "true" };
    assert.equal(
      isFinanceArExcludedBySourcePresence(
        { sourcePresenceStatus: "MISSING_CANDIDATE", balanceReceivable: 10 },
        env
      ),
      false
    );
    assert.equal(
      isFinanceArExcludedBySourcePresence(
        { sourcePresenceStatus: "MISSING_CONFIRMED", balanceReceivable: 10 },
        env
      ),
      true
    );
  });

  it("10. flags independentes e fail-closed", () => {
    assert.equal(isNomusOpsExcludeMissingSalesOrdersEnabled({}), false);
    assert.equal(isNomusOpsExcludeMissingArEnabled({}), false);
    assert.equal(isNomusOpsExcludeMissingApEnabled({}), false);

    assert.equal(
      isNomusOpsExcludeMissingSalesOrdersEnabled({
        [NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV]: "true",
      }),
      true
    );
    assert.equal(
      isNomusOpsExcludeMissingArEnabled({
        [NOMUS_OPS_EXCLUDE_MISSING_AR_ENV]: "yes",
      }),
      true
    );
    assert.equal(
      isNomusOpsExcludeMissingApEnabled({
        [NOMUS_OPS_EXCLUDE_MISSING_AP_ENV]: "1",
      }),
      true
    );

    // Ligar só AR não liga Pedidos/CP
    const onlyAr = { [NOMUS_OPS_EXCLUDE_MISSING_AR_ENV]: "true" };
    assert.equal(isNomusOpsExcludeMissingArEnabled(onlyAr), true);
    assert.equal(isNomusOpsExcludeMissingSalesOrdersEnabled(onlyAr), false);
    assert.equal(isNomusOpsExcludeMissingApEnabled(onlyAr), false);
  });

  it("11. frontend não duplica regra (autoridade backend)", () => {
    const salesOrdersUi = read("src/components/SalesOrdersModule.tsx");
    assert.doesNotMatch(salesOrdersUi, /sourcePresenceStatus/);
    assert.doesNotMatch(salesOrdersUi, /MISSING_CONFIRMED/);
    assert.match(
      read("src/lib/nomus/nomusSourcePresencePolicy.ts"),
      /isNomusSourceOperationallyPresent/
    );
    assert.match(
      read("src/lib/financeAccountsReceivableDashboard.ts"),
      /mergeAccountsReceivableOperationalPresenceWhere/
    );
  });

  it("12. relatórios SQL respeitam a policy", () => {
    const crm = read("src/lib/crmOrderPortfolioSql.ts");
    const billing = read("src/lib/financeBillingForecast.ts");
    assert.match(crm, /salesOrderOperationalPresenceSql/);
    assert.match(billing, /salesOrderOperationalPresenceSql/);

    const envOn = { [NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV]: "true" };
    const envOff = {};
    const sqlText = (sql: { strings?: ReadonlyArray<string>; values?: unknown[] }) =>
      `${(sql.strings ?? []).join("")}${JSON.stringify(sql.values ?? [])}`;
    assert.match(sqlText(salesOrderOperationalPresenceSql("so", envOn)), /MISSING_CONFIRMED|sourcePresenceStatus/);
    assert.match(sqlText(salesOrderOperationalPresenceSql("so", envOff)), /TRUE/);
    assert.match(
      sqlText(
        accountsReceivableOperationalPresenceSql("ar", {
          [NOMUS_OPS_EXCLUDE_MISSING_AR_ENV]: "true",
        })
      ),
      /MISSING_CONFIRMED|sourcePresenceStatus/
    );
    assert.match(
      sqlText(
        accountsPayableOperationalPresenceSql("ap", {
          [NOMUS_OPS_EXCLUDE_MISSING_AP_ENV]: "true",
        })
      ),
      /MISSING_CONFIRMED|sourcePresenceStatus/
    );
  });

  it("13. SUPER_ADMIN consegue auditar registros ausentes", () => {
    assert.equal(canAuditConfirmedMissingPresence("SUPER_ADMIN"), true);
    assert.equal(canAuditConfirmedMissingPresence("ADMIN"), true);
    assert.equal(canAuditConfirmedMissingPresence("VIEWER"), false);
    assert.equal(isNomusSourcePresenceVisibleForAudit("MISSING_CONFIRMED"), true);

    const where = mergeSalesOrderOperationalPresenceWhere(
      { status: { not: "CANCELLED" } },
      {
        includeConfirmedMissing: canAuditConfirmedMissingPresence("SUPER_ADMIN"),
        env: { [NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV]: "true" },
      }
    );
    assert.deepEqual(where, { status: { not: "CANCELLED" } });
  });
});

describe("nomusSourcePresencePolicy — merges Prisma", () => {
  it("merge SO aplica só com flag", () => {
    const base = { status: { not: "CANCELLED" as const } };
    assert.deepEqual(
      mergeSalesOrderOperationalPresenceWhere(base, { env: {} }),
      base
    );
    const merged = mergeSalesOrderOperationalPresenceWhere(base, {
      env: { [NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV]: "true" },
    });
    assert.deepEqual(merged, {
      AND: [base, { sourcePresenceStatus: { not: "MISSING_CONFIRMED" } }],
    });
  });

  it("merge AR/AP respeitam universo aberto e flags", () => {
    const base = { balanceReceivable: { gt: 0 } };
    assert.deepEqual(
      mergeAccountsReceivableOperationalPresenceWhere(base, {
        env: { [NOMUS_OPS_EXCLUDE_MISSING_AR_ENV]: "true" },
        openOperationalUniverse: false,
      }),
      base
    );
    assert.deepEqual(
      mergeAccountsReceivableOperationalPresenceWhere(base, {
        env: { [NOMUS_OPS_EXCLUDE_MISSING_AR_ENV]: "true" },
      }),
      {
        AND: [base, { sourcePresenceStatus: { not: "MISSING_CONFIRMED" } }],
      }
    );
    assert.deepEqual(
      mergeAccountsPayableOperationalPresenceWhere(
        { balancePayable: { gt: 0 } },
        { env: { [NOMUS_OPS_EXCLUDE_MISSING_AP_ENV]: "on" } }
      ),
      {
        AND: [
          { balancePayable: { gt: 0 } },
          { sourcePresenceStatus: { not: "MISSING_CONFIRMED" } },
        ],
      }
    );
  });

  it("consumidores oficiais importam a policy (sem syncer)", () => {
    const arDash = read("src/lib/financeAccountsReceivableDashboard.ts");
    const apDash = read("src/lib/financeAccountsPayableDashboard.ts");
    const arFresh = read("src/lib/financeNomusArReportFreshness.ts");
    const apFresh = read("src/lib/financeNomusApReportFreshness.ts");
    const mgmt = read("src/lib/salesOrderManagement.ts");
    const metrics = read("src/lib/salesOrderMetricsEngine.ts");
    const forecast = read("src/lib/commissions/commissionForecast.server.ts");
    const syncAp = read("scripts/nomusAccountsPayableSync.ts");
    const syncAr = read("scripts/nomusAccountsReceivableSync.ts");

    assert.match(arDash, /mergeAccountsReceivableOperationalPresenceWhere|isFinanceArExcludedBySourcePresence/);
    assert.match(apDash, /mergeAccountsPayableOperationalPresenceWhere|isFinanceApExcludedBySourcePresence/);
    assert.match(arFresh, /isFinanceArExcludedBySourcePresence/);
    assert.match(apFresh, /isFinanceApExcludedBySourcePresence/);
    assert.match(mgmt, /mergeSalesOrderOperationalPresenceWhere/);
    assert.match(metrics, /mergeSalesOrderOperationalPresenceWhere/);
    assert.match(forecast, /mergeSalesOrderOperationalPresenceWhere/);
    assert.match(
      read("src/lib/salesOrdersListSummary.ts"),
      /mergeSalesOrderOperationalPresenceWhere/
    );
    // SYNC-07 não modifica sincronizadores
    assert.doesNotMatch(syncAp, /nomusSourcePresencePolicy/);
    assert.doesNotMatch(syncAr, /nomusSourcePresencePolicy/);
  });
});
