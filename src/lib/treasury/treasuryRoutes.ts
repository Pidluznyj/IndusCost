/**
 * Router principal da Central de Tesouraria.
 * Auth + flag + requireResource; handlers em controllers.
 */

import type express from "express";
import type { RequestHandler } from "express";
import multer from "multer";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { treasuryAvailabilityHandler } from "./controllers/treasuryAvailabilityController.js";
import { createTreasuryAccountControllers } from "./controllers/treasuryAccountController.js";
import { createTreasuryBalanceControllers } from "./controllers/treasuryBalanceController.js";
import { createTreasuryReceivableControllers } from "./controllers/treasuryReceivableController.js";
import { createTreasuryPayableControllers } from "./controllers/treasuryPayableController.js";
import { createTreasuryPayableProgrammingControllers } from "./controllers/treasuryPayableProgrammingController.js";
import { createTreasuryPaymentPromiseControllers } from "./controllers/treasuryPaymentPromiseController.js";
import { createTreasuryCollectionActionControllers } from "./controllers/treasuryCollectionActionController.js";
import { createTreasuryDisputeControllers } from "./controllers/treasuryDisputeController.js";
import { createTreasuryDashboardControllers } from "./controllers/treasuryDashboardController.js";
import { createTreasuryGuidedTodayControllers } from "./controllers/treasuryGuidedTodayController.js";
import { createTreasuryGuidedDailyOpeningControllers } from "./controllers/treasuryGuidedDailyOpeningController.js";
import { createTreasuryGuidedDailyClosingControllers } from "./controllers/treasuryGuidedDailyClosingController.js";
import { createTreasuryProjectionControllers } from "./controllers/treasuryProjectionController.js";
import { createTreasuryPredictiveCrCpByAccountControllers } from "./controllers/treasuryPredictiveCrCpByAccountController.js";
import { createTreasuryCaixaControllers } from "./controllers/treasuryCaixaController.js";
import { createTreasuryCaixaScenariosControllers } from "./controllers/treasuryCaixaScenariosController.js";
import { createCashSupportControllers } from "./controllers/cashSupportController.js";
import { createTreasuryTransferControllers } from "./controllers/treasuryTransferController.js";
import { createTreasuryExceptionControllers } from "./controllers/treasuryExceptionController.js";
import { createTreasuryAlertSettingsControllers } from "./controllers/treasuryAlertSettingsController.js";
import { createTreasuryDailyClosingPreviewControllers } from "./controllers/treasuryDailyClosingPreviewController.js";
import { createTreasuryDailyClosingControllers } from "./controllers/treasuryDailyClosingController.js";
import { createTreasuryBankImportOfxPreviewControllers } from "./controllers/treasuryBankImportOfxPreviewController.js";
import { createTreasuryBankImportOfxApplyControllers } from "./controllers/treasuryBankImportOfxApplyController.js";
import { createTreasuryBankMovementQueryControllers } from "./controllers/treasuryBankMovementQueryController.js";
import { createTreasuryReconciliationMatchControllers } from "./controllers/treasuryReconciliationMatchController.js";
import { createTreasuryReportControllers } from "./controllers/treasuryReportController.js";
import { createTreasuryReportExportControllers } from "./controllers/treasuryReportExportController.js";
import { createTreasuryManualLedgerControllers } from "./controllers/treasuryManualLedgerController.js";
import { createTreasuryTraceabilityGapControllers } from "./controllers/treasuryTraceabilityGapController.js";
import {
  TREASURY_ACCOUNTS_PATH,
  TREASURY_AGENDA_PATH,
  TREASURY_PREDICTIVE_CRCP_BY_ACCOUNT_PATH,
  TREASURY_CAIXA_PATH,
  TREASURY_CAIXA_SCENARIOS_PATH,
  TREASURY_CASH_SUPPORT_PATH,
  TREASURY_CASH_SUPPORT_SUMMARY_PATH,
  TREASURY_ALERT_SETTINGS_PATH,
  TREASURY_ALERTS_PATH,
  TREASURY_AUDIT_PATH,
  TREASURY_AVAILABILITY_PATH,
  TREASURY_BANK_IMPORTS_OFX_APPLY_PATH,
  TREASURY_BANK_IMPORTS_OFX_PREVIEW_PATH,
  TREASURY_BANK_IMPORTS_PATH,
  TREASURY_BANK_MOVEMENTS_PATH,
  TREASURY_COLLECTION_ACTIONS_PATH,
  TREASURY_DAILY_CLOSING_PATH,
  TREASURY_DAILY_CLOSING_PREVIEW_PATH,
  TREASURY_DASHBOARD_PATH,
  TREASURY_TODAY_PATH,
  TREASURY_TODAY_OPENING_PATH,
  TREASURY_TODAY_CLOSING_PATH,
  TREASURY_DISPUTES_PATH,
  TREASURY_EXCEPTIONS_PATH,
  TREASURY_FORECAST_VS_ACTUAL_PATH,
  TREASURY_HEALTH_PATH,
  TREASURY_LEDGER_ENTRIES_PATH,
  TREASURY_PAYABLES_PATH,
  TREASURY_PAYMENT_SCHEDULE_PATH,
  TREASURY_PROJECTIONS_PATH,
  TREASURY_PROMISES_PATH,
  TREASURY_RECEIVABLES_PATH,
  TREASURY_RECONCILE_WORKSPACE_PATH,
  TREASURY_RECONCILIATIONS_PATH,
  TREASURY_REPORTS_PATH,
  TREASURY_TRANSFERS_PATH,
} from "./contracts/treasuryContracts.js";
import { TREASURY_OFX_MAX_FILE_BYTES } from "./ofx/treasuryOfxConstants.js";
import {
  FINANCE_AP_RESOURCE_KEY_REF,
  FINANCE_MODULE_RESOURCE_KEYS,
} from "@/src/lib/financeModulesAccess.js";
import {
  TREASURY_ACTIONS,
  TREASURY_RESOURCE_KEY,
  TREASURY_RESOURCE_KEYS,
} from "./treasuryAccess.js";
import {
  requireTreasuryFeatureFlag,
  requireTreasuryModuleEnabled,
} from "./treasuryFeatureFlags.js";
import { requireTreasuryCriticalRateLimit } from "./treasuryRateLimit.js";

