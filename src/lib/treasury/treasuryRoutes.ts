/**
 * Router principal da Central de Tesouraria.
 * Auth + flag + requireResource; handlers em controllers.
 */

import type express from "express";
import type { RequestHandler } from "express";
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
import { createTreasuryProjectionControllers } from "./controllers/treasuryProjectionController.js";
import { createTreasuryTransferControllers } from "./controllers/treasuryTransferController.js";
import { createTreasuryExceptionControllers } from "./controllers/treasuryExceptionController.js";
import { createTreasuryAlertSettingsControllers } from "./controllers/treasuryAlertSettingsController.js";
import {
  TREASURY_ACCOUNTS_PATH,
  TREASURY_AGENDA_PATH,
  TREASURY_ALERT_SETTINGS_PATH,
  TREASURY_AVAILABILITY_PATH,
  TREASURY_COLLECTION_ACTIONS_PATH,
  TREASURY_DASHBOARD_PATH,
  TREASURY_DISPUTES_PATH,
  TREASURY_EXCEPTIONS_PATH,
  TREASURY_PAYABLES_PATH,
  TREASURY_PROJECTIONS_PATH,
  TREASURY_PROMISES_PATH,
  TREASURY_RECEIVABLES_PATH,
  TREASURY_TRANSFERS_PATH,
} from "./contracts/treasuryContracts.js";
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
  const projections = createTreasuryProjectionControllers({ getCurrentAppUser });
  const transfers = createTreasuryTransferControllers({ getCurrentAppUser });
  const exceptions = createTreasuryExceptionControllers({ getCurrentAppUser });
  const alertSettings = createTreasuryAlertSettingsControllers({
    getCurrentAppUser,
  });

  const viewDashboard = requireResource(
    TREASURY_RESOURCE_KEYS.dashboard,
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

  app.get(
    TREASURY_AVAILABILITY_PATH,
    requireAppAuth,
    moduleEnabled,
    requireResource(TREASURY_RESOURCE_KEY, TREASURY_ACTIONS.view),
    treasuryAvailabilityHandler
  );

  app.get(
    TREASURY_DASHBOARD_PATH,
    requireAppAuth,
    moduleEnabled,
    viewDashboard,
    dashboard.getDashboard
  );

  app.get(
    TREASURY_ALERT_SETTINGS_PATH,
    requireAppAuth,
    moduleEnabled,
    viewDashboard,
    alertSettings.get
  );

  app.put(
    TREASURY_ALERT_SETTINGS_PATH,
    requireAppAuth,
    moduleEnabled,
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
    TREASURY_ACCOUNTS_PATH,
    requireAppAuth,
    moduleEnabled,
    viewAccounts,
    accounts.listAccounts
  );

  app.get(
    `${TREASURY_ACCOUNTS_PATH}/:id/balances/latest`,
    requireAppAuth,
    moduleEnabled,
    viewAccounts,
    balances.getLatestBalance
  );

  app.get(
    `${TREASURY_ACCOUNTS_PATH}/:id/balances`,
    requireAppAuth,
    moduleEnabled,
    viewAccounts,
    balances.listBalances
  );

  app.post(
    `${TREASURY_ACCOUNTS_PATH}/:id/balance-snapshots`,
    requireAppAuth,
    moduleEnabled,
    manageBalances,
    balances.createBalanceSnapshot
  );

  app.get(
    `${TREASURY_ACCOUNTS_PATH}/:id`,
    requireAppAuth,
    moduleEnabled,
    viewAccounts,
    accounts.getAccount
  );

  app.post(
    TREASURY_ACCOUNTS_PATH,
    requireAppAuth,
    moduleEnabled,
    manageAccounts,
    accounts.createAccount
  );

  app.patch(
    `${TREASURY_ACCOUNTS_PATH}/:id`,
    requireAppAuth,
    moduleEnabled,
    manageAccounts,
    accounts.updateAccount
  );

  app.post(
    `${TREASURY_ACCOUNTS_PATH}/:id/deactivate`,
    requireAppAuth,
    moduleEnabled,
    manageAccounts,
    accounts.deactivateAccount
  );

  app.post(
    `${TREASURY_ACCOUNTS_PATH}/:id/reactivate`,
    requireAppAuth,
    moduleEnabled,
    manageAccounts,
    accounts.reactivateAccount
  );

  app.get(
    `${TREASURY_ACCOUNTS_PATH}/:id/access`,
    requireAppAuth,
    moduleEnabled,
    manageAccounts,
    accounts.listAccountAccess
  );

  app.put(
    `${TREASURY_ACCOUNTS_PATH}/:id/access`,
    requireAppAuth,
    moduleEnabled,
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
    viewReceivables,
    viewOfficialReceivables,
    receivables.listReceivables
  );

  app.get(
    `${TREASURY_RECEIVABLES_PATH}/:titleId`,
    requireAppAuth,
    moduleEnabled,
    viewReceivables,
    viewOfficialReceivables,
    receivables.getReceivable
  );

  app.get(
    `${TREASURY_RECEIVABLES_PATH}/:titleId/customer-summary`,
    requireAppAuth,
    moduleEnabled,
    viewReceivables,
    viewOfficialReceivables,
    receivables.getCustomerSummary
  );

  app.get(
    TREASURY_PAYABLES_PATH,
    requireAppAuth,
    moduleEnabled,
    viewPayables,
    viewOfficialPayables,
    payables.listPayables
  );

  app.get(
    `${TREASURY_PAYABLES_PATH}/:titleId`,
    requireAppAuth,
    moduleEnabled,
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
    manageReceivables,
    viewOfficialReceivables,
    receivables.putExpectation
  );

  app.get(
    `${TREASURY_RECEIVABLES_PATH}/:titleId/promises`,
    requireAppAuth,
    moduleEnabled,
    viewReceivables,
    viewOfficialReceivables,
    promises.listByReceivable
  );

  app.post(
    `${TREASURY_RECEIVABLES_PATH}/:titleId/promises`,
    requireAppAuth,
    moduleEnabled,
    promiseReceivables,
    viewOfficialReceivables,
    promises.createForReceivable
  );

  app.post(
    `${TREASURY_PROMISES_PATH}/:promiseId/cancel`,
    requireAppAuth,
    moduleEnabled,
    promiseReceivables,
    promises.cancel
  );

  app.post(
    `${TREASURY_PROMISES_PATH}/:promiseId/mark-fulfilled`,
    requireAppAuth,
    moduleEnabled,
    promiseReceivables,
    promises.markFulfilled
  );

  app.get(
    `${TREASURY_RECEIVABLES_PATH}/:titleId/collection-actions`,
    requireAppAuth,
    moduleEnabled,
    viewReceivables,
    viewOfficialReceivables,
    collectionActions.listByReceivable
  );

  app.post(
    `${TREASURY_RECEIVABLES_PATH}/:titleId/collection-actions`,
    requireAppAuth,
    moduleEnabled,
    collectReceivables,
    viewOfficialReceivables,
    collectionActions.createForReceivable
  );

  app.post(
    `${TREASURY_COLLECTION_ACTIONS_PATH}/:actionId/cancel`,
    requireAppAuth,
    moduleEnabled,
    collectReceivables,
    collectionActions.cancel
  );

  app.get(
    `${TREASURY_RECEIVABLES_PATH}/:titleId/disputes`,
    requireAppAuth,
    moduleEnabled,
    viewReceivables,
    viewOfficialReceivables,
    disputes.listByReceivable
  );

  app.post(
    `${TREASURY_RECEIVABLES_PATH}/:titleId/disputes`,
    requireAppAuth,
    moduleEnabled,
    manageReceivables,
    viewOfficialReceivables,
    disputes.createForReceivable
  );

  app.patch(
    `${TREASURY_DISPUTES_PATH}/:disputeId`,
    requireAppAuth,
    moduleEnabled,
    manageReceivables,
    disputes.updateStatus
  );
}
