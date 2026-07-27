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
import {
  TREASURY_ACCOUNTS_PATH,
  TREASURY_AVAILABILITY_PATH,
  TREASURY_RECEIVABLES_PATH,
} from "./contracts/treasuryContracts.js";
import {
  TREASURY_ACTIONS,
  TREASURY_RESOURCE_KEY,
  TREASURY_RESOURCE_KEYS,
} from "./treasuryAccess.js";
import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";
import { requireTreasuryModuleEnabled } from "./treasuryFeatureFlags.js";

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
  const viewOfficialReceivables = requireResource(
    FINANCE_MODULE_RESOURCE_KEYS.accountsReceivable,
    TREASURY_ACTIONS.view
  );
  const moduleEnabled = requireTreasuryModuleEnabled();

  app.get(
    TREASURY_AVAILABILITY_PATH,
    requireAppAuth,
    moduleEnabled,
    requireResource(TREASURY_RESOURCE_KEY, TREASURY_ACTIONS.view),
    treasuryAvailabilityHandler
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
}