export type TreasuryAuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (
    req: express.Request
  ) => Promise<AppAuthContext | null>;
};

/**
 * Registra rotas do módulo. Lógica de negócio permanece fora de server.ts.
 */
export function registerTreasuryRoutes(
  app: express.Express,
  auth: TreasuryAuthGuards
): void {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;
  const accounts = createTreasuryAccountControllers({ getCurrentAppUser });
  const balances = createTreasuryBalanceControllers({ getCurrentAppUser });
  const receivables = createTreasuryReceivableControllers({ getCurrentAppUser });
  const payables = createTreasuryPayableControllers({ getCurrentAppUser });
  const payableProgramming = createTreasuryPayableProgrammingControllers({
    getCurrentAppUser,
  });
  const promises = createTreasuryPaymentPromiseControllers({ getCurrentAppUser });
  const collectionActions = createTreasuryCollectionActionControllers({
    getCurrentAppUser,
  });
  const disputes = createTreasuryDisputeControllers({ getCurrentAppUser });
  const dashboard = createTreasuryDashboardControllers({ getCurrentAppUser });
  const guidedToday = createTreasuryGuidedTodayControllers({ getCurrentAppUser });
  const guidedOpening = createTreasuryGuidedDailyOpeningControllers({
    getCurrentAppUser,
  });
  const guidedClosing = createTreasuryGuidedDailyClosingControllers({
    getCurrentAppUser,
  });
  const projections = createTreasuryProjectionControllers({ getCurrentAppUser });
  const predictiveCrCpByAccount = createTreasuryPredictiveCrCpByAccountControllers({
    getCurrentAppUser,
  });
  const caixa = createTreasuryCaixaControllers({ getCurrentAppUser });
  const cashSupport = createCashSupportControllers({ getCurrentAppUser });
  const caixaScenarios = createTreasuryCaixaScenariosControllers({
    getCurrentAppUser,
  });
  const transfers = createTreasuryTransferControllers({ getCurrentAppUser });
  const exceptions = createTreasuryExceptionControllers({ getCurrentAppUser });
  const alertSettings = createTreasuryAlertSettingsControllers({
    getCurrentAppUser,
  });
  const dailyClosingPreview = createTreasuryDailyClosingPreviewControllers({
    getCurrentAppUser,
  });
  const dailyClosing = createTreasuryDailyClosingControllers({
    getCurrentAppUser,
  });
  const ofxPreview = createTreasuryBankImportOfxPreviewControllers({
    getCurrentAppUser,
  });
  const ofxApply = createTreasuryBankImportOfxApplyControllers({
    getCurrentAppUser,
  });
  const bankMovements = createTreasuryBankMovementQueryControllers({
    getCurrentAppUser,
  });
  const reconciliations = createTreasuryReconciliationMatchControllers({
    getCurrentAppUser,
  });
  const reports = createTreasuryReportControllers({ getCurrentAppUser });
  const reportExports = createTreasuryReportExportControllers({
    getCurrentAppUser,
  });
  const manualLedger = createTreasuryManualLedgerControllers({
    getCurrentAppUser,
  });
  const gaps = createTreasuryTraceabilityGapControllers({ getCurrentAppUser });
  const ofxUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: TREASURY_OFX_MAX_FILE_BYTES, files: 1 },
  });

  const rateLimitUserId = async (req: express.Request) => {
    const user = await getCurrentAppUser(req);
    return user?.id ?? null;
  };
  const rateOfxPreview = requireTreasuryCriticalRateLimit({
    action: "ofxPreview",
    getUserId: rateLimitUserId,
  });
  const rateOfxApply = requireTreasuryCriticalRateLimit({
    action: "ofxApply",
    getUserId: rateLimitUserId,
  });
  const rateReverse = requireTreasuryCriticalRateLimit({
    action: "reconciliationReverse",
    getUserId: rateLimitUserId,
  });
  const rateClose = requireTreasuryCriticalRateLimit({
    action: "dailyClose",
    getUserId: rateLimitUserId,
  });
  const rateReopen = requireTreasuryCriticalRateLimit({
    action: "dailyReopen",
    getUserId: rateLimitUserId,
  });
  const rateReportExport = requireTreasuryCriticalRateLimit({
    action: "reportExport",
    getUserId: rateLimitUserId,
  });

  const viewDashboard = requireResource(
    TREASURY_RESOURCE_KEYS.dashboard,
    TREASURY_ACTIONS.view
  );
  const viewReports = requireResource(
    TREASURY_RESOURCE_KEYS.reports,
    TREASURY_ACTIONS.view
  );
  const exportTreasury = requireResource(
    TREASURY_RESOURCE_KEY,
    TREASURY_ACTIONS.export
  );
  /**
   * Visão do módulo (finance.treasury view). O Caixa é a tela principal da
   * Tesouraria: até 08/2026 essas rotas exigiam CR+CP do Financeiro e
   * NENHUMA permissão de Tesouraria — quem recebia só "Central de
   * Tesouraria" via o menu (quando visível) mas o board respondia 403.
   * O recurso é sensível por si (risk: sensitive no catálogo) e cobre a
   * leitura consolidada de CR/CP DENTRO da Tesouraria.
   */
  const viewTreasury = requireResource(
    TREASURY_RESOURCE_KEY,
    TREASURY_ACTIONS.view
  );
  const viewAgenda = requireResource(
    TREASURY_RESOURCE_KEYS.agenda,
    TREASURY_ACTIONS.view
  );
  const viewAccounts = requireResource(
    TREASURY_RESOURCE_KEYS.accounts,
    TREASURY_ACTIONS.view
  );
  const manageAccounts = requireResource(
    TREASURY_RESOURCE_KEYS.accounts,
    TREASURY_ACTIONS.manage
  );
  const manageBalances = requireResource(
    TREASURY_RESOURCE_KEYS.balances,
    TREASURY_ACTIONS.manage
  );
  const viewReceivables = requireResource(
    TREASURY_RESOURCE_KEYS.receivables,
    TREASURY_ACTIONS.view
  );
  const manageReceivables = requireResource(
    TREASURY_RESOURCE_KEYS.receivables,
    TREASURY_ACTIONS.manage
  );
  const promiseReceivables = requireResource(
    TREASURY_RESOURCE_KEYS.receivablesPromise,
    TREASURY_ACTIONS.execute
  );
  const collectReceivables = requireResource(
    TREASURY_RESOURCE_KEYS.receivablesCollection,
    TREASURY_ACTIONS.execute
  );
  const viewOfficialReceivables = requireResource(
    FINANCE_MODULE_RESOURCE_KEYS.accountsReceivable,
    TREASURY_ACTIONS.view
  );
  const viewPayables = requireResource(
    TREASURY_RESOURCE_KEYS.payables,
    TREASURY_ACTIONS.view
  );
  const programPayables = requireResource(
    TREASURY_RESOURCE_KEYS.payablesProgram,
    TREASURY_ACTIONS.execute
  );
  const viewOfficialPayables = requireResource(
    FINANCE_AP_RESOURCE_KEY_REF,
    TREASURY_ACTIONS.view
  );
  const moduleEnabled = requireTreasuryModuleEnabled();
  const accountsEnabled = requireTreasuryFeatureFlag(
    "treasury.accounts.enabled"
  );
  const balancesEnabled = requireTreasuryFeatureFlag(
    "treasury.balances.enabled"
  );
  const dashboardEnabled = requireTreasuryFeatureFlag(
    "treasury.dashboard.enabled"
  );
  const receivablesEnabled = requireTreasuryFeatureFlag(
    "treasury.receivables.enabled"
  );
  const payablesEnabled = requireTreasuryFeatureFlag(
    "treasury.payables.enabled"
  );
  const promisesEnabled = requireTreasuryFeatureFlag(
    "treasury.promises.enabled"
  );
  const reportsEnabled = requireTreasuryFeatureFlag(
    "treasury.reports.enabled"
  );
  const payablesProgrammingEnabled = requireTreasuryFeatureFlag(
    "treasury.payablesProgramming.enabled"
  );
  const projectionEnabled = requireTreasuryFeatureFlag(
    "treasury.projection.enabled"
  );
  const transfersEnabled = requireTreasuryFeatureFlag(
    "treasury.transfers.enabled"
  );
  const exceptionsEnabled = requireTreasuryFeatureFlag(
    "treasury.exceptions.enabled"
  );
  const viewTransfers = requireResource(
    TREASURY_RESOURCE_KEYS.transfers,
    TREASURY_ACTIONS.view
  );
  const manageTransfers = requireResource(
    TREASURY_RESOURCE_KEYS.transfers,
    TREASURY_ACTIONS.manage
  );
  const viewExceptions = requireResource(
    TREASURY_RESOURCE_KEYS.exceptions,
    TREASURY_ACTIONS.view
  );
  const manageExceptions = requireResource(
    TREASURY_RESOURCE_KEYS.exceptions,
    TREASURY_ACTIONS.manage
  );
  const viewClosing = requireResource(
    TREASURY_RESOURCE_KEYS.closing,
    TREASURY_ACTIONS.view
  );
  const closeDay = requireResource(
    TREASURY_RESOURCE_KEYS.closing,
    TREASURY_ACTIONS.close
  );
  const reopenDay = requireResource(
    TREASURY_RESOURCE_KEYS.closing,
    TREASURY_ACTIONS.reopen
  );
  const dailyClosingEnabled = requireTreasuryFeatureFlag(
    "treasury.dailyClosing.enabled"
  );
  const ofxImportEnabled = requireTreasuryFeatureFlag(
    "treasury.ofxImport.enabled"
  );
  const viewReconciliation = requireResource(
    TREASURY_RESOURCE_KEYS.reconciliation,
    TREASURY_ACTIONS.view
  );
  const manageReconciliation = requireResource(
    TREASURY_RESOURCE_KEYS.reconciliation,
    TREASURY_ACTIONS.manage
  );
  const reverseReconciliation = requireResource(
    TREASURY_RESOURCE_KEYS.reconciliationReverse,
    TREASURY_ACTIONS.execute
  );
  const reconciliationEnabled = requireTreasuryFeatureFlag(
    "treasury.reconciliation.enabled"
  );

  const viewManualEntries = requireResource(
    TREASURY_RESOURCE_KEYS.manualEntries,
    TREASURY_ACTIONS.view
  );
  const manageManualEntries = requireResource(
    TREASURY_RESOURCE_KEYS.manualEntries,
    TREASURY_ACTIONS.manage
  );
  const viewAudit = requireResource(
    TREASURY_RESOURCE_KEYS.audit,
    TREASURY_ACTIONS.view
  );

  app.get(
    TREASURY_AVAILABILITY_PATH,
    requireAppAuth,
    moduleEnabled,
    requireResource(TREASURY_RESOURCE_KEY, TREASURY_ACTIONS.view),
    treasuryAvailabilityHandler
  );

  app.get(
    TREASURY_HEALTH_PATH,
    requireAppAuth,
    moduleEnabled,
    requireResource(TREASURY_RESOURCE_KEY, TREASURY_ACTIONS.view),
    gaps.health
  );

  app.get(
    TREASURY_DASHBOARD_PATH,
    requireAppAuth,
    moduleEnabled,
    dashboardEnabled,
    viewDashboard,
    dashboard.getDashboard
  );

  app.get(
    TREASURY_TODAY_PATH,
    requireAppAuth,
    moduleEnabled,
    dashboardEnabled,
    viewDashboard,
    guidedToday.getToday
  );

  app.get(
    TREASURY_TODAY_OPENING_PATH,
    requireAppAuth,
    moduleEnabled,
    dashboardEnabled,
    balancesEnabled,
    viewAccounts,
    guidedOpening.getWorkspace
  );

  app.post(
    TREASURY_TODAY_OPENING_PATH,
    requireAppAuth,
    moduleEnabled,
    dashboardEnabled,
    balancesEnabled,
    manageBalances,
    guidedOpening.saveOpenings
  );

  app.get(
    TREASURY_TODAY_CLOSING_PATH,
    requireAppAuth,
    moduleEnabled,
    dashboardEnabled,
    balancesEnabled,
    viewAccounts,
    guidedClosing.getWorkspace
  );

  app.post(
    TREASURY_TODAY_CLOSING_PATH,
    requireAppAuth,
    moduleEnabled,
    dashboardEnabled,
    balancesEnabled,
    manageBalances,
    guidedClosing.saveFinalBalances
  );

  app.get(
    `${TREASURY_REPORTS_PATH}/:reportKey`,
    requireAppAuth,
    moduleEnabled,
    reportsEnabled,
    viewReports,
    reports.getReport
  );

  app.get(
    `${TREASURY_REPORTS_PATH}/:reportKey/export.csv`,
    requireAppAuth,
    moduleEnabled,
    reportsEnabled,
    viewReports,
    exportTreasury,
    rateReportExport,
    reportExports.exportCsv
  );
  app.get(
    `${TREASURY_REPORTS_PATH}/:reportKey/export.xlsx`,
    requireAppAuth,
    moduleEnabled,
    reportsEnabled,
    viewReports,
    exportTreasury,
    rateReportExport,
    reportExports.exportXlsx
  );
  app.get(
    `${TREASURY_REPORTS_PATH}/:reportKey/export.pdf`,
    requireAppAuth,
    moduleEnabled,
    reportsEnabled,
    viewReports,
    exportTreasury,
    rateReportExport,
    reportExports.exportPdf
  );

  app.get(
    TREASURY_DAILY_CLOSING_PREVIEW_PATH,
    requireAppAuth,
    moduleEnabled,
    dailyClosingEnabled,
    viewClosing,
    dailyClosingPreview.getPreview
  );

  app.post(
    TREASURY_BANK_IMPORTS_OFX_PREVIEW_PATH,
    requireAppAuth,
    moduleEnabled,
    ofxImportEnabled,
    manageReconciliation,
    rateOfxPreview,
    ofxUpload.single("file"),
    ofxPreview.preview
  );

  app.post(
    TREASURY_BANK_IMPORTS_OFX_APPLY_PATH,
    requireAppAuth,
    moduleEnabled,
    ofxImportEnabled,
    manageReconciliation,
    rateOfxApply,
    ofxApply.apply
  );

  app.get(
    TREASURY_BANK_IMPORTS_PATH,
    requireAppAuth,
    moduleEnabled,
    reconciliationEnabled,
    viewReconciliation,
    bankMovements.listBatches
  );

  app.get(
    TREASURY_BANK_MOVEMENTS_PATH,
    requireAppAuth,
    moduleEnabled,
    reconciliationEnabled,
    viewReconciliation,
    bankMovements.listMovements
  );

  app.get(
    `${TREASURY_BANK_MOVEMENTS_PATH}/:id`,
    requireAppAuth,
    moduleEnabled,
    reconciliationEnabled,
    viewReconciliation,
    bankMovements.getMovement
  );

  app.get(
    TREASURY_RECONCILIATIONS_PATH,
    requireAppAuth,
    moduleEnabled,
    reconciliationEnabled,
    viewReconciliation,
    reconciliations.listByBankMovement
  );

  app.get(
    `${TREASURY_RECONCILIATIONS_PATH}/:id`,
    requireAppAuth,
    moduleEnabled,
    reconciliationEnabled,
    viewReconciliation,
    reconciliations.getById
  );

  app.post(
    `${TREASURY_RECONCILIATIONS_PATH}/:id/reverse`,
    requireAppAuth,
    moduleEnabled,
    reconciliationEnabled,
    reverseReconciliation,
    rateReverse,
    reconciliations.reverse
  );

  app.post(
    TREASURY_RECONCILIATIONS_PATH,
    requireAppAuth,
    moduleEnabled,
    reconciliationEnabled,
    manageReconciliation,
    reconciliations.accept
  );

  app.post(
    `${TREASURY_RECONCILIATIONS_PATH}/:id/unmatch`,
    requireAppAuth,
    moduleEnabled,
    reconciliationEnabled,
    manageReconciliation,
    reconciliations.unmatch
  );

  app.get(
    TREASURY_RECONCILE_WORKSPACE_PATH,
    requireAppAuth,
    moduleEnabled,
    reconciliationEnabled,
    viewReconciliation,
    gaps.reconcileWorkspace
  );

  app.get(
    TREASURY_FORECAST_VS_ACTUAL_PATH,
    requireAppAuth,
    moduleEnabled,
    dashboardEnabled,
    viewDashboard,
    gaps.forecastVsActual
  );

  app.get(
    TREASURY_ALERTS_PATH,
    requireAppAuth,
    moduleEnabled,
    dashboardEnabled,
    viewDashboard,
    gaps.alerts
  );

  app.get(
    TREASURY_AUDIT_PATH,
    requireAppAuth,
    moduleEnabled,
    viewAudit,
    gaps.auditList
  );

  app.get(
    TREASURY_PAYMENT_SCHEDULE_PATH,
    requireAppAuth,
    moduleEnabled,
    payablesProgrammingEnabled,
    viewPayables,
    gaps.paymentSchedule
  );

  app.get(
    TREASURY_LEDGER_ENTRIES_PATH,
    requireAppAuth,
    moduleEnabled,
    accountsEnabled,
    viewManualEntries,
    manualLedger.list
  );

  app.post(
    TREASURY_LEDGER_ENTRIES_PATH,
    requireAppAuth,
    moduleEnabled,
    accountsEnabled,
    manageManualEntries,
    manualLedger.create
  );

  app.get(
    `${TREASURY_LEDGER_ENTRIES_PATH}/:id`,
    requireAppAuth,
    moduleEnabled,
    accountsEnabled,
    viewManualEntries,
    manualLedger.getById
  );

  app.post(
    `${TREASURY_LEDGER_ENTRIES_PATH}/:id/reverse`,
    requireAppAuth,
    moduleEnabled,
    accountsEnabled,
    manageManualEntries,
    manualLedger.reverse
  );

  app.get(
    TREASURY_DAILY_CLOSING_PATH,
    requireAppAuth,
    moduleEnabled,
    dailyClosingEnabled,
    viewClosing,
    dailyClosing.list
  );

  app.post(
    TREASURY_DAILY_CLOSING_PATH,
    requireAppAuth,
    moduleEnabled,
    dailyClosingEnabled,
    closeDay,
    rateClose,
    dailyClosing.close
  );

  app.get(
    `${TREASURY_DAILY_CLOSING_PATH}/:id`,
    requireAppAuth,
    moduleEnabled,
    dailyClosingEnabled,
    viewClosing,
    dailyClosing.getById
  );

  app.post(
    `${TREASURY_DAILY_CLOSING_PATH}/:id/reopen`,
    requireAppAuth,
    moduleEnabled,
    dailyClosingEnabled,
    reopenDay,
    rateReopen,
    dailyClosing.reopen
  );

  app.get(
    TREASURY_ALERT_SETTINGS_PATH,
    requireAppAuth,
    moduleEnabled,
    dashboardEnabled,
    viewDashboard,
    alertSettings.get
  );

  app.put(
    TREASURY_ALERT_SETTINGS_PATH,
    requireAppAuth,
    moduleEnabled,
    exceptionsEnabled,
    manageExceptions,
    alertSettings.put
  );

  app.post(
    `${TREASURY_PROJECTIONS_PATH}/calculate`,
    requireAppAuth,
    moduleEnabled,
    projectionEnabled,
    viewDashboard,
    projections.calculate
  );

  app.get(
    `${TREASURY_PROJECTIONS_PATH}/latest`,
    requireAppAuth,
    moduleEnabled,
    projectionEnabled,
    viewDashboard,
    projections.getLatest
  );

  // Antes de /:id — evita capturar "compare" como id.
  app.get(
    `${TREASURY_PROJECTIONS_PATH}/compare`,
    requireAppAuth,
    moduleEnabled,
    projectionEnabled,
    viewDashboard,
    projections.compareScenarios
  );

  app.get(
    `${TREASURY_PROJECTIONS_PATH}/:id/composition`,
    requireAppAuth,
    moduleEnabled,
    projectionEnabled,
    viewDashboard,
    projections.getComposition
  );

  app.get(
    `${TREASURY_PROJECTIONS_PATH}/:id`,
    requireAppAuth,
    moduleEnabled,
    projectionEnabled,
    viewDashboard,
    projections.getById
  );

  app.get(
    TREASURY_AGENDA_PATH,
    requireAppAuth,
    moduleEnabled,
    projectionEnabled,
    viewAgenda,
    projections.getAgenda
  );

  app.get(
    TREASURY_PREDICTIVE_CRCP_BY_ACCOUNT_PATH,
    requireAppAuth,
    moduleEnabled,
    projectionEnabled,
    viewAgenda,
    predictiveCrCpByAccount.getBoard
  );

  app.get(
    TREASURY_CAIXA_PATH,
    requireAppAuth,
    moduleEnabled,
    viewTreasury,
    caixa.getBoard
  );

  // Apoio ao Caixa (read-only) — RBAC/ACL/flag reaproveitados da conciliação
  // (07-mvp-scope.md): o read model inclui movimento bancário, mais sensível
  // que o Caixa canônico puro. requireResource nega por padrão; ACL por
  // conta é aplicada dentro do orquestrador via treasuryBankMovementQueryService.
  app.get(
    TREASURY_CASH_SUPPORT_PATH,
    requireAppAuth,
    moduleEnabled,
    reconciliationEnabled,
    viewReconciliation,
    cashSupport.getReadModel
  );

  app.get(
    TREASURY_CASH_SUPPORT_SUMMARY_PATH,
    requireAppAuth,
    moduleEnabled,
    reconciliationEnabled,
    viewReconciliation,
    cashSupport.getSummary
  );

  app.get(
    TREASURY_CAIXA_SCENARIOS_PATH,
    requireAppAuth,
    moduleEnabled,
    viewTreasury,
    caixaScenarios.getBoard
  );

  app.get(
    TREASURY_ACCOUNTS_PATH,
    requireAppAuth,
    moduleEnabled,
    accountsEnabled,
    viewAccounts,
    accounts.listAccounts
  );

  app.get(
    "/api/finance/treasury/nomus-bank-accounts",
    requireAppAuth,
    moduleEnabled,
    accountsEnabled,
    viewAccounts,
    accounts.listNomusBankAccounts
  );

  app.get(
    `${TREASURY_ACCOUNTS_PATH}/:id/balances/latest`,
    requireAppAuth,
    moduleEnabled,
    balancesEnabled,
    viewAccounts,
    balances.getLatestBalance
  );

  app.get(
    `${TREASURY_ACCOUNTS_PATH}/:id/balances`,
    requireAppAuth,
    moduleEnabled,
    balancesEnabled,
    viewAccounts,
    balances.listBalances
  );

  app.get(
    `${TREASURY_ACCOUNTS_PATH}/:id/balance-position`,
    requireAppAuth,
    moduleEnabled,
    balancesEnabled,
    viewAccounts,
    gaps.balancePosition
  );

  app.post(
    `${TREASURY_ACCOUNTS_PATH}/:id/balance-snapshots`,
    requireAppAuth,
    moduleEnabled,
    balancesEnabled,
    manageBalances,
    balances.createBalanceSnapshot
  );

  app.post(
    `${TREASURY_ACCOUNTS_PATH}/:id/balance-snapshots/:snapshotId/cancel`,
    requireAppAuth,
    moduleEnabled,
    balancesEnabled,
    manageBalances,
    balances.cancelBalanceSnapshot
  );

  app.get(
    `${TREASURY_ACCOUNTS_PATH}/:id`,
    requireAppAuth,
    moduleEnabled,
    accountsEnabled,
    viewAccounts,
    accounts.getAccount
  );

  app.post(
    TREASURY_ACCOUNTS_PATH,
    requireAppAuth,
    moduleEnabled,
    accountsEnabled,
    manageAccounts,
    accounts.createAccount
  );

  app.patch(
    `${TREASURY_ACCOUNTS_PATH}/:id`,
    requireAppAuth,
    moduleEnabled,
    accountsEnabled,
    manageAccounts,
    accounts.updateAccount
  );

  app.post(
    `${TREASURY_ACCOUNTS_PATH}/:id/deactivate`,
    requireAppAuth,
    moduleEnabled,
    accountsEnabled,
    manageAccounts,
    accounts.deactivateAccount
  );

  app.post(
    `${TREASURY_ACCOUNTS_PATH}/:id/reactivate`,
    requireAppAuth,
    moduleEnabled,
    accountsEnabled,
    manageAccounts,
    accounts.reactivateAccount
  );

  app.get(
    `${TREASURY_ACCOUNTS_PATH}/:id/access`,
    requireAppAuth,
    moduleEnabled,
    accountsEnabled,
    manageAccounts,
    accounts.listAccountAccess
  );

  app.put(
    `${TREASURY_ACCOUNTS_PATH}/:id/access`,
    requireAppAuth,
    moduleEnabled,
    accountsEnabled,
    manageAccounts,
    accounts.putAccountAccess
  );

  app.get(
    TREASURY_TRANSFERS_PATH,
    requireAppAuth,
    moduleEnabled,
    transfersEnabled,
    viewTransfers,
    transfers.list
  );

  app.post(
    TREASURY_TRANSFERS_PATH,
    requireAppAuth,
    moduleEnabled,
    transfersEnabled,
    manageTransfers,
    transfers.create
  );

  app.get(
    `${TREASURY_TRANSFERS_PATH}/:id`,
    requireAppAuth,
    moduleEnabled,
    transfersEnabled,
    viewTransfers,
    transfers.getById
  );

  app.post(
    `${TREASURY_TRANSFERS_PATH}/:id/schedule`,
    requireAppAuth,
    moduleEnabled,
    transfersEnabled,
    manageTransfers,
    transfers.schedule
  );

  app.post(
    `${TREASURY_TRANSFERS_PATH}/:id/send`,
    requireAppAuth,
    moduleEnabled,
    transfersEnabled,
    manageTransfers,
    transfers.send
  );

  app.post(
    `${TREASURY_TRANSFERS_PATH}/:id/receive`,
    requireAppAuth,
    moduleEnabled,
    transfersEnabled,
    manageTransfers,
    transfers.receive
  );

  app.post(
    `${TREASURY_TRANSFERS_PATH}/:id/reconcile`,
    requireAppAuth,
    moduleEnabled,
    transfersEnabled,
    manageTransfers,
    transfers.reconcile
  );

  app.post(
    `${TREASURY_TRANSFERS_PATH}/:id/cancel`,
    requireAppAuth,
    moduleEnabled,
    transfersEnabled,
    manageTransfers,
    transfers.cancel
  );

  app.get(
    TREASURY_EXCEPTIONS_PATH,
    requireAppAuth,
    moduleEnabled,
    exceptionsEnabled,
    viewExceptions,
    exceptions.list
  );

  app.get(
    `${TREASURY_EXCEPTIONS_PATH}/:id`,
    requireAppAuth,
    moduleEnabled,
    exceptionsEnabled,
    viewExceptions,
    exceptions.getById
  );

  app.post(
    `${TREASURY_EXCEPTIONS_PATH}/:id/acknowledge`,
    requireAppAuth,
    moduleEnabled,
    exceptionsEnabled,
    manageExceptions,
    exceptions.acknowledge
  );

  app.post(
    `${TREASURY_EXCEPTIONS_PATH}/:id/assign`,
    requireAppAuth,
    moduleEnabled,
    exceptionsEnabled,
    manageExceptions,
    exceptions.assign
  );

  app.post(
    `${TREASURY_EXCEPTIONS_PATH}/:id/due-at`,
    requireAppAuth,
    moduleEnabled,
    exceptionsEnabled,
    manageExceptions,
    exceptions.setDueAt
  );

  app.post(
    `${TREASURY_EXCEPTIONS_PATH}/:id/status`,
    requireAppAuth,
    moduleEnabled,
    exceptionsEnabled,
    manageExceptions,
    exceptions.setStatus
  );

  app.post(
    `${TREASURY_EXCEPTIONS_PATH}/:id/resolve`,
    requireAppAuth,
    moduleEnabled,
    exceptionsEnabled,
    manageExceptions,
    exceptions.resolve
  );

  app.post(
    `${TREASURY_EXCEPTIONS_PATH}/:id/ignore`,
    requireAppAuth,
    moduleEnabled,
    exceptionsEnabled,
    manageExceptions,
    exceptions.ignore
  );

  app.post(
    `${TREASURY_EXCEPTIONS_PATH}/:id/cancel`,
    requireAppAuth,
    moduleEnabled,
    exceptionsEnabled,
    manageExceptions,
    exceptions.cancel
  );

  app.get(
    TREASURY_RECEIVABLES_PATH,
    requireAppAuth,
    moduleEnabled,
    receivablesEnabled,
    viewReceivables,
    viewOfficialReceivables,
    receivables.listReceivables
  );

  app.get(
    `${TREASURY_RECEIVABLES_PATH}/:titleId`,
    requireAppAuth,
    moduleEnabled,
    receivablesEnabled,
    viewReceivables,
    viewOfficialReceivables,
    receivables.getReceivable
  );

  app.get(
    `${TREASURY_RECEIVABLES_PATH}/:titleId/customer-summary`,
    requireAppAuth,
    moduleEnabled,
    receivablesEnabled,
    viewReceivables,
    viewOfficialReceivables,
    receivables.getCustomerSummary
  );

  app.get(
    TREASURY_PAYABLES_PATH,
    requireAppAuth,
    moduleEnabled,
    payablesEnabled,
    viewPayables,
    viewOfficialPayables,
    payables.listPayables
  );

  app.get(
    `${TREASURY_PAYABLES_PATH}/:titleId`,
    requireAppAuth,
    moduleEnabled,
    payablesEnabled,
    viewPayables,
    viewOfficialPayables,
    payables.getPayable
  );

  app.post(
    `${TREASURY_PAYABLES_PATH}/:titleId/program-payment`,
    requireAppAuth,
    moduleEnabled,
    payablesProgrammingEnabled,
    programPayables,
    viewOfficialPayables,
    payableProgramming.programPayment
  );

  app.put(
    `${TREASURY_PAYABLES_PATH}/:titleId/program-payment`,
    requireAppAuth,
    moduleEnabled,
    payablesProgrammingEnabled,
    programPayables,
    viewOfficialPayables,
    payableProgramming.updateProgramPayment
  );

  app.post(
    `${TREASURY_PAYABLES_PATH}/:titleId/program-payment/cancel`,
    requireAppAuth,
    moduleEnabled,
    payablesProgrammingEnabled,
    programPayables,
    viewOfficialPayables,
    payableProgramming.cancelProgramPayment
  );

  app.post(
    `${TREASURY_PAYABLES_PATH}/:titleId/hold`,
    requireAppAuth,
    moduleEnabled,
    payablesProgrammingEnabled,
    programPayables,
    viewOfficialPayables,
    payableProgramming.holdPayable
  );

  app.post(
    `${TREASURY_PAYABLES_PATH}/:titleId/release-hold`,
    requireAppAuth,
    moduleEnabled,
    payablesProgrammingEnabled,
    programPayables,
    viewOfficialPayables,
    payableProgramming.releaseHoldPayable
  );

  app.put(
    `${TREASURY_RECEIVABLES_PATH}/:titleId/expectation`,
    requireAppAuth,
    moduleEnabled,
    receivablesEnabled,
    manageReceivables,
    viewOfficialReceivables,
    receivables.putExpectation
  );

  app.get(
    `${TREASURY_RECEIVABLES_PATH}/:titleId/promises`,
    requireAppAuth,
    moduleEnabled,
    promisesEnabled,
    viewReceivables,
    viewOfficialReceivables,
    promises.listByReceivable
  );

  app.post(
    `${TREASURY_RECEIVABLES_PATH}/:titleId/promises`,
    requireAppAuth,
    moduleEnabled,
    promisesEnabled,
    promiseReceivables,
    viewOfficialReceivables,
    promises.createForReceivable
  );

  app.post(
    `${TREASURY_PROMISES_PATH}/:promiseId/cancel`,
    requireAppAuth,
    moduleEnabled,
    promisesEnabled,
    promiseReceivables,
    promises.cancel
  );

  app.post(
    `${TREASURY_PROMISES_PATH}/:promiseId/mark-fulfilled`,
    requireAppAuth,
    moduleEnabled,
    promisesEnabled,
    promiseReceivables,
    promises.markFulfilled
  );

  app.get(
    `${TREASURY_RECEIVABLES_PATH}/:titleId/collection-actions`,
    requireAppAuth,
    moduleEnabled,
    receivablesEnabled,
    viewReceivables,
    viewOfficialReceivables,
    collectionActions.listByReceivable
  );

  app.post(
    `${TREASURY_RECEIVABLES_PATH}/:titleId/collection-actions`,
    requireAppAuth,
    moduleEnabled,
    receivablesEnabled,
    collectReceivables,
    viewOfficialReceivables,
    collectionActions.createForReceivable
  );

  app.post(
    `${TREASURY_COLLECTION_ACTIONS_PATH}/:actionId/cancel`,
    requireAppAuth,
    moduleEnabled,
    receivablesEnabled,
    collectReceivables,
    collectionActions.cancel
  );

  app.get(
    `${TREASURY_RECEIVABLES_PATH}/:titleId/disputes`,
    requireAppAuth,
    moduleEnabled,
    receivablesEnabled,
    viewReceivables,
    viewOfficialReceivables,
    disputes.listByReceivable
  );

  app.post(
    `${TREASURY_RECEIVABLES_PATH}/:titleId/disputes`,
    requireAppAuth,
    moduleEnabled,
    receivablesEnabled,
    manageReceivables,
    viewOfficialReceivables,
    disputes.createForReceivable
  );

  app.patch(
    `${TREASURY_DISPUTES_PATH}/:disputeId`,
    requireAppAuth,
    moduleEnabled,
    receivablesEnabled,
    manageReceivables,
    disputes.updateStatus
  );
}
