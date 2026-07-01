import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";
import {
  Prisma,
  AppUserRole,
  type ItemType,
  type MaintenanceCategory,
  type MaintenancePriority,
  type MaintenanceStatus,
} from "@prisma/client";
import { prisma } from "./src/lib/prisma.js";
import { createProductCostAnalysisEngine, type AnalysisCache } from "./src/lib/productCostAnalysisEngine.server.js";
import { civilDateToLocalDate } from "./src/lib/financeCivilDate.js";
import {
  generateProductionCostTableDraftFromProducts,
  getProductionCostTableVersionById,
  listProductionCostTableVersions,
  publishProductionCostVersionFromDraft,
} from "./src/lib/productionCostPublication.server.js";
import { getEffectiveProductProductionCost } from "./src/lib/productionCostTables.server.js";
import {
  formatEffectiveProductionCostSummary,
  PRODUCTION_COST_TABLE_VIEW_PERMISSIONS,
} from "./src/lib/productionCostTablesUi.js";
import { resolveServerAppBuildInfo } from "./src/lib/appVersion.js";
import multer from "multer";
import { ServerImporter } from "./src/lib/importer/serverImporter.js";
import { MaterialImportConfig } from "./src/lib/importer/MaterialConfig.js";
import { EngineeringImportConfigs } from "./src/lib/importer/ProductConfig.js";
import { CustomerImportConfig } from "./src/lib/importer/CustomerConfig.js";
import crypto from "crypto";
import { buildReportsDataPayload } from "./src/lib/reportsDataService.js";
import {
  buildPortfolioAbcFromSalesOrders,
  normalizeCustomerDocument,
  salesOrderHasInvoicing,
  salesOrderMatchesCustomer,
} from "./src/lib/customerCommercialSalesOrderView.js";
import { loadOfficialPortfolioAbcRevenueRows } from "./src/lib/officialSalesOrderPortfolioLoaders.server.js";
import { MATERIAL_DEMAND_VIEW_PERMISSIONS } from "./src/lib/commercialMaterialDemandPermissions.js";
import { buildCrmCommercialIntelligenceResponse } from "./src/lib/crmCommercialIntelligence.js";
import { buildCrmManagementDashboardResponse } from "./src/lib/crmManagementDashboardService.js";
import {
  buildCrmSellerDashboardResponse,
  SellerDashboardBadRequest,
} from "./src/lib/crmSellerDashboardService.js";
import {
  isCustomerInCrmCommercialScope,
  requireCrmCommercialDataScope,
  resolveCrmCommercialAccessScope,
} from "./src/lib/crmCommercialAccessScope.js";
import { buildCrmSellerCustomerPortfolioWhere, salesOrderMatchesCrmSellerScope } from "./src/lib/crmCustomerSellerScope.js";
import {
  fetchCrmCustomersList,
  parseCrmCustomerListFilter,
  parseCrmCustomerListSellerQuery,
} from "./src/lib/crmCustomersList.js";
import { registerCrmCustomerCommercialOwnerRoutes } from "./src/lib/crmCustomerCommercialOwnerRoutes.js";
import { buildCrmDashboardBasicResponse } from "./src/lib/crmDashboardBasicService.js";
import {
  applyCommercialActivityProposalToCreate,
  applyCommercialActivityProposalToUpdate,
  applyCommercialActivitySalesOrderToCreate,
  applyCommercialActivitySalesOrderToUpdate,
  COMMERCIAL_ACTIVITY_API_INCLUDE,
  mapCommercialActivityForApi,
  parseOptionalUuidField,
  resolveCommercialActivityProposalLink,
  resolveCommercialActivitySalesOrderLink,
} from "./src/lib/commercialActivityApi.js";
import {
  buildCostAnalysisExplainability,
  buildPricingSnapshotExplainability,
} from "./src/lib/calculationExplainability.js";
import {
  aggregateParentDecomposition,
  scaleChildContribution,
  type ChildScaledContribution,
  type ChildUnitAnalysis,
} from "./src/lib/costRollup.js";
import {
  buildExcludedBomLineRecord,
  type ExcludedBomLineRecord,
} from "./src/lib/costAnalysisPartial.js";
import {
  addDirectMaterialRow,
  cloneExplosionMap,
  finalizeRowsForOpenBook,
  mergeExplosionMaps,
  naturePercentages,
  sumExplosionTotalCost,
  type ExplosionRowCore,
} from "./src/lib/openBookMaterialExplosion.js";
import { normalizeMaterialUnitKey } from "./src/lib/materialDemandUnits.js";
import {
  buildMaterialDemandSalesOrderWhere,
  createMaterialDemandCoverage,
  materialDemandAggregationPeriodKey,
  materialDemandPeriodLabel,
  parseMaterialDemandFilters,
  recordMaterialDemandSkip,
  type MaterialDemandFilters,
  type MaterialDemandMode,
} from "./src/lib/materialDemandFilters.js";
import { getCachedMaterialDemandDataset } from "./src/lib/materialDemandDatasetCache.js";
import {
  buildCustomerSearchWhereEnhanced,
  normalizeCustomerSearchQuery,
  parseCustomerSearchLimit,
  rankCustomerSearchResults,
  serializeCustomerSearchItem,
} from "./src/lib/customerSearch.js";
import {
  aggregateMaterialUsageContributions,
  buildMaterialUsagePlannedRealizedSummary,
  createMaterialUsagePlannedRealizedDataQuality,
  extractProcessedNfeSummaries,
  orderHasProcessedInvoicing,
  PLANNED_REALIZED_MISSING_BOM_WARNING,
  PLANNED_REALIZED_MISSING_COST_WARNING,
  PLANNED_REALIZED_PARTIAL_INVOICE_FALLBACK_WARNING,
  resolveRealizedOrderItemQuantity,
  salesOrderMatchesInvoicingScope,
  type MaterialUsageContribution,
} from "./src/lib/materialDemandPlannedRealized.js";
import { buildMaterialUsageAuditPayload } from "./src/lib/materialDemandPlannedRealizedAudit.js";
import {
  buildMaterialDemandIntelligenceFilters,
  buildSalesOrderRawMaterialIntelligencePayload,
  mapPrismaSalesOrderToIntelligenceSource,
} from "./src/lib/salesOrderRawMaterialIntelligenceService.js";
import type { ProductBomExplosionRow } from "./src/lib/salesOrderRawMaterialIntelligenceTypes.js";
import { registerFleetRoutes } from "./src/lib/fleetRoutes.js";
import {
  registerFleetPublicReservationRoutes,
  registerFleetPublicReservationShortLinkMiddleware,
} from "./src/lib/fleetPublicReservationRoutes.js";
import { registerFleetPublicVehicleChecklistRoutes } from "./src/lib/fleetPublicVehicleChecklistRoutes.js";
import { registerAccessProfilesRoutes } from "./src/lib/accessProfilesRoutes.js";
import {
  AccessProfileError,
  applyAccessProfileToUserFields,
  resolveAccessProfileForUser,
} from "./src/lib/accessProfilesService.js";
import { registerExecutiveDashboardRoutes } from "./src/lib/executiveDashboardRoutes.js";
import { registerNomusAccountsReceivableRoutes } from "./src/lib/nomusAccountsReceivableRoutes.js";
import { registerNomusAccountsPayableRoutes } from "./src/lib/nomusAccountsPayableRoutes.js";
import {
  registerFinanceArDueRadarRoutes,
  registerFinanceApDueRadarRoutes,
} from "./src/lib/financeDueRadarRoutes.js";
import { registerFinanceAccountsReceivableRoutes } from "./src/lib/financeAccountsReceivableRoutes.js";
import { registerFinanceAccountsPayableRoutes } from "./src/lib/financeAccountsPayableRoutes.js";
import { registerFinanceSuppliersRoutes } from "./src/lib/financeSuppliersRoutes.js";
import { registerFinanceCostCentersRoutes } from "./src/lib/financeCostCentersRoutes.js";
import { registerFinanceCostCenterReclassificationRoutes } from "./src/lib/financeCostCenterReclassificationRoutes.js";
import { registerFinanceCostCenterDetailRoutes } from "./src/lib/financeCostCenterDetailRoutes.js";
import { registerFinanceSupplierCostCenterRulesRoutes } from "./src/lib/financeSupplierCostCenterRulesRoutes.js";
import { registerFinanceClassificationRulesRoutes } from "./src/lib/financeCostCenterClassificationRulesRoutes.js";
import { registerFinanceAccountsPayableCostCenterAllocationRoutes } from "./src/lib/financeAccountsPayableCostCenterAllocationRoutes.js";
import { registerFinanceUnclassifiedImportRoutes } from "./src/lib/financeUnclassifiedImportRoutes.js";
import { registerFinanceBillingRoutes } from "./src/lib/financeBillingRoutes.js";
import { registerFinanceSalesOrdersRoutes } from "./src/lib/financeSalesOrdersRoutes.js";
import { registerFinanceCashFlowRoutes } from "./src/lib/financeCashFlowRoutes.js";
import { registerFinanceExecutiveReportRoutes } from "./src/lib/financeExecutiveReportRoutes.js";
import { registerSettingsGlobalsRoutes } from "./src/lib/settingsGlobalsRoutes.js";
import { registerSettingsSalesMarginNomusRoutes } from "./src/lib/settingsSalesMarginNomusRoutes.js";
import { registerSettingsNomusSyncRoutes } from "./src/lib/settingsNomusSyncRoutes.js";
import { registerSalesProductRankingRoutes } from "./src/lib/salesProductRankingRoutes.js";
import { registerCustomerIntelligenceRoutes } from "./src/lib/customerIntelligenceRoutes.js";
import { registerSalesOrderIntelligenceRoutes } from "./src/lib/salesOrderIntelligenceRoutes.js";
import { registerSalesOrderMarginIndicatorsRoutes } from "./src/lib/salesOrderMarginIndicatorsRoutes.js";
import { registerSalesOrderResultRoutes } from "./src/lib/salesOrderResultRoutes.js";
import { registerSalesOrderInternalMarginExportRoutes } from "./src/lib/salesOrderInternalMarginExportRoutes.js";
import {
  attachMarginToSalesOrderDetail,
  attachMarginsToSalesOrders,
  SALES_ORDER_LIST_MARGIN_PRISMA_SELECT,
} from "./src/lib/salesOrderMarginService.server.js";
import { registerOfficialServerResolvers } from "./src/lib/registerServerResolvers.js";
import {
  buildSalesOrderListWhere,
} from "./src/lib/salesOrdersListSummary.js";
import {
  buildOfficialSalesOrderListPayload,
  mapPrismaOrderToSalesOrderRulesInput,
  resolveOfficialScopedOrderMetrics,
  SALES_ORDER_RULES_PRISMA_SELECT,
} from "./src/lib/salesOrderRulesAdapter.js";
import { loadOfficialCommercial360MarginBundle, buildOfficialSalesOrderListMarginSummary } from "./src/lib/salesMarginRulesAdapter.js";
import { loadSalesOrderLinkedNfeContextMap } from "./src/lib/salesOrderLinkedNfe.js";
import {
  parseSalesOrderMonthParam,
  parseSalesOrderYearParam,
} from "./src/lib/salesOrderPeriodFilter.js";
import { registerProjectsRoutes } from "./src/lib/projectsRoutes.js";
import { registerInventoryRoutes } from "./src/lib/inventoryRoutes.js";
import {
  getNomusDailySyncStatus,
  NomusDailySyncConflictError,
  startNomusDailySyncApply,
} from "./src/lib/nomusDailySyncRunner.js";
import {
  getNomusAccountsReceivableSyncStatus,
  NomusAccountsReceivableSyncConflictError,
  startNomusAccountsReceivableSyncApply,
} from "./src/lib/nomusAccountsReceivableSyncRunner.js";
import {
  getNomusAccountsPayableSyncStatus,
  NomusAccountsPayableSyncConflictError,
  startNomusAccountsPayableSyncApply,
} from "./src/lib/nomusAccountsPayableSyncRunner.js";
import {
  getNomusNfesSyncStatus,
  NomusNfesSyncConflictError,
  startNomusNfesSyncApply,
} from "./src/lib/nomusNfesSyncRunner.js";
import { resolveProductBomUsage, type BomUsageSearchKind } from "./src/lib/productBomUsage.js";
import { simulateScenarioFromBreakdown } from "./src/lib/simulationFormula.js";
import { buildPricingUnitCalculationBreakdown } from "./src/lib/pricingUnitCalculationBreakdown.js";
import {
  buildCloneDraftData,
  buildSnapshotSaveData,
} from "./src/lib/newProductSimulationSnapshot.js";
import { buildCustomerIndicatorsPayload, normalizeBrazilUf } from "./src/lib/customerIndicators.js";
import {
  buildCustomerListResponse,
  buildCustomerSearchWhere,
  customerListMeta,
  parseCustomerListQuery,
  shouldUseCustomerPagination,
} from "./src/lib/customerListQuery.js";
import {
  ALL_PERMISSION_KEYS,
  APP_SESSION_COOKIE_NAME,
  APP_SESSION_TTL_MS,
  PERMISSION_CATALOG,
  createOpaqueSessionToken,
  filterKnownPermissions,
  hasPermission,
  hashPassword,
  hashSessionToken,
  isValidEmail,
  normalizeEmail,
  toAppAuthContext,
  toSafeAppUser,
  validatePasswordMin,
  verifyPassword,
  type AppAuthContext,
} from "./src/lib/appAuth.js";
import { resolveCookieSecure } from "./src/lib/appSessionCookie.js";
import {
  createAuthGuards,
  resolveSellerDashboardScope,
  sendAuthForbidden,
} from "./src/lib/appAuthMiddleware.js";
import { fetchAdminSellerOptionsFromDb } from "./src/lib/adminSellerOptions.js";
import { enrichAppAuthSellerCommercialLink } from "./src/lib/crmSellerIdentityConsolidation.js";
import { buildBomComparisonForProductId } from "./src/lib/nomusBomComparisonLoad.js";
import {
  buildNomusBomBatchReport,
  buildNomusBomClassificationReport,
  clampBatchLimit,
} from "./src/lib/nomusBomBatchReport.js";
import type { NomusBomActionClass } from "./src/lib/nomusBomClassification.js";
import { buildNomusBomApplyPlansReport } from "./src/lib/nomusBomApplyPlanLoad.js";
import { listNomusParentCodeOptions } from "./src/lib/nomusParentCodeOptions.js";
import {
  createOptionalPricingGroup,
  deactivateOptionalPricingGroup,
  getOptionalPricingSelectionDetail,
  listProductsWithOptionalNomusItems,
  setOptionalPricingSelection,
  updateOptionalPricingGroup,
  type PricingOptionalStatus,
} from "./src/lib/nomusOptionalPricingSelection.js";
import { buildEffectivePricingBomForParentCode } from "./src/lib/nomusEffectivePricingBom.js";
import {
  buildNomusEffectiveBomCostImpact,
  type CurrentCostSnapshot,
} from "./src/lib/nomusEffectiveBomCostImpact.js";
import { buildCurrentCostSnapshotFromAnalysis } from "./src/lib/productCostSnapshot.js";
import {
  extractOfficialProductFinalUnitCost,
  OFFICIAL_PRODUCT_FINAL_COST_SOURCE,
  resolveOfficialProductFinalCostFromAnalysis,
  isOfficialProductFinalCostFailure,
} from "./src/lib/productOfficialFinalCost.js";
import {
  clearReviewDecision,
  listReviewDecisionsForParentCode,
  saveReviewDecision,
} from "./src/lib/nomusBomReviewDecision.js";
import {
  applyEffectiveBomToProductBom,
  buildControlledApplyPreview,
} from "./src/lib/nomusBomControlledApply.js";
import {
  buildNomusProductImportSimulationPreview,
  executeNomusProductImportSimulation,
} from "./src/lib/nomusProductImportSimulation.js";
import {
  applyNomusEngineeringSync,
  buildNomusEngineeringReconciliationPlan,
  listEngineeringChangeLog,
} from "./src/lib/nomusEngineeringReconciliation.js";
import { buildNomusEngineeringOperationsCockpit } from "./src/lib/nomusEngineeringOperationsCockpit.js";
import { registerNomusAutoApplyBomDashboardRoutes } from "./src/lib/nomusAutoApplyBomDashboardRoutes.js";
import {
  applyNomusBomBatchFromDashboard,
  applyNomusBomFromDashboard,
  previewNomusBomApplyReadiness,
} from "./src/lib/nomusBomAutoApplyBatch.js";
import { buildNomusEngineeringEqualizationActionPlan } from "./src/lib/nomusEngineeringEqualizationActionPlan.js";
import {
  applyNomusMasterDataImport,
  buildNomusMasterDataImportDiagnostic,
  buildNomusMasterDataImportPreview,
} from "./src/lib/nomusMasterDataImport.js";
import {
  applyAmbiguityBatch,
  buildAmbiguityBatchPreview,
  AMBIGUITY_BATCH_CONFIRMATION_TEXT,
} from "./src/lib/nomusRegistryAmbiguityBatch.js";
import { MASTER_DATA_CONFIRMATION_TEXT } from "./src/lib/nomusMasterDataImportTypes.js";
import {
  applyNomusMasterDataEqualize,
  buildNomusMasterDataEqualizePreview,
} from "./src/lib/nomusMasterDataEqualize.js";
import { EQUALIZE_CONFIRMATION_TEXT } from "./src/lib/nomusMasterDataEqualizeTypes.js";
import { loadProductChangeHistory } from "./src/lib/productChangeHistory.js";
import {
  buildReclassificationImpactForMaterial,
  buildReclassificationImpactForProduct,
  executeItemReclassification,
} from "./src/lib/itemReclassificationServer.js";
import type { ItemReclassificationKind } from "./src/lib/itemReclassificationTypes.js";
import type { NomusBomReviewDecisionType } from "@prisma/client";
import type { NomusOptionalPricingSelectionMode } from "@prisma/client";

const upload = multer({ storage: multer.memoryStorage() });
const importCache = new Map<string, any>();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BOOTSTRAP_ADMIN_COOKIE_NAME = "induscost_bootstrap_admin";
const BOOTSTRAP_ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 8;

type BootstrapAdminConfig = {
  enabled: boolean;
  username: string;
  password: string;
  sessionSecret: string;
};

type BootstrapAdminSessionPayload = {
  username: string;
  exp: number;
  nonce: string;
};

type NomusSyncMode = "apply" | "dry";
type NomusSyncKind = "runner" | "sync";
type NomusSyncTarget =
  | "customers"
  | "products"
  | "bom-components"
  | "proposals"
  | "sales-orders"
  | "accounts-receivable"
  | "accounts-payable"
  | "nfes";
type NomusSyncStatus = "SUCCESS" | "FAILED" | "SKIPPED" | "UNKNOWN";

const NOMUS_SYNC_TARGETS: readonly NomusSyncTarget[] = [
  "customers",
  "products",
  "bom-components",
  "proposals",
  "sales-orders",
  "accounts-receivable",
  "accounts-payable",
  "nfes",
];
const NOMUS_HEALTH_STALE_MS: Record<NomusSyncTarget, number> = {
  "sales-orders": 2 * 60 * 60 * 1000,
  "accounts-receivable": 2 * 60 * 60 * 1000,
  "accounts-payable": 2 * 60 * 60 * 1000,
  nfes: 2 * 60 * 60 * 1000,
  customers: 26 * 60 * 60 * 1000,
  products: 26 * 60 * 60 * 1000,
  "bom-components": 30 * 60 * 60 * 1000,
  proposals: 26 * 60 * 60 * 1000,
};
const NOMUS_PRODUCT_EXPECTED_BLOCK_KEYS = new Set([
  "RAW_MATERIAL_NOT_PRODUCT",
  "MRO_OR_FIXED_ASSET_NOT_PRODUCT",
  "PACKAGING_NOT_PRODUCT",
  "SERVICE_ITEM",
  "MISSING_DESCRIPTIVE_NAME",
]);

type NomusSyncLogSummary = {
  fileName: string;
  kind: NomusSyncKind;
  target: NomusSyncTarget;
  mode: NomusSyncMode;
  status: NomusSyncStatus;
  success: boolean | null;
  exitCode: number | null;
  /** ISO: preferência para ordenação (IntegrationRun.createdAt quando houver merge). */
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  sizeBytes: number;
  modifiedAt: string;
  command: string | null;
  metrics: {
    eligibleCount: number | null;
    blockedCount: number | null;
    created: number | null;
    updated: number | null;
    itemsCreated: number | null;
    pageRead: number | null;
    ordersRead: number | null;
    startPage: number | null;
    maxPages: number | null;
    lastPage: number | null;
  };
  blockedReasons: Record<string, number>;
};

function parseBooleanEnv(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function getBootstrapAdminConfig(): BootstrapAdminConfig {
  return {
    enabled: parseBooleanEnv(process.env.BOOTSTRAP_ADMIN_ENABLED),
    username: String(process.env.BOOTSTRAP_ADMIN_USERNAME ?? ""),
    password: String(process.env.BOOTSTRAP_ADMIN_PASSWORD ?? ""),
    sessionSecret: String(process.env.BOOTSTRAP_ADMIN_SESSION_SECRET ?? ""),
  };
}

function isBootstrapAdminConfigReady(config: BootstrapAdminConfig): boolean {
  return config.username.length > 0 && config.password.length > 0 && config.sessionSecret.length > 0;
}

function safeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function parseCookiesFromHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, cookiePart) => {
      const eqIdx = cookiePart.indexOf("=");
      if (eqIdx <= 0) return acc;
      const key = cookiePart.slice(0, eqIdx).trim();
      const value = cookiePart.slice(eqIdx + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function signBootstrapSession(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function encodeBootstrapSessionToken(payload: BootstrapAdminSessionPayload, secret: string): string {
  const payloadJson = JSON.stringify(payload);
  const encodedPayload = Buffer.from(payloadJson, "utf8").toString("base64url");
  const signature = signBootstrapSession(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function decodeBootstrapSessionToken(
  token: string,
  secret: string
): BootstrapAdminSessionPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;
  const expectedSignature = signBootstrapSession(encodedPayload, secret);
  if (!safeEqualString(signature, expectedSignature)) return null;
  try {
    const payloadRaw = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const parsed = JSON.parse(payloadRaw) as Partial<BootstrapAdminSessionPayload>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.username !== "string" || typeof parsed.exp !== "number" || typeof parsed.nonce !== "string") {
      return null;
    }
    if (!Number.isFinite(parsed.exp) || parsed.exp <= Date.now()) return null;
    return {
      username: parsed.username,
      exp: parsed.exp,
      nonce: parsed.nonce,
    };
  } catch {
    return null;
  }
}

function parseNomusSyncFileName(fileName: string): { kind: NomusSyncKind; mode: NomusSyncMode; target: NomusSyncTarget } | null {
  const arMatch = /^runner-accounts-receivable_(apply|dry)_.+\.log$/i.exec(fileName);
  if (arMatch) {
    return {
      kind: "runner",
      target: "accounts-receivable",
      mode: arMatch[1].toLowerCase() as NomusSyncMode,
    };
  }
  const apMatch = /^runner-accounts-payable_(apply|dry)_.+\.log$/i.exec(fileName);
  if (apMatch) {
    return {
      kind: "runner",
      target: "accounts-payable",
      mode: apMatch[1].toLowerCase() as NomusSyncMode,
    };
  }
  const nfeMatch = /^runner-nfes_(apply|dry)_.+\.log$/i.exec(fileName);
  if (nfeMatch) {
    return {
      kind: "runner",
      target: "nfes",
      mode: nfeMatch[1].toLowerCase() as NomusSyncMode,
    };
  }
  const m =
    /^(runner-)?(customers|products|bom-components|proposals|sales-orders)_(apply|dry)_.+\.log$/i.exec(
      fileName
    );
  if (!m) return null;
  const target = m[2].toLowerCase() as NomusSyncTarget;
  if (!NOMUS_SYNC_TARGETS.includes(target)) return null;
  return {
    kind: m[1] ? "runner" : "sync",
    target,
    mode: m[3].toLowerCase() as NomusSyncMode,
  };
}

function parseIsoDateOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const dt = new Date(value.trim());
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function safeNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractFirstJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = raw.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          return safeObject(parsed);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function sanitizeLogContent(content: string): string {
  const masks: Array<[RegExp, string]> = [
    [/(authorization\s*[:=]\s*)([^\s]+)/gi, "$1***"],
    [/(token\s*[:=]\s*)([^\s]+)/gi, "$1***"],
    [/(password\s*[:=]\s*)([^\s]+)/gi, "$1***"],
    [/(nomus_auth_header_value\s*[:=]\s*)([^\s]+)/gi, "$1***"],
    [/(\b(?:Bearer|Basic)\s+)([A-Za-z0-9\-._~+/]+=*)/gi, "$1***"],
  ];
  return masks.reduce((acc, [re, replacement]) => acc.replace(re, replacement), content);
}

async function startServer() {
  const {
    initAnalysisCache,
    getProductCostAnalysis,
    isCostAnalysisFailure,
    describeCostAnalysisFailure,
  } = createProductCostAnalysisEngine(prisma);

  async function loadCurrentCostSnapshotForProductId(
    productId: string
  ): Promise<CurrentCostSnapshot | null> {
    const cache = await initAnalysisCache();
    const analysis = await getProductCostAnalysis(productId, cache, true);
    return buildCurrentCostSnapshotFromAnalysis(analysis);
  }

  async function resolveCurrentCostSnapshotForNomus(
    productId: string,
    _sku: string
  ): Promise<CurrentCostSnapshot | null> {
    return loadCurrentCostSnapshotForProductId(productId);
  }

  const app = express();
  const port = process.env.PORT || 3000;
  const host = process.env.HOST || "0.0.0.0";
  const bootstrapAdminConfig = getBootstrapAdminConfig();
  const isBootstrapReady = isBootstrapAdminConfigReady(bootstrapAdminConfig);

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Respostas de API nunca podem ser cacheadas pelo navegador. Sem isso, um
  // /api/auth/me autenticado pode ficar em cache e mostrar usuário logado
  // enquanto as demais chamadas protegidas retornam 401 (estado híbrido).
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");
    next();
  });

  if (bootstrapAdminConfig.enabled && !isBootstrapReady) {
    console.warn(
      "[bootstrap-admin] habilitado, porém incompleto. Defina BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_PASSWORD e BOOTSTRAP_ADMIN_SESSION_SECRET."
    );
  }

  function readBootstrapSession(req: express.Request): BootstrapAdminSessionPayload | null {
    if (!bootstrapAdminConfig.enabled || !isBootstrapReady) return null;
    const cookies = parseCookiesFromHeader(req.headers.cookie);
    const token = cookies[BOOTSTRAP_ADMIN_COOKIE_NAME];
    if (!token) return null;
    return decodeBootstrapSessionToken(token, bootstrapAdminConfig.sessionSecret);
  }

  function setBootstrapSessionCookie(res: express.Response, username: string): BootstrapAdminSessionPayload {
    const payload: BootstrapAdminSessionPayload = {
      username,
      exp: Date.now() + BOOTSTRAP_ADMIN_SESSION_TTL_MS,
      nonce: crypto.randomBytes(16).toString("hex"),
    };
    const token = encodeBootstrapSessionToken(payload, bootstrapAdminConfig.sessionSecret);
    res.cookie(BOOTSTRAP_ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecureFor(res),
      maxAge: BOOTSTRAP_ADMIN_SESSION_TTL_MS,
      path: "/",
    });
    return payload;
  }

  function clearBootstrapSessionCookie(res: express.Response): void {
    res.clearCookie(BOOTSTRAP_ADMIN_COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecureFor(res),
      path: "/",
    });
  }

  const requireBootstrapAdmin: express.RequestHandler = (req, res, next) => {
    if (!bootstrapAdminConfig.enabled) return next();
    if (!isBootstrapReady) {
      return res.status(503).json({
        error: "BOOTSTRAP_ADMIN_MISCONFIGURED",
        message: "Acesso administrativo temporário habilitado, mas sem configuração completa de ambiente.",
      });
    }
    const session = readBootstrapSession(req);
    if (!session || !safeEqualString(session.username, bootstrapAdminConfig.username)) {
      return res.status(401).json({
        error: "BOOTSTRAP_ADMIN_REQUIRED",
        message: "Acesso administrativo temporário necessário para esta operação.",
      });
    }
    return next();
  };

  const nomusSyncLogDir = path.resolve(process.env.NOMUS_SYNC_LOG_DIR || "/tmp/induscost-nomus-sync");
  const nomusLogDetailMaxBytes = 200 * 1024;

  async function listNomusSyncLogEntries(): Promise<Array<{ fileName: string; absolutePath: string; sizeBytes: number; modifiedAt: string }>> {
    try {
      const dirEntries = await fs.readdir(nomusSyncLogDir, { withFileTypes: true });
      const rows = await Promise.all(
        dirEntries
          .filter((entry) => entry.isFile())
          .map(async (entry) => {
            const fileName = entry.name;
            const parsed = parseNomusSyncFileName(fileName);
            if (!parsed) return null;
            const absolutePath = path.join(nomusSyncLogDir, fileName);
            const stats = await fs.stat(absolutePath);
            return {
              fileName,
              absolutePath,
              sizeBytes: stats.size,
              modifiedAt: stats.mtime.toISOString(),
            };
          })
      );
      return rows.filter((x): x is { fileName: string; absolutePath: string; sizeBytes: number; modifiedAt: string } => Boolean(x));
    } catch {
      return [];
    }
  }

  function buildNomusSummary(
    fileMeta: { fileName: string; sizeBytes: number; modifiedAt: string },
    content: string
  ): NomusSyncLogSummary | null {
    const parsedFile = parseNomusSyncFileName(fileMeta.fileName);
    if (!parsedFile) return null;

    const isRunnerFinanceLog =
      parsedFile.target === "accounts-receivable" || parsedFile.target === "accounts-payable";
    const commandMatch = content.match(/^\s*COMMAND\s*:\s*(.+)$/m);
    const startedMatch = content.match(
      isRunnerFinanceLog ? /^\s*STARTED_AT=(.+)$/m : /^\s*STARTED_AT\s*:\s*(.+)$/m
    );
    const finishedMatch = content.match(
      isRunnerFinanceLog ? /^\s*FINISHED_AT=(.+)$/m : /^\s*FINISHED_AT\s*:\s*(.+)$/m
    );
    const exitCodeMatch = content.match(
      isRunnerFinanceLog ? /^\s*EXIT_CODE=(-?\d+)/m : /^\s*EXIT_CODE\s*:\s*(-?\d+)/m
    );
    const pageReadMatch = content.match(/página\s+(\d+)\s+lida\s+com\s+(\d+)\s+pedidos/i);
    const blockLimitMatch = content.match(/limite\s+de\s+bloco\s+atingido:\s*startPage=(\d+),\s*maxPages=(\d+),\s*lastPage=(\d+)/i);

    const startedAt = parseIsoDateOrNull(startedMatch?.[1] ?? null);
    const finishedAt = parseIsoDateOrNull(finishedMatch?.[1] ?? null);
    const durationMs =
      startedAt && finishedAt
        ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
        : null;
    const exitCode = exitCodeMatch ? Number(exitCodeMatch[1]) : null;
    const jsonObj = extractFirstJsonObject(content);
    const analysisObj = safeObject(jsonObj?.analysis) ?? {};
    const appliedObj = safeObject(jsonObj?.applied) ?? {};
    const summaryObj = safeObject(jsonObj?.summary) ?? {};
    const rootBlockedReasons = safeObject(jsonObj?.blockedReasons);
    const analysisBlockedReasons = safeObject(analysisObj.blockedReasons);
    const blockedReasonsRaw = analysisBlockedReasons ?? rootBlockedReasons ?? {};
    const blockedReasons = Object.entries(blockedReasonsRaw).reduce<Record<string, number>>((acc, [key, value]) => {
      const n = safeNumber(value);
      if (n !== null) acc[key] = n;
      return acc;
    }, {});

    const successFromJson = typeof jsonObj?.success === "boolean" ? jsonObj.success : null;
    const statusFromJson = typeof jsonObj?.status === "string" ? jsonObj.status.toUpperCase() : null;
    const isSkipped =
      content.toLowerCase().includes("dry-run sem apply") ||
      statusFromJson === "SKIPPED" ||
      /SKIPPED:\s*outra execução/i.test(content);
    const status: NomusSyncStatus =
      isSkipped
        ? "SKIPPED"
        : successFromJson === true || exitCode === 0
        ? "SUCCESS"
        : successFromJson === false || (exitCode !== null && exitCode !== 0)
        ? "FAILED"
        : "UNKNOWN";

    return {
      fileName: fileMeta.fileName,
      kind: parsedFile.kind,
      target: parsedFile.target,
      mode: parsedFile.mode,
      status,
      success: status === "SUCCESS" ? true : status === "FAILED" ? false : null,
      exitCode,
      createdAt: null,
      startedAt,
      finishedAt,
      durationMs,
      sizeBytes: fileMeta.sizeBytes,
      modifiedAt: fileMeta.modifiedAt,
      command: commandMatch?.[1]?.trim() || null,
      metrics: {
        eligibleCount: safeNumber(
          isRunnerFinanceLog
            ? summaryObj.mapped
            : analysisObj.eligibleCount ?? jsonObj?.eligibleCount
        ),
        blockedCount: safeNumber(analysisObj.blockedCount ?? jsonObj?.blockedCount),
        created: safeNumber(
          isRunnerFinanceLog ? appliedObj.created ?? summaryObj.created : appliedObj.created
        ),
        updated: safeNumber(
          isRunnerFinanceLog ? appliedObj.updated ?? summaryObj.updated : appliedObj.updated
        ),
        itemsCreated: safeNumber(appliedObj.itemsCreated),
        pageRead: pageReadMatch
          ? Number(pageReadMatch[1])
          : safeNumber(isRunnerFinanceLog ? summaryObj.pagesRead : null),
        ordersRead: pageReadMatch
          ? Number(pageReadMatch[2])
          : safeNumber(isRunnerFinanceLog ? summaryObj.recordsRead : null),
        startPage: blockLimitMatch ? Number(blockLimitMatch[1]) : safeNumber(jsonObj?.startPage),
        maxPages: blockLimitMatch ? Number(blockLimitMatch[2]) : safeNumber(jsonObj?.maxPages),
        lastPage: blockLimitMatch ? Number(blockLimitMatch[3]) : safeNumber(jsonObj?.lastPage),
      },
      blockedReasons,
    };
  }

  type NomusIntegrationRunPick = {
    createdAt: Date;
    target: string;
    mode: string;
    kind: string | null;
    status: string;
    success: boolean | null;
    exitCode: number | null;
    command: string | null;
    errorMessage: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    durationMs: number | null;
    logFile: string | null;
    runnerLogFile: string | null;
    pageRead: number | null;
    ordersRead: number | null;
    startPage: number | null;
    maxPages: number | null;
    lastPage: number | null;
    eligibleCount: number | null;
    blockedCount: number | null;
    createdCount: number | null;
    updatedCount: number | null;
    itemsCreated: number | null;
    blockedReasons: unknown;
  };

  function mapIntegrationRunStatusToNomusSync(run: {
    status: string;
    success: boolean | null;
    exitCode: number | null;
  }): NomusSyncStatus {
    const raw = String(run.status ?? "").trim().toUpperCase();
    if (raw === "SUCCESS" || raw === "FAILED" || raw === "SKIPPED") return raw;
    if (run.success === true && (run.exitCode === null || run.exitCode === 0)) return "SUCCESS";
    if (run.success === false) return "FAILED";
    if (run.exitCode !== null && run.exitCode !== 0) return "FAILED";
    if (run.success === true) return "SUCCESS";
    return "UNKNOWN";
  }

  function blockedReasonsFromIntegrationJson(value: unknown): Record<string, number> {
    const obj = safeObject(value);
    if (!obj) return {};
    return Object.entries(obj).reduce<Record<string, number>>((acc, [key, val]) => {
      const n = safeNumber(val);
      if (n !== null) acc[key] = n;
      return acc;
    }, {});
  }

  function mergeNomusSummaryWithIntegrationRun(
    summary: NomusSyncLogSummary,
    run: NomusIntegrationRunPick | undefined
  ): NomusSyncLogSummary {
    if (!run) return summary;
    const dbStatus = mapIntegrationRunStatusToNomusSync(run);
    const dbBlocked = blockedReasonsFromIntegrationJson(run.blockedReasons);
    const mergedBlocked =
      Object.keys(dbBlocked).length > 0 ? { ...summary.blockedReasons, ...dbBlocked } : summary.blockedReasons;
    const runKind = run.kind === "runner" || run.kind === "sync" ? run.kind : summary.kind;
    const runMode = run.mode === "apply" || run.mode === "dry" ? run.mode : summary.mode;
    const runTarget = NOMUS_SYNC_TARGETS.includes(run.target as NomusSyncTarget)
      ? (run.target as NomusSyncTarget)
      : summary.target;

    return {
      ...summary,
      kind: runKind,
      mode: runMode,
      target: runTarget,
      status: dbStatus,
      createdAt: run.createdAt ? run.createdAt.toISOString() : summary.createdAt,
      success:
        run.success !== null && run.success !== undefined
          ? run.success
          : dbStatus === "SUCCESS"
            ? true
            : dbStatus === "FAILED"
              ? false
              : summary.success,
      exitCode: run.exitCode !== null && run.exitCode !== undefined ? run.exitCode : summary.exitCode,
      startedAt: run.startedAt ? run.startedAt.toISOString() : summary.startedAt,
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : summary.finishedAt,
      durationMs: run.durationMs !== null && run.durationMs !== undefined ? run.durationMs : summary.durationMs,
      command: run.command ?? summary.command,
      metrics: {
        eligibleCount: run.eligibleCount ?? summary.metrics.eligibleCount,
        blockedCount: run.blockedCount ?? summary.metrics.blockedCount,
        created: run.createdCount ?? summary.metrics.created,
        updated: run.updatedCount ?? summary.metrics.updated,
        itemsCreated: run.itemsCreated ?? summary.metrics.itemsCreated,
        pageRead: run.pageRead ?? summary.metrics.pageRead,
        ordersRead: run.ordersRead ?? summary.metrics.ordersRead,
        startPage: run.startPage ?? summary.metrics.startPage,
        maxPages: run.maxPages ?? summary.metrics.maxPages,
        lastPage: run.lastPage ?? summary.metrics.lastPage,
      },
      blockedReasons: mergedBlocked,
    };
  }

  async function loadNomusIntegrationRunByBasename(): Promise<Map<string, NomusIntegrationRunPick>> {
    const runs = await prisma.integrationRun.findMany({
      where: {
        sourceSystem: "NOMUS",
        OR: [{ logFile: { not: null } }, { runnerLogFile: { not: null } }],
      },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      take: 3000,
      select: {
        createdAt: true,
        target: true,
        mode: true,
        kind: true,
        status: true,
        success: true,
        exitCode: true,
        command: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        logFile: true,
        runnerLogFile: true,
        pageRead: true,
        ordersRead: true,
        startPage: true,
        maxPages: true,
        lastPage: true,
        eligibleCount: true,
        blockedCount: true,
        createdCount: true,
        updatedCount: true,
        itemsCreated: true,
        blockedReasons: true,
      },
    });
    const map = new Map<string, NomusIntegrationRunPick>();
    const upsert = (basename: string, row: NomusIntegrationRunPick) => {
      if (!basename) return;
      const prev = map.get(basename);
      if (!prev) {
        map.set(basename, row);
        return;
      }
      const prevT = prev.finishedAt?.getTime() ?? 0;
      const nextT = row.finishedAt?.getTime() ?? 0;
      if (nextT > prevT) {
        map.set(basename, row);
        return;
      }
      if (nextT < prevT) return;
      if (row.createdAt.getTime() >= prev.createdAt.getTime()) map.set(basename, row);
    };
    for (const row of runs) {
      if (row.logFile) upsert(path.basename(row.logFile), row);
      if (row.runnerLogFile) upsert(path.basename(row.runnerLogFile), row);
    }
    return map;
  }

  async function findNomusIntegrationRunForLog(
    fileName: string,
    absolutePath: string
  ): Promise<NomusIntegrationRunPick | null> {
    const row = await prisma.integrationRun.findFirst({
      where: {
        sourceSystem: "NOMUS",
        OR: [
          { logFile: absolutePath },
          { runnerLogFile: absolutePath },
          { logFile: { endsWith: `/${fileName}` } },
          { runnerLogFile: { endsWith: `/${fileName}` } },
          { logFile: fileName },
          { runnerLogFile: fileName },
        ],
      },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      select: {
        createdAt: true,
        target: true,
        mode: true,
        kind: true,
        status: true,
        success: true,
        exitCode: true,
        command: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        logFile: true,
        runnerLogFile: true,
        pageRead: true,
        ordersRead: true,
        startPage: true,
        maxPages: true,
        lastPage: true,
        eligibleCount: true,
        blockedCount: true,
        createdCount: true,
        updatedCount: true,
        itemsCreated: true,
        blockedReasons: true,
      },
    });
    return row;
  }

  type NomusIntegrationHealthState = "OK" | "FAILED" | "STALE" | "WARNING" | "NO_DATA";

  function nomusRunReferenceMs(row: NomusIntegrationRunPick): number {
    return (row.finishedAt ?? row.startedAt ?? row.createdAt).getTime();
  }

  function nomusRunExplicitlyFailed(row: NomusIntegrationRunPick): boolean {
    const st = mapIntegrationRunStatusToNomusSync(row);
    if (st === "FAILED") return true;
    if (row.success === false) return true;
    if (row.exitCode !== null && row.exitCode !== undefined && row.exitCode !== 0) return true;
    return false;
  }

  function nomusRunSucceededApply(row: NomusIntegrationRunPick): boolean {
    const st = mapIntegrationRunStatusToNomusSync(row);
    return st === "SUCCESS" && row.success !== false && (row.exitCode === null || row.exitCode === 0);
  }

  function nomusProductBlocksOnlyExpected(blockedReasons: unknown): boolean {
    const o = safeObject(blockedReasons);
    if (!o || Object.keys(o).length === 0) return true;
    return Object.keys(o).every((k) => NOMUS_PRODUCT_EXPECTED_BLOCK_KEYS.has(k));
  }

  function computeNomusTargetHealth(
    target: NomusSyncTarget,
    row: NomusIntegrationRunPick | null
  ): { health: NomusIntegrationHealthState; message: string; warning: string | null } {
    if (!row) {
      return {
        health: "NO_DATA",
        message: "Ainda não existe execução apply registrada para este destino.",
        warning: null,
      };
    }
    if (nomusRunExplicitlyFailed(row)) {
      return {
        health: "FAILED",
        message: row.errorMessage?.trim() || "Última execução apply falhou.",
        warning: null,
      };
    }
    const st = mapIntegrationRunStatusToNomusSync(row);
    if (st === "SKIPPED") {
      return {
        health: "WARNING",
        message: "Última execução apply foi ignorada (SKIPPED).",
        warning: null,
      };
    }
    const ageMs = Date.now() - nomusRunReferenceMs(row);
    if (nomusRunSucceededApply(row) && ageMs > NOMUS_HEALTH_STALE_MS[target]) {
      return {
        health: "STALE",
        message:
          target === "sales-orders"
            ? "Última conclusão com sucesso há mais de 2 horas (prazo esperado para pedidos)."
            : target === "accounts-receivable"
              ? "Última conclusão com sucesso há mais de 2 horas (prazo esperado para contas a receber)."
              : target === "accounts-payable"
                ? "Última conclusão com sucesso há mais de 2 horas (prazo esperado para contas a pagar)."
                : "Última conclusão com sucesso há mais de 24 horas (prazo esperado).",
        warning: null,
      };
    }
    const blocked = row.blockedCount ?? 0;
    if (nomusRunSucceededApply(row) && blocked > 0) {
      if (target === "products" && nomusProductBlocksOnlyExpected(row.blockedReasons)) {
        return {
          health: "OK",
          message: "Última execução apply finalizou com sucesso.",
          warning:
            "Há bloqueios catalogados — muitos são esperados em produtos (ex.: matéria-prima sem cadastro de produto). Consulte o último log para detalhes.",
        };
      }
      return {
        health: "WARNING",
        message: "Execução concluída com sucesso, porém existem registros bloqueados.",
        warning: null,
      };
    }
    if (nomusRunSucceededApply(row)) {
      return { health: "OK", message: "Última execução apply finalizou com sucesso.", warning: null };
    }
    return {
      health: "WARNING",
      message: "Última execução apply terminou com status a revisar.",
      warning: null,
    };
  }

  function serializeNomusHealthLastRun(row: NomusIntegrationRunPick) {
    return {
      mode: row.mode,
      kind: row.kind,
      status: mapIntegrationRunStatusToNomusSync(row),
      success: row.success,
      exitCode: row.exitCode,
      ordersRead: row.ordersRead,
      eligibleCount: row.eligibleCount,
      blockedCount: row.blockedCount,
      createdCount: row.createdCount,
      updatedCount: row.updatedCount,
      itemsCreated: row.itemsCreated,
      errorMessage: row.errorMessage,
      logFile: row.logFile,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
      durationMs: row.durationMs,
    };
  }

  async function buildNomusIntegrationHealthPayload(): Promise<{
    targets: Array<{
      target: NomusSyncTarget;
      label: string;
      lastRun: ReturnType<typeof serializeNomusHealthLastRun> | null;
      health: NomusIntegrationHealthState;
      message: string;
      warning: string | null;
    }>;
  }> {
    const labels: Record<NomusSyncTarget, string> = {
      customers: "Clientes",
      products: "Produtos",
      "bom-components": "Componentes da BOM",
      proposals: "Propostas",
      "sales-orders": "Pedidos de venda",
      "accounts-receivable": "Contas a receber",
      "accounts-payable": "Contas a pagar",
      nfes: "NF-e / Faturamento",
    };
    const select = {
      createdAt: true,
      target: true,
      mode: true,
      kind: true,
      status: true,
      success: true,
      exitCode: true,
      command: true,
      errorMessage: true,
      startedAt: true,
      finishedAt: true,
      durationMs: true,
      logFile: true,
      runnerLogFile: true,
      pageRead: true,
      ordersRead: true,
      startPage: true,
      maxPages: true,
      lastPage: true,
      eligibleCount: true,
      blockedCount: true,
      createdCount: true,
      updatedCount: true,
      itemsCreated: true,
      blockedReasons: true,
    } as const;

    const targets: Array<{
      target: NomusSyncTarget;
      label: string;
      lastRun: ReturnType<typeof serializeNomusHealthLastRun> | null;
      health: NomusIntegrationHealthState;
      message: string;
      warning: string | null;
    }> = [];

    for (const target of NOMUS_SYNC_TARGETS) {
      const row = await prisma.integrationRun.findFirst({
        where: { sourceSystem: "NOMUS", target, mode: "apply" },
        orderBy: { createdAt: "desc" },
        select,
      });
      const typed = row as NomusIntegrationRunPick | null;
      const { health, message, warning } = computeNomusTargetHealth(target, typed);
      targets.push({
        target,
        label: labels[target],
        lastRun: typed ? serializeNomusHealthLastRun(typed) : null,
        health,
        message,
        warning,
      });
    }

    return { targets };
  }

  const MAX_NOMUS_LOG_FILES_SCAN = 500;

  async function readNomusSyncLogSafe(fileNameRaw: string): Promise<{
    fileName: string;
    absolutePath: string;
    sizeBytes: number;
    modifiedAt: string;
    content: string;
  } | null> {
    const fileName = path.basename(String(fileNameRaw || "").trim());
    if (!fileName || fileName !== fileNameRaw) return null;
    if (!parseNomusSyncFileName(fileName)) return null;
    const absolutePath = path.resolve(nomusSyncLogDir, fileName);
    if (!absolutePath.startsWith(nomusSyncLogDir + path.sep) && absolutePath !== path.join(nomusSyncLogDir, fileName)) {
      return null;
    }
    try {
      const stats = await fs.stat(absolutePath);
      const fullContent = await fs.readFile(absolutePath, "utf8");
      const limitedContent =
        fullContent.length > nomusLogDetailMaxBytes
          ? fullContent.slice(-nomusLogDetailMaxBytes)
          : fullContent;
      return {
        fileName,
        absolutePath,
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        content: sanitizeLogContent(limitedContent),
      };
    } catch {
      return null;
    }
  }

  const requireBootstrapForGlobalParamMutation: express.RequestHandler = async (req, res, next) => {
    const method = req.method.toUpperCase();
    if (method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE") return next();

    const bodyCategory =
      typeof req.body?.category === "string" ? req.body.category.trim().toUpperCase() : "";
    if (bodyCategory === "GLOBAL_PARAM") {
      return requireBootstrapAdmin(req, res, next);
    }

    const targetId = typeof req.params?.id === "string" ? req.params.id : "";
    if (!targetId) return next();

    try {
      const current = await prisma.indirectCost.findUnique({
        where: { id: targetId },
        select: { category: true },
      });
      if (current?.category === "GLOBAL_PARAM") {
        return requireBootstrapAdmin(req, res, next);
      }
      return next();
    } catch (error) {
      console.error("Error validating GLOBAL_PARAM mutation guard:", error);
      return res.status(500).json({ error: "Erro ao validar proteção administrativa." });
    }
  };

  // --- API: Test ---
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/app-version", (_req, res) => {
    res.json(resolveServerAppBuildInfo());
  });

  app.get("/api/bootstrap-admin/status", (req, res) => {
    const session = readBootstrapSession(req);
    res.json({
      enabled: bootstrapAdminConfig.enabled,
      authenticated: Boolean(session),
      mode: "bootstrap-env",
      misconfigured: bootstrapAdminConfig.enabled && !isBootstrapReady,
      username: session?.username ?? null,
      expiresAt: session ? new Date(session.exp).toISOString() : null,
    });
  });

  app.post("/api/bootstrap-admin/login", (req, res) => {
    if (!bootstrapAdminConfig.enabled) {
      return res.status(400).json({
        error: "BOOTSTRAP_ADMIN_DISABLED",
        message: "Acesso administrativo temporário está desabilitado neste ambiente.",
      });
    }
    if (!isBootstrapReady) {
      return res.status(503).json({
        error: "BOOTSTRAP_ADMIN_MISCONFIGURED",
        message:
          "Acesso administrativo temporário habilitado, mas sem configuração completa de ambiente.",
      });
    }

    const username = typeof req.body?.username === "string" ? req.body.username : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    const isValidUsername = safeEqualString(username, bootstrapAdminConfig.username);
    const isValidPassword = safeEqualString(password, bootstrapAdminConfig.password);

    if (!isValidUsername || !isValidPassword) {
      return res.status(401).json({
        error: "INVALID_CREDENTIALS",
        message: "Credenciais administrativas inválidas.",
      });
    }

    const session = setBootstrapSessionCookie(res, bootstrapAdminConfig.username);
    return res.json({
      success: true,
      mode: "bootstrap-env",
      expiresAt: new Date(session.exp).toISOString(),
    });
  });

  app.post("/api/bootstrap-admin/logout", (_req, res) => {
    clearBootstrapSessionCookie(res);
    res.json({ success: true });
  });

  // --- API: App auth & RBAC (Fase 1K-B) ---
  const APP_USER_ROLE_VALUES = Object.values(AppUserRole);

  function parseAppUserRole(raw: unknown): AppUserRole | null {
    if (typeof raw !== "string") return null;
    const normalized = raw.trim().toUpperCase();
    return APP_USER_ROLE_VALUES.includes(normalized as AppUserRole)
      ? (normalized as AppUserRole)
      : null;
  }

  async function readAppSession(req: express.Request): Promise<AppAuthContext | null> {
    const cookies = parseCookiesFromHeader(req.headers.cookie);
    const token = cookies[APP_SESSION_COOKIE_NAME];
    if (!token) return null;
    const tokenHash = hashSessionToken(token);
    const now = new Date();
    const session = await prisma.appSession.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: { user: true },
    });
    if (!session?.user?.isActive) return null;
    const auth = toAppAuthContext(session.user, session.id);
    return enrichAppAuthSellerCommercialLink(auth);
  }

  function cookieSecureFor(res: express.Response): boolean {
    return resolveCookieSecure({
      forcedSecure: process.env.APP_COOKIE_SECURE,
      requestSecure: res.req?.secure,
      forwardedProto: res.req?.headers["x-forwarded-proto"],
    });
  }

  function setAppSessionCookie(res: express.Response, token: string): void {
    res.cookie(APP_SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecureFor(res),
      maxAge: APP_SESSION_TTL_MS,
      path: "/",
    });
  }

  function clearAppSessionCookie(res: express.Response): void {
    res.clearCookie(APP_SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecureFor(res),
      path: "/",
    });
  }

  async function revokeAppSessionById(sessionId: string): Promise<void> {
    await prisma.appSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async function revokeAllUserSessions(userId: string): Promise<void> {
    await prisma.appSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  const {
    requireAppAuth,
    requirePermission,
    requireAnyPermission,
    getCurrentAppUser,
  } = createAuthGuards(readAppSession);

  /** Bootstrap admin OU permissões de app (settings / RBAC). */
  function requireBootstrapOrAnyPermission(permissions: string[]): express.RequestHandler {
    return async (req, res, next) => {
      if (bootstrapAdminConfig.enabled && isBootstrapReady) {
        const bootstrap = readBootstrapSession(req);
        if (bootstrap && safeEqualString(bootstrap.username, bootstrapAdminConfig.username)) {
          return next();
        }
      }
      return requireAnyPermission(permissions)(req, res, next);
    };
  }

  const requireUserAdminOrBootstrap: express.RequestHandler = async (req, res, next) => {
    if (bootstrapAdminConfig.enabled && isBootstrapReady) {
      const bootstrap = readBootstrapSession(req);
      if (bootstrap && safeEqualString(bootstrap.username, bootstrapAdminConfig.username)) {
        return next();
      }
    }
    const auth = await readAppSession(req);
    if (!auth) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Autenticação necessária.",
      });
    }
    if (!hasPermission(auth, "users.manage")) {
      return sendAuthForbidden(res, ["users.manage"]);
    }
    req.appAuth = auth;
    return next();
  };

  app.post("/api/auth/login", async (req, res) => {
    try {
      const emailRaw = typeof req.body?.email === "string" ? req.body.email : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const email = normalizeEmail(emailRaw);
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: "INVALID_EMAIL", message: "E-mail inválido." });
      }
      if (!password) {
        return res.status(400).json({ error: "INVALID_PASSWORD", message: "Informe a senha." });
      }

      const user = await prisma.appUser.findUnique({ where: { email } });
      if (!user || !user.isActive) {
        return res.status(401).json({
          error: "INVALID_CREDENTIALS",
          message: "E-mail ou senha inválidos.",
        });
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({
          error: "INVALID_CREDENTIALS",
          message: "E-mail ou senha inválidos.",
        });
      }

      const token = createOpaqueSessionToken();
      const tokenHash = hashSessionToken(token);
      const expiresAt = new Date(Date.now() + APP_SESSION_TTL_MS);

      await prisma.$transaction([
        prisma.appSession.create({
          data: { userId: user.id, tokenHash, expiresAt },
        }),
        prisma.appUser.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        }),
      ]);

      const refreshed = await prisma.appUser.findUniqueOrThrow({
        where: { id: user.id },
        include: { accessProfile: { select: { name: true } } },
      });
      setAppSessionCookie(res, token);
      return res.json({
        user: toSafeAppUser(refreshed, {
          accessProfileName: refreshed.accessProfile?.name ?? null,
        }),
      });
    } catch (error) {
      console.error("POST /api/auth/login", error);
      return res.status(500).json({ error: "Erro ao autenticar usuário." });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const auth = await readAppSession(req);
      if (auth) {
        await revokeAppSessionById(auth.sessionId);
      }
      clearAppSessionCookie(res);
      return res.json({ success: true });
    } catch (error) {
      console.error("POST /api/auth/logout", error);
      clearAppSessionCookie(res);
      return res.json({ success: true });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const auth = await readAppSession(req);
      if (!auth) {
        return res.json({ authenticated: false, user: null });
      }
      const user = await prisma.appUser.findUnique({
        where: { id: auth.id },
        include: { accessProfile: { select: { name: true } } },
      });
      if (!user || !user.isActive) {
        clearAppSessionCookie(res);
        return res.json({ authenticated: false, user: null });
      }
      return res.json({
        authenticated: true,
        user: toSafeAppUser(user, { accessProfileName: user.accessProfile?.name ?? null }),
      });
    } catch (error) {
      console.error("GET /api/auth/me", error);
      return res.status(500).json({ error: "Erro ao consultar sessão." });
    }
  });

  app.get("/api/admin/permissions/catalog", requireUserAdminOrBootstrap, (_req, res) => {
    res.json({ permissions: PERMISSION_CATALOG });
  });

  app.get("/api/admin/seller-options", requireUserAdminOrBootstrap, async (_req, res) => {
    try {
      const sellers = await fetchAdminSellerOptionsFromDb();
      return res.json({ sellers });
    } catch (error) {
      console.error("GET /api/admin/seller-options", error);
      return res.status(500).json({ error: "Erro ao listar vendedores comerciais." });
    }
  });

  app.get("/api/admin/users", requireUserAdminOrBootstrap, async (_req, res) => {
    try {
      const users = await prisma.appUser.findMany({
        orderBy: [{ name: "asc" }, { email: "asc" }],
        include: { accessProfile: { select: { name: true } } },
      });
      return res.json({
        users: users.map((u) =>
          toSafeAppUser(u, { accessProfileName: u.accessProfile?.name ?? null })
        ),
      });
    } catch (error) {
      console.error("GET /api/admin/users", error);
      return res.status(500).json({ error: "Erro ao listar usuários." });
    }
  });

  app.post("/api/admin/users", requireUserAdminOrBootstrap, async (req, res) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const email = normalizeEmail(typeof req.body?.email === "string" ? req.body.email : "");
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      let role = parseAppUserRole(req.body?.role) ?? AppUserRole.VIEWER;
      let permissions = filterKnownPermissions(req.body?.permissions);
      const accessProfileId =
        req.body?.accessProfileId === null || req.body?.accessProfileId === undefined
          ? null
          : String(req.body.accessProfileId).trim() || null;
      const isActive = req.body?.isActive !== false;
      const externalSellerId =
        req.body?.externalSellerId === null || req.body?.externalSellerId === undefined
          ? null
          : Number.parseInt(String(req.body.externalSellerId), 10);
      const sellerResponsibleName =
        typeof req.body?.sellerResponsibleName === "string"
          ? req.body.sellerResponsibleName.trim() || null
          : null;

      if (!name) {
        return res.status(400).json({ error: "INVALID_NAME", message: "Informe o nome." });
      }
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: "INVALID_EMAIL", message: "E-mail inválido." });
      }
      const passwordError = validatePasswordMin(password);
      if (passwordError) {
        return res.status(400).json({ error: "INVALID_PASSWORD", message: passwordError });
      }
      if (
        externalSellerId !== null &&
        (!Number.isFinite(externalSellerId) || externalSellerId < 0)
      ) {
        return res.status(400).json({
          error: "INVALID_EXTERNAL_SELLER_ID",
          message: "externalSellerId inválido.",
        });
      }

      if (accessProfileId) {
        const profile = await resolveAccessProfileForUser(prisma, accessProfileId);
        const applied = applyAccessProfileToUserFields(profile);
        if (applied.role) role = applied.role;
        if (req.body?.permissions === undefined) permissions = applied.permissions;
      }

      const passwordHash = await hashPassword(password);
      const user = await prisma.appUser.create({
        data: {
          name,
          email,
          passwordHash,
          role,
          permissions,
          accessProfileId,
          isActive,
          externalSellerId: externalSellerId ?? null,
          sellerResponsibleName,
        },
        include: { accessProfile: { select: { name: true } } },
      });
      return res.status(201).json({
        user: toSafeAppUser(user, { accessProfileName: user.accessProfile?.name ?? null }),
      });
    } catch (error) {
      if (error instanceof AccessProfileError) {
        return res.status(409).json({ error: error.code, message: error.message });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return res.status(409).json({ error: "EMAIL_ALREADY_EXISTS", message: "E-mail já cadastrado." });
      }
      console.error("POST /api/admin/users", error);
      return res.status(500).json({ error: "Erro ao criar usuário." });
    }
  });

  app.patch("/api/admin/users/:id", requireUserAdminOrBootstrap, async (req, res) => {
    try {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        return res.status(400).json({ error: "INVALID_ID", message: "ID inválido." });
      }

      const existing = await prisma.appUser.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: "NOT_FOUND", message: "Usuário não encontrado." });
      }

      const data: Prisma.AppUserUpdateInput = {};

      if (typeof req.body?.name === "string") {
        const name = req.body.name.trim();
        if (!name) {
          return res.status(400).json({ error: "INVALID_NAME", message: "Nome inválido." });
        }
        data.name = name;
      }
      if (typeof req.body?.email === "string") {
        const email = normalizeEmail(req.body.email);
        if (!isValidEmail(email)) {
          return res.status(400).json({ error: "INVALID_EMAIL", message: "E-mail inválido." });
        }
        data.email = email;
      }
      if (req.body?.role !== undefined) {
        const role = parseAppUserRole(req.body.role);
        if (!role) {
          return res.status(400).json({ error: "INVALID_ROLE", message: "Perfil inválido." });
        }
        data.role = role;
      }
      if (req.body?.permissions !== undefined) {
        data.permissions = filterKnownPermissions(req.body.permissions);
      }
      if (req.body?.accessProfileId !== undefined) {
        if (req.body.accessProfileId === null) {
          data.accessProfile = { disconnect: true };
        } else {
          const profileId = String(req.body.accessProfileId).trim();
          if (!profileId) {
            return res.status(400).json({
              error: "INVALID_PROFILE",
              message: "Perfil de acesso inválido.",
            });
          }
          const profile = await resolveAccessProfileForUser(prisma, profileId);
          data.accessProfile = { connect: { id: profile.id } };
          const applied = applyAccessProfileToUserFields(profile);
          if (req.body?.role === undefined && applied.role) {
            data.role = applied.role;
          }
          if (req.body?.permissions === undefined) {
            data.permissions = applied.permissions;
          }
        }
      }
      if (req.body?.isActive !== undefined) {
        data.isActive = Boolean(req.body.isActive);
      }
      if (req.body?.externalSellerId !== undefined) {
        if (req.body.externalSellerId === null) {
          data.externalSellerId = null;
        } else {
          const externalSellerId = Number.parseInt(String(req.body.externalSellerId), 10);
          if (!Number.isFinite(externalSellerId) || externalSellerId < 0) {
            return res.status(400).json({
              error: "INVALID_EXTERNAL_SELLER_ID",
              message: "externalSellerId inválido.",
            });
          }
          data.externalSellerId = externalSellerId;
        }
      }
      if (req.body?.sellerResponsibleName !== undefined) {
        data.sellerResponsibleName =
          typeof req.body.sellerResponsibleName === "string"
            ? req.body.sellerResponsibleName.trim() || null
            : null;
      }

      if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: "NO_CHANGES", message: "Nenhum campo para atualizar." });
      }

      // Guardrails anti-auto-bloqueio e proteção do último SUPER_ADMIN.
      // Fase: INDUSCOST-ACCESS-PERMISSIONS-AUDIT-UX-A.
      const isEditingSelf = req.appAuth?.id === existing.id;

      if (isEditingSelf) {
        if (data.isActive === false) {
          return res.status(409).json({
            error: "CANNOT_DEACTIVATE_SELF",
            code: "CANNOT_DEACTIVATE_SELF",
            message:
              "Você não pode inativar seu próprio usuário. Peça a outro administrador para fazer isso.",
          });
        }
        if (
          typeof data.role === "string" &&
          existing.role === AppUserRole.SUPER_ADMIN &&
          data.role !== AppUserRole.SUPER_ADMIN
        ) {
          return res.status(409).json({
            error: "CANNOT_DEMOTE_SELF",
            code: "CANNOT_DEMOTE_SELF",
            message:
              "Você não pode rebaixar o próprio perfil de Super Administrador. Peça a outro administrador para fazer isso.",
          });
        }
        if (Array.isArray(data.permissions)) {
          const nextRole = (data.role as AppUserRole | undefined) ?? existing.role;
          const willKeepUsersManage =
            nextRole === AppUserRole.SUPER_ADMIN ||
            (data.permissions as string[]).includes("users.manage");
          const currentlyHasUsersManage =
            existing.role === AppUserRole.SUPER_ADMIN ||
            existing.permissions.includes("users.manage");
          if (currentlyHasUsersManage && !willKeepUsersManage) {
            return res.status(409).json({
              error: "CANNOT_REMOVE_OWN_USERS_MANAGE",
              code: "CANNOT_REMOVE_OWN_USERS_MANAGE",
              message:
                "Você não pode remover a própria permissão de administrar usuários. Peça a outro administrador para fazer isso.",
            });
          }
        }
      }

      // Proteção do último SUPER_ADMIN ativo: nunca permitir inativar/rebaixar
      // o único Super Administrador ativo do sistema, mesmo que outro admin
      // esteja realizando a operação.
      const willMakeInactive = data.isActive === false;
      const willChangeRole = typeof data.role === "string" && data.role !== existing.role;
      if (
        existing.role === AppUserRole.SUPER_ADMIN &&
        existing.isActive &&
        (willMakeInactive ||
          (willChangeRole && (data.role as AppUserRole) !== AppUserRole.SUPER_ADMIN))
      ) {
        const otherActiveSuperAdmins = await prisma.appUser.count({
          where: {
            role: AppUserRole.SUPER_ADMIN,
            isActive: true,
            id: { not: existing.id },
          },
        });
        if (otherActiveSuperAdmins === 0) {
          return res.status(409).json({
            error: "LAST_SUPER_ADMIN_PROTECTED",
            code: "LAST_SUPER_ADMIN_PROTECTED",
            message:
              "Este é o único Super Administrador ativo do sistema. Cadastre outro Super Administrador antes de inativá-lo ou rebaixá-lo.",
          });
        }
      }

      const user = await prisma.appUser.update({
        where: { id },
        data,
        include: { accessProfile: { select: { name: true } } },
      });
      return res.json({
        user: toSafeAppUser(user, { accessProfileName: user.accessProfile?.name ?? null }),
      });
    } catch (error) {
      if (error instanceof AccessProfileError) {
        return res.status(409).json({ error: error.code, message: error.message });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return res.status(409).json({ error: "EMAIL_ALREADY_EXISTS", message: "E-mail já cadastrado." });
      }
      console.error("PATCH /api/admin/users/:id", error);
      return res.status(500).json({ error: "Erro ao atualizar usuário." });
    }
  });

  app.post("/api/admin/users/:id/reset-password", requireUserAdminOrBootstrap, async (req, res) => {
    try {
      const id = String(req.params.id ?? "").trim();
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const passwordError = validatePasswordMin(password);
      if (passwordError) {
        return res.status(400).json({ error: "INVALID_PASSWORD", message: passwordError });
      }

      const existing = await prisma.appUser.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: "NOT_FOUND", message: "Usuário não encontrado." });
      }

      const passwordHash = await hashPassword(password);
      await prisma.$transaction([
        prisma.appUser.update({ where: { id }, data: { passwordHash } }),
        prisma.appSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);

      const user = await prisma.appUser.findUniqueOrThrow({ where: { id } });
      return res.json({ success: true, user: toSafeAppUser(user) });
    } catch (error) {
      console.error("POST /api/admin/users/:id/reset-password", error);
      return res.status(500).json({ error: "Erro ao redefinir senha." });
    }
  });

  app.post("/api/admin/users/bootstrap-super-admin", requireBootstrapAdmin, async (req, res) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const email = normalizeEmail(typeof req.body?.email === "string" ? req.body.email : "");
      const password = typeof req.body?.password === "string" ? req.body.password : "";

      if (!name) {
        return res.status(400).json({ error: "INVALID_NAME", message: "Informe o nome." });
      }
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: "INVALID_EMAIL", message: "E-mail inválido." });
      }
      const passwordError = validatePasswordMin(password);
      if (passwordError) {
        return res.status(400).json({ error: "INVALID_PASSWORD", message: passwordError });
      }

      const passwordHash = await hashPassword(password);
      const existing = await prisma.appUser.findUnique({ where: { email } });

      let user;
      let action: "created" | "updated";
      if (existing) {
        user = await prisma.appUser.update({
          where: { id: existing.id },
          data: {
            name,
            passwordHash,
            role: AppUserRole.SUPER_ADMIN,
            permissions: [...ALL_PERMISSION_KEYS],
            isActive: true,
          },
        });
        await revokeAllUserSessions(user.id);
        action = "updated";
      } else {
        user = await prisma.appUser.create({
          data: {
            name,
            email,
            passwordHash,
            role: AppUserRole.SUPER_ADMIN,
            permissions: [...ALL_PERMISSION_KEYS],
            isActive: true,
          },
        });
        action = "created";
      }

      return res.json({
        action,
        message:
          action === "created"
            ? "Super administrador criado com sucesso."
            : "Super administrador existente atualizado (senha e perfil).",
        user: toSafeAppUser(user),
      });
    } catch (error) {
      console.error("POST /api/admin/users/bootstrap-super-admin", error);
      return res.status(500).json({ error: "Erro ao criar super administrador." });
    }
  });

  registerAccessProfilesRoutes(app, {
    requireAppAuth,
    getCurrentAppUser,
  });

  // --- API: Test DB Connection ---
  app.get("/api/test-db", async (req, res) => {
    console.log("Testing database connection and schema...");
    try {
      const results = {
        machines: await prisma.machine.count(),
        roles: await prisma.role.count(),
        employees: await prisma.employee.count(),
        materials: await prisma.material.count(),
        products: await prisma.product.count(),
        indirectCosts: await prisma.indirectCost.count(),
        taxRules: await prisma.taxRule.count(),
        pricing: await prisma.productPricing.count(),
        simulations: await prisma.simulation.count(),
      };
      res.json({ status: "success", counts: results });
    } catch (error) {
      console.error("Database test failed:", error);
      res.status(500).json({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  });

  // --- API: Dashboard Gerencial ---
  app.get("/api/dashboard", requireAppAuth, requirePermission("dashboard.view"), async (req, res, next) => {
    console.log("Fetching dashboard data...");
    try {
      const [employees, machines, products, pricings, indirectCosts] = await Promise.all([
        prisma.employee.findMany({ 
          where: { status: "ACTIVE" },
          include: { EmployeePayrollComponent: { include: { PayrollComponent: true } } } 
        }),
        prisma.machine.findMany({ include: { MachineCostComponent: true } }),
        prisma.product.findMany({ where: { status: "ACTIVE" } }),
        prisma.productPricing.findMany({ include: { TaxRule: { include: { TaxComponent: true } } } }),
        prisma.indirectCost.findMany({ where: { status: "ACTIVE" } })
      ]);

      // 1. Custo por Colaborador
      const employeeCosts = await Promise.all(employees.map(async emp => {
        const role = await prisma.role.findUnique({ where: { id: emp.roleId } });
        const salary = Number(role?.baseSalary || 0);
        let load = 0;
        emp.EmployeePayrollComponent.forEach(rel => {
          const c = rel.PayrollComponent;
          load += c.calculationType === "PERCENTAGE" ? (salary * Number(c.value)) / 100 : Number(c.value);
        });
        return { id: emp.id, name: emp.name, totalCost: salary + load };
      }));
      const avgEmployeeCost = employeeCosts.length > 0 ? employeeCosts.reduce((acc, e) => acc + e.totalCost, 0) / employeeCosts.length : 0;

      // Verificação de Parâmetros Globais para Custo Máquina
      const energyCostParam = indirectCosts.find(c => c.category === "GLOBAL_PARAM" && c.description === "ENERGY_COST");
      const workingHoursParam = indirectCosts.find(c => c.category === "GLOBAL_PARAM" && c.description === "WORKING_HOURS");
      
      if (!energyCostParam || !workingHoursParam) {
        return res.status(400).json({ error: "CONFIG_MISSING", message: "Parâmetros globais de energia e/ou horas trabalhadas não configurados." });
      }

      const globalEnergyCost = Number(energyCostParam.monthlyValue);
      const globalWorkingHours = Number(workingHoursParam.monthlyValue);

      if (globalWorkingHours <= 0) {
        return res.status(400).json({ error: "CONFIG_MISSING", message: "Horas trabalhadas devem ser maiores que zero." });
      }

      const globalMachineHourCost = globalEnergyCost / globalWorkingHours;

      // 2. HM por Máquina
      const machineHM = machines.map(m => {
        return { id: m.id, code: m.code, hmCost: globalMachineHourCost };
      });

      // 3. Análise de Produtos (Top 5 e Bottom 5)
      const productAnalyses = await Promise.all(products.map(p => getProductCostAnalysis(p.id)));
      const validAnalyses = productAnalyses.filter(a => a !== null && !("error" in a));

      const productPerformance = validAnalyses.map((analysis: any) => {
        const pricing = pricings.find(pr => pr.productId === analysis.productId);
        if (!pricing) return { ...analysis, marginPct: 0, marginAbs: 0, suggestedPrice: 0 };

        const taxRule = pricing.TaxRule;
        const taxRate = taxRule?.TaxComponent?.reduce((acc: number, c: any) => acc + Number(c.percentage), 0) / 100 || 0;
        const commRate = Number(pricing.commission) / 100;
        const marginRate = Number(pricing.desiredMargin) / 100;
        const otherRate = Number(pricing.otherVariables) / 100;
        const freight = Number(pricing.freightOut);

        const divisor = 1 - taxRate - commRate - otherRate - marginRate;
        const suggestedPrice = divisor > 0 ? (analysis.totalIndustrialCost + freight) / divisor : 0;
        
        const totalTaxes = suggestedPrice * taxRate;
        const totalComm = suggestedPrice * commRate;
        const marginAbs = suggestedPrice - totalTaxes - totalComm - freight - analysis.totalGerencialCost;

        return {
          ...analysis,
          suggestedPrice,
          marginAbs,
          marginPct: suggestedPrice > 0 ? (marginAbs / suggestedPrice) * 100 : 0
        };
      });

      // 4. Impactos Globais
      const totalCIF = indirectCosts.filter(c => c.category === "CIF").reduce((acc, c) => acc + Number(c.monthlyValue), 0);
      const totalOPEX = indirectCosts.filter(c => c.category !== "CIF" && c.category !== "GLOBAL_PARAM").reduce((acc, c) => acc + Number(c.monthlyValue), 0);

      res.json({
        kpis: {
          totalEmployees: employees.length,
          avgEmployeeCost,
          totalMachines: machines.length,
          avgHM: machineHM.length > 0 ? machineHM.reduce((acc, m) => acc + m.hmCost, 0) / machineHM.length : 0,
          totalCIF,
          totalOPEX
        },
        productPerformance: productPerformance.sort((a, b) => b.marginPct - a.marginPct),
        costComposition: {
          mp: validAnalyses.length > 0 ? validAnalyses.reduce((acc, a: any) => acc + a.totalMaterialCost, 0) / validAnalyses.length : 0,
          hh: validAnalyses.length > 0 ? validAnalyses.reduce((acc, a: any) => acc + a.totalHH_Unit, 0) / validAnalyses.length : 0,
          hm: validAnalyses.length > 0 ? validAnalyses.reduce((acc, a: any) => acc + a.totalHM_Unit, 0) / validAnalyses.length : 0,
          cif: validAnalyses.length > 0 ? validAnalyses.reduce((acc, a: any) => acc + a.totalCIF_Unit, 0) / validAnalyses.length : 0,
          opex: validAnalyses.length > 0 ? validAnalyses.reduce((acc, a: any) => acc + a.totalOPEX_Unit, 0) / validAnalyses.length : 0,
        }
      });
    } catch (err) {
      console.error("Dashboard route error:", err);
      next(err);
    }
  });

  // --- API: Roles (Cargos) ---
  app.get("/api/roles", requireAppAuth, requireBootstrapOrAnyPermission(["settings.operational.view", "settings.view"]), async (req, res) => {
    const roles = await prisma.role.findMany({
      orderBy: { name: "asc" },
    });
    res.json(roles);
  });

  app.post("/api/roles", requireBootstrapOrAnyPermission(["settings.operational.manage", "users.manage"]), async (req, res) => {
    const { name, baseSalary, monthlyHours } = req.body;
    const role = await prisma.role.create({
      data: { name, baseSalary, monthlyHours },
    });
    res.json(role);
  });

  app.put("/api/roles/:id", requireBootstrapOrAnyPermission(["settings.operational.manage", "users.manage"]), async (req, res) => {
    const { id } = req.params;
    const { name, baseSalary, monthlyHours } = req.body;
    const role = await prisma.role.update({
      where: { id },
      data: { name, baseSalary, monthlyHours },
    });
    res.json(role);
  });

  app.delete("/api/roles/:id", requireBootstrapOrAnyPermission(["settings.operational.manage", "users.manage"]), async (req, res) => {
    const { id } = req.params;
    await prisma.role.delete({ where: { id } });
    res.json({ success: true });
  });

  // --- API: Machines (Máquinas e Centros de Trabalho) ---
  app.get("/api/machines", requireAppAuth, requirePermission("machines.view"), async (req, res) => {
    const machines = await prisma.machine.findMany({
      include: { MachineCostComponent: true },
      orderBy: { code: "asc" },
    });
    res.json(machines);
  });

  app.post("/api/machines", requireAppAuth, requirePermission("machines.edit"), async (req, res) => {
    const { code, name, acquisitionValue, residualValue, usefulLifeMonths, components } = req.body;
    const machine = await prisma.machine.create({
      data: {
        code,
        name,
        acquisitionValue,
        residualValue,
        usefulLifeMonths,
        MachineCostComponent: {
          create: (components || []).map((c: any) => ({
            name: c.name,
            monthlyEstimatedCost: c.monthlyEstimatedCost,
          }))
        }
      },
      include: { MachineCostComponent: true }
    });
    res.json(machine);
  });

  app.put("/api/machines/:id", requireAppAuth, requirePermission("machines.edit"), async (req, res) => {
    const { id } = req.params;
    const { code, name, acquisitionValue, residualValue, usefulLifeMonths, components } = req.body;

    const machine = await prisma.$transaction(async (tx) => {
      await tx.machineCostComponent.deleteMany({ where: { machineId: id } });
      return await tx.machine.update({
        where: { id },
        data: {
          code,
          name,
          acquisitionValue,
          residualValue,
          usefulLifeMonths,
          MachineCostComponent: {
            create: (components || []).map((c: any) => ({
              name: c.name,
              monthlyEstimatedCost: c.monthlyEstimatedCost,
            }))
          }
        },
        include: { MachineCostComponent: true }
      });
    });
    res.json(machine);
  });

  app.delete("/api/machines/:id", requireAppAuth, requirePermission("machines.edit"), async (req, res) => {
    try {
      const { id } = req.params;
      
      const inUse = await prisma.productRouting.findFirst({ where: { machineId: id } });
      if (inUse) {
        return res.status(400).json({ error: "IN_USE", message: "Não é possível excluir esta máquina porque ela está vinculada a roteiros de produção." });
      }

      await prisma.$transaction([
        prisma.machineCostComponent.deleteMany({ where: { machineId: id } }),
        prisma.machine.delete({ where: { id } })
      ]);
      res.json({ success: true });
    } catch (err) {
      console.error("Erro ao deletar maquina:", err);
      res.status(500).json({ error: "Erro ao excluir máquina." });
    }
  });

  // --- API: Payroll Components ---
  app.get("/api/payroll-components", requireAppAuth, requireBootstrapOrAnyPermission(["settings.operational.view", "settings.view"]), async (req, res) => {
    const components = await prisma.payrollComponent.findMany({
      orderBy: { name: "asc" },
    });
    res.json(components);
  });

  app.post("/api/payroll-components", requireBootstrapOrAnyPermission(["settings.operational.manage", "users.manage"]), async (req, res) => {
    const { name, type, calculationType, value } = req.body;
    const component = await prisma.payrollComponent.create({
      data: { name, type, calculationType, value },
    });
    res.json(component);
  });

  app.put("/api/payroll-components/:id", requireBootstrapOrAnyPermission(["settings.operational.manage", "users.manage"]), async (req, res) => {
    const { id } = req.params;
    const { name, type, calculationType, value } = req.body;
    const component = await prisma.payrollComponent.update({
      where: { id },
      data: { name, type, calculationType, value },
    });
    res.json(component);
  });

  app.delete("/api/payroll-components/:id", requireBootstrapOrAnyPermission(["settings.operational.manage", "users.manage"]), async (req, res) => {
    const { id } = req.params;
    await prisma.payrollComponent.delete({ where: { id } });
    res.json({ success: true });
  });

  
// --- API: Employees (Funcionários) ---
app.get("/api/employees", requireAppAuth, requirePermission("employees.view"), async (req, res) => {
  const employees = await prisma.employee.findMany({
    include: {
      Role: true,
      EmployeePayrollComponent: {
        include: { PayrollComponent: true }
      }
    },
    orderBy: { name: "asc" },
  });

  // Lógica de Cálculo de Custo (Motor de Custeio HH)
  const employeesWithCosts = employees.map((emp) => {
    const salary = Number(emp.salary);
    let totalBenefits = 0;
    let totalCharges = 0;
    let totalProvisions = 0;

    emp.EmployeePayrollComponent.forEach((rel) => {
      const comp = rel.PayrollComponent;
      const value = Number(comp.value);
      const amount =
        comp.calculationType === "PERCENTAGE"
          ? (salary * value) / 100
          : value;

      if (comp.type === "BENEFIT") totalBenefits += amount;
      if (comp.type === "CHARGE") totalCharges += amount;
      if (comp.type === "PROVISION") totalProvisions += amount;
    });

    const totalMonthlyCost = salary + totalBenefits + totalCharges + totalProvisions;
    const costPerContractedHour = totalMonthlyCost / emp.monthlyHours;
    const productiveHours = emp.monthlyHours * (Number(emp.productivity) / 100);
    const costPerProductiveHour = totalMonthlyCost / (productiveHours || 1);

    return {
      ...emp,
      costs: {
        salary,
        totalBenefits,
        totalCharges,
        totalProvisions,
        totalMonthlyCost,
        costPerContractedHour,
        costPerProductiveHour,
        productiveHours
      }
    };
  });

  res.json(employeesWithCosts);
});

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeOptionalText(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}

function normalizeRequiredText(value: unknown): string {
  return isNonEmptyString(value) ? value.trim() : "";
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function sanitizeUuidArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && isUuid(item));
}

function normalizeOptionalDigits(value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

function normalizeOptionalDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00.000Z` : trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function buildEmployeeHrProfileData(body: Record<string, unknown>) {
  return {
    socialName: normalizeOptionalText(body.socialName),
    cpf: normalizeOptionalDigits(body.cpf),
    rg: normalizeOptionalText(body.rg),
    birthDate: normalizeOptionalDate(body.birthDate),
    phone: normalizeOptionalDigits(body.phone),
    personalEmail: normalizeOptionalText(body.personalEmail),
    emergencyContactName: normalizeOptionalText(body.emergencyContactName),
    emergencyContactPhone: normalizeOptionalDigits(body.emergencyContactPhone),
    emergencyContactRelationship: normalizeOptionalText(body.emergencyContactRelationship),
    admissionDate: normalizeOptionalDate(body.admissionDate),
    terminationDate: normalizeOptionalDate(body.terminationDate),
    contractType: normalizeOptionalText(body.contractType),
    managerName: normalizeOptionalText(body.managerName),
    professionalNotes: normalizeOptionalText(body.professionalNotes),
    address: normalizeOptionalText(body.address),
    adminNotes: normalizeOptionalText(body.adminNotes),
    shirtSize: normalizeOptionalText(body.shirtSize),
    pantsSize: normalizeOptionalText(body.pantsSize),
    jacketSize: normalizeOptionalText(body.jacketSize),
    gloveSize: normalizeOptionalText(body.gloveSize),
    shoeSize: normalizeOptionalText(body.shoeSize),
    epiNotes: normalizeOptionalText(body.epiNotes),
  };
}

app.post("/api/employees", requireAppAuth, requirePermission("employees.edit"), async (req, res) => {
  try {
    const {
      name,
      roleId,
      department,
      costCenter,
      classification,
      salary,
      monthlyHours,
      productivity,
      status,
      componentIds,
      ...hrProfileBody
    } = req.body;

    const cleanName = normalizeRequiredText(name);
    const cleanRoleId = isUuid(roleId) ? roleId.trim() : null;
    const cleanComponentIds = sanitizeUuidArray(componentIds);
    const hrProfile = buildEmployeeHrProfileData(hrProfileBody as Record<string, unknown>);

    if (!cleanName) {
      return res.status(400).json({ error: "Nome do funcionário é obrigatório." });
    }

    if (!cleanRoleId) {
      return res.status(400).json({ error: "Selecione um cargo válido." });
    }

    const employee = await prisma.employee.create({
      data: {
        name: cleanName,
        roleId: cleanRoleId,
        department: normalizeRequiredText(department),
        costCenter: normalizeRequiredText(costCenter),
        classification: normalizeRequiredText(classification),
        salary: toNumber(salary, 0),
        monthlyHours: toNumber(monthlyHours, 0),
        productivity: toNumber(productivity, 0),
        status: normalizeOptionalText(status) ?? "ACTIVE",
        ...hrProfile,
        EmployeePayrollComponent:
          cleanComponentIds.length > 0
            ? {
                create: cleanComponentIds.map((id) => ({
                  PayrollComponent: { connect: { id } }
                }))
              }
            : undefined
      },
      include: {
        Role: true,
        EmployeePayrollComponent: {
          include: { PayrollComponent: true }
        }
      }
    });

    res.json(employee);
  } catch (error) {
    console.error("Create employee error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Erro ao criar funcionário"
    });
  }
});

app.put("/api/employees/:id", requireAppAuth, requirePermission("employees.edit"), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      componentIds,
      name,
      roleId,
      department,
      costCenter,
      classification,
      salary,
      monthlyHours,
      productivity,
      status,
      ...hrProfileBody
    } = req.body;

    if (!isUuid(id)) {
      return res.status(400).json({ error: "ID de funcionário inválido." });
    }

    const cleanName = normalizeRequiredText(name);
    const cleanRoleId = isUuid(roleId) ? roleId.trim() : null;
    const cleanComponentIds = sanitizeUuidArray(componentIds);
    const hrProfile = buildEmployeeHrProfileData(hrProfileBody as Record<string, unknown>);

    if (!cleanName) {
      return res.status(400).json({ error: "Nome do funcionário é obrigatório." });
    }

    if (!cleanRoleId) {
      return res.status(400).json({ error: "Selecione um cargo válido." });
    }

    await prisma.employeePayrollComponent.deleteMany({
      where: { employeeId: id }
    });

    const employee = await prisma.employee.update({
      where: { id },
      data: {
        name: cleanName,
        roleId: cleanRoleId,
        department: normalizeRequiredText(department),
        costCenter: normalizeRequiredText(costCenter),
        classification: normalizeRequiredText(classification),
        salary: toNumber(salary, 0),
        monthlyHours: toNumber(monthlyHours, 0),
        productivity: toNumber(productivity, 0),
        status: normalizeOptionalText(status) ?? "ACTIVE",
        ...hrProfile,
        EmployeePayrollComponent:
          cleanComponentIds.length > 0
            ? {
                create: cleanComponentIds.map((compId) => ({
                  PayrollComponent: { connect: { id: compId } }
                }))
              }
            : undefined
      },
      include: {
        Role: true,
        EmployeePayrollComponent: {
          include: { PayrollComponent: true }
        }
      }
    });

    res.json(employee);
  } catch (error) {
    console.error("Update employee error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Erro ao atualizar funcionário"
    });
  }
});

app.delete("/api/employees/:id", requireAppAuth, requirePermission("employees.edit"), async (req, res) => {
  const { id } = req.params;
  await prisma.employee.delete({ where: { id } });
  res.json({ success: true });
});

  // --- API: Materials (Matérias-Primas e Insumos) ---
  app.get("/api/materials/import/template", requireAppAuth, requirePermission("materials.view"), (req, res) => {
    try {
      const buffer = ServerImporter.generateTemplate(MaterialImportConfig);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=template_materiais.xlsx");
      res.send(buffer);
    } catch (error) {
      console.error("Template generation error:", error);
      res.status(500).json({ error: "Erro ao gerar template" });
    }
  });

  app.post("/api/materials/import/preview", requireAppAuth, requirePermission("materials.edit"), upload.single("file"), upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Arquivo não enviado" });
    try {
      const result = await ServerImporter.parseExcel(req.file.buffer, MaterialImportConfig);
      const importId = crypto.randomUUID();
      importCache.set(importId, result.data);
      
      // Cleanup after 30 mins
      setTimeout(() => importCache.delete(importId), 30 * 60 * 1000);
      
      res.json({ ...result, importId });
    } catch (error) {
      console.error("Import preview error:", error);
      res.status(500).json({ error: "Erro ao processar planilha" });
    }
  });

  app.post("/api/materials/import/confirm", requireAppAuth, requirePermission("materials.edit"), async (req, res) => {
    const { data: bodyData, importId } = req.body;
    let data = bodyData;

    if (importId && importCache.has(importId)) {
      data = importCache.get(importId);
      importCache.delete(importId);
    }

    if (!Array.isArray(data)) return res.status(400).json({ error: "Dados inválidos ou sessão de importação expirada." });

    try {
      const codes = data.map(d => d.code);
      const existing = await prisma.material.findMany({
        where: { code: { in: codes } },
        select: { code: true }
      });
      const existingCodes = new Set(existing.map(e => e.code));

      const toCreate = data.filter(d => !existingCodes.has(d.code));
      const rowsSkippedExisting = data.filter(d => existingCodes.has(d.code)).length;

      if (toCreate.length > 0) {
        await prisma.material.createMany({
          data: toCreate.map(d => ({
            code: d.code,
            description: d.description,
            unit: d.unit,
            category: d.category,
            supplier: d.supplier || null,
            currentCost: d.currentCost || 0,
            averageCost: d.averageCost || 0,
            standardCost: d.standardCost || 0,
            freight: d.freight || 0,
            standardLoss: d.standardLoss || 0,
            conversionFactor: d.conversionFactor || 1,
            status: d.status || "ACTIVE"
          }))
        });
      }

      res.json({
        success: true,
        count: toCreate.length,
        skipped: rowsSkippedExisting,
        summary: {
          rowsProcessed: data.length,
          rowsImported: toCreate.length,
          rowsSkippedExisting,
          rowsFailed: 0
        }
      });
    } catch (error) {
      console.error("Import confirm error:", error);
      res.status(500).json({ error: "Erro ao salvar dados no banco" });
    }
  });

  app.get("/api/materials", requireAppAuth, requirePermission("materials.view"), async (req, res) => {
    const materials = await prisma.material.findMany({
      include: { MaterialPriceHistory: { orderBy: { effectiveDate: "desc" }, take: 5 } },
      orderBy: { code: "asc" },
    });

    // Lógica de Cálculo de Custo Posto Fábrica e com Perda
    const materialsWithCalculations = materials.map((mat) => {
      const currentCost = Number(mat.currentCost);
      const freight = Number(mat.freight);
      const standardLoss = Number(mat.standardLoss) / 100;

      const landedCost = currentCost + freight;
      const effectiveCost = landedCost / (1 - standardLoss);

      return {
        ...mat,
        calculations: {
          landedCost,
          effectiveCost,
        }
      };
    });

    res.json(materialsWithCalculations);
  });

  app.post("/api/materials", requireAppAuth, requirePermission("materials.edit"), async (req, res) => {
    try {
      const body = req.body ?? {};
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const description =
        typeof body.description === "string" ? body.description.trim() : "";
      const unit = typeof body.unit === "string" ? body.unit.trim() : "";
      const category = typeof body.category === "string" ? body.category.trim() : "";
      const supplier =
        typeof body.supplier === "string" && body.supplier.trim()
          ? body.supplier.trim()
          : null;

      if (!code) {
        return res
          .status(400)
          .json({ error: "MATERIAL_CODE_REQUIRED", message: "Código é obrigatório." });
      }
      if (!description) {
        return res.status(400).json({
          error: "MATERIAL_DESCRIPTION_REQUIRED",
          message: "Descrição é obrigatória.",
        });
      }
      if (!unit) {
        return res
          .status(400)
          .json({ error: "MATERIAL_UNIT_REQUIRED", message: "Unidade é obrigatória." });
      }
      if (!category) {
        return res.status(400).json({
          error: "MATERIAL_CATEGORY_REQUIRED",
          message: "Categoria é obrigatória.",
        });
      }

      type NumberParseResult =
        | { ok: true; value: number }
        | { ok: false; ok_: false; message: string };
      const toNonNegativeNumber = (
        value: unknown,
        fieldLabel: string
      ): NumberParseResult => {
        if (value == null || value === "") return { ok: true, value: 0 };
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n)) {
          return { ok: false, ok_: false, message: `${fieldLabel} inválido (não é número).` };
        }
        if (n < 0) {
          return { ok: false, ok_: false, message: `${fieldLabel} não pode ser negativo.` };
        }
        return { ok: true, value: n };
      };
      const toPositiveNumber = (value: unknown, fieldLabel: string): NumberParseResult => {
        if (value == null || value === "") return { ok: true, value: 1 };
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n)) {
          return { ok: false, ok_: false, message: `${fieldLabel} inválido (não é número).` };
        }
        if (n <= 0) {
          return { ok: false, ok_: false, message: `${fieldLabel} deve ser maior que zero.` };
        }
        return { ok: true, value: n };
      };

      const numericFields: Array<{
        key:
          | "currentCost"
          | "standardCost"
          | "averageCost"
          | "freight"
          | "standardLoss";
        label: string;
      }> = [
        { key: "currentCost", label: "Custo atual" },
        { key: "standardCost", label: "Custo padrão" },
        { key: "averageCost", label: "Custo médio" },
        { key: "freight", label: "Frete" },
        { key: "standardLoss", label: "Perda padrão" },
      ];
      const parsedNumeric: Record<string, number> = {};
      for (const field of numericFields) {
        const parsed = toNonNegativeNumber(body[field.key], field.label);
        if (parsed.ok === false) {
          return res.status(400).json({
            error: "MATERIAL_INVALID_NUMERIC_FIELD",
            field: field.key,
            message: parsed.message,
          });
        }
        parsedNumeric[field.key] = parsed.value;
      }
      const conversion = toPositiveNumber(body.conversionFactor, "Fator de conversão");
      if (conversion.ok === false) {
        return res.status(400).json({
          error: "MATERIAL_INVALID_NUMERIC_FIELD",
          field: "conversionFactor",
          message: conversion.message,
        });
      }

      const existing = await prisma.material.findUnique({
        where: { code },
        select: { id: true, code: true },
      });
      if (existing) {
        return res.status(409).json({
          error: "MATERIAL_CODE_ALREADY_EXISTS",
          message: "Já existe um material cadastrado com este código.",
          code: existing.code,
          existingMaterialId: existing.id,
        });
      }

      const material = await prisma.material.create({
        data: {
          code,
          description,
          unit,
          category,
          supplier,
          currentCost: parsedNumeric.currentCost,
          averageCost: parsedNumeric.averageCost,
          standardCost: parsedNumeric.standardCost,
          freight: parsedNumeric.freight,
          standardLoss: parsedNumeric.standardLoss,
          conversionFactor: conversion.value,
          MaterialPriceHistory: {
            create: {
              price: parsedNumeric.currentCost,
              freight: parsedNumeric.freight,
            },
          },
        },
      });
      return res.json(material);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const target = Array.isArray(error.meta?.target)
          ? (error.meta?.target as string[])
          : typeof error.meta?.target === "string"
            ? [error.meta?.target as string]
            : [];
        if (target.includes("code")) {
          const codeRaw =
            typeof req.body?.code === "string" ? req.body.code.trim() : "";
          const existing = codeRaw
            ? await prisma.material
                .findUnique({ where: { code: codeRaw }, select: { id: true, code: true } })
                .catch(() => null)
            : null;
          return res.status(409).json({
            error: "MATERIAL_CODE_ALREADY_EXISTS",
            message: "Já existe um material cadastrado com este código.",
            code: existing?.code ?? codeRaw,
            existingMaterialId: existing?.id ?? null,
          });
        }
        return res.status(409).json({
          error: "MATERIAL_UNIQUE_CONSTRAINT",
          message: `Conflito de unicidade em campo(s): ${target.join(", ") || "desconhecido"}.`,
        });
      }
      console.error("POST /api/materials", error);
      return res.status(500).json({
        error: "MATERIAL_CREATE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Erro inesperado ao criar material.",
      });
    }
  });

  app.put("/api/materials/:id", requireAppAuth, requirePermission("materials.edit"), async (req, res) => {
    const { id } = req.params;
    const { currentCost, freight, ...data } = req.body;

    // Se o custo ou frete mudou, registra no histórico
    const oldMaterial = await prisma.material.findUnique({ where: { id } });
    if (oldMaterial && (Number(oldMaterial.currentCost) !== currentCost || Number(oldMaterial.freight) !== freight)) {
      await prisma.materialPriceHistory.create({
        data: {
          materialId: id,
          price: currentCost,
          freight: freight,
        }
      });
    }

    const material = await prisma.material.update({
      where: { id },
      data: {
        ...data,
        currentCost,
        freight,
      }
    });
    res.json(material);
  });

  app.patch("/api/materials/:id/status", requireAppAuth, requirePermission("materials.edit"), async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!isUuid(id)) {
        return res.status(400).json({ error: "ID de material inválido." });
      }

      const next =
        typeof status === "string" ? status.trim().toUpperCase() : "";
      if (next !== "ACTIVE" && next !== "INACTIVE") {
        return res
          .status(400)
          .json({ error: "Status inválido. Use ACTIVE ou INACTIVE." });
      }

      const existing = await prisma.material.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: "Material não encontrado." });
      }

      const material = await prisma.material.update({
        where: { id },
        data: { status: next },
      });
      res.json(material);
    } catch (error) {
      console.error("Material status error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Erro ao atualizar status do material.",
      });
    }
  });

  app.delete("/api/materials/:id", requireAppAuth, requirePermission("materials.edit"), async (req, res) => {
    const { id } = req.params;
    await prisma.material.delete({ where: { id } });
    res.json({ success: true });
  });

  // --- Compras: centros de custo e solicitações (Bloco 1) ---
  app.get("/api/cost-centers", requireAppAuth, requirePermission("purchases.view"), async (_req, res) => {
    try {
      const rows = await prisma.costCenter.findMany({
        orderBy: [{ isActive: "desc" }, { code: "asc" }],
      });
      res.json(rows);
    } catch (e) {
      console.error("cost-centers list error:", e);
      res.status(500).json({ error: "Erro ao listar centros de custo." });
    }
  });

  app.post("/api/cost-centers", requireAppAuth, requirePermission("purchases.edit"), async (req, res) => {
    try {
      const { code, name, description, notes, isActive } = req.body;
      if (!code || !name) {
        return res.status(400).json({ error: "Código e nome do centro de custo são obrigatórios." });
      }
      const row = await prisma.costCenter.create({
        data: {
          code: String(code).trim().toUpperCase(),
          name: String(name).trim(),
          description: description != null ? String(description) : null,
          notes: notes != null ? String(notes) : null,
          isActive: isActive !== false,
        },
      });
      res.json(row);
    } catch (e: any) {
      console.error("cost-center create error:", e);
      if (e.code === "P2002") {
        return res.status(409).json({ error: "Já existe centro de custo com este código." });
      }
      res.status(500).json({ error: "Erro ao criar centro de custo." });
    }
  });

  app.patch("/api/cost-centers/:id", requireAppAuth, requirePermission("purchases.edit"), async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const { name, description, notes, isActive } = req.body;
      const row = await prisma.costCenter.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name: String(name) } : {}),
          ...(description !== undefined ? { description: description } : {}),
          ...(notes !== undefined ? { notes: notes } : {}),
          ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
        },
      });
      res.json(row);
    } catch (e: any) {
      console.error("cost-center patch error:", e);
      if (e.code === "P2025") return res.status(404).json({ error: "Centro de custo não encontrado." });
      res.status(500).json({ error: "Erro ao atualizar centro de custo." });
    }
  });

  const purchaseInclude = {
    defaultCostCenter: true,
    items: {
      include: { material: true, costCenter: true },
      orderBy: { id: "asc" as const },
    },
  };

  app.get("/api/purchase-requests", requireAppAuth, requirePermission("purchases.view"), async (_req, res) => {
    try {
      const rows = await prisma.purchaseRequest.findMany({
        include: {
          defaultCostCenter: true,
          items: { include: { material: true, costCenter: true } },
        },
        orderBy: { number: "desc" },
      });
      res.json(rows);
    } catch (e) {
      console.error("purchase-requests list error:", e);
      res.status(500).json({ error: "Erro ao listar solicitações de compra." });
    }
  });

  app.get("/api/purchase-requests/:id", requireAppAuth, requirePermission("purchases.view"), async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const row = await prisma.purchaseRequest.findUnique({
        where: { id },
        include: purchaseInclude,
      });
      if (!row) return res.status(404).json({ error: "Solicitação não encontrada." });
      res.json(row);
    } catch (e) {
      console.error("purchase-request get error:", e);
      res.status(500).json({ error: "Erro ao carregar solicitação." });
    }
  });

  function validatePurchaseRequestPayload(body: any): string | null {
    if (!body || typeof body !== "object") return "Payload inválido.";
    if (!body.requester || !String(body.requester).trim()) return "Solicitante é obrigatório.";
    if (!body.department || !String(body.department).trim()) return "Departamento / área é obrigatório.";
    if (!body.justification || !String(body.justification).trim()) return "Justificativa é obrigatória.";
    if (!body.defaultCostCenterId || !isUuid(body.defaultCostCenterId)) {
      return "Centro de custo do cabeçalho é obrigatório.";
    }
    const st = body.status;
    if (st && !["RASCUNHO", "ABERTA", "CANCELADA", "ENCERRADA"].includes(st)) return "Status inválido.";
    const pr = body.priority;
    if (pr && !["BAIXA", "NORMAL", "ALTA", "URGENTE"].includes(pr)) return "Prioridade inválida.";
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return "Inclua ao menos um item na solicitação.";
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.lineType || !["MATERIA_PRIMA", "INDIRETO"].includes(it.lineType)) {
        return `Item ${i + 1}: tipo de linha inválido (MATERIA_PRIMA ou INDIRETO).`;
      }
      if (!it.description || !String(it.description).trim()) return `Item ${i + 1}: descrição é obrigatória.`;
      const q = Number(it.quantity);
      if (!Number.isFinite(q) || q <= 0) return `Item ${i + 1}: quantidade inválida.`;
      if (!it.unit || !String(it.unit).trim()) return `Item ${i + 1}: unidade é obrigatória.`;
      if (it.lineType === "MATERIA_PRIMA") {
        if (!it.materialId || !isUuid(it.materialId)) {
          return `Item ${i + 1}: matéria-prima exige material cadastrado (selecione um item ou cadastre nova MP em Suprimentos).`;
        }
      } else {
        if (it.materialId) return `Item ${i + 1}: itens indiretos não devem ter material vinculado.`;
      }
      if (it.costCenterId != null && it.costCenterId !== "" && !isUuid(it.costCenterId)) {
        return `Item ${i + 1}: centro de custo inválido.`;
      }
      if (it.lineType === "MATERIA_PRIMA") {
        const mo = it.minOrderQtySuggested;
        if (mo != null && mo !== "") {
          const n = Number(mo);
          if (!Number.isFinite(n) || n <= 0) {
            return `Item ${i + 1}: quantidade mínima sugerida (MOQ) inválida — use valor positivo ou deixe em branco.`;
          }
        }
      }
    }
    return null;
  }

  function purchaseRequestItemMpExtras(it: any) {
    const isMp = it.lineType === "MATERIA_PRIMA";
    if (!isMp) {
      return {
        supplierReference: null,
        packagingPresentation: null,
        minOrderQtySuggested: null,
      };
    }
    const supRef =
      it.supplierReference != null && String(it.supplierReference).trim()
        ? String(it.supplierReference).trim()
        : null;
    const pack =
      it.packagingPresentation != null && String(it.packagingPresentation).trim()
        ? String(it.packagingPresentation).trim()
        : null;
    let minOrder: number | null = null;
    if (it.minOrderQtySuggested != null && String(it.minOrderQtySuggested).trim() !== "") {
      minOrder = Number(it.minOrderQtySuggested);
    }
    return {
      supplierReference: supRef,
      packagingPresentation: pack,
      minOrderQtySuggested: minOrder,
    };
  }

  app.post("/api/purchase-requests", requireAppAuth, requirePermission("purchases.create"), async (req, res) => {
    try {
      const err = validatePurchaseRequestPayload(req.body);
      if (err) return res.status(400).json({ error: err });

      const {
        requester,
        department,
        requestCategory,
        priority = "NORMAL",
        status = "RASCUNHO",
        justification,
        defaultCostCenterId,
        notes,
        items = [],
      } = req.body;

      const cc = await prisma.costCenter.findUnique({ where: { id: defaultCostCenterId } });
      if (!cc || !cc.isActive) {
        return res.status(400).json({ error: "Centro de custo do cabeçalho inválido ou inativo." });
      }

      const created = await prisma.$transaction(async (tx) => {
        const header = await tx.purchaseRequest.create({
          data: {
            requester: String(requester).trim(),
            department: String(department).trim(),
            requestCategory: requestCategory != null ? String(requestCategory) : null,
            priority,
            status,
            justification: String(justification).trim(),
            defaultCostCenterId,
            notes: notes != null ? String(notes) : null,
          },
        });

        for (const it of items) {
          const costCenterId =
            it.costCenterId && isUuid(it.costCenterId) ? it.costCenterId : null;
          if (costCenterId) {
            const c = await tx.costCenter.findUnique({ where: { id: costCenterId } });
            if (!c || !c.isActive) throw new Error(`Centro de custo do item inválido ou inativo.`);
          }
          if (it.lineType === "MATERIA_PRIMA") {
            const mat = await tx.material.findUnique({ where: { id: it.materialId } });
            if (!mat) throw new Error("Material da linha de matéria-prima não encontrado.");
          }
          const mpExtras = purchaseRequestItemMpExtras(it);
          await tx.purchaseRequestItem.create({
            data: {
              purchaseRequestId: header.id,
              lineType: it.lineType,
              materialId: it.lineType === "MATERIA_PRIMA" ? it.materialId : null,
              description: String(it.description).trim(),
              quantity: it.quantity,
              unit: String(it.unit).trim(),
              costCenterId,
              desiredDate: it.desiredDate ? new Date(it.desiredDate) : null,
              priority: it.priority || null,
              notes: it.notes != null ? String(it.notes) : null,
              suggestedSupplier: it.suggestedSupplier != null ? String(it.suggestedSupplier) : null,
              supplierReference: mpExtras.supplierReference,
              packagingPresentation: mpExtras.packagingPresentation,
              minOrderQtySuggested: mpExtras.minOrderQtySuggested,
              lineStatus: it.lineStatus && ["ABERTA", "CANCELADA"].includes(it.lineStatus) ? it.lineStatus : "ABERTA",
            },
          });
        }

        return tx.purchaseRequest.findUniqueOrThrow({
          where: { id: header.id },
          include: purchaseInclude,
        });
      });

      res.json(created);
    } catch (e: any) {
      console.error("purchase-request create error:", e);
      res.status(500).json({ error: e.message || "Erro ao criar solicitação de compra." });
    }
  });

  app.put("/api/purchase-requests/:id", requireAppAuth, requirePermission("purchases.edit"), async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });

      const err = validatePurchaseRequestPayload(req.body);
      if (err) return res.status(400).json({ error: err });

      const existing = await prisma.purchaseRequest.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Solicitação não encontrada." });

      const {
        requester,
        department,
        requestCategory,
        priority = "NORMAL",
        status = "RASCUNHO",
        justification,
        defaultCostCenterId,
        notes,
        items = [],
      } = req.body;

      const cc = await prisma.costCenter.findUnique({ where: { id: defaultCostCenterId } });
      if (!cc || !cc.isActive) {
        return res.status(400).json({ error: "Centro de custo do cabeçalho inválido ou inativo." });
      }

      const updated = await prisma.$transaction(async (tx) => {
        await tx.purchaseRequest.update({
          where: { id },
          data: {
            requester: String(requester).trim(),
            department: String(department).trim(),
            requestCategory: requestCategory != null ? String(requestCategory) : null,
            priority,
            status,
            justification: String(justification).trim(),
            defaultCostCenterId,
            notes: notes != null ? String(notes) : null,
          },
        });

        await tx.purchaseRequestItem.deleteMany({ where: { purchaseRequestId: id } });

        for (const it of items) {
          const costCenterId =
            it.costCenterId && isUuid(it.costCenterId) ? it.costCenterId : null;
          if (costCenterId) {
            const c = await tx.costCenter.findUnique({ where: { id: costCenterId } });
            if (!c || !c.isActive) throw new Error(`Centro de custo do item inválido ou inativo.`);
          }
          if (it.lineType === "MATERIA_PRIMA") {
            const mat = await tx.material.findUnique({ where: { id: it.materialId } });
            if (!mat) throw new Error("Material da linha de matéria-prima não encontrado.");
          }
          const mpExtrasPut = purchaseRequestItemMpExtras(it);
          await tx.purchaseRequestItem.create({
            data: {
              purchaseRequestId: id,
              lineType: it.lineType,
              materialId: it.lineType === "MATERIA_PRIMA" ? it.materialId : null,
              description: String(it.description).trim(),
              quantity: it.quantity,
              unit: String(it.unit).trim(),
              costCenterId,
              desiredDate: it.desiredDate ? new Date(it.desiredDate) : null,
              priority: it.priority || null,
              notes: it.notes != null ? String(it.notes) : null,
              suggestedSupplier: it.suggestedSupplier != null ? String(it.suggestedSupplier) : null,
              supplierReference: mpExtrasPut.supplierReference,
              packagingPresentation: mpExtrasPut.packagingPresentation,
              minOrderQtySuggested: mpExtrasPut.minOrderQtySuggested,
              lineStatus: it.lineStatus && ["ABERTA", "CANCELADA"].includes(it.lineStatus) ? it.lineStatus : "ABERTA",
            },
          });
        }

        return tx.purchaseRequest.findUniqueOrThrow({
          where: { id },
          include: purchaseInclude,
        });
      });

      res.json(updated);
    } catch (e: any) {
      console.error("purchase-request update error:", e);
      res.status(500).json({ error: e.message || "Erro ao atualizar solicitação de compra." });
    }
  });

  // --- Helper Functions for Recursive BOM ---
  async function checkBOMCycle(parentId: string, childProductId: string): Promise<boolean> {
    if (parentId === childProductId) return true;
    
    const children = await prisma.productBOM.findMany({
      where: { productId: childProductId },
      select: { childProductId: true }
    });

    for (const child of children) {
      if (child.childProductId) {
        if (child.childProductId === parentId) return true;
        const hasCycle = await checkBOMCycle(parentId, child.childProductId);
        if (hasCycle) return true;
      }
    }
    return false;
  }

  async function checkBOMCycleWithTx(
    tx: Prisma.TransactionClient,
    parentId: string,
    childProductId: string
  ): Promise<boolean> {
    if (parentId === childProductId) return true;
    const children = await tx.productBOM.findMany({
      where: { productId: childProductId },
      select: { childProductId: true },
    });
    for (const child of children) {
      if (child.childProductId) {
        if (child.childProductId === parentId) return true;
        if (await checkBOMCycleWithTx(tx, parentId, child.childProductId))
          return true;
      }
    }
    return false;
  }

  async function getFullBOMTree(productId: string): Promise<any> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        ProductBOM: {
          include: {
            Material: true,
            ChildProduct: true
          }
        }
      }
    });

    if (!product) return null;

    const children = await Promise.all((product.ProductBOM || []).map(async (item) => {
      if (item.childProductId) {
        const subTree = await getFullBOMTree(item.childProductId);
        return {
          id: item.id,
          type: "COMPONENT",
          item: subTree,
          quantity: item.quantity,
          lossPercentage: item.lossPercentage,
          notes: item.notes
        };
      } else {
        return {
          id: item.id,
          type: "MATERIAL",
          item: item.Material,
          quantity: item.quantity,
          lossPercentage: item.lossPercentage,
          notes: item.notes
        };
      }
    }));

    return {
      ...product,
      children
    };
  }

  // --- API: Products (Engenharia / BOM / Routing) ---
  // --- API: Products Import ---
  app.get("/api/products/import/template", requireAppAuth, requirePermission("products.view"), (req, res) => {
    try {
      const buffer = ServerImporter.generateTemplateMulti(EngineeringImportConfigs);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=template_engenharia.xlsx");
      res.send(buffer);
    } catch (error) {
      console.error("Template generation error:", error);
      res.status(500).json({ error: "Erro ao gerar template" });
    }
  });

  app.post("/api/products/import/preview", requireAppAuth, requirePermission("products.edit"), upload.single("file"), upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Arquivo não enviado" });
    try {
      const results = await ServerImporter.parseExcelMulti(req.file.buffer, EngineeringImportConfigs);

      const importId = crypto.randomUUID();
      importCache.set(importId, results);
      
      // Cleanup after 30 mins
      setTimeout(() => importCache.delete(importId), 30 * 60 * 1000);
      
      res.json({ ...results, importId });
    } catch (error) {
      console.error("Import preview error:", error);
      res.status(500).json({ error: "Erro ao processar planilha" });
    }
  });

  app.post("/api/products/import/confirm", requireAppAuth, requirePermission("products.edit"), async (req, res) => {
    const { cadastro: bodyCadastro, estrutura: bodyEstrutura, importId } = req.body;
    let cadastro = bodyCadastro;
    let estrutura = bodyEstrutura;

    if (importId && importCache.has(importId)) {
      const cached = importCache.get(importId);
      cadastro = cached["CADASTRO"].data;
      estrutura = cached["ESTRUTURA"].data;
      importCache.delete(importId);
    }
    
    if (!cadastro || !estrutura) {
      return res.status(400).json({ success: false, error: "Dados de cadastro ou estrutura ausentes ou sessão expirada." });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1. Create Products/Components (somente SKUs novos)
        const skus = cadastro.map((d: any) => d.sku);
        const existing = await tx.product.findMany({
          where: { sku: { in: skus } },
          select: { sku: true }
        });
        const existingSkus = new Set(existing.map((e) => e.sku));
        const toCreate = cadastro.filter((d: any) => !existingSkus.has(d.sku));

        if (toCreate.length > 0) {
          await tx.product.createMany({
            data: toCreate.map((d: any) => ({
              sku: d.sku,
              name: d.name,
              description: d.description || null,
              type: d.type,
              version: d.version || "1.0.0",
              defaultLotSize: d.defaultLotSize !== undefined ? Number(d.defaultLotSize) : 1,
              status: d.status || "ACTIVE"
            }))
          });
        }

        const productsSkippedExisting = cadastro.filter((d: any) =>
          existingSkus.has(d.sku)
        ).length;

        // 2. BOM: substituir estrutura por pai (idempotente na reimportação)
        const allSkus = [
          ...new Set(
            [
              ...skus,
              ...estrutura.map((e: any) => e?.parentSku).filter(Boolean),
              ...estrutura
                .filter(
                  (e: any) =>
                    String(e?.childType ?? "").trim().toUpperCase() === "COMPONENT"
                )
                .map((e: any) => e?.childIdentifier)
                .filter(Boolean)
            ] as string[]
          )
        ];

        const products = await tx.product.findMany({
          where: { sku: { in: allSkus } },
          select: { id: true, sku: true, type: true }
        });
        const skuToId = new Map<string, string>(
          products.map((p) => [p.sku, p.id] as [string, string])
        );
        const skuToType = new Map<string, string>(
          products.map((p) => [p.sku, String(p.type)] as [string, string])
        );

        const matCodes = [
          ...new Set(
            estrutura
              .filter(
                (e: any) =>
                  String(e?.childType ?? "").trim().toUpperCase() === "MATERIAL"
              )
              .map((e: any) => String(e?.childIdentifier ?? "").trim())
              .filter((c: string) => c.length > 0)
          ),
        ] as string[];
        const materials =
          matCodes.length === 0
            ? []
            : await tx.material.findMany({
                where: { code: { in: matCodes } },
                select: { id: true, code: true }
              });
        const matCodeToId = new Map<string, string>(
          materials.map((m) => [m.code, m.id] as [string, string])
        );

        const parentSkuList: string[] = estrutura.map((e: any) =>
          String(e?.parentSku ?? "").trim()
        ).filter((s: string) => s.length > 0);
        const parentSkusInFile: string[] = [...new Set(parentSkuList)];

        let bomParentsStructureReplaced = 0;
        for (const ps of parentSkusInFile) {
          const pid = skuToId.get(ps);
          if (pid) {
            await tx.productBOM.deleteMany({ where: { productId: pid } });
            bomParentsStructureReplaced++;
          }
        }

        const ignoredRows: Array<{
          row: number;
          parentSku: string;
          childType?: string;
          childIdentifier?: string;
          reason: string;
        }> = [];

        const seenBomKeys = new Set<string>();
        const bomData: Array<{
          productId: string;
          materialId: string | null;
          childProductId: string | null;
          quantity: number;
          lossPercentage: number;
          notes: string | null;
        }> = [];

        for (let idx = 0; idx < estrutura.length; idx++) {
          const item = estrutura[idx];
          const rowNum = idx + 2;
          const parentSku = String(item?.parentSku ?? "").trim();
          if (!parentSku) {
            ignoredRows.push({
              row: rowNum,
              parentSku: "",
              reason: "Dado obrigatório ausente (parentSku)."
            });
            continue;
          }

          const parentId = skuToId.get(parentSku);
          if (!parentId) {
            ignoredRows.push({
              row: rowNum,
              parentSku,
              reason: "Produto pai não encontrado no cadastro (SKU sem produto correspondente)."
            });
            continue;
          }

          const childTypeRaw = String(item?.childType ?? "").trim().toUpperCase();
          if (childTypeRaw !== "MATERIAL" && childTypeRaw !== "COMPONENT") {
            ignoredRows.push({
              row: rowNum,
              parentSku,
              childType: childTypeRaw || undefined,
              reason:
                "Tipo de filho inválido ou ausente (use MATERIAL ou COMPONENT)."
            });
            continue;
          }

          const childIdentifier = String(item?.childIdentifier ?? "").trim();
          if (!childIdentifier) {
            ignoredRows.push({
              row: rowNum,
              parentSku,
              reason: "Dado obrigatório ausente (childIdentifier)."
            });
            continue;
          }

          let materialId: string | null = null;
          let childProductId: string | null = null;

          if (childTypeRaw === "MATERIAL") {
            materialId = matCodeToId.get(childIdentifier) ?? null;
            if (!materialId) {
              ignoredRows.push({
                row: rowNum,
                parentSku,
                childType: childTypeRaw,
                childIdentifier,
                reason: "Material não encontrado (código inexistente no cadastro de materiais)."
              });
              continue;
            }
          } else {
            childProductId = skuToId.get(childIdentifier) ?? null;
            if (!childProductId) {
              ignoredRows.push({
                row: rowNum,
                parentSku,
                childType: childTypeRaw,
                childIdentifier,
                reason:
                  "Produto filho não encontrado (SKU de componente inexistente no cadastro)."
              });
              continue;
            }
          }

          const qty = Number(item.quantity);
          if (!Number.isFinite(qty) || qty <= 0) {
            ignoredRows.push({
              row: rowNum,
              parentSku,
              childType: childTypeRaw,
              childIdentifier,
              reason: "Quantidade inválida ou ausente (deve ser número > 0)."
            });
            continue;
          }

          if (childTypeRaw === "COMPONENT" && childProductId) {
            const cycle = await checkBOMCycleWithTx(tx, parentId, childProductId);
            if (cycle) {
              ignoredRows.push({
                row: rowNum,
                parentSku,
                childType: childTypeRaw,
                childIdentifier,
                reason: "Ciclo estrutural detectado (vínculo pai/filho inválido)."
              });
              continue;
            }
          }

          const dedupeKey = `${parentId}|${materialId ?? ""}|${childProductId ?? ""}`;
          if (seenBomKeys.has(dedupeKey)) {
            ignoredRows.push({
              row: rowNum,
              parentSku,
              childType: childTypeRaw,
              childIdentifier,
              reason:
                "Linha duplicada no arquivo para o mesmo vínculo pai/filho (descartada pela idempotência)."
            });
            continue;
          }
          seenBomKeys.add(dedupeKey);

          bomData.push({
            productId: parentId,
            materialId,
            childProductId,
            quantity: qty,
            lossPercentage:
              item.lossPercentage !== undefined ? Number(item.lossPercentage) : 0,
            notes: item.notes ? String(item.notes) : null
          });
        }

        if (bomData.length > 0) {
          await tx.productBOM.createMany({ data: bomData });
        }

        const bomLinesWritten = bomData.length;
        const estruturaRowsIgnored = ignoredRows.length;

        return {
          productsCreated: toCreate.length,
          productsSkippedExisting,
          cadastroRowsProcessed: cadastro.length,
          estruturaRowsProcessed: estrutura.length,
          bomLinesWritten,
          bomCreated: bomLinesWritten,
          bomParentsStructureReplaced,
          estruturaRowsIgnored,
          skipped: productsSkippedExisting,
          estruturaIgnoredDetails: ignoredRows,
          hasStructureWarnings: estruturaRowsIgnored > 0
        };
      });

      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Import confirm error:", error);
      res.status(500).json({ 
        success: false, 
        error: "Erro ao salvar dados no banco de dados. Verifique se há SKUs duplicados ou dados inválidos.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/products", requireAppAuth, requirePermission("products.view"), async (req, res) => {
    try {
      const typeQ = typeof req.query.type === "string" ? req.query.type.trim() : "";
      /** Product.type no Prisma é apenas PRODUCT | COMPONENT (matéria-prima é modelo Material). */
      const typeFilter: { type: ItemType } | undefined =
        typeQ === "PRODUCT" || typeQ === "COMPONENT" ? { type: typeQ as ItemType } : undefined;

      const products = await prisma.product.findMany({
        where: typeFilter,
        include: {
          ProductBOM: {
            include: {
              Material: true,
              ChildProduct: true,
            },
          },
          ProductRouting: { include: { Machine: true, Role: true } },
        },
        orderBy: { sku: "asc" },
      });

      const wantCost = req.query.cost === "1" || req.query.cost === "true";
      if (!wantCost) {
        res.json(products);
        return;
      }

      let cache: Awaited<ReturnType<typeof initAnalysisCache>>;
      try {
        cache = await initAnalysisCache();
      } catch (cfgErr: any) {
        res.json(
          products.map((p) => ({
            ...p,
            costSummary: {
              unavailable: true as const,
              reason: cfgErr?.message ?? "Configuração global incompleta",
            },
          }))
        );
        return;
      }

      const enriched = await Promise.all(
        products.map(async (p) => {
          const a = await getProductCostAnalysis(p.id, cache, false);
          if (a && typeof a === "object" && "error" in a) {
            return {
              ...p,
              costSummary: {
                error: true as const,
                code: (a as { error: string }).error,
                message: typeof (a as { message?: string }).message === "string" ? (a as { message: string }).message : undefined,
              },
            };
          }
          const resolved = resolveOfficialProductFinalCostFromAnalysis(a);
          if (isOfficialProductFinalCostFailure(resolved)) {
            const diag = resolved.diagnostics[0];
            return {
              ...p,
              costSummary: {
                error: true as const,
                code: diag?.code ?? "CUSTO_OFICIAL_NAO_CALCULADO",
                message: diag?.message,
              },
            };
          }
          const ciu = resolved.finalUnitCost;
          return {
            ...p,
            costSummary: {
              totalIndustrialCost: ciu,
              partial: resolved.costAnalysisPartial,
              source: OFFICIAL_PRODUCT_FINAL_COST_SOURCE,
            },
          };
        })
      );

      res.json(enriched);
    } catch (error) {
      console.error("GET /api/products", error);
      res.status(500).json({ error: "Erro ao listar produtos." });
    }
  });

  /**
   * Opções para montagem da BOM: matérias-primas + produtos/componentes ativos.
   * `excludeProductId` evita auto-referência direta na lista (produto não pode ser filho de si mesmo).
   */
  app.get("/api/products/bom-item-options", requireAppAuth, requireAnyPermission(["products.view", "products.tab.bom", "products.edit"]), async (req, res) => {
    try {
      const excludeId = typeof req.query.excludeProductId === "string" ? req.query.excludeProductId.trim() : "";
      const activeMaterialWhere: Prisma.MaterialWhereInput = {
        NOT: { status: "INACTIVE" },
      };
      const activeProductWhere: Prisma.ProductWhereInput = {
        type: { in: ["PRODUCT", "COMPONENT"] },
        NOT: { status: "INACTIVE" },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      };

      const [materials, products] = await Promise.all([
        prisma.material.findMany({
          where: activeMaterialWhere,
          select: { id: true, code: true, description: true },
          orderBy: { code: "asc" },
        }),
        prisma.product.findMany({
          where: activeProductWhere,
          select: { id: true, sku: true, name: true, type: true },
          orderBy: { sku: "asc" },
        }),
      ]);

      const out: Array<
        | { type: "MATERIAL"; id: string; code: string; name: string; label: string }
        | { type: "PRODUCT"; id: string; sku: string; name: string; productType: ItemType; label: string }
      > = [
        ...materials.map((m) => ({
          type: "MATERIAL" as const,
          id: m.id,
          code: m.code,
          name: m.description,
          label: `[MP] ${m.code} — ${m.description}`,
        })),
        ...products.map((p) => ({
          type: "PRODUCT" as const,
          id: p.id,
          sku: p.sku,
          name: p.name,
          productType: p.type,
          label: p.type === "COMPONENT" ? `[COMPONENTE] ${p.sku} — ${p.name}` : `[PRODUTO] ${p.sku} — ${p.name}`,
        })),
      ];

      res.json(out);
    } catch (e: any) {
      console.error("GET /api/products/bom-item-options", e);
      res.status(500).json({ error: e?.message || "Erro ao listar opções de BOM." });
    }
  });

  app.get("/api/products/bom-usage", requireAppAuth, requirePermission("products.view"), async (req, res) => {
    try {
      const rawCode = typeof req.query.code === "string" ? req.query.code : "";
      if (!rawCode.trim()) {
        return res.status(400).json({
          error: "CODE_REQUIRED",
          message: "Informe o parâmetro code com o código do produto, componente ou matéria-prima.",
        });
      }

      const kindRaw = typeof req.query.kind === "string" ? req.query.kind.trim().toUpperCase() : "";
      let kind: BomUsageSearchKind | undefined;
      if (kindRaw === "PRODUCT") kind = "PRODUCT";
      else if (kindRaw === "MATERIAL") kind = "MATERIAL";
      else if (kindRaw) {
        return res.status(400).json({
          error: "INVALID_KIND",
          message: "Parâmetro kind inválido. Use kind=PRODUCT ou kind=MATERIAL.",
        });
      }

      const outcome = await resolveProductBomUsage({ code: rawCode, kind });

      if (outcome.status === "ok") {
        return res.json(outcome.data);
      }
      if (outcome.status === "ambiguous") {
        return res.status(409).json({
          error: "AMBIGUOUS_CODE",
          message: outcome.message,
          searchedCode: outcome.searchedCode,
          candidates: outcome.candidates,
        });
      }
      return res.status(404).json({
        error: "ITEM_NOT_FOUND",
        message: outcome.message,
        searchedCode: outcome.searchedCode,
      });
    } catch (error) {
      console.error("GET /api/products/bom-usage", error);
      return res.status(500).json({ error: "Erro ao consultar uso na estrutura ProductBOM." });
    }
  });

  app.get("/api/products/:id", requireAppAuth, requirePermission("products.view"), async (req, res) => {
    const { id } = req.params;
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        ProductBOM: { 
          include: { 
            Material: true,
            ChildProduct: true
          } 
        },
        ProductRouting: { include: { Machine: true, Role: true } },
      },
    });
    res.json(product);
  });

  app.get(
    "/api/products/:id/nomus-bom-comparison",
    requireAppAuth,
    requireAnyPermission([
      "products.tab.bom",
      "products.tab.tree",
      "products.tab.cost",
      "products.edit",
    ]),
    async (req, res) => {
      try {
        const { id } = req.params;
        const comparison = await buildBomComparisonForProductId(id);
        if (!comparison) {
          return res.status(404).json({ error: "Produto não encontrado." });
        }
        return res.json(comparison);
      } catch (error) {
        console.error("GET /api/products/:id/nomus-bom-comparison", error);
        return res.status(500).json({ error: "Erro ao comparar BOM Nomus com IndusCost." });
      }
    }
  );

  app.get(
    "/api/nomus/bom-comparison/report",
    requireAppAuth,
    requireAnyPermission([
      "products.view",
      "products.tab.bom",
      "products.tab.tree",
      "products.tab.cost",
      "products.edit",
    ]),
    async (req, res) => {
      try {
        const parseBool = (value: unknown): boolean | undefined => {
          if (value == null || value === "") return undefined;
          const normalized = String(value).trim().toLowerCase();
          if (normalized === "true" || normalized === "1") return true;
          if (normalized === "false" || normalized === "0") return false;
          return undefined;
        };

        const statusRaw = String(req.query.status ?? "ALL").trim().toUpperCase();
        const status =
          statusRaw === "OK" || statusRaw === "DIVERGENT" || statusRaw === "BLOCKED"
            ? statusRaw
            : "ALL";

        const onlyDivergent = parseBool(req.query.onlyDivergent) === true;
        const limit = clampBatchLimit(
          req.query.limit != null ? Number.parseInt(String(req.query.limit), 10) : 100
        );
        const offset = Math.max(
          0,
          req.query.offset != null ? Number.parseInt(String(req.query.offset), 10) : 0
        );

        const report = await buildNomusBomBatchReport({
          status: onlyDivergent && status === "ALL" ? "DIVERGENT" : status,
          onlyMissingProductInIndus:
            parseBool(req.query.onlyMissingProduct) === true ? true : undefined,
          onlyNoIndusBom: parseBool(req.query.onlyNoIndusBom) === true ? true : undefined,
          onlyQuantityDiffs: parseBool(req.query.onlyQuantityDiffs) === true ? true : undefined,
          onlyOnlyInNomus: parseBool(req.query.onlyOnlyInNomus) === true ? true : undefined,
          onlyOnlyInIndusCost: parseBool(req.query.onlyOnlyInIndusCost) === true ? true : undefined,
          search: req.query.search != null ? String(req.query.search) : undefined,
          limit,
          offset,
        });

        return res.json(report);
      } catch (error) {
        console.error("GET /api/nomus/bom-comparison/report", error);
        return res.status(500).json({ error: "Erro ao gerar relatório de divergências Nomus x IndusCost." });
      }
    }
  );

  app.get(
    "/api/nomus/bom-comparison/classification",
    requireAppAuth,
    requireAnyPermission([
      "products.view",
      "products.tab.bom",
      "products.tab.tree",
      "products.tab.cost",
      "products.edit",
    ]),
    async (req, res) => {
      try {
        const parseBool = (value: unknown): boolean | undefined => {
          if (value == null || value === "") return undefined;
          const normalized = String(value).trim().toLowerCase();
          if (normalized === "true" || normalized === "1") return true;
          if (normalized === "false" || normalized === "0") return false;
          return undefined;
        };

        const limit = clampBatchLimit(
          req.query.limit != null ? Number.parseInt(String(req.query.limit), 10) : 100
        );
        const offset = Math.max(
          0,
          req.query.offset != null ? Number.parseInt(String(req.query.offset), 10) : 0
        );

        const riskRaw = req.query.risk != null ? String(req.query.risk).trim().toUpperCase() : undefined;
        const risk =
          riskRaw === "LOW" || riskRaw === "MEDIUM" || riskRaw === "HIGH" || riskRaw === "BLOCKED"
            ? riskRaw
            : undefined;

        const actionClass =
          req.query.actionClass != null ? String(req.query.actionClass).trim() : undefined;

        const report = await buildNomusBomClassificationReport({
          search: req.query.search != null ? String(req.query.search) : undefined,
          limit,
          offset,
          risk,
          actionClass: actionClass as NomusBomActionClass | undefined,
          onlyBlocked: parseBool(req.query.onlyBlocked) === true ? true : undefined,
          onlyReview: parseBool(req.query.onlyReview) === true ? true : undefined,
          onlyCandidates: parseBool(req.query.onlyCandidates) === true ? true : undefined,
        });

        return res.json(report);
      } catch (error) {
        console.error("GET /api/nomus/bom-comparison/classification", error);
        return res.status(500).json({
          error: "Erro ao classificar divergências Nomus x IndusCost.",
        });
      }
    }
  );

  app.get(
    "/api/nomus/parent-code-options",
    requireAppAuth,
    requireAnyPermission([
      "products.view",
      "products.tab.bom",
      "products.tab.cost",
      "products.edit",
    ]),
    async (req, res) => {
      try {
        const search = req.query.search != null ? String(req.query.search) : "";
        const limit =
          req.query.limit != null ? Number.parseInt(String(req.query.limit), 10) : undefined;
        const result = await listNomusParentCodeOptions(search, limit);
        return res.json(result);
      } catch (error) {
        console.error("GET /api/nomus/parent-code-options", error);
        return res.status(500).json({ error: "Erro ao listar opções de parentCode Nomus." });
      }
    }
  );

  app.get(
    "/api/nomus/bom-comparison/apply-plan",
    requireAppAuth,
    requireAnyPermission([
      "products.view",
      "products.tab.bom",
      "products.tab.tree",
      "products.tab.cost",
      "products.edit",
    ]),
    async (req, res) => {
      try {
        const parseBool = (value: unknown): boolean | undefined => {
          if (value == null || value === "") return undefined;
          const normalized = String(value).trim().toLowerCase();
          if (normalized === "true" || normalized === "1") return true;
          if (normalized === "false" || normalized === "0") return false;
          return undefined;
        };

        const limit = clampBatchLimit(
          req.query.limit != null ? Number.parseInt(String(req.query.limit), 10) : 100
        );
        const offset = Math.max(
          0,
          req.query.offset != null ? Number.parseInt(String(req.query.offset), 10) : 0
        );

        const riskRaw = req.query.risk != null ? String(req.query.risk).trim().toUpperCase() : undefined;
        const risk =
          riskRaw === "LOW" || riskRaw === "MEDIUM" || riskRaw === "HIGH" || riskRaw === "BLOCKED"
            ? riskRaw
            : undefined;

        const sku = req.query.sku != null ? String(req.query.sku).trim() : undefined;
        const parentCode =
          req.query.parentCode != null ? String(req.query.parentCode).trim() : undefined;

        const report = await buildNomusBomApplyPlansReport({
          sku: parentCode ? undefined : sku || undefined,
          parentCode: parentCode || undefined,
          limit,
          offset,
          risk,
          onlyCandidates: parseBool(req.query.onlyCandidates) === true ? true : undefined,
          onlyBlocked: parseBool(req.query.onlyBlocked) === true ? true : undefined,
          onlyImportProducts: parseBool(req.query.onlyImportProducts) === true ? true : undefined,
          onlyUpdateQuantities: parseBool(req.query.onlyUpdateQuantities) === true ? true : undefined,
        });

        return res.json(report);
      } catch (error) {
        console.error("GET /api/nomus/bom-comparison/apply-plan", error);
        return res.status(500).json({
          error: "Erro ao gerar plano dry-run de aplicação da BOM Nomus.",
        });
      }
    }
  );

  const NOMUS_OPTIONAL_PRICING_PERMS = [
    "products.view",
    "products.tab.bom",
    "products.tab.cost",
    "products.edit",
  ] as const;

  app.get(
    "/api/nomus/bom-optionals/pricing-selection",
    requireAppAuth,
    requireAnyPermission([...NOMUS_OPTIONAL_PRICING_PERMS]),
    async (req, res) => {
      try {
        const search = req.query.search != null ? String(req.query.search).trim() : undefined;
        const statusRaw =
          req.query.status != null ? String(req.query.status).trim().toUpperCase() : undefined;
        const status =
          statusRaw === "PENDING" ||
          statusRaw === "RESOLVED" ||
          statusRaw === "NO_OPTIONALS" ||
          statusRaw === "STALE"
            ? (statusRaw as PricingOptionalStatus)
            : undefined;
        const limit = clampBatchLimit(
          req.query.limit != null ? Number.parseInt(String(req.query.limit), 10) : 100
        );
        const offset = Math.max(
          0,
          req.query.offset != null ? Number.parseInt(String(req.query.offset), 10) : 0
        );
        const result = await listProductsWithOptionalNomusItems({ search, status, limit, offset });
        return res.json(result);
      } catch (error) {
        console.error("GET /api/nomus/bom-optionals/pricing-selection", error);
        return res.status(500).json({ error: "Erro ao listar opcionais de precificação." });
      }
    }
  );

  app.get(
    "/api/nomus/bom-optionals/pricing-selection/detail",
    requireAppAuth,
    requireAnyPermission([...NOMUS_OPTIONAL_PRICING_PERMS]),
    async (req, res) => {
      try {
        const parentCode = req.query.parentCode != null ? String(req.query.parentCode).trim() : "";
        if (!parentCode) {
          return res.status(400).json({ error: "parentCode é obrigatório." });
        }
        const detail = await getOptionalPricingSelectionDetail(parentCode);
        return res.json(detail);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao carregar detalhe.";
        const status = message.includes("não encontrado") ? 404 : 500;
        console.error("GET /api/nomus/bom-optionals/pricing-selection/detail", error);
        return res.status(status).json({ error: message });
      }
    }
  );

  app.post(
    "/api/nomus/bom-optionals/pricing-selection/groups",
    requireAppAuth,
    requireAnyPermission([...NOMUS_OPTIONAL_PRICING_PERMS]),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const parentCode = String(body.parentCode ?? "").trim();
        const groupName = String(body.groupName ?? "").trim();
        const selectionMode = String(body.selectionMode ?? "EXACTLY_ONE").trim() as NomusOptionalPricingSelectionMode;
        const componentCodes = Array.isArray(body.componentCodes)
          ? body.componentCodes.map((c: unknown) => String(c).trim()).filter(Boolean)
          : [];
        if (!parentCode || !groupName) {
          return res.status(400).json({ error: "parentCode e groupName são obrigatórios." });
        }
        if (
          selectionMode !== "EXACTLY_ONE" &&
          selectionMode !== "OPTIONAL_ONE" &&
          selectionMode !== "MULTIPLE"
        ) {
          return res.status(400).json({ error: "selectionMode inválido." });
        }
        const detail = await createOptionalPricingGroup({
          parentCode,
          groupName,
          selectionMode,
          componentCodes,
          notes: body.notes != null ? String(body.notes) : null,
        });
        return res.status(201).json(detail);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao criar grupo.";
        console.error("POST /api/nomus/bom-optionals/pricing-selection/groups", error);
        return res.status(400).json({ error: message });
      }
    }
  );

  app.patch(
    "/api/nomus/bom-optionals/pricing-selection/groups/:groupId",
    requireAppAuth,
    requireAnyPermission([...NOMUS_OPTIONAL_PRICING_PERMS]),
    async (req, res) => {
      try {
        const { groupId } = req.params;
        const body = req.body ?? {};
        const selectionMode =
          body.selectionMode != null
            ? (String(body.selectionMode).trim() as NomusOptionalPricingSelectionMode)
            : undefined;
        const detail = await updateOptionalPricingGroup(groupId, {
          groupName: body.groupName != null ? String(body.groupName).trim() : undefined,
          selectionMode,
          notes: body.notes !== undefined ? (body.notes != null ? String(body.notes) : null) : undefined,
          isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
        });
        return res.json(detail);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao atualizar grupo.";
        console.error("PATCH /api/nomus/bom-optionals/pricing-selection/groups/:groupId", error);
        return res.status(400).json({ error: message });
      }
    }
  );

  app.patch(
    "/api/nomus/bom-optionals/pricing-selection/groups/:groupId/selection",
    requireAppAuth,
    requireAnyPermission([...NOMUS_OPTIONAL_PRICING_PERMS]),
    async (req, res) => {
      try {
        const { groupId } = req.params;
        const body = req.body ?? {};
        const detail = await setOptionalPricingSelection(groupId, {
          selectedChoiceId:
            body.selectedChoiceId != null ? String(body.selectedChoiceId) : undefined,
          selectedChoiceIds: Array.isArray(body.selectedChoiceIds)
            ? body.selectedChoiceIds.map((id: unknown) => String(id))
            : undefined,
          selectedNone: body.selectedNone === true,
        });
        return res.json(detail);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao salvar seleção.";
        console.error(
          "PATCH /api/nomus/bom-optionals/pricing-selection/groups/:groupId/selection",
          error
        );
        return res.status(400).json({ error: message });
      }
    }
  );

  app.delete(
    "/api/nomus/bom-optionals/pricing-selection/groups/:groupId",
    requireAppAuth,
    requireAnyPermission([...NOMUS_OPTIONAL_PRICING_PERMS]),
    async (req, res) => {
      try {
        const { groupId } = req.params;
        const detail = await deactivateOptionalPricingGroup(groupId);
        return res.json(detail);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao desativar grupo.";
        console.error("DELETE /api/nomus/bom-optionals/pricing-selection/groups/:groupId", error);
        return res.status(400).json({ error: message });
      }
    }
  );

  app.get(
    "/api/nomus/effective-pricing-bom",
    requireAppAuth,
    requireAnyPermission([...NOMUS_OPTIONAL_PRICING_PERMS]),
    async (req, res) => {
      try {
        const parentCode = req.query.parentCode != null ? String(req.query.parentCode).trim() : "";
        if (!parentCode) {
          return res.status(400).json({ error: "parentCode é obrigatório." });
        }
        const recursive =
          req.query.recursive === "true" || req.query.recursive === "1";
        const maxDepthRaw =
          req.query.maxDepth != null ? Number.parseInt(String(req.query.maxDepth), 10) : 10;
        const maxDepth = Number.isFinite(maxDepthRaw)
          ? Math.min(Math.max(maxDepthRaw, 1), 20)
          : 10;

        const result = await buildEffectivePricingBomForParentCode(parentCode, {
          recursive,
          maxDepth,
        });
        return res.json(result);
      } catch (error) {
        console.error("GET /api/nomus/effective-pricing-bom", error);
        return res.status(500).json({ error: "Erro ao gerar BOM efetiva de precificação." });
      }
    }
  );

  app.get(
    "/api/nomus/effective-pricing-bom/cost-impact",
    requireAppAuth,
    requireAnyPermission([...NOMUS_OPTIONAL_PRICING_PERMS]),
    async (req, res) => {
      try {
        const parentCode = req.query.parentCode != null ? String(req.query.parentCode).trim() : "";
        if (!parentCode) {
          return res.status(400).json({ error: "parentCode é obrigatório." });
        }
        const recursive =
          req.query.recursive === "true" || req.query.recursive === "1";
        const maxDepthRaw =
          req.query.maxDepth != null ? Number.parseInt(String(req.query.maxDepth), 10) : 10;
        const maxDepth = Number.isFinite(maxDepthRaw)
          ? Math.min(Math.max(maxDepthRaw, 1), 20)
          : 10;
        const lotSizeRaw =
          req.query.lotSize != null ? Number.parseFloat(String(req.query.lotSize)) : undefined;
        const lotSize =
          lotSizeRaw != null && Number.isFinite(lotSizeRaw) ? lotSizeRaw : undefined;

        let currentSnapshot: CurrentCostSnapshot | null = null;
        const sku = parentCode.trim();
        const product = await prisma.product.findFirst({
          where: { OR: [{ sku }, { sku: sku.toUpperCase() }] },
          select: { id: true },
        });
        if (product) {
          currentSnapshot = await loadCurrentCostSnapshotForProductId(product.id);
        }

        const result = await buildNomusEffectiveBomCostImpact(
          parentCode,
          { recursive, maxDepth, lotSize },
          currentSnapshot
        );
        return res.json(result);
      } catch (error) {
        console.error("GET /api/nomus/effective-pricing-bom/cost-impact", error);
        return res.status(500).json({ error: "Erro ao calcular impacto de custo da BOM efetiva." });
      }
    }
  );

  app.get(
    "/api/nomus/effective-pricing-bom/review-decisions",
    requireAppAuth,
    requireAnyPermission([...NOMUS_OPTIONAL_PRICING_PERMS]),
    async (req, res) => {
      try {
        const parentCode = req.query.parentCode != null ? String(req.query.parentCode).trim() : "";
        if (!parentCode) {
          return res.status(400).json({ error: "parentCode é obrigatório." });
        }
        const result = await listReviewDecisionsForParentCode(parentCode);
        return res.json(result);
      } catch (error) {
        console.error("GET /api/nomus/effective-pricing-bom/review-decisions", error);
        return res.status(500).json({ error: "Erro ao listar decisões de revisão." });
      }
    }
  );

  app.patch(
    "/api/nomus/effective-pricing-bom/review-decisions",
    requireAppAuth,
    requireAnyPermission([...NOMUS_OPTIONAL_PRICING_PERMS]),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const parentCode = String(body.parentCode ?? "").trim();
        const componentCode = String(body.componentCode ?? "").trim();
        const decision = String(body.decision ?? "PENDING").trim() as NomusBomReviewDecisionType;
        if (!parentCode || !componentCode) {
          return res.status(400).json({ error: "parentCode e componentCode são obrigatórios." });
        }
        const validDecisions: NomusBomReviewDecisionType[] = [
          "PENDING",
          "INCLUDE_AS_LOCAL_EXCEPTION",
          "EXCLUDE_FROM_PRICING",
          "DUPLICATED_BY_NOMUS_COMPONENT",
          "OPERATIONAL_ROUTING_COST",
          "NEEDS_ENGINEERING_REVIEW",
        ];
        if (!validDecisions.includes(decision)) {
          return res.status(400).json({ error: "decision inválida." });
        }
        const quantityRaw = body.quantitySnapshot;
        const quantitySnapshot =
          quantityRaw != null && quantityRaw !== ""
            ? Number(quantityRaw)
            : null;
        const saved = await saveReviewDecision(
          {
            parentCode,
            parentProductId:
              body.parentProductId != null ? String(body.parentProductId) : null,
            productBomLineId:
              body.productBomLineId != null ? String(body.productBomLineId) : null,
            componentCode,
            componentDescription:
              body.componentDescription != null ? String(body.componentDescription) : null,
            quantitySnapshot:
              quantitySnapshot != null && Number.isFinite(quantitySnapshot)
                ? quantitySnapshot
                : null,
            decision,
            includeForPricing:
              body.includeForPricing != null ? Boolean(body.includeForPricing) : undefined,
            relatedNomusComponentCode:
              body.relatedNomusComponentCode != null
                ? String(body.relatedNomusComponentCode)
                : null,
            reason: body.reason != null ? String(body.reason) : null,
            notes: body.notes != null ? String(body.notes) : null,
          },
          req.appAuth?.id ?? req.appAuth?.email ?? null
        );
        return res.json(saved);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao salvar decisão.";
        console.error("PATCH /api/nomus/effective-pricing-bom/review-decisions", error);
        return res.status(400).json({ error: message });
      }
    }
  );

  app.get(
    "/api/nomus/effective-pricing-bom/apply-preview",
    requireAppAuth,
    requireAnyPermission([...NOMUS_OPTIONAL_PRICING_PERMS]),
    async (req, res) => {
      try {
        const parentCode = req.query.parentCode != null ? String(req.query.parentCode).trim() : "";
        if (!parentCode) {
          return res.status(400).json({ error: "parentCode é obrigatório." });
        }
        const result = await buildControlledApplyPreview(parentCode, {
          resolveCurrentCostSnapshot: resolveCurrentCostSnapshotForNomus,
        });
        return res.json(result);
      } catch (error) {
        console.error("GET /api/nomus/effective-pricing-bom/apply-preview", error);
        return res.status(500).json({ error: "Erro ao gerar preview de aplicação controlada." });
      }
    }
  );

  app.post(
    "/api/nomus/effective-pricing-bom/apply",
    requireAppAuth,
    requirePermission("products.edit"),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const parentCode = String(body.parentCode ?? "").trim();
        const planHash = String(body.planHash ?? "").trim();
        const confirmationText = String(body.confirmationText ?? "").trim();
        const approvedBy =
          body.approvedBy != null && String(body.approvedBy).trim()
            ? String(body.approvedBy).trim()
            : undefined;

        if (!parentCode || !planHash || !confirmationText) {
          return res.status(400).json({
            error: "parentCode, planHash e confirmationText são obrigatórios.",
          });
        }

        const result = await applyEffectiveBomToProductBom({
          parentCode,
          planHash,
          confirmationText,
          approvedBy,
          resolveCurrentCostSnapshot: resolveCurrentCostSnapshotForNomus,
        });
        return res.json(result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Erro ao aplicar BOM efetiva.";
        console.error("POST /api/nomus/effective-pricing-bom/apply", error);
        const status = message.includes("Plano desatualizado") || message.includes("Confirmação")
          ? 409
          : message.includes("bloqueada") || message.includes("gates")
            ? 422
            : 400;
        return res.status(status).json({ error: message });
      }
    }
  );

  app.delete(
    "/api/nomus/effective-pricing-bom/review-decisions",
    requireAppAuth,
    requireAnyPermission([...NOMUS_OPTIONAL_PRICING_PERMS]),
    async (req, res) => {
      try {
        const parentCode =
          req.query.parentCode != null
            ? String(req.query.parentCode).trim()
            : String(req.body?.parentCode ?? "").trim();
        const productBomLineId =
          req.query.productBomLineId != null
            ? String(req.query.productBomLineId).trim()
            : req.body?.productBomLineId != null
              ? String(req.body.productBomLineId).trim()
              : undefined;
        const componentCode =
          req.query.componentCode != null
            ? String(req.query.componentCode).trim()
            : req.body?.componentCode != null
              ? String(req.body.componentCode).trim()
              : undefined;
        if (!parentCode) {
          return res.status(400).json({ error: "parentCode é obrigatório." });
        }
        await clearReviewDecision({ parentCode, productBomLineId, componentCode });
        return res.json({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao remover decisão.";
        console.error("DELETE /api/nomus/effective-pricing-bom/review-decisions", error);
        return res.status(400).json({ error: message });
      }
    }
  );

  app.get(
    "/api/nomus/product-import-simulation/preview",
    requireAppAuth,
    requirePermission("products.view"),
    async (req, res) => {
      try {
        const parentCode = String(req.query.parentCode ?? "").trim();
        if (!parentCode) {
          return res.status(400).json({ error: "parentCode é obrigatório." });
        }
        const recursive = req.query.recursive === "true" || req.query.recursive === "1";
        const maxDepthRaw = Number(req.query.maxDepth);
        const maxDepth = Number.isFinite(maxDepthRaw) && maxDepthRaw > 0 ? maxDepthRaw : undefined;
        const preview = await buildNomusProductImportSimulationPreview({
          parentCode,
          recursive,
          maxDepth,
        });
        return res.json(preview);
      } catch (error) {
        console.error("GET /api/nomus/product-import-simulation/preview", error);
        return res.status(500).json({
          error: error instanceof Error ? error.message : "Erro ao gerar preview de importação.",
        });
      }
    }
  );

  app.post(
    "/api/nomus/product-import-simulation/import",
    requireAppAuth,
    requirePermission("products.edit"),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const parentCode = String(body.parentCode ?? "").trim();
        const planHash = String(body.planHash ?? "").trim();
        const confirmationText = String(body.confirmationText ?? "").trim();
        const approvedBy =
          body.approvedBy != null && String(body.approvedBy).trim()
            ? String(body.approvedBy).trim()
            : undefined;
        const recursive = body.recursive === true || body.recursive === "true";
        const maxDepthRaw = Number(body.maxDepth);
        const maxDepth = Number.isFinite(maxDepthRaw) && maxDepthRaw > 0 ? maxDepthRaw : undefined;

        if (!parentCode || !planHash || !confirmationText) {
          return res.status(400).json({
            error: "parentCode, planHash e confirmationText são obrigatórios.",
          });
        }

        const result = await executeNomusProductImportSimulation({
          parentCode,
          planHash,
          confirmationText,
          approvedBy,
          recursive,
          maxDepth,
        });
        return res.json(result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Erro ao importar produto do Nomus.";
        console.error("POST /api/nomus/product-import-simulation/import", error);
        const status =
          message.includes("Plano desatualizado") || message.includes("Confirmação")
            ? 409
            : message.includes("bloqueada") || message.includes("gates")
              ? 422
              : 400;
        return res.status(status).json({ error: message });
      }
    }
  );

  app.get(
    "/api/nomus/engineering-operations-cockpit",
    requireAppAuth,
    requireAnyPermission([
      "products.view",
      "products.tab.bom",
      "products.tab.tree",
      "products.tab.cost",
      "products.edit",
    ]),
    async (req, res) => {
      try {
        const scopeRaw = String(req.query.scope ?? "CHANGED_ONLY").trim().toUpperCase();
        const scope: "ALL" | "CHANGED_ONLY" | "ONE_PRODUCT" =
          scopeRaw === "ALL" || scopeRaw === "CHANGED_ONLY" || scopeRaw === "ONE_PRODUCT"
            ? (scopeRaw as "ALL" | "CHANGED_ONLY" | "ONE_PRODUCT")
            : "CHANGED_ONLY";
        const parentCode =
          req.query.parentCode != null && String(req.query.parentCode).trim()
            ? String(req.query.parentCode).trim()
            : undefined;
        const limitRaw = Number(req.query.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
        const offsetRaw = Number(req.query.offset);
        const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : undefined;
        const includeCostImpact =
          req.query.includeCostImpact === "true" || req.query.includeCostImpact === "1";

        const result = await buildNomusEngineeringOperationsCockpit({
          scope,
          parentCode,
          limit,
          offset,
          includeCostImpact,
        });
        return res.json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Erro ao montar Central de Atualização Nomus.";
        console.error("GET /api/nomus/engineering-operations-cockpit", error);
        return res.status(500).json({
          error: "OPERATIONS_COCKPIT_FAILED",
          message,
        });
      }
    }
  );

  app.get(
    "/api/nomus/engineering-equalization-action-plan",
    requireAppAuth,
    requireAnyPermission([
      "products.view",
      "products.tab.bom",
      "products.tab.tree",
      "products.tab.cost",
      "products.edit",
    ]),
    async (req, res) => {
      try {
        const parentCode =
          req.query.parentCode != null ? String(req.query.parentCode).trim() : "";
        if (!parentCode) {
          return res.status(400).json({
            error: "PARENT_CODE_REQUIRED",
            message: "parentCode é obrigatório.",
          });
        }

        const parseBool = (value: unknown, defaultValue: boolean): boolean => {
          if (value === undefined) return defaultValue;
          const v = String(value).trim().toLowerCase();
          if (v === "true" || v === "1") return true;
          if (v === "false" || v === "0") return false;
          return defaultValue;
        };

        const includeCostImpact = parseBool(req.query.includeCostImpact, true);
        const includeApplyPreview = parseBool(req.query.includeApplyPreview, true);
        const includeImportPreviewRaw =
          req.query.includeImportPreview !== undefined
            ? parseBool(req.query.includeImportPreview, true)
            : undefined;

        const result = await buildNomusEngineeringEqualizationActionPlan({
          parentCode,
          includeCostImpact,
          includeApplyPreview,
          includeImportPreview: includeImportPreviewRaw,
        });
        return res.json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Erro ao montar Plano de Ação de Equalização.";
        console.error("GET /api/nomus/engineering-equalization-action-plan", error);
        return res.status(500).json({
          error: "EQUALIZATION_ACTION_PLAN_FAILED",
          message,
        });
      }
    }
  );

  app.get(
    "/api/nomus/master-data-import/diagnostic",
    requireAppAuth,
    requireAnyPermission([
      "products.view",
      "products.edit",
      "materials.view",
      "materials.edit",
    ]),
    async (req, res) => {
      try {
        const limitRaw = Number(req.query.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
        const offsetRaw = Number(req.query.offset);
        const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : undefined;
        const search =
          req.query.search != null && String(req.query.search).trim()
            ? String(req.query.search).trim()
            : undefined;
        const classification =
          req.query.classification != null && String(req.query.classification).trim()
            ? String(req.query.classification).trim()
            : undefined;
        const includeExisting =
          req.query.includeExisting === "true" || req.query.includeExisting === "1";

        const result = await buildNomusMasterDataImportDiagnostic({
          limit,
          offset,
          search,
          classification,
          includeExisting,
        });
        return res.json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Erro ao montar diagnóstico de Carga Mestre Nomus.";
        console.error("GET /api/nomus/master-data-import/diagnostic", error);
        return res.status(500).json({
          error: "MASTER_DATA_DIAGNOSTIC_FAILED",
          message,
        });
      }
    }
  );

  app.get(
    "/api/nomus/master-data-import/preview",
    requireAppAuth,
    requireAnyPermission([
      "products.view",
      "products.edit",
      "materials.view",
      "materials.edit",
    ]),
    async (req, res) => {
      try {
        const classificationRaw =
          req.query.classification != null
            ? String(req.query.classification).trim().toUpperCase()
            : "ALL_SAFE";
        const classification: "SAFE_PRODUCT_CANDIDATE" | "SAFE_MATERIAL_CANDIDATE" | "ALL_SAFE" =
          classificationRaw === "SAFE_PRODUCT_CANDIDATE" ||
          classificationRaw === "SAFE_MATERIAL_CANDIDATE"
            ? (classificationRaw as "SAFE_PRODUCT_CANDIDATE" | "SAFE_MATERIAL_CANDIDATE")
            : "ALL_SAFE";

        let codes: string[] | undefined;
        if (req.query.codes != null) {
          const raw = String(req.query.codes);
          codes = raw
            .split(/[,\n;]/)
            .map((c) => c.trim())
            .filter(Boolean);
          if (codes.length === 0) codes = undefined;
        }

        const result = await buildNomusMasterDataImportPreview({ classification, codes });
        return res.json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Erro ao montar preview de Carga Mestre Nomus.";
        console.error("GET /api/nomus/master-data-import/preview", error);
        return res.status(500).json({
          error: "MASTER_DATA_PREVIEW_FAILED",
          message,
        });
      }
    }
  );

  app.post(
    "/api/nomus/master-data-import/apply-safe",
    requireAppAuth,
    requireAnyPermission(["products.edit", "materials.edit"]),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const modeRaw = String(body.mode ?? "").trim();
        if (modeRaw !== "SAFE_ONLY") {
          return res.status(400).json({
            error: "MASTER_DATA_INVALID_MODE",
            message: `Apenas mode=SAFE_ONLY é aceito. Recebido: "${modeRaw}".`,
          });
        }
        const confirmationText = typeof body.confirmationText === "string"
          ? body.confirmationText
          : "";
        if (confirmationText !== MASTER_DATA_CONFIRMATION_TEXT) {
          return res.status(400).json({
            error: "MASTER_DATA_INVALID_CONFIRMATION",
            message: `Confirmação inválida — envie confirmationText exatamente igual a: "${MASTER_DATA_CONFIRMATION_TEXT}".`,
          });
        }

        let codes: string[] | undefined;
        if (Array.isArray(body.codes)) {
          codes = body.codes
            .filter((c: unknown): c is string => typeof c === "string")
            .map((c: string) => c.trim())
            .filter((c: string) => c.length > 0);
          if (codes.length === 0) codes = undefined;
        }

        const requestedBy =
          typeof body.requestedBy === "string" && body.requestedBy.trim()
            ? body.requestedBy.trim()
            : undefined;

        const result = await applyNomusMasterDataImport({
          mode: "SAFE_ONLY",
          codes,
          confirmationText,
          requestedBy,
        });
        const statusCode = result.status === "FAILED" ? 500 : 200;
        return res.status(statusCode).json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Erro ao aplicar Carga Mestre Nomus.";
        console.error("POST /api/nomus/master-data-import/apply-safe", error);
        return res.status(500).json({
          error: "MASTER_DATA_APPLY_FAILED",
          message,
        });
      }
    }
  );

  app.get(
    "/api/nomus/master-data-import/ambiguity-batch/preview",
    requireAppAuth,
    requireAnyPermission([
      "products.view",
      "products.edit",
      "materials.view",
      "materials.edit",
    ]),
    async (_req, res) => {
      try {
        const result = await buildAmbiguityBatchPreview();
        return res.json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Erro ao montar preview de ambiguidades.";
        console.error(
          "GET /api/nomus/master-data-import/ambiguity-batch/preview",
          error
        );
        return res.status(500).json({
          error: "AMBIGUITY_BATCH_PREVIEW_FAILED",
          message,
        });
      }
    }
  );

  app.post(
    "/api/nomus/master-data-import/ambiguity-batch/apply",
    requireAppAuth,
    requireAnyPermission(["products.edit", "materials.edit"]),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const planHash =
          typeof body.planHash === "string" ? body.planHash.trim() : "";
        const confirmationText =
          typeof body.confirmationText === "string" ? body.confirmationText : "";
        if (!planHash) {
          return res.status(400).json({
            error: "AMBIGUITY_BATCH_PLAN_HASH_REQUIRED",
            message: "Envie planHash do preview do lote.",
          });
        }
        if (confirmationText !== AMBIGUITY_BATCH_CONFIRMATION_TEXT) {
          return res.status(400).json({
            error: "AMBIGUITY_BATCH_INVALID_CONFIRMATION",
            message: `Confirmação inválida — use: "${AMBIGUITY_BATCH_CONFIRMATION_TEXT}".`,
          });
        }
        let codes: string[] | undefined;
        if (Array.isArray(body.codes)) {
          codes = body.codes
            .filter((c: unknown): c is string => typeof c === "string")
            .map((c: string) => c.trim())
            .filter(Boolean);
          if (codes.length === 0) codes = undefined;
        }
        const result = await applyAmbiguityBatch({
          planHash,
          confirmationText,
          codes,
          approvedBy:
            typeof body.approvedBy === "string" ? body.approvedBy : "master-data-ui",
        });
        const httpStatus =
          result.resultStatus === "APPLIED" || result.resultStatus === "PARTIAL"
            ? 200
            : 400;
        return res.status(httpStatus).json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Erro ao aplicar resolução de ambiguidades.";
        console.error(
          "POST /api/nomus/master-data-import/ambiguity-batch/apply",
          error
        );
        return res.status(500).json({
          error: "AMBIGUITY_BATCH_APPLY_FAILED",
          message,
        });
      }
    }
  );

  app.get(
    "/api/nomus/master-data-equalize/preview",
    requireAppAuth,
    requireAnyPermission([
      "products.view",
      "products.edit",
      "materials.view",
      "materials.edit",
    ]),
    async (req, res) => {
      try {
        const limitRaw = Number(req.query.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
        const offsetRaw = Number(req.query.offset);
        const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : undefined;
        const search =
          req.query.search != null && String(req.query.search).trim()
            ? String(req.query.search).trim()
            : undefined;
        const scopeRaw = String(req.query.scope ?? "").trim().toUpperCase();
        const scope: "ALL" | "ACTIONABLE" | undefined =
          scopeRaw === "ALL" || scopeRaw === "ACTIONABLE"
            ? (scopeRaw as "ALL" | "ACTIONABLE")
            : undefined;
        const includeExisting =
          req.query.includeExisting === "true" || req.query.includeExisting === "1";
        const includeUnmatchedIndusCost =
          req.query.includeUnmatchedIndusCost === "false" ||
          req.query.includeUnmatchedIndusCost === "0"
            ? false
            : true;

        const result = await buildNomusMasterDataEqualizePreview({
          limit,
          offset,
          search,
          scope,
          includeExisting,
          includeUnmatchedIndusCost,
        });
        return res.json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Erro ao montar preview de Igualar Bases Nomus.";
        console.error("GET /api/nomus/master-data-equalize/preview", error);
        return res.status(500).json({
          error: "MASTER_DATA_EQUALIZE_PREVIEW_FAILED",
          message,
        });
      }
    }
  );

  app.post(
    "/api/nomus/master-data-equalize/apply",
    requireAppAuth,
    requireAnyPermission(["products.edit", "materials.edit"]),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const confirmationText = typeof body.confirmationText === "string"
          ? body.confirmationText
          : "";
        if (confirmationText !== EQUALIZE_CONFIRMATION_TEXT) {
          return res.status(400).json({
            error: "MASTER_DATA_EQUALIZE_INVALID_CONFIRMATION",
            message: `Confirmação inválida — envie confirmationText exatamente igual a: "${EQUALIZE_CONFIRMATION_TEXT}".`,
          });
        }
        const scopeRaw = String(body.scope ?? "SAFE_ONLY").trim();
        if (scopeRaw !== "SAFE_ONLY") {
          return res.status(400).json({
            error: "MASTER_DATA_EQUALIZE_INVALID_SCOPE",
            message: `Apenas scope="SAFE_ONLY" é aceito. Recebido: "${scopeRaw}".`,
          });
        }
        let codes: string[] | undefined;
        if (Array.isArray(body.codes)) {
          codes = body.codes
            .filter((c: unknown): c is string => typeof c === "string")
            .map((c: string) => c.trim())
            .filter((c: string) => c.length > 0);
          if (codes.length === 0) codes = undefined;
        }
        const requestedBy =
          typeof body.requestedBy === "string" && body.requestedBy.trim()
            ? body.requestedBy.trim()
            : null;

        const result = await applyNomusMasterDataEqualize({
          confirmationText,
          scope: "SAFE_ONLY",
          codes,
          requestedBy,
        });
        const statusCode = result.status === "FAILED" ? 500 : 200;
        return res.status(statusCode).json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Erro ao aplicar Igualar Bases Nomus.";
        console.error("POST /api/nomus/master-data-equalize/apply", error);
        return res.status(500).json({
          error: "MASTER_DATA_EQUALIZE_APPLY_FAILED",
          message,
        });
      }
    }
  );

  app.get(
    "/api/nomus/engineering-runs/recent",
    requireAppAuth,
    requireAnyPermission([
      "products.view",
      "products.edit",
      "materials.view",
      "materials.edit",
    ]),
    async (req, res) => {
      try {
        const limitRaw = Number(req.query.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 10;
        const runs = await prisma.engineeringSyncRun.findMany({
          orderBy: { createdAt: "desc" },
          take: limit,
          select: {
            id: true,
            mode: true,
            status: true,
            parentCode: true,
            planHash: true,
            approvedBy: true,
            startedAt: true,
            finishedAt: true,
            createdAt: true,
            summaryJson: true,
          },
        });
        const items = runs.map((r) => {
          const summary = (r.summaryJson as { origin?: string } | null) ?? null;
          const origin = summary?.origin ?? null;
          let label: string;
          switch (origin) {
            case "MASTER_DATA_EQUALIZE":
              label = "Igualar bases";
              break;
            case "BOM_APPLY_AFTER_MASTER_DATA":
              label = r.parentCode
                ? `Aplicar BOM Nomus · ${r.parentCode}`
                : "Aplicar BOM Nomus";
              break;
            case "MASTER_DATA_HISTORY_BACKFILL":
              label = "Backfill de histórico";
              break;
            case "NOMUS_SYNC":
              label = "Auto apply BOM Nomus (batch)";
              break;
            default:
              label = r.parentCode ? `Sync engenharia · ${r.parentCode}` : "Sync engenharia";
          }
          return {
            id: r.id,
            mode: r.mode,
            status: r.status,
            origin,
            label,
            parentCode: r.parentCode,
            planHash: r.planHash,
            approvedBy: r.approvedBy,
            startedAt: r.startedAt?.toISOString() ?? null,
            finishedAt: r.finishedAt?.toISOString() ?? null,
            createdAt: r.createdAt.toISOString(),
            summary: summary,
          };
        });
        return res.json({
          mode: "READ_ONLY",
          generatedAt: new Date().toISOString(),
          items,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Erro ao listar runs recentes.";
        console.error("GET /api/nomus/engineering-runs/recent", error);
        return res.status(500).json({
          error: "ENGINEERING_RUNS_RECENT_FAILED",
          message,
        });
      }
    }
  );

  registerNomusAutoApplyBomDashboardRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  app.get(
    "/api/nomus/bom-auto-apply/products/apply-readiness",
    requireAppAuth,
    requireAnyPermission([
      "products.view",
      "products.tab.bom",
      "products.edit",
    ]),
    async (req, res) => {
      try {
        const parentCode = req.query.parentCode != null ? String(req.query.parentCode).trim() : "";
        if (!parentCode) {
          return res.status(400).json({ error: "parentCode é obrigatório." });
        }
        const result = await previewNomusBomApplyReadiness(parentCode);
        return res.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao verificar elegibilidade.";
        console.error("GET /api/nomus/bom-auto-apply/products/apply-readiness", error);
        return res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    "/api/nomus/bom-auto-apply/products/:parentCode/apply",
    requireAppAuth,
    requirePermission("products.edit"),
    async (req, res) => {
      try {
        const parentCode = String(req.params.parentCode ?? "").trim();
        if (!parentCode) {
          return res.status(400).json({ error: "parentCode é obrigatório." });
        }
        const approvedBy =
          req.appAuth?.email?.trim() ||
          req.appAuth?.id?.trim() ||
          req.appAuth?.name?.trim() ||
          "dashboard-user";
        const result = await applyNomusBomFromDashboard({ parentCode, approvedBy });
        const status =
          result.status === "applied"
            ? 200
            : result.status === "blocked"
              ? 422
              : result.status === "error"
                ? 500
                : 409;
        return res.status(status).json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao aplicar BOM.";
        console.error("POST /api/nomus/bom-auto-apply/products/:parentCode/apply", error);
        return res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    "/api/nomus/bom-auto-apply/products/apply-batch",
    requireAppAuth,
    requirePermission("products.edit"),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const raw = body.parentCodes ?? body.productIds ?? [];
        if (!Array.isArray(raw) || raw.length === 0) {
          return res.status(400).json({ error: "parentCodes é obrigatório (array não vazio)." });
        }
        const parentCodes = raw.map((c: unknown) => String(c).trim()).filter(Boolean);
        const approvedBy =
          req.appAuth?.email?.trim() ||
          req.appAuth?.id?.trim() ||
          req.appAuth?.name?.trim() ||
          "dashboard-user";
        const result = await applyNomusBomBatchFromDashboard({ parentCodes, approvedBy });
        return res.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao aplicar BOM em lote.";
        console.error("POST /api/nomus/bom-auto-apply/products/apply-batch", error);
        return res.status(500).json({ error: message });
      }
    }
  );

  app.get(
    "/api/products/:id/change-history",
    requireAppAuth,
    requireAnyPermission(["products.view", "products.edit", "products.tab.info"]),
    async (req, res) => {
      try {
        const productId = String(req.params.id ?? "").trim();
        if (!productId) {
          return res.status(400).json({
            error: "PRODUCT_ID_REQUIRED",
            message: "productId é obrigatório na URL.",
          });
        }
        const limitRaw = Number(req.query.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
        const offsetRaw = Number(req.query.offset);
        const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : undefined;

        const result = await loadProductChangeHistory({
          productId,
          limit,
          offset,
        });
        return res.json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Erro ao carregar histórico do produto.";
        console.error("GET /api/products/:id/change-history", error);
        return res.status(500).json({
          error: "PRODUCT_CHANGE_HISTORY_FAILED",
          message,
        });
      }
    }
  );

  app.get(
    "/api/nomus/engineering-sync/preview",
    requireAppAuth,
    requirePermission("products.view"),
    async (req, res) => {
      try {
        const scopeRaw = String(req.query.scope ?? "ONE_PRODUCT").trim();
        if (scopeRaw !== "ONE_PRODUCT" && scopeRaw !== "ALL_NOMUS_PRODUCTS") {
          return res.status(400).json({ error: "scope inválido." });
        }
        const parentCode = String(req.query.parentCode ?? "").trim() || undefined;
        const recursive = req.query.recursive === "true" || req.query.recursive === "1";
        const maxDepthRaw = Number(req.query.maxDepth);
        const maxDepth = Number.isFinite(maxDepthRaw) && maxDepthRaw > 0 ? maxDepthRaw : undefined;
        const plan = await buildNomusEngineeringReconciliationPlan({
          scope: scopeRaw,
          parentCode,
          recursive,
          maxDepth,
        });
        return res.json(plan);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Erro ao gerar plano de sincronização.";
        console.error("GET /api/nomus/engineering-sync/preview", error);
        return res.status(400).json({ error: message });
      }
    }
  );

  app.post(
    "/api/nomus/engineering-sync/apply",
    requireAppAuth,
    requirePermission("products.edit"),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const scopeRaw = String(body.scope ?? "ONE_PRODUCT").trim();
        if (scopeRaw !== "ONE_PRODUCT" && scopeRaw !== "ALL_NOMUS_PRODUCTS") {
          return res.status(400).json({ error: "scope inválido." });
        }
        const parentCode = body.parentCode ? String(body.parentCode).trim() : undefined;
        const planHash = String(body.planHash ?? "").trim();
        const confirmationText = String(body.confirmationText ?? "").trim();
        const approvedBy =
          body.approvedBy != null && String(body.approvedBy).trim()
            ? String(body.approvedBy).trim()
            : undefined;
        const recursive = body.recursive === true || body.recursive === "true";
        const maxDepthRaw = Number(body.maxDepth);
        const maxDepth = Number.isFinite(maxDepthRaw) && maxDepthRaw > 0 ? maxDepthRaw : undefined;

        if (!planHash || !confirmationText) {
          return res
            .status(400)
            .json({ error: "planHash e confirmationText são obrigatórios." });
        }

        const result = await applyNomusEngineeringSync({
          scope: scopeRaw,
          parentCode,
          recursive,
          maxDepth,
          planHash,
          confirmationText,
          approvedBy,
        });
        return res.json(result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Erro ao aplicar sincronização de engenharia.";
        console.error("POST /api/nomus/engineering-sync/apply", error);
        const status =
          message.includes("Plano desatualizado") || message.includes("Confirmação")
            ? 409
            : message.includes("bloqueada") || message.includes("gates") || message.includes("habilitado")
              ? 422
              : 400;
        return res.status(status).json({ error: message });
      }
    }
  );

  app.get(
    "/api/products/:id/engineering-change-log",
    requireAppAuth,
    requireAnyPermission(["products.view", "products.tab.bom"]),
    async (req, res) => {
      try {
        const productId = String(req.params.id);
        const limitRaw = Number(req.query.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 200;
        const entries = await listEngineeringChangeLog({ productId, limit });
        return res.json({ entries });
      } catch (error) {
        console.error("GET /api/products/:id/engineering-change-log", error);
        return res.status(500).json({
          error: error instanceof Error ? error.message : "Erro ao buscar histórico de alterações.",
        });
      }
    }
  );

  app.get("/api/products/:id/tree", requireAppAuth, requireAnyPermission(["products.tab.tree", "products.tab.bom", "products.edit"]), async (req, res) => {
    const { id } = req.params;
    const tree = await getFullBOMTree(id);
    if (!tree) return res.status(404).json({ error: "Produto não encontrado" });
    res.json(tree);
  });

  app.post("/api/products", requireAppAuth, requirePermission("products.create"), async (req, res) => {
    const { sku, name, description, type, version, defaultLotSize, bom, routing, cycleTimeSeconds, cavities, setupTimeMin, efficiencyExpected, costingMode } = req.body;

    const normalizedSku = sku?.toString().trim().toUpperCase();
    if (!normalizedSku) {
      return res.status(400).json({ error: "O SKU é obrigatório." });
    }

    try {
      const effectiveType = type || "PRODUCT";

      const existing = await prisma.product.findUnique({ where: { sku: normalizedSku } });
      if (existing) {
        return res.status(409).json({ error: "SKU já existe.", code: "SKU_ALREADY_EXISTS" });
      }

      if (effectiveType === "MATERIAL" && (bom || []).length > 0) {
        return res.status(400).json({ error: "Matérias-Primas não podem ter estrutura (BOM)." });
      }

      // Validações de BOM
      for (const item of bom || []) {
        const hasMat = Boolean(item.materialId);
        const hasChild = Boolean(item.childProductId);
        if (hasMat === hasChild) {
          return res.status(400).json({
            error: "Cada linha da BOM deve ter exatamente um vínculo: materialId OU childProductId.",
          });
        }
        if (hasMat) {
          const mat = await prisma.material.findUnique({ where: { id: item.materialId } });
          if (!mat) return res.status(400).json({ error: "Matéria-prima não encontrada na linha da BOM." });
        } else {
          const child = await prisma.product.findUnique({ where: { id: item.childProductId } });
          if (!child) return res.status(400).json({ error: "Produto/componente filho não encontrado na linha da BOM." });
          if (child.type !== "PRODUCT" && child.type !== "COMPONENT") {
            return res.status(400).json({
              error: "Filho de BOM via childProductId deve ser do tipo PRODUCT ou COMPONENT.",
            });
          }
        }
      }

      if (effectiveType === "MATERIAL" && (routing || []).length > 0) {
        return res.status(400).json({ error: "Matérias-Primas não possuem roteiro de produção." });
      }

      // Sanitização dos campos do Processo Padrão (null-safe, NaN-safe)
      const safeCycle = cycleTimeSeconds   == null || cycleTimeSeconds   === "" ? null : Number(cycleTimeSeconds);
      const safeCav   = cavities           == null || cavities           === "" ? null : Number(cavities);
      const safeSetup = setupTimeMin       == null || setupTimeMin       === "" ? null : Number(setupTimeMin);
      const safeEff   = efficiencyExpected == null || efficiencyExpected === "" ? null : Number(efficiencyExpected);

      const hasProcessoField = safeCycle !== null || safeCav !== null || safeSetup !== null || safeEff !== null;

      // Processo Padrão só é permitido em COMPONENT
      if (hasProcessoField && effectiveType !== "COMPONENT")
        return res.status(400).json({ error: "Processo Padrão (cycleTimeSeconds/cavities/setupTimeMin/efficiencyExpected) só é permitido para itens do tipo COMPONENT." });

      // Regra tudo-ou-nada: se ANY campo vier, TODOS os 4 são obrigatórios e válidos
      if (hasProcessoField && effectiveType === "COMPONENT") {
        if (safeCycle === null || !Number.isFinite(safeCycle) || safeCycle <= 0)
          return res.status(400).json({ error: "Processo Padrão: cycleTimeSeconds é obrigatório e deve ser > 0." });
        if (safeCav === null || !Number.isFinite(safeCav) || safeCav < 1)
          return res.status(400).json({ error: "Processo Padrão: cavities é obrigatório e deve ser >= 1." });
        if (safeSetup === null || !Number.isFinite(safeSetup) || safeSetup < 0)
          return res.status(400).json({ error: "Processo Padrão: setupTimeMin é obrigatório e deve ser >= 0." });
        if (safeEff === null || !Number.isFinite(safeEff) || safeEff <= 0 || safeEff > 100)
          return res.status(400).json({ error: "Processo Padrão: efficiencyExpected é obrigatório e deve ser > 0 e <= 100." });
      }

      const validCostingModes = ["OWN_PROCESS", "BOM_ONLY", "FINISHING_SERVICE"] as const;
      const safeCostingMode =
        typeof costingMode === "string" &&
        (validCostingModes as readonly string[]).includes(costingMode)
          ? (costingMode as (typeof validCostingModes)[number])
          : "OWN_PROCESS";

      const product = await prisma.product.create({
        data: {
          sku: normalizedSku,
          name,
          description,
          type: effectiveType,
          version,
          defaultLotSize,
          cycleTimeSeconds: safeCycle,
          cavities: safeCav,
          setupTimeMin: safeSetup,
          efficiencyExpected: safeEff,
          costingMode: safeCostingMode,
          ProductBOM: {
            create: (bom || []).map((item: any) => ({
              materialId: item.materialId,
              childProductId: item.childProductId,
              quantity: item.quantity,
              lossPercentage: item.lossPercentage,
              notes: item.notes,
            }))
          },
          ProductRouting: {
            create: (routing || []).map((step: any) => ({
              sequence: step.sequence,
              description: step.description,
              machineId: step.machineId,
              roleId: step.roleId,
              setupTimeMin: step.setupTimeMin,
              operationTimeMin: step.operationTimeMin,
              efficiencyExpected: step.efficiencyExpected,
              cycleTimeSeconds: step.cycleTimeSeconds,
              cavities: step.cavities,
              notes: step.notes,
            }))
          }
        },
        include: { ProductBOM: true, ProductRouting: true }
      });
      res.json(product);
    } catch (error) {
      console.error("Product creation error:", error);
      res.status(500).json({ error: "Erro ao criar produto." });
    }
  });

  app.put("/api/products/:id", requireAppAuth, requirePermission("products.edit"), async (req, res) => {
    const { id } = req.params;
    const { sku, name, description, type, version, defaultLotSize, bom, routing, cycleTimeSeconds, cavities, setupTimeMin, efficiencyExpected, costingMode } = req.body;
    const normalizedSku = sku?.toString().trim().toUpperCase();

    try {
      // effectiveType: usa o tipo do banco se o payload não trouxer type
      const currentProduct = await prisma.product.findUnique({
        where: { id },
        select: { type: true, cycleTimeSeconds: true, cavities: true, setupTimeMin: true, efficiencyExpected: true }
      });
      if (!currentProduct) return res.status(404).json({ error: "Produto não encontrado." });

      // Validação explícita de `type` ANTES do Prisma — evita 500 genérico
      // "Erro ao atualizar produto." quando o frontend envia "MATERIAL".
      // MATERIAL não é update direto: passa pelo fluxo de reclassificação
      // (POST /api/products/:id/reclassify).
      if (type !== undefined && type !== null) {
        if (type === "MATERIAL") {
          return res.status(409).json({
            error: "PRODUCT_TYPE_RECLASSIFICATION_REQUIRED",
            code: "PRODUCT_TYPE_RECLASSIFICATION_REQUIRED",
            message:
              "Converter um Produto/Componente em Material exige análise de impacto. Use o fluxo de reclassificação (modal Reclassificar Item) em vez de salvar diretamente.",
            targetKind: "MATERIAL",
          });
        }
        if (type !== "PRODUCT" && type !== "COMPONENT") {
          return res.status(400).json({
            error: "INVALID_PRODUCT_TYPE",
            code: "INVALID_PRODUCT_TYPE",
            message: `Tipo de produto inválido: ${String(type)}. Use PRODUCT ou COMPONENT.`,
          });
        }
        if (type !== currentProduct.type) {
          return res.status(409).json({
            error: "PRODUCT_TYPE_RECLASSIFICATION_REQUIRED",
            code: "PRODUCT_TYPE_RECLASSIFICATION_REQUIRED",
            message:
              "A troca de tipo (Produto ⇄ Componente) exige análise de impacto. Use o fluxo de reclassificação (modal Reclassificar Item) em vez de salvar diretamente.",
            targetKind: type,
            currentKind: currentProduct.type,
          });
        }
      }
      const effectiveType = type ?? currentProduct.type;

      if (normalizedSku) {
        const existing = await prisma.product.findFirst({
          where: { sku: normalizedSku, id: { not: id } }
        });
        if (existing) return res.status(409).json({ error: "SKU já existe." });
      }

      if (effectiveType === "MATERIAL" && (bom || []).length > 0) {
        return res.status(400).json({ error: "Matérias-Primas não podem ter estrutura (BOM)." });
      }

      for (const item of bom || []) {
        const hasMat = Boolean(item.materialId);
        const hasChild = Boolean(item.childProductId);
        if (hasMat === hasChild) {
          return res.status(400).json({
            error: "Cada linha da BOM deve ter exatamente um vínculo: materialId OU childProductId.",
          });
        }
        if (hasMat) {
          const mat = await prisma.material.findUnique({ where: { id: item.materialId } });
          if (!mat) return res.status(400).json({ error: "Matéria-prima não encontrada na linha da BOM." });
        } else {
          if (item.childProductId === id) {
            return res.status(400).json({ error: "A BOM não pode referenciar o próprio produto como filho." });
          }
          if (await checkBOMCycle(id, item.childProductId)) {
            return res.status(400).json({ error: "Ciclo detectado!" });
          }
          const child = await prisma.product.findUnique({ where: { id: item.childProductId } });
          if (!child) return res.status(400).json({ error: "Produto/componente filho não encontrado na linha da BOM." });
          if (child.type !== "PRODUCT" && child.type !== "COMPONENT") {
            return res.status(400).json({
              error: "Filho de BOM via childProductId deve ser do tipo PRODUCT ou COMPONENT.",
            });
          }
        }
      }

      if (effectiveType === "MATERIAL" && (routing || []).length > 0)
        return res.status(400).json({ error: "Matérias-Primas não possuem roteiro de produção." });

      // Detectar presença EXPLÍCITA de cada campo no payload (chave ausente ≠ null)
      const body = req.body;
      const cycleInPayload = Object.prototype.hasOwnProperty.call(body, "cycleTimeSeconds");
      const cavInPayload   = Object.prototype.hasOwnProperty.call(body, "cavities");
      const setupInPayload = Object.prototype.hasOwnProperty.call(body, "setupTimeMin");
      const effInPayload   = Object.prototype.hasOwnProperty.call(body, "efficiencyExpected");

      // Sanitizar apenas os campos que vieram explicitamente no payload
      const safeCycle = cycleInPayload ? (cycleTimeSeconds == null || cycleTimeSeconds === "" ? null : Number(cycleTimeSeconds)) : undefined;
      const safeCav   = cavInPayload   ? (cavities         == null || cavities         === "" ? null : Number(cavities))         : undefined;
      const safeSetup = setupInPayload ? (setupTimeMin     == null || setupTimeMin     === "" ? null : Number(setupTimeMin))     : undefined;
      const safeEff   = effInPayload   ? (efficiencyExpected == null || efficiencyExpected === "" ? null : Number(efficiencyExpected)) : undefined;

      // Valores resolvidos: payload tem precedência; ausente no payload → preserva do banco
      const resolvedCycle = safeCycle !== undefined ? safeCycle : (currentProduct.cycleTimeSeconds !== null ? Number(currentProduct.cycleTimeSeconds) : null);
      const resolvedCav   = safeCav   !== undefined ? safeCav   : (currentProduct.cavities           !== null ? Number(currentProduct.cavities)           : null);
      const resolvedSetup = safeSetup !== undefined ? safeSetup : (currentProduct.setupTimeMin       !== null ? Number(currentProduct.setupTimeMin)       : null);
      const resolvedEff   = safeEff   !== undefined ? safeEff   : (currentProduct.efficiencyExpected !== null ? Number(currentProduct.efficiencyExpected) : null);

      const hasProcessoField = resolvedCycle !== null || resolvedCav !== null || resolvedSetup !== null || resolvedEff !== null;

      // Processo Padrão só é permitido em COMPONENT
      if (hasProcessoField && effectiveType !== "COMPONENT")
        return res.status(400).json({ error: "Processo Padrão (cycleTimeSeconds/cavities/setupTimeMin/efficiencyExpected) só é permitido para itens do tipo COMPONENT." });

      // Regra tudo-ou-nada aplicada sobre os valores resolvidos
      if (hasProcessoField && effectiveType === "COMPONENT") {
        if (resolvedCycle === null || !Number.isFinite(resolvedCycle) || resolvedCycle <= 0)
          return res.status(400).json({ error: "Processo Padrão: cycleTimeSeconds é obrigatório e deve ser > 0." });
        if (resolvedCav === null || !Number.isFinite(resolvedCav) || resolvedCav < 1)
          return res.status(400).json({ error: "Processo Padrão: cavities é obrigatório e deve ser >= 1." });
        if (resolvedSetup === null || !Number.isFinite(resolvedSetup) || resolvedSetup < 0)
          return res.status(400).json({ error: "Processo Padrão: setupTimeMin é obrigatório e deve ser >= 0." });
        if (resolvedEff === null || !Number.isFinite(resolvedEff) || resolvedEff <= 0 || resolvedEff > 100)
          return res.status(400).json({ error: "Processo Padrão: efficiencyExpected é obrigatório e deve ser > 0 e <= 100." });
      }

      const validCostingModes = ["OWN_PROCESS", "BOM_ONLY", "FINISHING_SERVICE"] as const;
      const costingModeInPayload = Object.prototype.hasOwnProperty.call(body, "costingMode");
      const safeCostingMode =
        costingModeInPayload &&
        typeof costingMode === "string" &&
        (validCostingModes as readonly string[]).includes(costingMode)
          ? (costingMode as (typeof validCostingModes)[number])
          : undefined;

      const product = await prisma.$transaction(async (tx) => {
        await tx.productBOM.deleteMany({ where: { productId: id } });
        await tx.productRouting.deleteMany({ where: { productId: id } });
        return await tx.product.update({
          where: { id },
          data: {
            sku: normalizedSku || sku,
            name,
            description,
            type: effectiveType,
            version,
            defaultLotSize,
            cycleTimeSeconds: resolvedCycle,
            cavities: resolvedCav,
            setupTimeMin: resolvedSetup,
            efficiencyExpected: resolvedEff,
            ...(safeCostingMode !== undefined ? { costingMode: safeCostingMode } : {}),
            ProductBOM: {
              create: (bom || []).map((item: any) => ({
                materialId: item.materialId,
                childProductId: item.childProductId,
                quantity: item.quantity,
                lossPercentage: item.lossPercentage,
                notes: item.notes,
              }))
            },
            ProductRouting: {
              create: (routing || []).map((step: any) => ({
                sequence: step.sequence,
                description: step.description,
                machineId: step.machineId,
                roleId: step.roleId,
                setupTimeMin: step.setupTimeMin,
                operationTimeMin: step.operationTimeMin,
                efficiencyExpected: step.efficiencyExpected,
                cycleTimeSeconds: step.cycleTimeSeconds,
                cavities: step.cavities,
                notes: step.notes,
              }))
            }
          },
          include: { ProductBOM: true, ProductRouting: true }
        });
      });
      res.json(product);
    } catch (error) {
      console.error("Product update error:", error);
      // Erros conhecidos do Prisma viram 409/400 com detalhe; o resto cai em 500
      // mas com a mensagem real do erro (não mais "Erro ao atualizar produto." cego).
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          return res.status(409).json({
            error: "UNIQUE_CONSTRAINT_VIOLATION",
            code: "UNIQUE_CONSTRAINT_VIOLATION",
            message: "Conflito de unicidade ao atualizar o produto (provavelmente SKU duplicado).",
            meta: error.meta,
          });
        }
        if (error.code === "P2025") {
          return res
            .status(404)
            .json({ error: "PRODUCT_NOT_FOUND", code: "PRODUCT_NOT_FOUND", message: "Produto não encontrado." });
        }
      }
      const detail = error instanceof Error ? error.message : "Erro desconhecido.";
      res.status(500).json({
        error: "PRODUCT_UPDATE_FAILED",
        code: "PRODUCT_UPDATE_FAILED",
        message: `Não foi possível atualizar o produto. ${detail}`,
      });
    }
  });

  /* ------------------------------------------------------------------ *
   * Item reclassification — Fase INDUSCOST-ITEM-RECLASSIFICATION-WORKFLOW-A
   *
   * GET  /api/products/:id/reclassification-impact?targetKind=...
   *   Análise read-only do impacto de reclassificar um Product.
   *
   * POST /api/products/:id/reclassify
   *   Aplica o plano com confirmação textual obrigatória, transacional.
   *
   * GET  /api/materials/:id/reclassification-impact?targetKind=...
   *   Análise read-only para Material. Caminho atual sempre BLOCKED nesta
   *   fase (apenas orienta o usuário a usar o caminho manual).
   * ------------------------------------------------------------------ */

  function parseTargetKind(raw: unknown): ItemReclassificationKind | null {
    if (raw !== "PRODUCT" && raw !== "COMPONENT" && raw !== "MATERIAL") return null;
    return raw as ItemReclassificationKind;
  }

  app.get(
    "/api/products/:id/reclassification-impact",
    requireAppAuth,
    requirePermission("products.edit"),
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) {
          return res
            .status(400)
            .json({ error: "INVALID_PRODUCT_ID", message: "ID de produto inválido." });
        }
        const targetKind = parseTargetKind(req.query.targetKind);
        if (!targetKind) {
          return res.status(400).json({
            error: "INVALID_TARGET_KIND",
            message: "targetKind deve ser PRODUCT, COMPONENT ou MATERIAL.",
          });
        }
        const impact = await buildReclassificationImpactForProduct(id, targetKind);
        if (!impact) {
          return res
            .status(404)
            .json({ error: "PRODUCT_NOT_FOUND", message: "Produto não encontrado." });
        }
        return res.json(impact);
      } catch (error) {
        console.error("GET /api/products/:id/reclassification-impact", error);
        return res.status(500).json({
          error: "RECLASSIFICATION_IMPACT_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Erro ao montar análise de impacto.",
        });
      }
    }
  );

  app.get(
    "/api/materials/:id/reclassification-impact",
    requireAppAuth,
    requireAnyPermission(["products.edit", "materials.edit"]),
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) {
          return res
            .status(400)
            .json({ error: "INVALID_MATERIAL_ID", message: "ID de material inválido." });
        }
        const targetKind = parseTargetKind(req.query.targetKind);
        if (!targetKind) {
          return res.status(400).json({
            error: "INVALID_TARGET_KIND",
            message: "targetKind deve ser PRODUCT, COMPONENT ou MATERIAL.",
          });
        }
        const impact = await buildReclassificationImpactForMaterial(id, targetKind);
        if (!impact) {
          return res
            .status(404)
            .json({ error: "MATERIAL_NOT_FOUND", message: "Material não encontrado." });
        }
        return res.json(impact);
      } catch (error) {
        console.error("GET /api/materials/:id/reclassification-impact", error);
        return res.status(500).json({
          error: "RECLASSIFICATION_IMPACT_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Erro ao montar análise de impacto.",
        });
      }
    }
  );

  app.post(
    "/api/products/:id/reclassify",
    requireAppAuth,
    requirePermission("products.edit"),
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) {
          return res
            .status(400)
            .json({ error: "INVALID_PRODUCT_ID", message: "ID de produto inválido." });
        }
        const body = req.body ?? {};
        const targetKind = parseTargetKind(body.targetKind);
        if (!targetKind) {
          return res.status(400).json({
            error: "INVALID_TARGET_KIND",
            code: "INVALID_TARGET_KIND",
            message: "targetKind deve ser PRODUCT, COMPONENT ou MATERIAL.",
          });
        }
        const confirmationText =
          typeof body.confirmationText === "string" ? body.confirmationText : "";
        const extraConfirmationText =
          typeof body.extraConfirmationText === "string"
            ? body.extraConfirmationText
            : null;

        const result = await executeItemReclassification({
          sourceProductId: id,
          targetKind,
          confirmationText,
          extraConfirmationText,
          changedBy: req.appAuth?.id ?? req.appAuth?.email ?? null,
        });

        if (result.ok === false) {
          // 409 para bloqueios/confirmação inválida; 400 para inputs inválidos.
          const status =
            result.code === "RECLASSIFICATION_BLOCKED" ||
            result.code === "TARGET_IDENTIFIER_CONFLICT"
              ? 409
              : result.code === "SOURCE_NOT_FOUND"
              ? 404
              : 400;
          return res.status(status).json(result);
        }
        return res.json(result);
      } catch (error) {
        console.error("POST /api/products/:id/reclassify", error);
        return res.status(500).json({
          ok: false,
          error: "INTERNAL_ERROR",
          code: "INTERNAL_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Erro inesperado ao reclassificar o item.",
        });
      }
    }
  );

  app.delete("/api/products/:id", requireAppAuth, requirePermission("products.delete"), async (req, res) => {
    const { id } = req.params;

    try {
      const product = await prisma.product.findUnique({
        where: { id },
        include: {
          UsedInBOM: {
            include: {
              ParentProduct: true
            }
          },
          ProposalItem: {
            include: {
              Proposal: true
            }
          }
        }
      });

      if (!product) {
        return res.status(404).json({ error: "Produto não encontrado." });
      }

      // Check if used in other BOMs
      if (product.UsedInBOM.length > 0) {
        const parentNames = product.UsedInBOM.map(b => b.ParentProduct.name).join(", ");
        return res.status(409).json({ 
          error: `Não é possível excluir este item pois ele é utilizado na estrutura de: ${parentNames}.` 
        });
      }

      // Check if used in Proposals
      if (product.ProposalItem.length > 0) {
        return res.status(409).json({ 
          error: "Não é possível excluir este item pois ele já possui histórico em propostas comerciais." 
        });
      }

      // Transactional delete of dependencies and product
      await prisma.$transaction([
        prisma.productPricing.deleteMany({ where: { productId: id } }),
        prisma.costCalculationLog.deleteMany({ where: { productId: id } }),
        prisma.product.delete({ where: { id } })
      ]);

      res.json({ success: true });
    } catch (error) {
      console.error("Erro ao excluir produto:", error);
      res.status(500).json({ error: "Erro interno ao excluir o produto." });
    }
  });

  app.post("/api/products/bulk-delete", requireAppAuth, requirePermission("products.delete"), async (req, res) => {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Lista de IDs inválida." });
    }

    const results = {
      total: ids.length,
      deleted: 0,
      blocked: 0,
      details: [] as any[]
    };

    try {
      for (const id of ids) {
        const product = await prisma.product.findUnique({
          where: { id },
          include: {
            UsedInBOM: { include: { ParentProduct: true } },
            ProposalItem: { include: { Proposal: true } }
          }
        });

        if (!product) {
          results.blocked++;
          results.details.push({ id, name: "Desconhecido", status: "blocked", reason: "Produto não encontrado." });
          continue;
        }

        if (product.UsedInBOM.length > 0) {
          const parentNames = product.UsedInBOM.map(b => b.ParentProduct.name).join(", ");
          results.blocked++;
          results.details.push({ 
            id, 
            name: product.name, 
            status: "blocked", 
            reason: `Utilizado na estrutura de: ${parentNames}.` 
          });
          continue;
        }

        if (product.ProposalItem.length > 0) {
          results.blocked++;
          results.details.push({ 
            id, 
            name: product.name, 
            status: "blocked", 
            reason: "Possui histórico em propostas comerciais." 
          });
          continue;
        }

        try {
          await prisma.$transaction([
            prisma.productPricing.deleteMany({ where: { productId: id } }),
            prisma.costCalculationLog.deleteMany({ where: { productId: id } }),
            prisma.product.delete({ where: { id } })
          ]);
          results.deleted++;
          results.details.push({ id, name: product.name, status: "deleted" });
        } catch (err) {
          results.blocked++;
          results.details.push({ id, name: product.name, status: "blocked", reason: "Erro interno ao excluir." });
        }
      }

      res.json({ success: true, ...results });
    } catch (error) {
      console.error("Bulk delete error:", error);
      res.status(500).json({ error: "Erro ao processar exclusão em massa." });
    }
  });

  // --- API: Indirect Costs (OPEX) ---
  app.get("/api/indirect-costs", requireAppAuth, requirePermission("opex.view"), async (req, res) => {
    const costs = await prisma.indirectCost.findMany({
      orderBy: { category: "asc" },
    });
    res.json(costs);
  });

  app.post("/api/indirect-costs", requireAppAuth, requirePermission("opex.edit"), requireBootstrapForGlobalParamMutation, async (req, res) => {
    const { description, category, monthlyValue, costCenter, allocationCriteria } = req.body;
    const cost = await prisma.indirectCost.create({
      data: { description, category, monthlyValue, costCenter, allocationCriteria }
    });
    res.json(cost);
  });

  app.put("/api/indirect-costs/:id", requireAppAuth, requirePermission("opex.edit"), requireBootstrapForGlobalParamMutation, async (req, res) => {
    const { id } = req.params;
    const { description, category, monthlyValue, costCenter, allocationCriteria, status } = req.body;
    const cost = await prisma.indirectCost.update({
      where: { id },
      data: { description, category, monthlyValue, costCenter, allocationCriteria, status }
    });
    res.json(cost);
  });

  app.delete("/api/indirect-costs/:id", requireAppAuth, requirePermission("opex.edit"), requireBootstrapForGlobalParamMutation, async (req, res) => {
    try {
      const { id } = req.params;
      
      const target = await prisma.indirectCost.findUnique({ where: { id } });
      if (target?.category === "GLOBAL_PARAM") {
        return res.status(400).json({ error: "PROTECTED_PARAM", message: "Este registro é um parâmetro global do sistema e não pode ser excluído por esta tela." });
      }
      
      await prisma.indirectCost.delete({ where: { id } });
      res.json({ success: true });
    } catch (err) {
      console.error("Erro ao deletar custo indireto:", err);
      res.status(500).json({ error: "Erro ao excluir custo indireto." });
    }
  });

  // --- API: Tabelas de preço comerciais (somente leitura; Fase 1) ---
  app.get("/api/price-tables", requireAppAuth, requireAnyPermission(["settings.price_tables.view", "pricing.view", "settings.view"]), async (_req, res) => {
    try {
      const tables = await prisma.priceTable.findMany({
        orderBy: { code: "asc" },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            select: {
              id: true,
              priceTableId: true,
              taxRuleId: true,
              versionNumber: true,
              status: true,
              generatedAt: true,
              publishedAt: true,
              effectiveFrom: true,
              effectiveTo: true,
              notes: true,
              createdBy: true,
              approvedBy: true,
              generationSummaryJson: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });

      const payload = tables.map((t) => {
        const published = t.versions.filter((v) => v.status === "PUBLISHED");
        const drafts = t.versions.filter((v) => v.status === "DRAFT");
        const latestPublished =
          published.length === 0
            ? null
            : published.reduce((a, b) => (a.versionNumber >= b.versionNumber ? a : b));
        const latestDraft =
          drafts.length === 0 ? null : drafts.reduce((a, b) => (a.versionNumber >= b.versionNumber ? a : b));

        const { versions: _v, ...rest } = t;
        return {
          ...rest,
          defaultMarginPct: Number(rest.defaultMarginPct),
          latestPublishedVersion: latestPublished,
          latestDraftVersion: latestDraft,
        };
      });

      res.json(payload);
    } catch (e) {
      console.error("GET /api/price-tables", e);
      res.status(500).json({ error: "Erro ao listar tabelas de preço." });
    }
  });

  app.post("/api/price-tables/:priceTableId/versions/generate-draft", requireAppAuth, requireAnyPermission(["pricing.generate_tables", "settings.price_tables.manage"]), async (req, res) => {
    const { priceTableId } = req.params;
    const body = (req.body ?? {}) as {
      taxRuleId?: unknown;
      includeAllActiveProducts?: unknown;
      productIds?: unknown;
      notes?: unknown;
      commissionPerc?: unknown;
    };

    const taxRuleId = typeof body.taxRuleId === "string" && body.taxRuleId.trim() ? body.taxRuleId.trim() : null;
    const includeAllActiveProducts = body.includeAllActiveProducts === true;
    const productIds = Array.isArray(body.productIds)
      ? body.productIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

    // Comissão de vendedor opcional informada na geração da tabela.
    // - Se vier (qualquer número finito >= 0 e <= 50), sobrepõe ProductPricing.commission para TODOS os produtos.
    // - Se NÃO vier (undefined/null/""), comportamento atual: usa ProductPricing.commission por produto.
    let hasCommissionOverride = false;
    let generationCommissionPerc: number | null = null;
    const rawCommission = body.commissionPerc;
    if (rawCommission !== undefined && rawCommission !== null && rawCommission !== "") {
      const parsed = typeof rawCommission === "number" ? rawCommission : Number(rawCommission);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 50) {
        return res.status(400).json({ error: "Comissão do vendedor deve estar entre 0% e 50%." });
      }
      hasCommissionOverride = true;
      generationCommissionPerc = parsed;
    }

    try {
      const table = await prisma.priceTable.findUnique({ where: { id: priceTableId } });
      if (!table) return res.status(404).json({ error: "Tabela de preço não encontrada." });
      if (table.status !== "ACTIVE") {
        return res.status(400).json({ error: "Apenas tabelas de preço ativas podem gerar versão DRAFT." });
      }

      let validatedTaxRule:
        | (Awaited<ReturnType<typeof prisma.taxRule.findUnique>> & { TaxComponent: Array<{ percentage: Prisma.Decimal }> })
        | null = null;
      if (taxRuleId) {
        const taxRule = await prisma.taxRule.findUnique({
          where: { id: taxRuleId },
          include: { TaxComponent: { select: { percentage: true } } },
        });
        if (!taxRule) return res.status(404).json({ error: "TaxRule não encontrada." });
        validatedTaxRule = taxRule;
      }

      const selectedProducts = await prisma.product.findMany({
        where: {
          status: "ACTIVE",
          type: "PRODUCT",
          ...(productIds.length > 0
            ? { id: { in: productIds } }
            : includeAllActiveProducts
              ? {}
              : { id: { in: [] } }),
        },
        select: { id: true, sku: true, name: true },
        orderBy: { sku: "asc" },
      });
      if (selectedProducts.length === 0) {
        return res.status(400).json({ error: "Nenhum produto ativo selecionado para geração da versão." });
      }

      const version = await prisma.$transaction(async (tx) => {
        const maxVersion = await tx.priceTableVersion.findFirst({
          where: { priceTableId },
          orderBy: { versionNumber: "desc" },
          select: { versionNumber: true },
        });
        return tx.priceTableVersion.create({
          data: {
            priceTableId,
            taxRuleId,
            versionNumber: Number(maxVersion?.versionNumber ?? 0) + 1,
            status: "DRAFT",
            generatedAt: new Date(),
            notes,
            commissionPerc: hasCommissionOverride ? generationCommissionPerc : null,
          },
        });
      });

      const defaultMarginPct = Number(table.defaultMarginPct);
      const marginRate = defaultMarginPct / 100;
      const fixedTaxRate = validatedTaxRule
        ? validatedTaxRule.TaxComponent.reduce((acc, c) => acc + Number(c.percentage), 0) / 100
        : null;

      const cache = await initAnalysisCache();
      const summary: {
        productsRead: number;
        itemsCreated: number;
        itemsSkipped: number;
        errors: Array<Record<string, unknown>>;
        warnings: Array<Record<string, unknown>>;
        commissionOverridePerc: number | null;
      } = {
        productsRead: selectedProducts.length,
        itemsCreated: 0,
        itemsSkipped: 0,
        errors: [],
        warnings: [],
        commissionOverridePerc: hasCommissionOverride ? generationCommissionPerc : null,
      };

      for (const product of selectedProducts) {
        try {
          const costData = await getProductCostAnalysis(product.id, cache, true);
          if (!costData) {
            summary.itemsSkipped += 1;
            summary.errors.push({
              code: "PRODUCT_NOT_FOUND",
              productId: product.id,
              sku: product.sku,
              productName: product.name,
              message: "Produto não encontrado para análise de custo.",
            });
            continue;
          }
          if (isCostAnalysisFailure(costData)) {
            summary.itemsSkipped += 1;
            summary.errors.push({
              code: String((costData as { error?: string }).error ?? "COST_ANALYSIS_ERROR"),
              productId: product.id,
              sku: product.sku,
              productName: product.name,
              message: String((costData as { message?: string }).message ?? "Erro na análise de custo."),
            });
            continue;
          }

          const excludedBomLines = Array.isArray((costData as any).excludedBomLines)
            ? ((costData as any).excludedBomLines as Array<Record<string, unknown>>)
            : [];
          const costWarnings = Array.isArray((costData as any).warnings)
            ? ((costData as any).warnings as Array<Record<string, unknown>>)
            : [];
          const isPartialCost = Boolean((costData as any).costAnalysisPartial) || excludedBomLines.length > 0;
          if (isPartialCost) {
            summary.warnings.push({
              code: "PARTIAL_COST_ANALYSIS",
              productId: product.id,
              sku: product.sku,
              productName: product.name,
              excludedBomLinesCount: excludedBomLines.length,
              excludedBomLinesPreview: excludedBomLines.slice(0, 10).map((line) => ({
                sku: line.sku ?? line.childSku ?? null,
                name: line.name ?? line.childName ?? null,
                errorCode: line.errorCode ?? line.code ?? null,
                message: line.message ?? null,
              })),
              message: "Produto gerado com custo parcial. Existem componentes excluídos do cálculo.",
            });
          }
          if (costWarnings.length > 0) {
            summary.warnings.push({
              code: "COST_ANALYSIS_WARNINGS",
              productId: product.id,
              sku: product.sku,
              productName: product.name,
              warningsCount: costWarnings.length,
              warningsPreview: costWarnings.slice(0, 10).map((w) => ({
                code: w.code ?? null,
                severity: w.severity ?? null,
                message: w.message ?? null,
              })),
              message: "Produto com warnings internos no motor de custo.",
            });
          }

          const custoFabril = extractOfficialProductFinalUnitCost(costData);
          if (custoFabril == null || custoFabril <= 0) {
            summary.itemsSkipped += 1;
            summary.errors.push({
              code: "NO_COST_AVAILABLE",
              productId: product.id,
              sku: product.sku,
              productName: product.name,
              frozenTotalCost: custoFabril,
              salePrice: null,
              message:
                "Produto sem custo calculável (> 0). PriceTableItem não foi criado para evitar preço comercial inválido.",
            });
            continue;
          }

          const productPricing = taxRuleId
            ? await prisma.productPricing.findUnique({
                where: { productId_taxRuleId: { productId: product.id, taxRuleId } },
              })
            : await prisma.productPricing.findFirst({
                where: { productId: product.id },
                include: { TaxRule: { include: { TaxComponent: true } } },
                orderBy: { createdAt: "desc" },
              });
          const productPricingAny = productPricing as any;

          const taxRate = fixedTaxRate ?? (
            productPricingAny?.TaxRule?.TaxComponent
              ? productPricingAny.TaxRule.TaxComponent.reduce((acc: number, c: any) => acc + Number(c.percentage), 0) / 100
              : 0
          );
          // Quando a geração veio com commissionPerc no body, sobrepõe ProductPricing.commission para todos os produtos.
          const commRate = hasCommissionOverride
            ? Number(generationCommissionPerc) / 100
            : Number(productPricingAny?.commission ?? 0) / 100;
          const otherRate = Number(productPricingAny?.otherVariables ?? 0) / 100;
          const freight = Number(productPricingAny?.freightOut ?? 0);

          if (!productPricing) {
            summary.warnings.push({
              productId: product.id,
              sku: product.sku,
              productName: product.name,
              message:
                "Produto sem premissa em ProductPricing. Comissão/outros/frete/taxa fiscal não informada foram assumidos como zero.",
            });
          }

          const divisor = 1 - taxRate - commRate - otherRate - marginRate;
          if (divisor <= 0) {
            summary.itemsSkipped += 1;
            summary.errors.push({
              code: "INVALID_PRICING_DIVISOR",
              productId: product.id,
              sku: product.sku,
              productName: product.name,
              divisor,
              rates: {
                taxRate,
                commRate,
                otherRate,
                marginRate,
              },
              message: "Soma de impostos/comissão/outros/margem maior ou igual a 100%.",
            });
            continue;
          }

          const salePrice = (custoFabril + freight) / divisor;
          if (!Number.isFinite(salePrice) || salePrice <= 0) {
            summary.itemsSkipped += 1;
            summary.errors.push({
              code: "INVALID_PRICE_RESULT",
              productId: product.id,
              sku: product.sku,
              productName: product.name,
              frozenTotalCost: custoFabril,
              salePrice: Number.isFinite(salePrice) ? salePrice : null,
              message:
                "Preço calculado inválido (<= 0). PriceTableItem não foi criado para evitar snapshot comercial inconsistente.",
            });
            continue;
          }

          const frozenTaxCost = salePrice * taxRate;
          const totalCommission = salePrice * commRate;
          const totalOther = salePrice * otherRate;
          const frozenOtherCost = totalCommission + totalOther + freight;

          await prisma.priceTableItem.create({
            data: {
              priceTableVersionId: version.id,
              productId: product.id,
              sku: product.sku,
              productName: product.name,
              frozenTotalCost: custoFabril,
              frozenMaterialCost: Number((costData as { totalMaterialCost?: unknown }).totalMaterialCost ?? 0),
              frozenHhCost: Number((costData as { totalHH_Unit?: unknown }).totalHH_Unit ?? 0),
              frozenHmCost: Number((costData as { totalHM_Unit?: unknown }).totalHM_Unit ?? 0),
              frozenTaxCost,
              frozenOtherCost,
              marginPct: defaultMarginPct,
              salePrice,
              commissionPerc: commRate * 100,
              commissionValue: totalCommission,
              costSnapshotJson: costData as Prisma.InputJsonValue,
              formulaSnapshotJson: {
                priceTableId,
                priceTableVersionId: version.id,
                taxRuleId: taxRuleId ?? (productPricingAny?.taxRuleId ?? null),
                marginPct: defaultMarginPct,
                rates: {
                  taxRate,
                  commissionRate: commRate,
                  otherRate,
                },
                freight,
                divisor,
                outputs: {
                  frozenTotalCost: custoFabril,
                  frozenTaxCost,
                  frozenOtherCost,
                  salePrice,
                },
              } as Prisma.InputJsonValue,
            },
          });
          summary.itemsCreated += 1;
        } catch (e) {
          summary.itemsSkipped += 1;
          summary.errors.push({
            code: "UNEXPECTED_ERROR",
            productId: product.id,
            sku: product.sku,
            productName: product.name,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const updatedVersion = await prisma.priceTableVersion.update({
        where: { id: version.id },
        data: { generationSummaryJson: summary as Prisma.InputJsonValue },
        include: { PriceTable: true, TaxRule: true },
      });

      const persistedSummary = (updatedVersion.generationSummaryJson ?? summary) as Prisma.JsonValue;
      return res.status(201).json({
        version: updatedVersion,
        summary: persistedSummary,
      });
    } catch (e) {
      console.error("POST /api/price-tables/:priceTableId/versions/generate-draft", e);
      return res.status(500).json({ error: "Erro ao gerar versão DRAFT da tabela de preço." });
    }
  });

  app.get("/api/price-table-versions/:id/items", requireAppAuth, requireAnyPermission(["settings.price_tables.view", "pricing.view"]), async (req, res) => {
    const { id } = req.params;
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limitRaw = Number.parseInt(String(req.query.limit ?? "50"), 10) || 50;
    const limit = Math.min(200, Math.max(1, limitRaw));
    const skip = (page - 1) * limit;

    try {
      const version = await prisma.priceTableVersion.findUnique({
        where: { id },
        include: {
          PriceTable: true,
          TaxRule: true,
        },
      });
      if (!version) return res.status(404).json({ error: "Versão de tabela de preço não encontrada." });

      const [items, total] = await Promise.all([
        prisma.priceTableItem.findMany({
          where: { priceTableVersionId: id },
          include: {
            Product: {
              select: { id: true, sku: true, name: true, status: true, type: true },
            },
          },
          orderBy: [{ sku: "asc" }, { productName: "asc" }],
          skip,
          take: limit,
        }),
        prisma.priceTableItem.count({ where: { priceTableVersionId: id } }),
      ]);

      return res.json({
        version,
        table: version.PriceTable,
        summary: version.generationSummaryJson ?? null,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
        items,
      });
    } catch (e) {
      console.error("GET /api/price-table-versions/:id/items", e);
      return res.status(500).json({ error: "Erro ao listar itens da versão da tabela de preço." });
    }
  });

  app.get("/api/price-tables/:priceTableId/products/:productId/published-price", requireAppAuth, requireAnyPermission(["pricing.view", "proposals.view", "settings.price_tables.view"]), async (req, res) => {
    const { priceTableId, productId } = req.params;
    const now = new Date();
    try {
      const priceTable = await prisma.priceTable.findUnique({
        where: { id: priceTableId },
        select: { id: true, code: true, name: true, defaultMarginPct: true, status: true },
      });
      if (!priceTable) {
        return res.status(404).json({
          code: "PRICE_TABLE_NOT_FOUND",
          message: "Tabela de preço não encontrada.",
        });
      }
      if (String(priceTable.status).toUpperCase() !== "ACTIVE") {
        return res.status(409).json({
          code: "PRICE_TABLE_INACTIVE",
          message: "A tabela de preço informada está inativa.",
        });
      }

      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, sku: true, name: true, status: true, type: true },
      });
      if (!product) {
        return res.status(404).json({
          code: "PRODUCT_NOT_FOUND",
          message: "Produto não encontrado.",
        });
      }

      const publishedVersion = await prisma.priceTableVersion.findFirst({
        where: {
          priceTableId,
          status: "PUBLISHED",
          AND: [
            {
              OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
            },
            {
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
            },
          ],
        },
        orderBy: [{ effectiveFrom: "desc" }, { publishedAt: "desc" }, { versionNumber: "desc" }],
        select: {
          id: true,
          versionNumber: true,
          status: true,
          publishedAt: true,
          effectiveFrom: true,
          effectiveTo: true,
          approvedBy: true,
          generationSummaryJson: true,
        },
      });
      if (!publishedVersion) {
        return res.status(404).json({
          code: "NO_PUBLISHED_PRICE_TABLE_VERSION",
          message: "Não existe versão publicada vigente para a tabela informada.",
        });
      }

      const item = await prisma.priceTableItem.findUnique({
        where: {
          priceTableVersionId_productId: {
            priceTableVersionId: publishedVersion.id,
            productId,
          },
        },
        select: {
          id: true,
          frozenTotalCost: true,
          frozenMaterialCost: true,
          frozenHhCost: true,
          frozenHmCost: true,
          frozenTaxCost: true,
          frozenOtherCost: true,
          marginPct: true,
          salePrice: true,
          commissionPerc: true,
          commissionValue: true,
          formulaSnapshotJson: true,
        },
      });
      if (!item) {
        return res.status(404).json({
          code: "NO_PRICE_TABLE_ITEM",
          message: "Produto não encontrado na versão publicada da tabela de preço.",
        });
      }

      const formulaSnapshot = item.formulaSnapshotJson as Record<string, unknown> | null;
      const freightFromSnapshot = Number((formulaSnapshot?.freight as unknown) ?? 0);
      const freightValue = Number.isFinite(freightFromSnapshot) ? freightFromSnapshot : 0;

      // Comissão: prefere colunas dedicadas (C2). Para itens antigos com 0 na coluna,
      // tenta resgatar do formulaSnapshotJson.rates.commissionRate (taxa em fração: 0.05 = 5%).
      const salePriceNum = Number(item.salePrice);
      const colCommissionPerc = Number(item.commissionPerc);
      const colCommissionValue = Number(item.commissionValue);
      let finalCommissionPerc = Number.isFinite(colCommissionPerc) ? colCommissionPerc : 0;
      let finalCommissionValue = Number.isFinite(colCommissionValue) ? colCommissionValue : 0;
      if (finalCommissionPerc <= 0) {
        const rates = (formulaSnapshot?.rates as Record<string, unknown> | undefined) ?? undefined;
        const legacyCommRate = Number(rates?.commissionRate);
        if (Number.isFinite(legacyCommRate) && legacyCommRate > 0) {
          finalCommissionPerc = legacyCommRate * 100;
          finalCommissionValue = Number.isFinite(salePriceNum) ? salePriceNum * legacyCommRate : 0;
        }
      }

      const warnings: Array<{ code: string; message: string }> = [];
      const versionSummary =
        publishedVersion.generationSummaryJson && typeof publishedVersion.generationSummaryJson === "object"
          ? (publishedVersion.generationSummaryJson as Record<string, unknown>)
          : null;
      const summaryItemsCreated = Number(versionSummary?.itemsCreated);
      if (
        publishedVersion.id === "151a3cbf-ce7c-435c-97ff-7758015db6bf" ||
        (Number.isFinite(summaryItemsCreated) && summaryItemsCreated <= 2)
      ) {
        warnings.push({
          code: "PILOT_OR_INCOMPLETE_VERSION",
          message:
            "A versão publicada atual é piloto/incompleta e possui poucos itens. Revise antes de usar comercialmente.",
        });
      }

      return res.json({
        priceSource: "PRICE_TABLE",
        priceTable: {
          id: priceTable.id,
          code: priceTable.code,
          name: priceTable.name,
          defaultMarginPct: Number(priceTable.defaultMarginPct),
        },
        version: {
          id: publishedVersion.id,
          versionNumber: publishedVersion.versionNumber,
          status: publishedVersion.status,
          publishedAt: publishedVersion.publishedAt,
          effectiveFrom: publishedVersion.effectiveFrom,
          effectiveTo: publishedVersion.effectiveTo,
          approvedBy: publishedVersion.approvedBy ?? null,
        },
        product: {
          id: product.id,
          sku: product.sku,
          name: product.name,
        },
        item: {
          priceTableItemId: item.id,
          frozenTotalCost: Number(item.frozenTotalCost),
          frozenMaterialCost: Number(item.frozenMaterialCost),
          frozenHhCost: Number(item.frozenHhCost),
          frozenHmCost: Number(item.frozenHmCost),
          frozenTaxCost: Number(item.frozenTaxCost),
          frozenOtherCost: Number(item.frozenOtherCost),
          marginPct: Number(item.marginPct),
          salePrice: Number(item.salePrice),
          commissionPerc: finalCommissionPerc,
          commissionValue: finalCommissionValue,
        },
        proposalDefaults: {
          unitCost: Number(item.frozenTotalCost),
          suggestedPrice: Number(item.salePrice),
          negotiatedPrice: Number(item.salePrice),
          marginPerc: Number(item.marginPct),
          taxesValue: Number(item.frozenTaxCost),
          freightValue,
          commissionPerc: finalCommissionPerc,
          commissionValue: finalCommissionValue,
        },
        warnings,
      });
    } catch (e: any) {
      if (e?.code === "P2023") {
        return res.status(404).json({
          code: "INVALID_IDENTIFIER",
          message: "Identificador inválido para tabela de preço ou produto.",
        });
      }
      console.error("GET /api/price-tables/:priceTableId/products/:productId/published-price", e);
      return res.status(500).json({
        code: "INTERNAL_ERROR",
        message: "Erro interno ao consultar preço publicado da tabela.",
      });
    }
  });

  app.post("/api/price-table-versions/:id/publish", requireAppAuth, requireAnyPermission(["pricing.publish_tables", "settings.price_tables.manage"]), async (req, res) => {
    const { id } = req.params;
    const body = (req.body ?? {}) as {
      effectiveFrom?: unknown;
      approvedBy?: unknown;
      forcePublishWithWarnings?: unknown;
      forcePublishWithErrors?: unknown;
    };

    const approvedBy = typeof body.approvedBy === "string" && body.approvedBy.trim().length > 0 ? body.approvedBy.trim() : null;
    const forcePublishWithWarnings = body.forcePublishWithWarnings === true;
    const forcePublishWithErrors = body.forcePublishWithErrors === true;
    const effectiveFromInput =
      typeof body.effectiveFrom === "string" && body.effectiveFrom.trim().length > 0
        ? new Date(body.effectiveFrom)
        : null;
    if (effectiveFromInput && Number.isNaN(effectiveFromInput.getTime())) {
      return res.status(400).json({ error: "effectiveFrom inválido." });
    }

    try {
      const version = await prisma.priceTableVersion.findUnique({
        where: { id },
        include: { PriceTable: true, TaxRule: true },
      });
      if (!version) return res.status(404).json({ error: "Versão de tabela de preço não encontrada." });
      if (version.status !== "DRAFT") {
        return res.status(400).json({ error: "Apenas versões DRAFT podem ser publicadas." });
      }

      const itemsCount = await prisma.priceTableItem.count({ where: { priceTableVersionId: id } });
      if (itemsCount <= 0) {
        return res.status(400).json({ error: "Versão DRAFT sem itens. Gere itens antes de publicar." });
      }

      const summaryRaw = version.generationSummaryJson as Record<string, unknown> | null;
      const summaryErrors = Array.isArray(summaryRaw?.errors) ? (summaryRaw!.errors as Array<Record<string, unknown>>) : [];
      const summaryWarnings = Array.isArray(summaryRaw?.warnings)
        ? (summaryRaw!.warnings as Array<Record<string, unknown>>)
        : [];

      if (summaryErrors.length > 0 && !forcePublishWithErrors) {
        return res.status(409).json({
          error:
            "A versão possui errors no generationSummaryJson. Confirme forcePublishWithErrors=true para publicar parcialmente (somente os itens válidos já criados na DRAFT serão publicados).",
          errorsCount: summaryErrors.length,
          errorsPreview: summaryErrors.slice(0, 20),
        });
      }

      if (summaryWarnings.length > 0 && !forcePublishWithWarnings) {
        return res.status(409).json({
          error: "A versão possui warnings. Confirme forcePublishWithWarnings=true para publicar mesmo assim.",
          warningsCount: summaryWarnings.length,
          warnings: summaryWarnings.slice(0, 20),
        });
      }

      const effectiveFrom = effectiveFromInput ?? new Date();
      const publishedAt = new Date();

      const published = await prisma.$transaction(async (tx) => {
        const archiveWhere: Prisma.PriceTableVersionWhereInput = {
          id: { not: id },
          priceTableId: version.priceTableId,
          taxRuleId: version.taxRuleId,
          status: "PUBLISHED",
        };

        const archived = await tx.priceTableVersion.updateMany({
          where: archiveWhere,
          data: {
            status: "ARCHIVED",
            effectiveTo: effectiveFrom,
          },
        });

        const currentPublished = await tx.priceTableVersion.update({
          where: { id },
          data: {
            status: "PUBLISHED",
            publishedAt,
            effectiveFrom,
            effectiveTo: null,
            approvedBy,
          },
          include: { PriceTable: true, TaxRule: true },
        });

        return { currentPublished, archivedVersionsCount: archived.count };
      });

      const errorsAccepted = summaryErrors.length > 0;
      const warningsAccepted = summaryWarnings.length > 0;

      if (errorsAccepted) {
        console.warn("PriceTableVersion publicada com pendências (publicação parcial):", {
          versionId: id,
          priceTableId: version.priceTableId,
          errorsCount: summaryErrors.length,
          warningsCount: summaryWarnings.length,
          approvedBy,
        });
      }

      return res.json({
        version: published.currentPublished,
        archivedVersionsCount: published.archivedVersionsCount,
        published: true,
        warningsAccepted,
        errorsAccepted,
        errorsCount: summaryErrors.length,
        warningsCount: summaryWarnings.length,
      });
    } catch (e) {
      console.error("POST /api/price-table-versions/:id/publish", e);
      return res.status(500).json({ error: "Erro ao publicar versão da tabela de preço." });
    }
  });

  // --- API: Tabela oficial versionada de custo de produção industrial ---
  app.get("/api/production-cost-tables/versions", requireAppAuth, requireAnyPermission([...PRODUCTION_COST_TABLE_VIEW_PERMISSIONS]), async (req, res) => {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const code = typeof req.query.code === "string" ? req.query.code : null;
    try {
      const versions = await listProductionCostTableVersions(prisma, { limit, status, code });
      return res.json(
        versions.map((v) => ({
          id: v.id,
          code: v.code,
          name: v.name,
          effectiveDate: v.effectiveDate,
          status: v.status,
          revision: v.revision,
          publishedAt: v.publishedAt,
          publishedBy: v.publishedBy,
          createdBy: v.createdBy,
          createdAt: v.createdAt,
          itemsCount: v._count.items,
          source: v.source,
          notes: v.notes,
          supersedesVersionId: v.supersedesVersionId,
          supersedesVersion: v.supersedesVersion,
        }))
      );
    } catch (e) {
      console.error("GET /api/production-cost-tables/versions", e);
      return res.status(500).json({ error: "Erro ao listar versões de custo de produção." });
    }
  });

  app.get("/api/production-cost-tables/effective-cost", requireAppAuth, requireAnyPermission([...PRODUCTION_COST_TABLE_VIEW_PERMISSIONS]), async (req, res) => {
    const productId = typeof req.query.productId === "string" ? req.query.productId.trim() : "";
    const referenceDateRaw =
      typeof req.query.referenceDate === "string" ? req.query.referenceDate.trim() : "";
    if (!productId) {
      return res.status(400).json({ error: "productId é obrigatório." });
    }
    if (!referenceDateRaw) {
      return res.status(400).json({ error: "referenceDate é obrigatória (yyyy-mm-dd)." });
    }
    const referenceDate = civilDateToLocalDate(referenceDateRaw);
    if (Number.isNaN(referenceDate.getTime())) {
      return res.status(400).json({ error: "referenceDate inválida." });
    }
    try {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, sku: true, name: true },
      });
      if (!product) {
        return res.status(404).json({ error: "Produto não encontrado." });
      }
      const result = await getEffectiveProductProductionCost(prisma, productId, referenceDate);
      const summaryText = formatEffectiveProductionCostSummary({
        productCode: product.sku,
        referenceDate: referenceDateRaw,
        result,
      });
      return res.json({
        ...result,
        referenceDate: referenceDateRaw,
        product,
        summaryText,
      });
    } catch (e) {
      console.error("GET /api/production-cost-tables/effective-cost", e);
      return res.status(500).json({ error: "Erro ao consultar custo vigente." });
    }
  });

  app.get("/api/production-cost-table-versions/:id", requireAppAuth, requireAnyPermission([...PRODUCTION_COST_TABLE_VIEW_PERMISSIONS]), async (req, res) => {
    try {
      const version = await getProductionCostTableVersionById(prisma, req.params.id);
      if (!version) return res.status(404).json({ error: "Versão não encontrada." });
      return res.json({
        id: version.id,
        code: version.code,
        name: version.name,
        effectiveDate: version.effectiveDate,
        status: version.status,
        revision: version.revision,
        publishedAt: version.publishedAt,
        publishedBy: version.publishedBy,
        createdBy: version.createdBy,
        createdAt: version.createdAt,
        source: version.source,
        notes: version.notes,
        supersedesVersionId: version.supersedesVersionId,
        supersedesVersion: version.supersedesVersion,
        itemsCount: version.items.length,
        items: version.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          productCodeSnapshot: item.productCodeSnapshot,
          productNameSnapshot: item.productNameSnapshot,
          unitProductionCost: item.unitProductionCost,
          materialCost: item.materialCost,
          processCost: item.processCost,
          laborCost: item.laborCost,
          machineCost: item.machineCost,
          overheadCost: item.overheadCost,
          otherCost: item.otherCost,
          currency: item.currency,
          calculationHash: item.calculationHash,
          calculationSnapshot: item.calculationSnapshot,
        })),
      });
    } catch (e) {
      console.error("GET /api/production-cost-table-versions/:id", e);
      return res.status(500).json({ error: "Erro ao consultar versão de custo de produção." });
    }
  });

  app.post("/api/production-cost-tables/versions/generate-draft", requireAppAuth, requireAnyPermission(["pricing.generate_tables", "settings.price_tables.manage"]), async (req, res) => {
    const body = (req.body ?? {}) as {
      effectiveDate?: unknown;
      productIds?: unknown;
      includeAllActiveProducts?: unknown;
      notes?: unknown;
      createdBy?: unknown;
    };

    const effectiveDateRaw =
      typeof body.effectiveDate === "string" && body.effectiveDate.trim()
        ? body.effectiveDate.trim()
        : null;
    if (!effectiveDateRaw) {
      return res.status(400).json({ error: "effectiveDate é obrigatória (yyyy-mm-dd)." });
    }
    const effectiveDate = civilDateToLocalDate(effectiveDateRaw);
    if (Number.isNaN(effectiveDate.getTime())) {
      return res.status(400).json({ error: "effectiveDate inválida." });
    }

    const productIds = Array.isArray(body.productIds)
      ? body.productIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
    const includeAllActiveProducts = body.includeAllActiveProducts === true;
    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
    const createdBy =
      typeof body.createdBy === "string" && body.createdBy.trim() ? body.createdBy.trim() : null;

    if (productIds.length === 0 && !includeAllActiveProducts) {
      return res.status(400).json({
        error: "Informe productIds ou includeAllActiveProducts=true.",
      });
    }

    try {
      const result = await generateProductionCostTableDraftFromProducts(prisma, {
        initAnalysisCache,
        getProductCostAnalysis,
        isCostAnalysisFailure,
        describeCostAnalysisFailure,
      }, {
        effectiveDate,
        productIds,
        includeAllActiveProducts,
        notes,
        createdBy,
      });

      if (!result.version) {
        return res.status(500).json({ error: "Falha ao criar versão DRAFT." });
      }

      if (result.summary.itemsCreated === 0) {
        return res.status(422).json({
          error: "Nenhum item de custo foi criado. Revise os erros de cálculo.",
          summary: result.summary,
        });
      }

      return res.status(201).json({
        version: {
          id: result.version.id,
          code: result.version.code,
          name: result.version.name,
          effectiveDate: result.version.effectiveDate,
          status: result.version.status,
          revision: result.version.revision,
          supersedesVersionId: result.supersedesVersionId,
          itemsCount: result.version._count.items,
        },
        summary: result.summary,
        published: false,
      });
    } catch (e) {
      console.error("POST /api/production-cost-tables/versions/generate-draft", e);
      const message = e instanceof Error ? e.message : "Erro ao gerar DRAFT de custo de produção.";
      return res.status(500).json({ error: message });
    }
  });

  app.post("/api/production-cost-table-versions/:id/publish", requireAppAuth, requireAnyPermission(["pricing.publish_tables", "settings.price_tables.manage"]), async (req, res) => {
    const { id } = req.params;
    const body = (req.body ?? {}) as { publishedBy?: unknown; supersedeVersionId?: unknown };
    const publishedBy =
      typeof body.publishedBy === "string" && body.publishedBy.trim() ? body.publishedBy.trim() : null;
    const supersedeVersionId =
      typeof body.supersedeVersionId === "string" && body.supersedeVersionId.trim()
        ? body.supersedeVersionId.trim()
        : null;

    try {
      const published = await publishProductionCostVersionFromDraft(prisma, {
        versionId: id,
        publishedBy,
        supersedeVersionId,
      });

      return res.json({
        version: {
          id: published.id,
          code: published.code,
          name: published.name,
          effectiveDate: published.effectiveDate,
          status: published.status,
          revision: published.revision,
          publishedAt: published.publishedAt,
          publishedBy: published.publishedBy,
          itemsCount: published.items.length,
        },
        published: true,
        immutable: true,
      });
    } catch (e) {
      console.error("POST /api/production-cost-table-versions/:id/publish", e);
      const message = e instanceof Error ? e.message : "Erro ao publicar versão de custo de produção.";
      const status = /DRAFT|imutável|sem itens|não encontrada/i.test(message) ? 400 : 500;
      return res.status(status).json({ error: message });
    }
  });

  // --- API: Tax Rules (Módulo Tributário) ---
  app.get("/api/tax-rules", requireAppAuth, requireAnyPermission(["taxes.view", "pricing.view"]), async (req, res) => {
    const rules = await prisma.taxRule.findMany({
      include: { TaxComponent: true },
      orderBy: { name: "asc" },
    });
    res.json(rules);
  });

  app.post("/api/tax-rules", requireAppAuth, requirePermission("taxes.edit"), async (req, res) => {
    const { name, description, operation, components } = req.body;
    const rule = await prisma.taxRule.create({
      data: {
        name,
        description,
        operation,
        TaxComponent: {
          create: (components || []).map((c: any) => ({
            name: c.name,
            percentage: c.percentage,
            isRecoverable: c.isRecoverable,
            baseType: c.baseType,
          }))
        }
      },
      include: { TaxComponent: true }
    });
    res.json(rule);
  });

  app.put("/api/tax-rules/:id", requireAppAuth, requirePermission("taxes.edit"), async (req, res) => {
    const { id } = req.params;
    const { name, description, operation, components, status } = req.body;

    const rule = await prisma.$transaction(async (tx) => {
      await tx.taxComponent.deleteMany({ where: { taxRuleId: id } });
      return await tx.taxRule.update({
        where: { id },
        data: {
          name,
          description,
          operation,
          status,
          TaxComponent: {
            create: (components || []).map((c: any) => ({
              name: c.name,
              percentage: c.percentage,
              isRecoverable: c.isRecoverable,
              baseType: c.baseType,
            }))
          }
        },
        include: { TaxComponent: true }
      });
    });
    res.json(rule);
  });

  app.delete("/api/tax-rules/:id", requireAppAuth, requirePermission("taxes.edit"), async (req, res) => {
    const { id } = req.params;
    await prisma.taxRule.delete({ where: { id } });
    res.json({ success: true });
  });

  // --- API: Product Pricing (Formação de Preço) ---
  app.get("/api/pricing", requireAppAuth, requirePermission("pricing.view"), async (req, res) => {
    try {
      const cache = await initAnalysisCache();
      const pricings = await prisma.productPricing.findMany({
        include: { Product: true, TaxRule: { include: { TaxComponent: true } } },
      });

      const rows = await Promise.all(
        pricings.map(async (pricing) => {
          try {
            const costData = await getProductCostAnalysis(pricing.productId, cache, true);
            if (!costData || isCostAnalysisFailure(costData)) {
              return { ...pricing, suggestedPrice: null };
            }
            const ciu = extractOfficialProductFinalUnitCost(costData);
            if (ciu == null) {
              return { ...pricing, suggestedPrice: null };
            }
            const taxRate = pricing.TaxRule.TaxComponent.reduce((acc, c) => acc + Number(c.percentage), 0) / 100;
            const commRate = Number(pricing.commission) / 100;
            const marginRate = Number(pricing.desiredMargin) / 100;
            const otherRate = Number(pricing.otherVariables) / 100;
            const freight = Number(pricing.freightOut);
            const divisor = 1 - taxRate - commRate - otherRate - marginRate;
            if (divisor <= 0) {
              return { ...pricing, suggestedPrice: null };
            }
            return { ...pricing, suggestedPrice: (ciu + freight) / divisor };
          } catch {
            return { ...pricing, suggestedPrice: null };
          }
        })
      );
      res.json(rows);
    } catch (error) {
      console.error("GET /api/pricing:", error);
      res.status(500).json({ error: "Erro ao listar formações de preço." });
    }
  });

  app.post("/api/pricing", requireAppAuth, requirePermission("pricing.view"), async (req, res) => {
    const { productId, taxRuleId, desiredMargin, commission, freightOut, otherVariables } = req.body;
    const pricing = await prisma.productPricing.upsert({
      where: { productId_taxRuleId: { productId, taxRuleId } },
      update: { desiredMargin, commission, freightOut, otherVariables },
      create: { productId, taxRuleId, desiredMargin, commission, freightOut, otherVariables },
    });
    res.json(pricing);
  });

  app.post("/api/pricing/bulk-delete", requireAppAuth, requirePermission("pricing.view"), async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
       return res.status(400).json({ error: "Nenhum ID fornecido para exclusão." });
    }

    let successCount = 0; let errorCount = 0;
    const errorsList = [];

    for (const id of ids) {
       try {
         await prisma.productPricing.delete({ where: { id } });
         successCount++;
       } catch (err: any) {
         errorCount++;
         if (err.code === 'P2003') {
           errorsList.push({ id, message: "Bloqueio relacional ativo (Vínculo de Restrição)." });
         } else {
           errorsList.push({ id, message: err.message || "Erro genérico." });
         }
       }
    }

    res.json({
       total: ids.length, success: successCount, error: errorCount,
       details: errorsList
    });
  });

  app.delete("/api/pricing/:id", requireAppAuth, requirePermission("pricing.view"), async (req, res) => {
    try {
      const { id } = req.params;
      
      const target = await prisma.productPricing.findUnique({ where: { id } });
      if (!target) return res.status(404).json({ error: "Formação de preço não encontrada no sistema." });
      
      await prisma.productPricing.delete({ where: { id } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("Erro ao excluir premissa de preço:", err);
      if (err.code === 'P2003') {
        return res.status(400).json({ error: "Não é possível excluir esta formação de preço porque ela possui vínculos ativos irreversíveis." });
      }
      res.status(500).json({ error: "Erro interno ao tentar apagar a formação." });
    }
  });

  app.get("/api/pricing/:productId/:taxRuleId/calculate", requireAppAuth, requirePermission("pricing.simulate"), async (req, res) => {
    const { productId, taxRuleId } = req.params;

    try {
      // 1. Buscar dados do produto (custos) - Chamada direta da função interna
      const cache = await initAnalysisCache();
      const costData = await getProductCostAnalysis(productId, cache, true);
      if (!costData) return res.status(404).json({ error: "Produto não encontrado para análise de custo" });
      if (isCostAnalysisFailure(costData)) return res.status(400).json(costData);

      // 2. Buscar premissas de preço
      const pricing = await prisma.productPricing.findUnique({
        where: { productId_taxRuleId: { productId, taxRuleId } },
        include: { TaxRule: { include: { TaxComponent: true } } }
      });

      if (!pricing) return res.status(404).json({ error: "Configuração de preço não encontrada" });

      const ciu = extractOfficialProductFinalUnitCost(costData);
      if (ciu == null) {
        return res.status(400).json({ error: "Custo final da engenharia indisponível para o produto." });
      }
      const opex = Number((costData as { totalOPEX_Unit?: unknown }).totalOPEX_Unit);
    
    // Custo Fabril Completo = CIU (que já inclui CIF)
    const custoFabril = ciu;
    // Custo Gerencial Total = CIU + OPEX
    const custoGerencial = ciu + opex;

    const taxRate = pricing.TaxRule.TaxComponent.reduce((acc, c) => acc + Number(c.percentage), 0) / 100;
    const commRate = Number(pricing.commission) / 100;
    const marginRate = Number(pricing.desiredMargin) / 100;
    const otherRate = Number(pricing.otherVariables) / 100;
    const freight = Number(pricing.freightOut);

    // Cálculo do Preço de Venda (Markup Divisor)
    // PV = (Custo + Frete) / (1 - Impostos - Comissões - Outros - Margem)
    const divisor = 1 - taxRate - commRate - otherRate - marginRate;
    
    if (divisor <= 0) return res.status(400).json({ error: "Margem e impostos excedem 100% do preço." });

    const suggestedPrice = (custoFabril + freight) / divisor;
    const totalTaxes = suggestedPrice * taxRate;
    const totalCommission = suggestedPrice * commRate;
    const totalOther = suggestedPrice * otherRate;

    const contributionMargin = suggestedPrice - totalTaxes - totalCommission - freight - custoFabril;
    const operationalMargin = contributionMargin - opex;

      let openBook: Record<string, unknown> | undefined;
      try {
        const explosion = await buildOpenBookRawMaterialExplosionPerUnit(
          productId,
          cache,
          new Set<string>(),
          new Map()
        );
        const mp = Number(costData.totalMaterialCost ?? 0);
        const hh = Number(costData.totalHH_Unit ?? 0);
        const hm = Number(costData.totalHM_Unit ?? 0);
        const nat = naturePercentages(mp, hh, hm);
        if (explosion instanceof Map) {
          const sumMp = sumExplosionTotalCost(explosion);
          openBook = {
            executive: {
              totalIndustrialCost: ciu,
              totalMaterialCost: mp,
              totalHH: hh,
              totalHM: hm,
              pctMp: nat.pctMp,
              pctHh: nat.pctHh,
              pctHm: nat.pctHm,
              denominatorIndustrial: nat.base,
            },
            consolidatedMaterials: finalizeRowsForOpenBook(explosion, ciu, mp),
            cifOpexInformational: {
              totalCIF_Unit: Number(costData.totalCIF_Unit ?? 0),
              totalOPEX_Unit: Number(costData.totalOPEX_Unit ?? 0),
            },
            explosionReconcilesMaterialTotal: Math.abs(sumMp - mp) < 0.02,
            explosionMaterialSum: sumMp,
          };
        } else {
          openBook = {
            error: explosion.error,
            message: explosion.message ?? null,
          };
        }
      } catch (obErr) {
        console.error("Pricing openBook error:", obErr);
        openBook = {
          error: "OPEN_BOOK_FAILED",
          message: obErr instanceof Error ? obErr.message : String(obErr),
        };
      }

      const obRecord = openBook as Record<string, unknown> | undefined;
      const consolidatedForBreakdown =
        obRecord &&
        typeof obRecord.error === "undefined" &&
        Array.isArray(obRecord.consolidatedMaterials)
          ? (obRecord.consolidatedMaterials as Array<Record<string, unknown>>)
          : null;
      const detailsBlock = (costData as { details?: { materials?: unknown[]; processBreakdown?: unknown[] } }).details;
      const bomMaterialsDetail = Array.isArray(detailsBlock?.materials)
        ? (detailsBlock!.materials as Array<Record<string, unknown>>)
        : null;
      const processBreakdown = Array.isArray(detailsBlock?.processBreakdown)
        ? detailsBlock!.processBreakdown
        : null;

      const pricingBreakdown = buildPricingUnitCalculationBreakdown({
        custoFabril,
        custoGerencial,
        totalMaterialCost: Number(costData.totalMaterialCost ?? 0),
        totalHH_Unit: Number(costData.totalHH_Unit ?? 0),
        totalHM_Unit: Number(costData.totalHM_Unit ?? 0),
        totalCIF_Unit: Number(costData.totalCIF_Unit ?? 0),
        totalOPEX_Unit: Number(costData.totalOPEX_Unit ?? 0),
        taxRuleName: pricing.TaxRule?.name ? String(pricing.TaxRule.name) : null,
        taxRuleId: String(pricing.taxRuleId),
        taxRate,
        commRate,
        marginRate,
        otherRate,
        freight,
        divisor,
        suggestedPrice,
        totalTaxes,
        totalCommission,
        totalOther,
        contributionMargin,
        operationalMargin,
        openBookConsolidatedMaterials: consolidatedForBreakdown,
        bomMaterialsDetail,
        processBreakdown,
      });

      res.json({
        product: costData.name,
        sku: costData.sku,
        ciu,
        custoFabril,
        custoGerencial,
        premissas: {
          taxRate: taxRate * 100,
          commRate: commRate * 100,
          marginRate: marginRate * 100,
          freight,
        },
        resultados: {
          suggestedPrice,
          totalTaxes,
          totalCommission,
          contributionMargin,
          operationalMargin,
          markup: suggestedPrice / custoFabril,
        },
        openBook,
        pricingBreakdown,
      });
    } catch (error) {
      console.error("Pricing calculation error:", error);
      res.status(500).json({ error: "Erro ao calcular preço" });
    }
  });

  app.post("/api/pricing/simulate-unit", requireAppAuth, requirePermission("pricing.simulate"), async (req, res) => {
    const { productId, taxRuleId, desiredMarginPerc } = req.body ?? {};
    const desiredMarginNumber = Number(desiredMarginPerc);

    if (!productId || !taxRuleId) {
      return res.status(400).json({ error: "Produto e regra fiscal são obrigatórios." });
    }
    if (!Number.isFinite(desiredMarginNumber) || desiredMarginNumber < 0) {
      return res.status(400).json({ error: "Margem desejada inválida." });
    }

    try {
      const cache = await initAnalysisCache();
      const costData = await getProductCostAnalysis(String(productId), cache, true);
      if (!costData) return res.status(404).json({ error: "Produto não encontrado para análise de custo" });
      if (isCostAnalysisFailure(costData)) return res.status(400).json(costData);

      const taxRule = await prisma.taxRule.findUnique({
        where: { id: String(taxRuleId) },
        include: { TaxComponent: true },
      });
      if (!taxRule) {
        return res.status(404).json({ error: "Regra fiscal não encontrada" });
      }

      const existingPricing = await prisma.productPricing.findUnique({
        where: { productId_taxRuleId: { productId: String(productId), taxRuleId: String(taxRuleId) } },
      });

      const ciu = extractOfficialProductFinalUnitCost(costData);
      if (ciu == null) {
        return res.status(400).json({ error: "Custo final da engenharia indisponível para o produto." });
      }
      const opex = Number((costData as { totalOPEX_Unit?: unknown }).totalOPEX_Unit);
      const custoFabril = ciu;
      const custoGerencial = ciu + opex;

      const taxRate = taxRule.TaxComponent.reduce((acc, c) => acc + Number(c.percentage), 0) / 100;
      const commRate = Number(existingPricing?.commission ?? 0) / 100;
      const marginRate = desiredMarginNumber / 100;
      const otherRate = Number(existingPricing?.otherVariables ?? 0) / 100;
      const freight = Number(existingPricing?.freightOut ?? 0);

      const divisor = 1 - taxRate - commRate - otherRate - marginRate;
      if (divisor <= 0) {
        return res.status(400).json({ error: "A soma de impostos e margem precisa ser menor que 100%." });
      }

      const suggestedPrice = (custoFabril + freight) / divisor;
      const totalTaxes = suggestedPrice * taxRate;
      const totalCommission = suggestedPrice * commRate;
      const totalOther = suggestedPrice * otherRate;
      const contributionMargin = suggestedPrice - totalTaxes - totalCommission - freight - custoFabril;
      const operationalMargin = contributionMargin - opex;

      let openBook: Record<string, unknown> | undefined;
      try {
        const explosion = await buildOpenBookRawMaterialExplosionPerUnit(
          String(productId),
          cache,
          new Set<string>(),
          new Map()
        );
        const mp = Number(costData.totalMaterialCost ?? 0);
        const hh = Number(costData.totalHH_Unit ?? 0);
        const hm = Number(costData.totalHM_Unit ?? 0);
        const nat = naturePercentages(mp, hh, hm);
        if (explosion instanceof Map) {
          const sumMp = sumExplosionTotalCost(explosion);
          openBook = {
            executive: {
              totalIndustrialCost: ciu,
              totalMaterialCost: mp,
              totalHH: hh,
              totalHM: hm,
              pctMp: nat.pctMp,
              pctHh: nat.pctHh,
              pctHm: nat.pctHm,
              directMaterialRowsTotal: sumMp,
            },
            consolidatedMaterials: finalizeRowsForOpenBook(explosion, ciu, mp),
          };
        }
      } catch (obErr) {
        openBook = {
          error: "OPEN_BOOK_FAILED",
          message: obErr instanceof Error ? obErr.message : String(obErr),
        };
      }

      const obRecord = openBook as Record<string, unknown> | undefined;
      const consolidatedForBreakdown =
        obRecord &&
        typeof obRecord.error === "undefined" &&
        Array.isArray(obRecord.consolidatedMaterials)
          ? (obRecord.consolidatedMaterials as Array<Record<string, unknown>>)
          : null;
      const detailsBlock = (costData as { details?: { materials?: unknown[]; processBreakdown?: unknown[] } }).details;
      const bomMaterialsDetail = Array.isArray(detailsBlock?.materials)
        ? (detailsBlock!.materials as Array<Record<string, unknown>>)
        : null;
      const processBreakdown = Array.isArray(detailsBlock?.processBreakdown)
        ? detailsBlock!.processBreakdown
        : null;

      const pricingBreakdown = buildPricingUnitCalculationBreakdown({
        custoFabril,
        custoGerencial,
        totalMaterialCost: Number(costData.totalMaterialCost ?? 0),
        totalHH_Unit: Number(costData.totalHH_Unit ?? 0),
        totalHM_Unit: Number(costData.totalHM_Unit ?? 0),
        totalCIF_Unit: Number(costData.totalCIF_Unit ?? 0),
        totalOPEX_Unit: Number(costData.totalOPEX_Unit ?? 0),
        taxRuleName: taxRule?.name ? String(taxRule.name) : null,
        taxRuleId: String(taxRuleId),
        taxRate,
        commRate,
        marginRate,
        otherRate,
        freight,
        divisor,
        suggestedPrice,
        totalTaxes,
        totalCommission,
        totalOther,
        contributionMargin,
        operationalMargin,
        openBookConsolidatedMaterials: consolidatedForBreakdown,
        bomMaterialsDetail,
        processBreakdown,
      });

      return res.json({
        product: costData.name,
        sku: costData.sku,
        ciu,
        custoFabril,
        custoGerencial,
        premissas: {
          taxRate: taxRate * 100,
          commRate: commRate * 100,
          marginRate: marginRate * 100,
          freight,
        },
        resultados: {
          suggestedPrice,
          totalTaxes,
          totalCommission,
          contributionMargin,
          operationalMargin,
          markup: suggestedPrice / custoFabril,
        },
        openBook,
        pricingBreakdown,
      });
    } catch (error) {
      console.error("Pricing simulate-unit error:", error);
      return res.status(500).json({ error: "Erro ao simular formação de preço." });
    }
  });

  app.post("/api/pricing/simulate-batch", requireAppAuth, requirePermission("pricing.simulate"), async (req, res) => {
    const { productIds, taxRuleId, desiredMargin, commission, freightOut, otherVariables, itemScope } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: "Nenhum item selecionado" });
    }
    if (!taxRuleId) {
      return res.status(400).json({ error: "Regra fiscal não informada." });
    }

    try {
      const { simulatePricingBatch } = await import("./src/lib/pricingBatchSimulation.server.js");
      const payload = await simulatePricingBatch(
        prisma,
        {
          productIds,
          taxRuleId,
          desiredMargin,
          commission,
          freightOut,
          otherVariables,
          itemScope,
        },
        (productId) => getProductCostAnalysis(productId)
      );
      res.json(payload);
    } catch (err) {
      console.error("Batch simulate error:", err);
      const message = err instanceof Error ? err.message : "Falha catastrófica no motor de lote.";
      const status = message.includes("Nenhum item") || message.includes("Regra fiscal") ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/pricing/apply-batch", requireAppAuth, requirePermission("pricing.simulate"), async (req, res) => {
    const { validResults, taxRuleId, desiredMargin, commission, freightOut, otherVariables, itemScope } = req.body;

    if (!Array.isArray(validResults) || validResults.length === 0) {
      return res.status(400).json({ error: "Nenhum resultado válido fornecido" });
    }
    if (!taxRuleId) {
      return res.status(400).json({ error: "Regra fiscal não informada." });
    }

    try {
      const { applyPricingBatchPremises } = await import("./src/lib/pricingBatchSimulation.server.js");
      const { appliedCount, itemScope: resolvedScope } = await applyPricingBatchPremises(prisma, {
        validResults,
        taxRuleId,
        desiredMargin,
        commission,
        freightOut,
        otherVariables,
        itemScope,
      });
      res.json({ success: true, appliedCount, itemScope: resolvedScope });
    } catch (err) {
      console.error("Batch apply error:", err);
      res.status(500).json({ error: "Erro ao aplicar premissas em banco." });
    }
  });

  // --- API: Simulations (What-if Analysis) ---
  app.get("/api/simulations", requireAppAuth, requirePermission("simulations.view"), async (req, res) => {
    const simulations = await prisma.simulation.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(simulations);
  });

  app.post("/api/simulations", requireAppAuth, requirePermission("simulations.create"), async (req, res) => {
    const data = req.body;
    const simulation = await prisma.simulation.create({ data });
    res.json(simulation);
  });

  app.delete("/api/simulations/:id", requireAppAuth, requirePermission("simulations.create"), async (req, res) => {
    const { id } = req.params;
    await prisma.simulation.delete({ where: { id } });
    res.json({ success: true });
  });

  app.get("/api/simulations/:id/compare", requireAppAuth, requirePermission("simulations.view"), async (req, res) => {
    const { id } = req.params;
    try {
      const sim = await prisma.simulation.findUnique({ where: { id } });
      if (!sim) return res.status(404).json({ error: "Simulação não encontrada" });

      // 1. Buscar Dados Oficiais (Base) - Chamada direta da função interna
      const baseData = await getProductCostAnalysis(sim.productId);
      if (!baseData) return res.status(404).json({ error: "Produto base não encontrado" });
      if (isCostAnalysisFailure(baseData)) return res.status(400).json(baseData);

      // Buscar premissas de preço oficiais
      const pricing = await prisma.productPricing.findUnique({
        where: { productId_taxRuleId: { productId: sim.productId, taxRuleId: sim.taxRuleId } },
        include: { TaxRule: { include: { TaxComponent: true } } }
      });

      if (!pricing) return res.status(404).json({ error: "Configuração de preço base não encontrada" });

      // Simular o retorno do endpoint de cálculo para manter compatibilidade
      const taxRateBase = pricing.TaxRule.TaxComponent.reduce((acc, c) => acc + Number(c.percentage), 0) / 100;
      const ciuBase = extractOfficialProductFinalUnitCost(baseData);
      if (ciuBase == null) {
        return res.status(400).json({ error: "Custo final da engenharia indisponível para o produto base." });
      }
      const opexBase = Number((baseData as { totalOPEX_Unit?: unknown }).totalOPEX_Unit);
      const freightBase = Number(pricing.freightOut);
      const commRateBase = Number(pricing.commission) / 100;
      const marginRateBase = Number(pricing.desiredMargin) / 100;
      const otherRateBase = Number(pricing.otherVariables) / 100;

      const divisorBase = 1 - taxRateBase - commRateBase - otherRateBase - marginRateBase;
      const suggestedPriceBase = divisorBase > 0 ? (ciuBase + freightBase) / divisorBase : 0;

      const base = {
        ciu: ciuBase,
        custoGerencial: ciuBase + opexBase,
        premissas: {
          taxRate: taxRateBase * 100,
          commRate: commRateBase * 100,
          otherRate: otherRateBase * 100,
          marginRate: marginRateBase * 100,
          freight: freightBase,
        },
        resultados: {
          suggestedPrice: suggestedPriceBase
        }
      };

      // 2. Aplicar Ajustes (Simulação) com base real MP + HH + HM (sem CIF/OPEX no custo base)
    const breakdownBase = {
      mp: Number((baseData as any).totalMaterialCost ?? 0),
      hh: Number((baseData as any).totalHH_Unit ?? 0),
      hm: Number((baseData as any).totalHM_Unit ?? 0),
    };

    const calc = simulateScenarioFromBreakdown(
      breakdownBase,
      {
        materialAdjPct: Number(sim.materialAdj ?? 0),
        laborAdjPct: Number(sim.laborAdj ?? 0),
        hmAdjPct: Number(sim.indirectAdj ?? 0),
        efficiencyAdjPct: Number(sim.efficiencyAdj ?? 0),
        marginAdjPct: Number(sim.marginAdj ?? 0),
      },
      {
        taxRatePct: taxRateBase * 100,
        commRatePct: commRateBase * 100,
        otherRatePct: otherRateBase * 100,
        marginRatePct: marginRateBase * 100,
        freight: freightBase,
      }
    );

    const simCIU = calc.simulated.costBase;
    const simOPEX = base.custoGerencial - base.ciu;
    const simCustoGerencial = simCIU + simOPEX;
    const simSuggestedPrice = calc.pricing.simSuggestedPrice;

    res.json({
      simulationMethod: "REAL_COMPONENT_BREAKDOWN",
      simulationNote:
        "Cenário simulado aplica ajustes diretamente nos componentes reais do CIU (MP/HH/HM), mantendo CIF/OPEX fora do custo base principal.",
      base,
      simulated: {
        ciu: simCIU,
        custoGerencial: simCustoGerencial,
        suggestedPrice: simSuggestedPrice,
        marginRate: calc.pricing.marginRatePct,
        markup: simCIU > 0 ? simSuggestedPrice / simCIU : 0,
        breakdown: calc.simulated,
      },
      breakdown: {
        base: calc.base,
        simulated: calc.simulated,
      },
      delta: {
        price: simSuggestedPrice - base.resultados.suggestedPrice,
        pricePct: ((simSuggestedPrice / base.resultados.suggestedPrice) - 1) * 100,
        ciu: simCIU - base.ciu,
        ciuPct: ((simCIU / base.ciu) - 1) * 100,
      }
    });
  } catch (error) {
    console.error("Simulation comparison error:", error);
    res.status(500).json({ error: "Erro ao comparar simulação" });
  }
});

  // --- API: New Product Simulations (Sandbox Snapshot Persistence) ---
  app.get("/api/new-product-simulations", requireAppAuth, requirePermission("simulations.view"), async (req, res) => {
    const status = String(req.query.status ?? "").toUpperCase();
    const where =
      status === "SAVED" || status === "DRAFT"
        ? { status: status as "SAVED" | "DRAFT" }
        : undefined;
    const rows = await prisma.newProductSimulation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        sourceSimulationId: true,
        productName: true,
        productSku: true,
        savedAt: true,
        createdAt: true,
      },
    });
    res.json(rows);
  });

  app.get("/api/new-product-simulations/:id", requireAppAuth, requirePermission("simulations.view"), async (req, res) => {
    const { id } = req.params;
    const row = await prisma.newProductSimulation.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Simulação de novo produto não encontrada." });
    res.json(row);
  });

  app.post("/api/new-product-simulations/save", requireAppAuth, requirePermission("simulations.create"), async (req, res) => {
    const { simulationName, snapshot, createdBy, origin } = req.body ?? {};
    if (!simulationName || typeof simulationName !== "string") {
      return res.status(400).json({ error: "Nome da simulação é obrigatório." });
    }
    if (!snapshot || typeof snapshot !== "object") {
      return res.status(400).json({ error: "Snapshot inválido." });
    }
    const productName = String((snapshot as any)?.header?.productName ?? "").trim();
    if (!productName) {
      return res.status(400).json({ error: "Snapshot sem cabeçalho de produto válido." });
    }
    const data = buildSnapshotSaveData({
      simulationName,
      snapshot,
      createdBy: typeof createdBy === "string" ? createdBy : undefined,
      origin: typeof origin === "string" ? origin : undefined,
    });
    const created = await prisma.newProductSimulation.create({ data });
    res.json(created);
  });

  app.post("/api/new-product-simulations/:id/clone", requireAppAuth, requirePermission("simulations.create"), async (req, res) => {
    const { id } = req.params;
    const source = await prisma.newProductSimulation.findUnique({
      where: { id },
      select: { id: true, name: true, snapshot: true },
    });
    if (!source) {
      return res.status(404).json({ error: "Simulação de origem não encontrada." });
    }
    const cloneData = buildCloneDraftData(source);
    const created = await prisma.newProductSimulation.create({ data: cloneData });
    res.json(created);
  });

  app.delete("/api/new-product-simulations/:id", requireAppAuth, requirePermission("simulations.create"), async (req, res) => {
    const { id } = req.params;
    try {
      await prisma.newProductSimulation.delete({ where: { id } });
      return res.status(204).end();
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === "P2025") {
        return res.status(404).json({ error: "Simulação de novo produto não encontrada." });
      }
      console.error("DELETE new-product-simulations:", error);
      return res.status(500).json({ error: "Erro ao excluir simulação de novo produto." });
    }
  });

  /**
   * Explosão recursiva só de matéria-prima (MP), consolidando por materialId.
   * Respeita as mesmas exclusões de linha que getProductCostAnalysis (filho não custeado = ramo ignorado).
   */
  async function buildOpenBookRawMaterialExplosionPerUnit(
    productId: string,
    cache: AnalysisCache,
    pathStack: Set<string>,
    memo: Map<string, Map<string, ExplosionRowCore>>
  ): Promise<Map<string, ExplosionRowCore> | { error: string; message?: string }> {
    if (memo.has(productId)) {
      return cloneExplosionMap(memo.get(productId)!);
    }
    if (pathStack.has(productId)) {
      return { error: "BOM_CYCLE", message: "Ciclo na BOM ao explodir matérias-primas." };
    }
    pathStack.add(productId);
    try {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          ProductBOM: { orderBy: { id: "asc" }, include: { Material: true } },
        },
      });
      if (!product) {
        return { error: "NOT_FOUND", message: "Produto não encontrado." };
      }

      const into = new Map<string, ExplosionRowCore>();

      for (const item of product.ProductBOM) {
        if (item.Material) {
          const mat = item.Material;
          const landedCost = Number(mat.currentCost) + Number(mat.freight ?? 0);
          const matStandardLoss = Number(mat.standardLoss ?? 0) / 100;
          const bomLoss = Number(item.lossPercentage ?? 0) / 100;
          const requiredQty = Number(item.quantity) / (1 - bomLoss);
          const matEffectiveCost = landedCost / (1 - matStandardLoss);
          const lineTotal = matEffectiveCost * requiredQty;
          addDirectMaterialRow(into, {
            materialId: mat.id,
            code: mat.code,
            description: mat.description,
            unit: mat.unit,
            quantity: requiredQty,
            totalCost: lineTotal,
          });
          continue;
        }

        if (item.childProductId) {
          const childAnalysis = await getProductCostAnalysis(item.childProductId, cache, false, pathStack);
          if (childAnalysis === null || isCostAnalysisFailure(childAnalysis)) {
            continue;
          }
          const sub = await buildOpenBookRawMaterialExplosionPerUnit(
            item.childProductId,
            cache,
            pathStack,
            memo
          );
          if (!(sub instanceof Map)) {
            return sub;
          }
          const bomLoss = Number(item.lossPercentage ?? 0) / 100;
          const requiredQty = Number(item.quantity) / (1 - bomLoss);
          mergeExplosionMaps(into, sub, requiredQty);
          continue;
        }
      }

      memo.set(productId, cloneExplosionMap(into));
      return into;
    } finally {
      pathStack.delete(productId);
    }
  }

  // --- API: Product Cost Analysis (Motor de Cálculo CIU com CIF) ---
  app.get("/api/products/:id/cost-analysis", requireAppAuth, requireAnyPermission(["products.tab.cost", "products.tab.composition", "proposals.indicators.view", "pricing.view", "pricing.simulate"]), async (req, res) => {
    try {
      const { id } = req.params;
      const cache = await initAnalysisCache();
      const analysis = await getProductCostAnalysis(id, cache, true);
      if (!analysis) return res.status(404).json({ error: "Produto não encontrado" });
      if ("error" in analysis) return res.status(400).json(analysis);

      // Mapeamento para garantir retrocompatibilidade com o frontend atual
      const calculationExplainability = buildCostAnalysisExplainability(analysis as any);

      let openBook: Record<string, unknown> | undefined;
      try {
        const explosion = await buildOpenBookRawMaterialExplosionPerUnit(id, cache, new Set<string>(), new Map());
        const mp = Number(analysis.totalMaterialCost);
        const hh = Number(analysis.totalHH_Unit);
        const hm = Number(analysis.totalHM_Unit);
        const industri = Number(analysis.totalIndustrialCost);
        const nat = naturePercentages(mp, hh, hm);
        if (explosion instanceof Map) {
          const sumMp = sumExplosionTotalCost(explosion);
          const rows = finalizeRowsForOpenBook(explosion, industri, mp);
          const reconcileOk = Math.abs(sumMp - mp) < 0.02;
          openBook = {
            executive: {
              totalIndustrialCost: industri,
              totalMaterialCost: mp,
              totalHH: hh,
              totalHM: hm,
              pctMp: nat.pctMp,
              pctHh: nat.pctHh,
              pctHm: nat.pctHm,
              denominatorIndustrial: nat.base,
            },
            consolidatedMaterials: rows,
            cifOpexInformational: {
              totalCIF_Unit: analysis.totalCIF_Unit,
              totalOPEX_Unit: analysis.totalOPEX_Unit,
            },
            explosionReconcilesMaterialTotal: reconcileOk,
            explosionMaterialSum: sumMp,
          };
        } else {
          openBook = {
            error: explosion.error,
            message: explosion.message ?? null,
          };
        }
      } catch (obErr) {
        console.error("Open book material explosion error:", obErr);
        openBook = {
          error: "OPEN_BOOK_FAILED",
          message: obErr instanceof Error ? obErr.message : String(obErr),
        };
      }

      res.json({
        ...analysis,
        summary: {
          totalMaterialCost: analysis.totalMaterialCost,
          totalConversionCost: analysis.totalHH_Unit + analysis.totalHM_Unit,
          totalCIF_Unit: analysis.totalCIF_Unit,
          totalOPEX_Unit: analysis.totalOPEX_Unit,
          totalIndustrialCost: analysis.totalIndustrialCost,
          totalGerencialCost: analysis.totalGerencialCost
        },
        calculationExplainability,
        officialCostSource: OFFICIAL_PRODUCT_FINAL_COST_SOURCE,
        // O breakdown de materiais e operações agora vem direto dos details do motor
        audit: { calculatedAt: new Date().toISOString() },
        openBook,
      });
    } catch (error) {
      console.error("Cost analysis endpoint error:", error);
      res.status(500).json({ error: "Erro interno no cálculo da análise." });
    }
  });

  app.patch("/api/employees/:id/status", requireAppAuth, requirePermission("employees.edit"), async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const employee = await prisma.employee.update({
      where: { id },
      data: { status },
    });
    res.json(employee);
  });

  app.get("/api/products/:id/pricing-snapshot", requireAppAuth, requireAnyPermission(["pricing.view", "pricing.simulate", "products.tab.cost"]), async (req, res) => {
    const { id } = req.params;
    const { taxRuleId } = req.query;

    try {
      const analysis = await getProductCostAnalysis(id);
      if (!analysis) return res.status(404).json({ error: "Produto não encontrado" });
      if (isCostAnalysisFailure(analysis)) return res.status(400).json(analysis);

      let pricing = null;
      if (taxRuleId) {
        pricing = await prisma.productPricing.findFirst({
          where: { productId: id, taxRuleId: taxRuleId as string },
          include: { TaxRule: { include: { TaxComponent: true } } }
        });
      }

      if (!pricing) {
        pricing = await prisma.productPricing.findFirst({
          where: { productId: id },
          include: { TaxRule: { include: { TaxComponent: true } } }
        });
      }

      const taxRate = pricing?.TaxRule?.TaxComponent?.reduce((acc: number, c: any) => acc + Number(c.percentage), 0) / 100 || 0;
      const commRate = Number(pricing?.commission || 0) / 100;
      const marginRate = Number(pricing?.desiredMargin || 0) / 100;
      const otherRate = Number(pricing?.otherVariables || 0) / 100;
      const freight = Number(pricing?.freightOut || 0);

      const officialCost = resolveOfficialProductFinalCostFromAnalysis(analysis);
      if (isOfficialProductFinalCostFailure(officialCost)) {
        const diag = officialCost.diagnostics[0];
        return res.status(400).json({
          error: diag?.code ?? "CUSTO_OFICIAL_NAO_CALCULADO",
          message: diag?.message,
        });
      }

      const divisor = 1 - taxRate - commRate - otherRate - marginRate;
      const suggestedPrice = divisor > 0 ? (officialCost.finalUnitCost + freight) / divisor : 0;

      const calculationExplainability = buildPricingSnapshotExplainability({
        analysis: analysis as any,
        taxRate,
        commRate,
        marginRate,
        otherRate,
        freight,
        suggestedPrice,
        divisor,
      });

      // marginPerc = premissa de margem desejada na formação de preço (compat.); preferir desiredMarginPremissaPct
      res.json({
        unitCost: officialCost.finalUnitCost,
        suggestedPrice,
        taxesPerc: taxRate * 100,
        commissionPerc: commRate * 100,
        freightValue: freight,
        desiredMarginPremissaPct: marginRate * 100,
        marginPerc: marginRate * 100,
        costBase: OFFICIAL_PRODUCT_FINAL_COST_SOURCE,
        officialCostSource: officialCost.source,
        costAnalysisPartial: officialCost.costAnalysisPartial,
        calculationExplainability,
      });
    } catch (error) {
      console.error("Pricing snapshot error:", error);
      res.status(500).json({ error: "Erro ao gerar snapshot de preço" });
    }
  });

  type MaterialDemandDateBasis = import("./src/lib/materialDemandFilters.js").MaterialDemandDateBasis;

  const materialDemandSortBySet = new Set([
    "estimatedValueTotal",
    "quantityTotal",
    "orderCount",
    "productCount",
    "latestUsageAt",
    "description",
  ]);

  const loadMaterialDemandDataset = (filters: MaterialDemandFilters) =>
    getCachedMaterialDemandDataset(filters, () =>
      buildMaterialDemandDataset(filters, { includeRowDetails: true })
    );

  const endOfDay = (iso: string) => {
    const d = new Date(iso);
    d.setHours(23, 59, 59, 999);
    return d;
  };

  const safeNum = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const parsePositiveInt = (value: unknown, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };

  const sortMaterialRows = (
    rows: Array<Record<string, unknown>>,
    sortBy: string,
    sortDir: "asc" | "desc"
  ) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const safeSortBy = materialDemandSortBySet.has(sortBy) ? sortBy : "estimatedValueTotal";
    return [...rows].sort((a, b) => {
      if (safeSortBy === "description") {
        return ((String(a.description ?? "")).localeCompare(String(b.description ?? ""))) * dir;
      }
      if (safeSortBy === "latestUsageAt") {
        return String(a.latestUsageAt ?? "").localeCompare(String(b.latestUsageAt ?? "")) * dir;
      }
      return ((Number(a[safeSortBy] ?? 0) - Number(b[safeSortBy] ?? 0))) * dir;
    });
  };

  const sortRowsByMode = (rows: Array<Record<string, unknown>>, mode: MaterialDemandMode) => {
    return [...rows].sort((a, b) => {
      if (mode === "value") return Number(b.estimatedValueTotal ?? 0) - Number(a.estimatedValueTotal ?? 0);
      if (mode === "orders") return Number(b.orderCount ?? 0) - Number(a.orderCount ?? 0);
      if (mode === "products") return Number(b.productCount ?? 0) - Number(a.productCount ?? 0);
      return Number(b.quantityTotal ?? 0) - Number(a.quantityTotal ?? 0);
    });
  };

  const buildMaterialDemandDataset = async (
    filters: MaterialDemandFilters,
    options?: { includeRowDetails?: boolean }
  ) => {
    const includeRowDetails = options?.includeRowDetails ?? true;
    const where = buildMaterialDemandSalesOrderWhere(filters);

    const salesOrders = await prisma.salesOrder.findMany({
      where,
      include: {
        Customer: { select: { id: true, companyName: true } },
        items: {
          include: {
            Product: { select: { id: true, sku: true, name: true } },
          },
        },
      },
      orderBy:
        filters.dateBasis === "expectedDeliveryDate"
          ? [{ expectedDeliveryDate: "asc" }, { issueDate: "desc" }]
          : { issueDate: "desc" },
    });

    const ordersWithoutDeliveryDate = salesOrders.filter((o) => !o.expectedDeliveryDate).length;
    const coverage = createMaterialDemandCoverage();
    coverage.ordersMatched = salesOrders.length;
    coverage.ordersWithoutDeliveryDate = ordersWithoutDeliveryDate;

    const analysisCache = await initAnalysisCache();
    const productAnalysisMemo = new Map<string, any>();
    const openBookExplosionMemo = new Map<string, Map<string, ExplosionRowCore>>();
    const getProductAnalysis = async (pid: string) => {
      if (productAnalysisMemo.has(pid)) return productAnalysisMemo.get(pid);
      const a = await getProductCostAnalysis(pid, analysisCache, true);
      productAnalysisMemo.set(pid, a);
      return a;
    };

    type MaterialAgg = {
      materialId: string;
      code: string | null;
      description: string;
      unit: string | null;
      unitKey: string;
      unitLabel: string;
      quantityTotal: number;
      valueTotal: number;
      unitCostReference: number | null;
      orderIds: Set<string>;
      productIds: Set<string>;
      customerIds: Set<string>;
      latestUsageAt: Date | null;
      productContrib: Map<
        string,
        { productId: string; sku: string | null; name: string; value: number }
      >;
      customerContrib: Map<
        string,
        { customerId: string; customerName: string; value: number }
      >;
      origins: Array<{
        salesOrderId: string;
        orderCode: string;
        orderStatus: string;
        orderDate: string;
        issueDate: string;
        expectedDeliveryDate: string | null;
        customerId: string | null;
        customerName: string | null;
        companyIssuer: string | null;
        productId: string;
        productSku: string | null;
        productName: string | null;
        orderQty: number;
        materialQtyPerUnit: number | null;
        estimatedQuantity: number | null;
        unitCostReference: number | null;
        estimatedValue: number | null;
      }>;
    };

    const byMaterial = new Map<string, MaterialAgg>();
    const byPeriod = new Map<
      string,
      { value: number; orderIds: Set<string>; quantityByUnit: Map<string, number> }
    >();
    const byNeedDeliveryPeriod = new Map<
      string,
      {
        period: string;
        periodLabel: string;
        materialId: string;
        code: string | null;
        description: string;
        unit: string | null;
        unitKey: string;
        unitLabel: string;
        quantity: number;
        value: number;
        orderIds: Set<string>;
      }
    >();
    const byProduct = new Map<string, { productId: string; sku: string | null; name: string; quantity: number; value: number; orderIds: Set<string> }>();
    const byCustomer = new Map<string, { customerId: string; customerName: string; quantity: number; value: number; orderIds: Set<string> }>();
    const byCompany = new Map<string, { companyIssuer: string; quantity: number; value: number; orderIds: Set<string> }>();

    for (const order of salesOrders) {
      const orderDate = new Date(order.issueDate);
      const issueDateIso = order.issueDate.toISOString();
      const expectedDeliveryDateIso = order.expectedDeliveryDate
        ? order.expectedDeliveryDate.toISOString()
        : null;
      const aggregationPeriodKey = materialDemandAggregationPeriodKey(
        filters.dateBasis,
        orderDate,
        order.expectedDeliveryDate
      );
      const planningDate =
        filters.dateBasis === "expectedDeliveryDate" && order.expectedDeliveryDate
          ? new Date(order.expectedDeliveryDate)
          : orderDate;
      const customerName = order.Customer?.companyName ?? null;
      const companyIssuerSafe = order.companyIssuer?.trim() || null;

      for (const item of order.items) {
        coverage.orderItemsTotal += 1;
        const orderQty = safeNum(item.quantity) ?? 0;
        const productSkuEarly = item.Product?.sku?.trim() || item.skuSnapshot?.trim() || null;
        const productNameEarly = item.Product?.name?.trim() || item.productNameSnapshot?.trim() || "Produto";
        if (!(orderQty > 0)) {
          coverage.orderItemsSkippedInvalidQty += 1;
          recordMaterialDemandSkip(coverage, {
            orderCode: order.orderCode,
            productSku: productSkuEarly,
            productName: productNameEarly,
            reason: "Quantidade do item inválida ou zero",
          });
          continue;
        }

        const analysis = await getProductAnalysis(item.productId);
        if (!analysis || isCostAnalysisFailure(analysis)) {
          coverage.orderItemsSkippedAnalysisFailure += 1;
          recordMaterialDemandSkip(coverage, {
            orderCode: order.orderCode,
            productSku: productSkuEarly,
            productName: productNameEarly,
            reason: "Análise de custo/composição indisponível para o produto",
          });
          continue;
        }
        const explosion = await buildOpenBookRawMaterialExplosionPerUnit(
          item.productId,
          analysisCache,
          new Set<string>(),
          openBookExplosionMemo
        );
        if (!(explosion instanceof Map)) {
          coverage.orderItemsSkippedExplosionError += 1;
          recordMaterialDemandSkip(coverage, {
            orderCode: order.orderCode,
            productSku: productSkuEarly,
            productName: productNameEarly,
            reason: "Não foi possível explodir a composição do produto",
          });
          continue;
        }
        const mp = Number((analysis as { totalMaterialCost?: unknown }).totalMaterialCost ?? 0);
        const industri = Number((analysis as { totalIndustrialCost?: unknown }).totalIndustrialCost ?? 0);
        const rows = finalizeRowsForOpenBook(explosion, industri, mp) as Array<Record<string, unknown>>;
        if (rows.length === 0) {
          coverage.orderItemsSkippedNoMaterials += 1;
          recordMaterialDemandSkip(coverage, {
            orderCode: order.orderCode,
            productSku: productSkuEarly,
            productName: productNameEarly,
            reason: "Composição sem matéria-prima registrada para custeio",
          });
          continue;
        }

        coverage.orderItemsProcessed += 1;

        const productSku = productSkuEarly;
        const productName = productNameEarly;

        for (const row of rows) {
          const mid = typeof row.materialId === "string" && row.materialId.trim() ? row.materialId : null;
          if (!mid) continue;
          if (filters.materialId && mid !== filters.materialId) continue;

          const code = typeof row.code === "string" && row.code.trim() ? row.code.trim() : null;
          const desc =
            typeof row.description === "string" && row.description.trim()
              ? row.description.trim()
              : "Matéria-prima";
          const unit = typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : null;
          const { unitKey, unitLabel } = normalizeMaterialUnitKey(unit);
          if (filters.unitKey && unitKey !== filters.unitKey) continue;
          const textHaystack = `${mid} ${code ?? ""} ${desc} ${unit ?? ""}`.toLowerCase();
          if (filters.search && !textHaystack.includes(filters.search)) continue;

          const qtyPerUnit = safeNum(row.quantity);
          const valuePerUnit = safeNum(row.totalCost);
          const unitCostRef = safeNum(row.unitCostEffective);
          const estimatedQuantity = qtyPerUnit != null ? qtyPerUnit * orderQty : null;
          const estimatedValue = valuePerUnit != null ? valuePerUnit * orderQty : null;

          const current =
            byMaterial.get(mid) ??
            {
              materialId: mid,
              code,
              description: desc,
              unit,
              unitKey,
              unitLabel,
              quantityTotal: 0,
              valueTotal: 0,
              unitCostReference: unitCostRef,
              orderIds: new Set<string>(),
              productIds: new Set<string>(),
              customerIds: new Set<string>(),
              latestUsageAt: null,
              productContrib: new Map(),
              customerContrib: new Map(),
              origins: [],
            };

          if (estimatedQuantity != null) current.quantityTotal += estimatedQuantity;
          if (estimatedValue != null) current.valueTotal += estimatedValue;
          if (estimatedValue != null) {
            const prodContrib =
              current.productContrib.get(item.productId) ??
              {
                productId: item.productId,
                sku: productSku,
                name: productName,
                value: 0,
              };
            prodContrib.value += estimatedValue;
            current.productContrib.set(item.productId, prodContrib);
            if (order.customerId) {
              const custContrib =
                current.customerContrib.get(order.customerId) ??
                {
                  customerId: order.customerId,
                  customerName: customerName ?? "Cliente",
                  value: 0,
                };
              custContrib.value += estimatedValue;
              current.customerContrib.set(order.customerId, custContrib);
            }
          }
          if (current.unitCostReference == null && unitCostRef != null) {
            current.unitCostReference = unitCostRef;
          }
          current.orderIds.add(order.id);
          current.productIds.add(item.productId);
          if (order.customerId) current.customerIds.add(order.customerId);
          if (!current.latestUsageAt || planningDate > current.latestUsageAt) {
            current.latestUsageAt = planningDate;
          }
          if (includeRowDetails) {
            current.origins.push({
              salesOrderId: order.id,
              orderCode: order.orderCode,
              orderStatus: order.status,
              orderDate: issueDateIso,
              issueDate: issueDateIso,
              expectedDeliveryDate: expectedDeliveryDateIso,
              customerId: order.customerId ?? null,
              customerName,
              companyIssuer: companyIssuerSafe,
              productId: item.productId,
              productSku,
              productName,
              orderQty,
              materialQtyPerUnit: qtyPerUnit,
              estimatedQuantity,
              unitCostReference: unitCostRef,
              estimatedValue,
            });
          }
          byMaterial.set(mid, current);

          const needKey = `${aggregationPeriodKey}|${unitKey}|${mid}`;
          const needAgg =
            byNeedDeliveryPeriod.get(needKey) ??
            {
              period: aggregationPeriodKey,
              periodLabel: materialDemandPeriodLabel(aggregationPeriodKey),
              materialId: mid,
              code,
              description: desc,
              unit,
              unitKey,
              unitLabel,
              quantity: 0,
              value: 0,
              orderIds: new Set<string>(),
            };
          if (estimatedQuantity != null) needAgg.quantity += estimatedQuantity;
          if (estimatedValue != null) needAgg.value += estimatedValue;
          needAgg.orderIds.add(order.id);
          byNeedDeliveryPeriod.set(needKey, needAgg);

          const periodAgg =
            byPeriod.get(aggregationPeriodKey) ?? {
              value: 0,
              orderIds: new Set<string>(),
              quantityByUnit: new Map<string, number>(),
            };
          if (estimatedQuantity != null) {
            periodAgg.quantityByUnit.set(
              unitKey,
              (periodAgg.quantityByUnit.get(unitKey) ?? 0) + estimatedQuantity
            );
          }
          if (estimatedValue != null) periodAgg.value += estimatedValue;
          periodAgg.orderIds.add(order.id);
          byPeriod.set(aggregationPeriodKey, periodAgg);

          const pid = item.productId;
          const prodAgg =
            byProduct.get(pid) ??
            {
              productId: pid,
              sku: productSku,
              name: productName,
              quantity: 0,
              value: 0,
              orderIds: new Set<string>(),
            };
          if (estimatedQuantity != null) prodAgg.quantity += estimatedQuantity;
          if (estimatedValue != null) prodAgg.value += estimatedValue;
          prodAgg.orderIds.add(order.id);
          byProduct.set(pid, prodAgg);

          const cid = order.customerId ?? "__unknown_customer__";
          const custAgg =
            byCustomer.get(cid) ??
            {
              customerId: order.customerId ?? "",
              customerName: customerName ?? "Cliente",
              quantity: 0,
              value: 0,
              orderIds: new Set<string>(),
            };
          if (estimatedQuantity != null) custAgg.quantity += estimatedQuantity;
          if (estimatedValue != null) custAgg.value += estimatedValue;
          custAgg.orderIds.add(order.id);
          byCustomer.set(cid, custAgg);

          const companyKey = companyIssuerSafe ?? "Não informado";
          const compAgg =
            byCompany.get(companyKey) ??
            { companyIssuer: companyKey, quantity: 0, value: 0, orderIds: new Set<string>() };
          if (estimatedQuantity != null) compAgg.quantity += estimatedQuantity;
          if (estimatedValue != null) compAgg.value += estimatedValue;
          compAgg.orderIds.add(order.id);
          byCompany.set(companyKey, compAgg);
        }
      }
    }

    const materials = [...byMaterial.values()];
    coverage.uniqueMaterials = materials.length;
    const totalEstimatedValue = materials.reduce((acc, m) => acc + m.valueTotal, 0);

    const quantityByUnitMap = new Map<
      string,
      { unitKey: string; unitLabel: string; totalQuantity: number; materialCount: number }
    >();
    for (const m of materials) {
      const bucket =
        quantityByUnitMap.get(m.unitKey) ??
        { unitKey: m.unitKey, unitLabel: m.unitLabel, totalQuantity: 0, materialCount: 0 };
      bucket.totalQuantity += m.quantityTotal;
      bucket.materialCount += 1;
      quantityByUnitMap.set(m.unitKey, bucket);
    }
    const quantityByUnit = [...quantityByUnitMap.values()].sort(
      (a, b) => b.totalQuantity - a.totalQuantity
    );
    const hasMixedUnits = quantityByUnit.length > 1;
    const activeUnitKey = filters.unitKey ?? (quantityByUnit.length === 1 ? quantityByUnit[0]?.unitKey ?? null : null);
    const activeUnitBucket = activeUnitKey ? quantityByUnitMap.get(activeUnitKey) : null;
    const totalEstimatedQuantity =
      activeUnitBucket != null ? activeUnitBucket.totalQuantity : hasMixedUnits ? null : materials.reduce((acc, m) => acc + m.quantityTotal, 0);
    const quantityTotalsComparable = activeUnitKey != null || !hasMixedUnits;

    const allOrderIds = new Set<string>();
    const allProductIds = new Set<string>();
    const allCustomerIds = new Set<string>();
    for (const m of materials) {
      m.orderIds.forEach((x) => allOrderIds.add(x));
      m.productIds.forEach((x) => allProductIds.add(x));
      m.customerIds.forEach((x) => allCustomerIds.add(x));
    }

    const rows = materials.map((m) => {
      const byProd = new Map<string, { productId: string; sku: string | null; name: string; quantity: number; value: number }>();
      const byCust = new Map<string, { customerId: string; customerName: string; quantity: number; value: number }>();
      const byOrder = new Map<
        string,
        {
          salesOrderId: string;
          orderCode: string;
          orderDate: string;
          issueDate: string;
          expectedDeliveryDate: string | null;
          orderStatus: string;
          quantity: number;
          value: number;
        }
      >();

      if (includeRowDetails) {
        for (const o of m.origins) {
          const pKey = o.productId;
          const p = byProd.get(pKey) ?? {
            productId: o.productId,
            sku: o.productSku,
            name: o.productName ?? "Produto",
            quantity: 0,
            value: 0,
          };
          if (o.estimatedQuantity != null) p.quantity += o.estimatedQuantity;
          if (o.estimatedValue != null) p.value += o.estimatedValue;
          byProd.set(pKey, p);

          const cKey = o.customerId ?? "__unknown_customer__";
          const c = byCust.get(cKey) ?? {
            customerId: o.customerId ?? "",
            customerName: o.customerName ?? "Cliente",
            quantity: 0,
            value: 0,
          };
          if (o.estimatedQuantity != null) c.quantity += o.estimatedQuantity;
          if (o.estimatedValue != null) c.value += o.estimatedValue;
          byCust.set(cKey, c);

          const ord = byOrder.get(o.salesOrderId) ?? {
            salesOrderId: o.salesOrderId,
            orderCode: o.orderCode,
            orderDate: o.orderDate,
            issueDate: o.issueDate,
            expectedDeliveryDate: o.expectedDeliveryDate,
            orderStatus: o.orderStatus,
            quantity: 0,
            value: 0,
          };
          if (o.estimatedQuantity != null) ord.quantity += o.estimatedQuantity;
          if (o.estimatedValue != null) ord.value += o.estimatedValue;
          byOrder.set(o.salesOrderId, ord);
        }
      }

      const unitQuantityDenominator = quantityByUnitMap.get(m.unitKey)?.totalQuantity ?? 0;

      const leadingProductEntry = [...m.productContrib.values()].sort((a, b) => b.value - a.value)[0] ?? null;
      const leadingCustomerEntry = [...m.customerContrib.values()].sort((a, b) => b.value - a.value)[0] ?? null;

      const baseRow = {
        materialId: m.materialId,
        code: m.code,
        description: m.description,
        unit: m.unit,
        unitKey: m.unitKey,
        unitLabel: m.unitLabel,
        quantityTotal: m.quantityTotal,
        unitCostReference:
          m.unitCostReference != null
            ? m.unitCostReference
            : m.quantityTotal > 0
              ? m.valueTotal / m.quantityTotal
              : null,
        estimatedValueTotal: m.valueTotal,
        orderCount: m.orderIds.size,
        productCount: m.productIds.size,
        customerCount: m.customerIds.size,
        latestUsageAt: m.latestUsageAt ? m.latestUsageAt.toISOString() : null,
        pctOfTotalQuantity:
          unitQuantityDenominator > 0 ? (m.quantityTotal / unitQuantityDenominator) * 100 : null,
        pctOfTotalValue: totalEstimatedValue > 0 ? (m.valueTotal / totalEstimatedValue) * 100 : null,
        leadingProduct: leadingProductEntry
          ? {
              productId: leadingProductEntry.productId,
              sku: leadingProductEntry.sku,
              name: leadingProductEntry.name,
              value: leadingProductEntry.value,
            }
          : null,
        leadingCustomer: leadingCustomerEntry
          ? {
              customerId: leadingCustomerEntry.customerId,
              customerName: leadingCustomerEntry.customerName,
              value: leadingCustomerEntry.value,
            }
          : null,
      };

      if (!includeRowDetails) {
        return baseRow;
      }

      return {
        ...baseRow,
        topProducts: [...byProd.values()]
          .sort((a, b) => b.value - a.value)
          .slice(0, 8),
        topCustomers: [...byCust.values()]
          .sort((a, b) => b.value - a.value)
          .slice(0, 8),
        orders: [...byOrder.values()]
          .sort((a, b) => {
            const aKey = a.expectedDeliveryDate ?? a.orderDate;
            const bKey = b.expectedDeliveryDate ?? b.orderDate;
            return bKey.localeCompare(aKey);
          })
          .slice(0, 12),
        origins: m.origins,
      };
    });

    const leaderByValue =
      [...rows].sort((a, b) => Number(b.estimatedValueTotal ?? 0) - Number(a.estimatedValueTotal ?? 0))[0] ?? null;
    const leaderSharePct =
      leaderByValue && totalEstimatedValue > 0
        ? (Number(leaderByValue.estimatedValueTotal ?? 0) / totalEstimatedValue) * 100
        : null;

    const paretoByQuantityByUnit = quantityByUnit.map((u) => ({
      unitKey: u.unitKey,
      unitLabel: u.unitLabel,
      rows: rows
        .filter((r) => r.unitKey === u.unitKey)
        .sort((a, b) => Number(b.quantityTotal ?? 0) - Number(a.quantityTotal ?? 0))
        .slice(0, 10),
    }));

    const needByPeriodTotalRows = byNeedDeliveryPeriod.size;
    const needByDeliveryPeriod = [...byNeedDeliveryPeriod.values()]
      .sort(
        (a, b) =>
          a.period.localeCompare(b.period) ||
          b.value - a.value ||
          String(a.description ?? "").localeCompare(String(b.description ?? ""))
      )
      .slice(0, 200)
      .map((row) => ({
        period: row.period,
        periodLabel: row.periodLabel,
        materialId: row.materialId,
        code: row.code,
        description: row.description,
        unit: row.unit,
        unitKey: row.unitKey,
        unitLabel: row.unitLabel,
        quantity: row.quantity,
        estimatedValue: row.value,
        orderCount: row.orderIds.size,
      }));

    const semantics = {
      source: "SALES_ORDER_ITEMS_WITH_PRODUCT_OPEN_BOOK",
      meaning: "DEMANDA_ESTIMADA_MATERIA_PRIMA",
      label:
        "Base derivada de itens de pedidos de venda com explosão estimada da composição atual dos produtos. Não representa consumo real de fábrica, estoque disponível nem compras em aberto.",
      quantityRankingNote:
        "Quantidades só são comparáveis entre matérias-primas com a mesma unidade de medida. Rankings globais de quantidade usam grupos por unidade; comparação entre unidades distintas use valor estimado (R$).",
      deliveryDateNote:
        filters.dateBasis === "expectedDeliveryDate"
          ? filters.includeOrdersWithoutDeliveryDate
            ? "Pedidos sem data de entrega prevista aparecem no agrupamento «Sem data de entrega» e permanecem visíveis ao filtrar por entrega."
            : "Pedidos sem data de entrega prevista foram excluídos desta estimativa."
          : null,
      periodGroupingNote:
        filters.dateBasis === "expectedDeliveryDate"
          ? "Agrupamento mensal pela entrega prevista do pedido."
          : "Agrupamento mensal pela emissão do pedido.",
      needByPeriodTruncated: needByPeriodTotalRows > 200,
      needByPeriodTotalRows,
    };

    const filtersApplied = {
      startDate: filters.startDate,
      endDate: filters.endDate,
      dateBasis: filters.dateBasis,
      status: filters.status,
      statuses: filters.statuses,
      customerId: filters.customerId,
      productId: filters.productId,
      materialId: filters.materialId,
      companyIssuer: filters.companyIssuer,
      unitKey: filters.unitKey,
      mode: filters.mode,
      search: filters.search || null,
      includeOrdersWithoutDeliveryDate: filters.includeOrdersWithoutDeliveryDate,
    };

    const summary = {
      totalEstimatedQuantity,
      totalEstimatedValue,
      uniqueMaterials: rows.length,
      orderCount: allOrderIds.size,
      productCount: allProductIds.size,
      customerCount: allCustomerIds.size,
      hasMixedUnits,
      quantityTotalsComparable,
      quantityByUnit,
      leaderMaterial: leaderByValue
        ? {
            materialId: leaderByValue.materialId,
            code: leaderByValue.code,
            description: leaderByValue.description,
            quantityTotal: leaderByValue.quantityTotal,
            estimatedValueTotal: leaderByValue.estimatedValueTotal,
            unit: leaderByValue.unit,
            unitLabel: leaderByValue.unitLabel,
          }
        : null,
      leaderSharePct,
      ordersWithoutDeliveryDate,
    };

    const charts = {
      needByDeliveryPeriod,
      paretoByQuantityByUnit,
      paretoByValue: [...rows]
        .sort((a, b) => Number(b.estimatedValueTotal ?? 0) - Number(a.estimatedValueTotal ?? 0))
        .slice(0, 15),
      evolution: [...byPeriod.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([period, v]) => {
          const quantity =
            activeUnitKey != null
              ? (v.quantityByUnit.get(activeUnitKey) ?? 0)
              : quantityTotalsComparable
                ? [...v.quantityByUnit.values()].reduce((acc, q) => acc + q, 0)
                : null;
          return {
            period,
            periodLabel: materialDemandPeriodLabel(period),
            quantity,
            value: v.value,
            orderCount: v.orderIds.size,
          };
        }),
      byProduct: [...byProduct.values()]
        .sort((a, b) => b.value - a.value)
        .slice(0, 20)
        .map((x) => ({
          productId: x.productId,
          sku: x.sku,
          name: x.name,
          quantity: x.quantity,
          value: x.value,
          orderCount: x.orderIds.size,
        })),
      byCustomer: [...byCustomer.values()]
        .filter((x) => x.customerId)
        .sort((a, b) => b.value - a.value)
        .slice(0, 20)
        .map((x) => ({
          customerId: x.customerId,
          customerName: x.customerName,
          quantity: x.quantity,
          value: x.value,
          orderCount: x.orderIds.size,
        })),
      byCompanyIssuer: [...byCompany.values()]
        .sort((a, b) => b.value - a.value)
        .map((x) => ({
          companyIssuer: x.companyIssuer,
          quantity: x.quantity,
          value: x.value,
          orderCount: x.orderIds.size,
        })),
    };

    const facets = {
      statuses: [...new Set(salesOrders.map((o) => o.status))].sort(),
      customers: [...new Map(
        salesOrders
          .filter((o) => o.Customer?.id)
          .map((o) => [o.Customer!.id, { id: o.Customer!.id, companyName: o.Customer!.companyName }])
      ).values()],
      products: [...new Map(
        salesOrders.flatMap((o) =>
          o.items.map((it) => [
            it.productId,
            {
              id: it.productId,
              sku: it.Product?.sku?.trim() || it.skuSnapshot?.trim() || null,
              name: it.Product?.name?.trim() || it.productNameSnapshot?.trim() || "Produto",
            },
          ] as const)
        )
      ).values()],
      materials: rows
        .map((r) => ({
          materialId: r.materialId,
          code: r.code,
          description: r.description,
          unit: r.unit,
        }))
        .sort((a, b) => String(a.description ?? "").localeCompare(String(b.description ?? ""))),
      companyIssuers: [
        ...new Set(
          salesOrders
            .map((o) => o.companyIssuer?.trim())
            .filter((v): v is string => Boolean(v))
        ),
      ].sort(),
      units: quantityByUnit.map((u) => ({
        unitKey: u.unitKey,
        unitLabel: u.unitLabel,
        materialCount: u.materialCount,
        totalQuantity: u.totalQuantity,
      })),
    };

    return {
      semantics,
      filtersApplied,
      summary,
      coverage,
      charts,
      rows,
      facets,
      sortedRowsByMode: sortRowsByMode(rows, filters.mode),
    };
  };

  const buildMaterialDemandPlannedVsRealizedDataset = async (
    filters: MaterialDemandFilters,
    query: Record<string, unknown> = {}
  ) => {
    const where = buildMaterialDemandSalesOrderWhere(filters);
    const salesOrders = await prisma.salesOrder.findMany({
      where,
      include: {
        Customer: { select: { id: true, companyName: true, tradeName: true } },
        items: {
          include: {
            Product: { select: { id: true, sku: true, name: true } },
          },
        },
      },
      orderBy:
        filters.dateBasis === "expectedDeliveryDate"
          ? [{ expectedDeliveryDate: "asc" }, { issueDate: "desc" }]
          : { issueDate: "desc" },
    });

    const analysisCache = await initAnalysisCache();
    const productAnalysisMemo = new Map<string, unknown>();
    const openBookExplosionMemo = new Map<string, Map<string, ExplosionRowCore>>();
    const productExplosions = new Map<string, ProductBomExplosionRow[]>();

    const getProductAnalysis = async (pid: string) => {
      if (productAnalysisMemo.has(pid)) return productAnalysisMemo.get(pid);
      const a = await getProductCostAnalysis(pid, analysisCache, true);
      productAnalysisMemo.set(pid, a);
      return a;
    };

    const productIds = new Set<string>();
    for (const order of salesOrders) {
      for (const item of order.items) productIds.add(item.productId);
    }

    for (const productId of productIds) {
      const analysis = await getProductAnalysis(productId);
      if (!analysis || isCostAnalysisFailure(analysis)) continue;

      const explosion = await buildOpenBookRawMaterialExplosionPerUnit(
        productId,
        analysisCache,
        new Set<string>(),
        openBookExplosionMemo
      );
      if (!(explosion instanceof Map)) continue;

      const mp = Number((analysis as { totalMaterialCost?: unknown }).totalMaterialCost ?? 0);
      const industri = Number((analysis as { totalIndustrialCost?: unknown }).totalIndustrialCost ?? 0);
      const rows = finalizeRowsForOpenBook(explosion, industri, mp) as Array<Record<string, unknown>>;
      if (rows.length === 0) continue;

      const bomRows: ProductBomExplosionRow[] = [];
      for (const row of rows) {
        const mid = typeof row.materialId === "string" && row.materialId.trim() ? row.materialId : null;
        if (!mid) continue;
        const code = typeof row.code === "string" && row.code.trim() ? row.code.trim() : null;
        const desc =
          typeof row.description === "string" && row.description.trim()
            ? row.description.trim()
            : "Matéria-prima";
        const unit = typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : null;
        const { unitKey, unitLabel } = normalizeMaterialUnitKey(unit);
        bomRows.push({
          materialId: mid,
          materialCode: code,
          materialName: desc,
          unit,
          unitKey,
          unitLabel,
          quantityPerUnit: safeNum(row.quantity) ?? 0,
          valuePerUnit: safeNum(row.totalCost),
          unitCost: safeNum(row.unitCostEffective),
        });
      }
      if (bomRows.length > 0) productExplosions.set(productId, bomRows);
    }

    const intelligenceFilters = buildMaterialDemandIntelligenceFilters(filters, query);
    const sourceOrders = salesOrders.map((order) => mapPrismaSalesOrderToIntelligenceSource(order));

    const quantityByUnitMap = new Map<
      string,
      { unitKey: string; unitLabel: string; totalQuantity: number }
    >();
    for (const bomRows of productExplosions.values()) {
      for (const row of bomRows) {
        const bucket =
          quantityByUnitMap.get(row.unitKey) ??
          { unitKey: row.unitKey, unitLabel: row.unitLabel, totalQuantity: 0 };
        bucket.totalQuantity += row.quantityPerUnit;
        quantityByUnitMap.set(row.unitKey, bucket);
      }
    }
    const quantityByUnit = [...quantityByUnitMap.values()];
    const activeUnitKey =
      filters.unitKey ?? (quantityByUnit.length === 1 ? quantityByUnit[0]?.unitKey ?? null : null);

    const payload = buildSalesOrderRawMaterialIntelligencePayload({
      orders: sourceOrders,
      productExplosions,
      filters,
      intelligenceFilters,
      invoicingScope: filters.invoicingScope,
      quantityByUnit,
      activeUnitKey,
    });

    return {
      ...payload,
      nfeByOrderId: new Map(Object.entries(payload.nfeByOrderId)),
    };
  };

  const materialDemandViewPermissions = [...MATERIAL_DEMAND_VIEW_PERMISSIONS];
  const materialDemandRouteGuard = [requireAppAuth, requireAnyPermission(materialDemandViewPermissions)] as const;

  const handleMaterialDemandSummary = async (req: express.Request, res: express.Response) => {
    try {
      const filters = parseMaterialDemandFilters(req.query as Record<string, unknown>);
      const data = await loadMaterialDemandDataset(filters);
      res.json({
        semantics: data.semantics,
        filtersApplied: data.filtersApplied,
        summary: data.summary,
        coverage: data.coverage,
        charts: data.charts,
        facets: data.facets,
      });
    } catch (error) {
      console.error("Material demand summary endpoint error:", error);
      res.status(500).json({ error: "Erro ao montar resumo de demanda de matéria-prima." });
    }
  };

  const handleMaterialDemandRows = async (req: express.Request, res: express.Response) => {
    try {
      const filters = parseMaterialDemandFilters(req.query as Record<string, unknown>);
      const page = parsePositiveInt((req.query as Record<string, unknown>).page, 1);
      const pageSize = Math.min(parsePositiveInt((req.query as Record<string, unknown>).pageSize, 20), 100);
      const sortByRaw =
        typeof (req.query as Record<string, unknown>).sortBy === "string"
          ? String((req.query as Record<string, unknown>).sortBy)
          : "estimatedValueTotal";
      const sortDirRaw =
        typeof (req.query as Record<string, unknown>).sortDir === "string"
          ? String((req.query as Record<string, unknown>).sortDir).toLowerCase()
          : "desc";
      const sortDir: "asc" | "desc" = sortDirRaw === "asc" ? "asc" : "desc";
      const sortBy = materialDemandSortBySet.has(sortByRaw) ? sortByRaw : "estimatedValueTotal";

      const data = await loadMaterialDemandDataset(filters);
      const sorted = sortMaterialRows(data.rows, sortBy, sortDir);
      const totalItems = sorted.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const safePage = Math.min(page, totalPages);
      const start = (safePage - 1) * pageSize;
      const rows = sorted.slice(start, start + pageSize);

      res.json({
        semantics: data.semantics,
        filtersApplied: data.filtersApplied,
        pagination: {
          page: safePage,
          pageSize,
          totalItems,
          totalPages,
        },
        sort: {
          sortBy,
          sortDir,
        },
        rows,
      });
    } catch (error) {
      console.error("Material demand rows endpoint error:", error);
      res.status(500).json({ error: "Erro ao montar linhas de demanda de matéria-prima." });
    }
  };

  const handleMaterialDemandDetails = async (req: express.Request, res: express.Response) => {
    try {
      const materialIdParam = typeof req.params.materialId === "string" ? req.params.materialId.trim() : "";
      if (!materialIdParam) {
        return res.status(400).json({ error: "materialId é obrigatório." });
      }
      const originsPage = parsePositiveInt((req.query as Record<string, unknown>).originsPage, 1);
      const originsPageSize = Math.min(
        parsePositiveInt((req.query as Record<string, unknown>).originsPageSize, 50),
        200
      );
      const filters = parseMaterialDemandFilters(req.query as Record<string, unknown>, {
        materialId: materialIdParam,
      });
      const data = await loadMaterialDemandDataset(filters);
      const target = data.rows.find((r) => r.materialId === materialIdParam) as Record<string, unknown> | undefined;
      if (!target) {
        return res.status(404).json({ error: "Matéria-prima não encontrada para os filtros informados." });
      }
      const allOrigins = Array.isArray(target.origins) ? (target.origins as unknown[]) : [];
      const originsTotal = allOrigins.length;
      const originsTotalPages = Math.max(1, Math.ceil(originsTotal / originsPageSize));
      const safeOriginsPage = Math.min(originsPage, originsTotalPages);
      const originsStart = (safeOriginsPage - 1) * originsPageSize;
      const origins = allOrigins.slice(originsStart, originsStart + originsPageSize);
      res.json({
        semantics: data.semantics,
        filtersApplied: data.filtersApplied,
        material: {
          materialId: target.materialId,
          code: target.code,
          description: target.description,
          unit: target.unit,
        },
        totals: {
          quantityTotal: target.quantityTotal,
          estimatedValueTotal: target.estimatedValueTotal,
          orderCount: target.orderCount,
          productCount: target.productCount,
          customerCount: target.customerCount,
          unitCostReference: target.unitCostReference,
          latestUsageAt: target.latestUsageAt,
        },
        topProducts: Array.isArray(target.topProducts) ? target.topProducts : [],
        topCustomers: Array.isArray(target.topCustomers) ? target.topCustomers : [],
        orders: Array.isArray(target.orders) ? target.orders : [],
        origins,
        originsPagination: {
          page: safeOriginsPage,
          pageSize: originsPageSize,
          totalItems: originsTotal,
          totalPages: originsTotalPages,
        },
      });
    } catch (error) {
      console.error("Material demand details endpoint error:", error);
      res.status(500).json({ error: "Erro ao montar detalhes de demanda de matéria-prima." });
    }
  };

  const handleMaterialDemandFacets = async (req: express.Request, res: express.Response) => {
    try {
      const filters = parseMaterialDemandFilters(req.query as Record<string, unknown>);
      const data = await loadMaterialDemandDataset(filters);
      res.json({
        semantics: data.semantics,
        filtersApplied: data.filtersApplied,
        facets: data.facets,
      });
    } catch (error) {
      console.error("Material demand facets endpoint error:", error);
      res.status(500).json({ error: "Erro ao montar filtros de demanda de matéria-prima." });
    }
  };

  /**
   * Inteligência de matéria-prima (demanda estimada) derivada de pedidos de venda.
   * Base: itens de pedido + composição atual dos produtos (não é consumo real de chão de fábrica).
   */
  const handleMaterialDemandAnalysis = async (req: express.Request, res: express.Response) => {
    try {
      const filters = parseMaterialDemandFilters(req.query as Record<string, unknown>);
      const data = await loadMaterialDemandDataset(filters);
      res.json({
        semantics: data.semantics,
        filtersApplied: data.filtersApplied,
        summary: data.summary,
        coverage: data.coverage,
        charts: data.charts,
        rows: data.sortedRowsByMode,
        facets: data.facets,
      });
    } catch (error) {
      console.error("Material demand analysis endpoint error:", error);
      res.status(500).json({ error: "Erro ao montar análise de matéria-prima." });
    }
  };

  const handleMaterialDemandPlannedVsRealized = async (req: express.Request, res: express.Response) => {
    try {
      const filters = parseMaterialDemandFilters(req.query as Record<string, unknown>);
      const data = await buildMaterialDemandPlannedVsRealizedDataset(
        filters,
        req.query as Record<string, unknown>
      );
      res.json({
        filtersApplied: data.filtersApplied,
        summary: data.summary,
        rows: data.rows,
        dataQuality: data.dataQuality,
        intelligence: data.intelligence,
      });
    } catch (error) {
      console.error("Material demand planned-vs-realized endpoint error:", error);
      res.status(500).json({ error: "Erro ao montar previsto x realizado de matéria-prima." });
    }
  };

  const handleMaterialDemandPlannedVsRealizedDetails = async (req: express.Request, res: express.Response) => {
    try {
      const materialIdParam = typeof req.params.materialId === "string" ? req.params.materialId.trim() : "";
      if (!materialIdParam) {
        return res.status(400).json({ error: "materialId é obrigatório." });
      }
      const filters = parseMaterialDemandFilters(req.query as Record<string, unknown>, {
        materialId: materialIdParam,
      });
      const data = await buildMaterialDemandPlannedVsRealizedDataset(
        filters,
        req.query as Record<string, unknown>
      );
      const summaryRow = data.rows.find((row) => row.materialId === materialIdParam) ?? null;
      const audit = buildMaterialUsageAuditPayload(
        materialIdParam,
        data.contributions,
        data.nfeByOrderId,
        summaryRow
      );
      if (!audit) {
        return res.status(404).json({ error: "Matéria-prima não encontrada para os filtros informados." });
      }
      res.json({
        filtersApplied: data.filtersApplied,
        audit,
      });
    } catch (error) {
      console.error("Material demand planned-vs-realized details endpoint error:", error);
      res.status(500).json({ error: "Erro ao montar detalhes previsto x realizado." });
    }
  };

  for (const base of ["/api/products/material-demand", "/api/sales-orders/material-demand"] as const) {
    app.get(`${base}/summary`, ...materialDemandRouteGuard, handleMaterialDemandSummary);
    app.get(`${base}/rows`, ...materialDemandRouteGuard, handleMaterialDemandRows);
    app.get(`${base}/materials/:materialId/details`, ...materialDemandRouteGuard, handleMaterialDemandDetails);
    app.get(`${base}/facets`, ...materialDemandRouteGuard, handleMaterialDemandFacets);
    app.get(`${base}/analysis`, ...materialDemandRouteGuard, handleMaterialDemandAnalysis);
    app.get(`${base}/planned-vs-realized`, ...materialDemandRouteGuard, handleMaterialDemandPlannedVsRealized);
    app.get(
      `${base}/planned-vs-realized/materials/:materialId/details`,
      ...materialDemandRouteGuard,
      handleMaterialDemandPlannedVsRealizedDetails
    );
  }

  /** Agregações para a aba Relatórios (sem BI externo). Respeita filtros de query. */
  app.get("/api/reports/data", requireAppAuth, requirePermission("reports.view"), async (req, res) => {
    try {
      const payload = await buildReportsDataPayload(
        prisma,
        req.query as Record<string, unknown>,
        { getProductCostAnalysis: (productId) => getProductCostAnalysis(productId) }
      );
      res.json(payload);
    } catch (error) {
      console.error("reports/data error:", error);
      res.status(500).json({ error: "Erro ao montar relatórios agregados." });
    }
  });

  // --- API: Customers (Clientes) ---
  app.get("/api/customers/import/template", requireAppAuth, requirePermission("customers.view"), (req, res) => {
    try {
      const buffer = ServerImporter.generateTemplate(CustomerImportConfig);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=template_clientes.xlsx");
      res.send(buffer);
    } catch (error) {
      console.error("Template generation error:", error);
      res.status(500).json({ error: "Erro ao gerar template" });
    }
  });

  app.post("/api/customers/import/preview", requireAppAuth, requirePermission("customers.edit"), upload.single("file"), upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Arquivo não enviado" });
    try {
      const result = await ServerImporter.parseExcel(req.file.buffer, CustomerImportConfig);
      const importId = crypto.randomUUID();
      importCache.set(importId, result.data);
      
      // Cleanup after 30 mins
      setTimeout(() => importCache.delete(importId), 30 * 60 * 1000);
      
      res.json({ ...result, importId });
    } catch (error) {
      console.error("Import preview error:", error);
      res.status(500).json({ error: "Erro ao processar planilha" });
    }
  });

  app.post("/api/customers/import/confirm", requireAppAuth, requirePermission("customers.edit"), async (req, res) => {
    const { data: bodyData, importId } = req.body;
    let data = bodyData;

    if (importId && importCache.has(importId)) {
      data = importCache.get(importId);
      importCache.delete(importId);
    }

    if (!Array.isArray(data)) return res.status(400).json({ error: "Dados inválidos ou sessão de importação expirada." });

    try {
      const taxIds = data.map(d => d.taxId);
      const existing = await prisma.customer.findMany({
        where: { taxId: { in: taxIds } },
        select: { taxId: true }
      });
      const existingTaxIds = new Set(existing.map(e => e.taxId));

      const toCreate = data.filter(d => !existingTaxIds.has(d.taxId));
      const rowsSkippedExisting = data.filter(d => existingTaxIds.has(d.taxId)).length;

      if (toCreate.length > 0) {
        await prisma.customer.createMany({
          data: toCreate.map(d => ({
            companyName: d.companyName,
            tradeName: d.tradeName || null,
            taxId: d.taxId,
            stateTaxId: d.stateTaxId || null,
            contactName: d.contactName || null,
            email: d.email || null,
            phone: d.phone || null,
            address: d.address || null,
            city: d.city || null,
            state: d.state || null,
            zipCode: d.zipCode || null,
            segment: d.segment || null,
            notes: d.notes || null,
            status: "ACTIVE"
          }))
        });
      }

      res.json({
        success: true,
        count: toCreate.length,
        skipped: rowsSkippedExisting,
        summary: {
          rowsProcessed: data.length,
          rowsImported: toCreate.length,
          rowsSkippedExisting,
          rowsFailed: 0
        }
      });
    } catch (error) {
      console.error("Import confirm error:", error);
      res.status(500).json({ error: "Erro ao salvar dados no banco" });
    }
  });

  app.get("/api/customers/search", requireAppAuth, requirePermission("customers.view"), async (req, res) => {
    try {
      const idRaw = typeof req.query.id === "string" ? req.query.id.trim() : "";
      if (idRaw) {
        const customer = await prisma.customer.findUnique({
          where: { id: idRaw },
          select: {
            id: true,
            companyName: true,
            tradeName: true,
            taxId: true,
            city: true,
            state: true,
            email: true,
            phone: true,
          },
        });
        return res.json({
          items: customer ? [serializeCustomerSearchItem(customer)] : [],
        });
      }

      const q = normalizeCustomerSearchQuery(req.query.q ?? req.query.query);
      const limit = parseCustomerSearchLimit(req.query.limit);
      if (q.length < 2) {
        return res.json({ items: [] });
      }

      const where = buildCustomerSearchWhereEnhanced(q);
      const rows = await prisma.customer.findMany({
        where,
        orderBy: { companyName: "asc" },
        take: limit,
        select: {
          id: true,
          companyName: true,
          tradeName: true,
          taxId: true,
          city: true,
          state: true,
          email: true,
          phone: true,
        },
      });

      const items = rankCustomerSearchResults(rows.map(serializeCustomerSearchItem), q);
      res.json({ items });
    } catch (error) {
      console.error("GET /api/customers/search", error);
      res.status(500).json({ error: "Erro ao buscar clientes." });
    }
  });

  app.get("/api/customers", requireAppAuth, requirePermission("customers.view"), async (req, res) => {
    try {
      const query = req.query as Record<string, unknown>;
      if (!shouldUseCustomerPagination(query)) {
        const customers = await prisma.customer.findMany({
          orderBy: { companyName: "asc" },
        });
        return res.json(customers);
      }

      const list = parseCustomerListQuery(query);
      const where = buildCustomerSearchWhere(list.search);
      const [total, items] = await Promise.all([
        prisma.customer.count({ where }),
        prisma.customer.findMany({
          where,
          orderBy: { companyName: "asc" },
          skip: list.skip,
          take: list.limit,
        }),
      ]);

      const meta = customerListMeta(total, list.page, list.limit);
      res.json(buildCustomerListResponse(items, meta));
    } catch (error) {
      console.error("GET /api/customers", error);
      res.status(500).json({ error: "Erro ao listar clientes." });
    }
  });

  /** Indicadores agregados do cadastro (somente leitura; base: SalesOrder). */
  app.get("/api/customers/indicators", requireAppAuth, requirePermission("customers.view"), async (_req, res) => {
    try {
      const VALID_ORDER_STATUSES = ["CANCELLED", "ERROR"] as const;
      const NEGOTIATION_PROPOSAL_STATUSES = ["DRAFT", "ANALYSIS", "SENT"] as const;

      const rows = await prisma.customer.findMany({
        select: {
          id: true,
          state: true,
          status: true,
          segment: true,
          email: true,
          phone: true,
          address: true,
          createdAt: true,
          _count: {
            select: {
              salesOrders: {
                where: { status: { notIn: [...VALID_ORDER_STATUSES] } },
              },
              proposals: {
                where: { status: { in: [...NEGOTIATION_PROPOSAL_STATUSES] } },
              },
            },
          },
        },
      });
      const mapped = rows.map((r) => ({
        id: r.id,
        state: r.state,
        status: r.status,
        segment: r.segment,
        email: r.email,
        phone: r.phone,
        address: r.address,
        createdAt: r.createdAt,
        salesOrderCount: r._count.salesOrders,
        negotiationProposalCount: r._count.proposals,
      }));
      res.json(buildCustomerIndicatorsPayload(mapped));
    } catch (error) {
      console.error("GET /api/customers/indicators", error);
      res.status(500).json({ error: "Erro ao montar indicadores de clientes." });
    }
  });

  /** Lista clientes de um agrupamento de UF (mesma regra de normalização do indicador). Somente leitura. */
  app.get("/api/customers/indicators/drilldown", requireAppAuth, requirePermission("customers.view"), async (req, res) => {
    const raw = typeof req.query.bucket === "string" ? req.query.bucket.trim() : "";
    if (!raw) {
      return res.status(400).json({ error: "Parâmetro bucket é obrigatório (ex.: SP, —, OUTROS)." });
    }
    try {
      const customers = await prisma.customer.findMany({
        select: {
          id: true,
          companyName: true,
          tradeName: true,
          taxId: true,
          email: true,
          phone: true,
          city: true,
          state: true,
          status: true,
        },
        orderBy: { companyName: "asc" },
      });
      const filtered = customers.filter((c) => normalizeBrazilUf(c.state) === raw);
      res.json({
        bucket: raw,
        customers: filtered,
      });
    } catch (error) {
      console.error("GET /api/customers/indicators/drilldown", error);
      res.status(500).json({ error: "Erro ao listar clientes do agrupamento." });
    }
  });

  /** Visão comercial 360°: cliente + pedidos de venda com itens e produto. */
  app.get("/api/customers/:id/commercial-360", requireAppAuth, requireAnyPermission(["customers.commercial360.view", "customers.view"]), async (req, res) => {
    const { id } = req.params;
    try {
      const customer = await prisma.customer.findUnique({ where: { id } });
      if (!customer) return res.status(404).json({ error: "Cliente não encontrado" });

      const customerDoc = normalizeCustomerDocument(customer.taxId);
      const salesOrdersRaw = await prisma.salesOrder.findMany({
        where: customer.taxId
          ? {
              OR: [{ customerId: id }, { Customer: { taxId: customer.taxId } }],
            }
          : { customerId: id },
        include: {
          Customer: { select: { id: true, taxId: true, companyName: true } },
          items: {
            include: {
              Product: {
                select: {
                  id: true,
                  sku: true,
                  name: true,
                  type: true,
                },
              },
            },
          },
        },
        orderBy: { issueDate: "desc" },
      });

      const salesOrders = salesOrdersRaw
        .filter((order) => {
          if (order.customerId === id) return true;
          const orderDoc = normalizeCustomerDocument(order.Customer?.taxId);
          return customerDoc.length > 0 && orderDoc === customerDoc;
        })
        .map((order) => ({
          ...order,
          hasInvoicing: salesOrderHasInvoicing(order.nomusRawResponse),
        }));

      const abcRows = await loadOfficialPortfolioAbcRevenueRows(prisma);
      const portfolioAbc = buildPortfolioAbcFromSalesOrders(abcRows, id);

      const rulesOrders = salesOrders.map((order) =>
        mapPrismaOrderToSalesOrderRulesInput({
          id: order.id,
          orderCode: order.orderCode,
          status: order.status,
          customerId: order.customerId,
          issueDate: order.issueDate,
          expectedDeliveryDate: order.expectedDeliveryDate,
          totalNetValue: order.totalNetValue,
          totalGrossValue: order.totalGrossValue,
          totalItems: order.totalItems,
          responsible: order.responsible,
          nomusRawResponse: order.nomusRawResponse,
          items: order.items.map((item) => ({
            id: item.id,
            externalProductId: item.externalProductId,
            skuSnapshot: item.skuSnapshot,
            productNameSnapshot: item.productNameSnapshot,
            quantity: item.quantity,
          })),
        })
      );
      const linkedMap = await loadSalesOrderLinkedNfeContextMap(
        salesOrders.map((order) => ({
          id: order.id,
          totalNetValue: order.totalNetValue,
          issueDate: order.issueDate,
          expectedDeliveryDate: order.expectedDeliveryDate,
          nomusRawResponse: order.nomusRawResponse,
        }))
      );
      const officialOrderMetrics = resolveOfficialScopedOrderMetrics({
        orders: rulesOrders,
        referenceDate: new Date(),
        managementFilters: { allYears: true },
        linkedNfeContextMap: linkedMap,
      });
      const { salesOrders: salesOrdersWithOfficialMargin, officialMarginMetrics } =
        await loadOfficialCommercial360MarginBundle(prisma, salesOrders);

      res.json({
        customer,
        salesOrders: salesOrdersWithOfficialMargin,
        portfolioAbc,
        officialOrderMetrics,
        officialMarginMetrics,
      });
    } catch (error) {
      console.error("commercial-360 error:", error);
      res.status(500).json({ error: "Erro ao montar visão comercial do cliente." });
    }
  });

  /** --- CRM comercial (Fase 1A): atividades em `CommercialActivity` --- */
  const CRM_COMMERCIAL_ACTIVITY_DEFAULT_LIMIT = 50;
  const CRM_COMMERCIAL_ACTIVITY_MAX_LIMIT = 200;
  const CRM_COMMERCIAL_ACTIVITY_MAX_BODY_CHARS = 32000;
  const CRM_COMMERCIAL_ACTIVITY_SUBJECT_MAX = 500;
  const CRM_COMMERCIAL_ACTIVITY_DESCRIPTION_MAX = 8000;
  const CRM_COMMERCIAL_ACTIVITY_SHORT_TEXT_MAX = 128;
  const CRM_COMMERCIAL_ACTIVITY_CHANNEL_REASON_MAX = 64;
  const CRM_COMMERCIAL_ACTIVITY_CREATED_BY_NAME_FALLBACK = "Comercial Lazarios";

  function parseCommercialActivitiesLimit(raw: unknown): number {
    const s = typeof raw === "string" ? raw.trim() : "";
    const n = s ? Number.parseInt(s, 10) : NaN;
    if (!Number.isFinite(n) || n < 1) return CRM_COMMERCIAL_ACTIVITY_DEFAULT_LIMIT;
    return Math.min(n, CRM_COMMERCIAL_ACTIVITY_MAX_LIMIT);
  }

  function normalizeCrmOptionalString(
    value: unknown,
    maxLen: number,
    uppercase?: boolean
  ): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return undefined;
    const t = value.trim();
    if (!t) return undefined;
    const cut = t.length > maxLen ? t.slice(0, maxLen) : t;
    return uppercase ? cut.toUpperCase() : cut;
  }

  function parseOptionalIsoDate(value: unknown): Date | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  function isUuidParam(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id
    );
  }

  app.get("/api/customers/:customerId/commercial-activities", requireAppAuth, requireAnyPermission(["crm.customer_cockpit.view", "customers.commercial360.view", "customers.view"]), async (req, res) => {
    const { customerId } = req.params;
    if (!isUuidParam(customerId)) {
      return res.status(400).json({ error: "customerId inválido." });
    }
    const limit = parseCommercialActivitiesLimit(req.query.limit);
    const statusFilter =
      typeof req.query.status === "string" && req.query.status.trim()
        ? req.query.status.trim()
        : undefined;
    const channelFilter =
      typeof req.query.channel === "string" && req.query.channel.trim()
        ? req.query.channel.trim().toUpperCase()
        : undefined;
    try {
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true },
      });
      if (!customer) return res.status(404).json({ error: "Cliente não encontrado." });

      const rows = await prisma.commercialActivity.findMany({
        where: {
          customerId,
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(channelFilter ? { channel: channelFilter } : {}),
        },
        take: limit,
        orderBy: [
          { contactDate: { sort: "desc", nulls: "last" } },
          { createdAt: "desc" },
        ],
        include: COMMERCIAL_ACTIVITY_API_INCLUDE,
      });
      res.json({ activities: rows.map(mapCommercialActivityForApi) });
    } catch (error) {
      console.error("GET /api/customers/:customerId/commercial-activities", error);
      res.status(500).json({ error: "Erro ao listar atividades comerciais." });
    }
  });

  app.post("/api/customers/:customerId/commercial-activities", requireAppAuth, requirePermission("crm.activities.create"), async (req, res) => {
    const { customerId } = req.params;
    if (!isUuidParam(customerId)) {
      return res.status(400).json({ error: "customerId inválido." });
    }
    try {
      const rawBody = req.body;
      if (rawBody && typeof rawBody === "object") {
        const approx = JSON.stringify(rawBody).length;
        if (approx > CRM_COMMERCIAL_ACTIVITY_MAX_BODY_CHARS) {
          return res.status(400).json({ error: "Payload muito grande." });
        }
      }

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true },
      });
      if (!customer) return res.status(404).json({ error: "Cliente não encontrado." });

      const body = (rawBody && typeof rawBody === "object" ? rawBody : {}) as Record<
        string,
        unknown
      >;

      const subject = normalizeCrmOptionalString(
        body.subject,
        CRM_COMMERCIAL_ACTIVITY_SUBJECT_MAX
      );
      const description = normalizeCrmOptionalString(
        body.description,
        CRM_COMMERCIAL_ACTIVITY_DESCRIPTION_MAX
      );
      if (!subject && !description) {
        return res
          .status(400)
          .json({ error: "Informe subject ou description (texto não vazio)." });
      }

      const channel = normalizeCrmOptionalString(
        body.channel,
        CRM_COMMERCIAL_ACTIVITY_CHANNEL_REASON_MAX,
        true
      );
      const reason = normalizeCrmOptionalString(
        body.reason,
        CRM_COMMERCIAL_ACTIVITY_CHANNEL_REASON_MAX,
        true
      );
      const activityType = reason || "CONTACT";

      const contactDate = parseOptionalIsoDate(body.contactDate) ?? new Date();
      const nextActionAt = parseOptionalIsoDate(body.nextActionAt);

      let statusRaw =
        typeof body.status === "string" && body.status.trim()
          ? body.status.trim()
          : undefined;
      if (!statusRaw) {
        statusRaw = nextActionAt ? "OPEN" : "DONE";
      }

      const outcome = normalizeCrmOptionalString(
        body.outcome,
        CRM_COMMERCIAL_ACTIVITY_SHORT_TEXT_MAX
      );
      const nextActionDescription = normalizeCrmOptionalString(
        body.nextActionDescription,
        CRM_COMMERCIAL_ACTIVITY_DESCRIPTION_MAX
      );
      const assignedTo = normalizeCrmOptionalString(
        body.assignedTo,
        CRM_COMMERCIAL_ACTIVITY_SHORT_TEXT_MAX
      );

      let priority: number | undefined;
      if (body.priority !== undefined && body.priority !== null) {
        if (typeof body.priority === "number" && Number.isFinite(body.priority)) {
          priority = Math.trunc(body.priority);
        } else if (typeof body.priority === "string" && body.priority.trim()) {
          const p = Number.parseInt(body.priority.trim(), 10);
          if (Number.isFinite(p)) priority = p;
        }
      }

      let createdByName = normalizeCrmOptionalString(
        body.createdByName,
        CRM_COMMERCIAL_ACTIVITY_SHORT_TEXT_MAX
      );
      if (!createdByName) {
        createdByName = CRM_COMMERCIAL_ACTIVITY_CREATED_BY_NAME_FALLBACK;
      }
      const createdByPhone = normalizeCrmOptionalString(
        body.createdByPhone,
        CRM_COMMERCIAL_ACTIVITY_SHORT_TEXT_MAX
      );
      const createdByEmail = normalizeCrmOptionalString(
        body.createdByEmail,
        CRM_COMMERCIAL_ACTIVITY_SHORT_TEXT_MAX
      );

      const scheduledAt = parseOptionalIsoDate(body.scheduledAt);
      const completedAt = parseOptionalIsoDate(body.completedAt);

      const salesOrderIdRaw = parseOptionalUuidField(body.salesOrderId);
      if (salesOrderIdRaw === "INVALID") {
        return res.status(400).json({ error: "salesOrderId inválido." });
      }
      const proposalIdRaw = parseOptionalUuidField(body.proposalId);
      if (proposalIdRaw === "INVALID") {
        return res.status(400).json({ error: "proposalId inválido." });
      }

      const salesOrderLink = await resolveCommercialActivitySalesOrderLink(
        customerId,
        salesOrderIdRaw ?? undefined,
        prisma
      );
      if (salesOrderLink.ok === false) {
        return res.status(400).json({ error: salesOrderLink.error });
      }
      const proposalLink = await resolveCommercialActivityProposalLink(
        customerId,
        proposalIdRaw ?? undefined,
        prisma
      );
      if (proposalLink.ok === false) {
        return res.status(400).json({ error: proposalLink.error });
      }

      const createData: Prisma.CommercialActivityCreateInput = {
        Customer: { connect: { id: customerId } },
        activityType,
        status: statusRaw,
        contactDate,
        ...(subject !== undefined ? { subject } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(channel !== undefined ? { channel } : {}),
        ...(reason !== undefined ? { reason } : {}),
        ...(outcome !== undefined ? { outcome } : {}),
        ...(nextActionAt !== undefined ? { nextActionAt } : {}),
        ...(nextActionDescription !== undefined ? { nextActionDescription } : {}),
        ...(assignedTo !== undefined ? { assignedTo } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(scheduledAt !== undefined ? { scheduledAt } : {}),
        ...(completedAt !== undefined ? { completedAt } : {}),
        createdByName,
        ...(createdByPhone !== undefined ? { createdByPhone } : {}),
        ...(createdByEmail !== undefined ? { createdByEmail } : {}),
      };
      applyCommercialActivitySalesOrderToCreate(createData, salesOrderIdRaw ?? undefined);
      applyCommercialActivityProposalToCreate(createData, proposalIdRaw ?? undefined);

      const created = await prisma.commercialActivity.create({
        data: createData,
        include: COMMERCIAL_ACTIVITY_API_INCLUDE,
      });
      res.status(201).json(mapCommercialActivityForApi(created));
    } catch (error) {
      console.error("POST /api/customers/:customerId/commercial-activities", error);
      res.status(500).json({ error: "Erro ao registrar atividade comercial." });
    }
  });

  app.patch("/api/commercial-activities/:id", requireAppAuth, requirePermission("crm.activities.edit"), async (req, res) => {
    const { id } = req.params;
    if (!isUuidParam(id)) {
      return res.status(400).json({ error: "id inválido." });
    }
    try {
      const rawBody = req.body;
      if (rawBody && typeof rawBody === "object") {
        const approx = JSON.stringify(rawBody).length;
        if (approx > CRM_COMMERCIAL_ACTIVITY_MAX_BODY_CHARS) {
          return res.status(400).json({ error: "Payload muito grande." });
        }
      }
      const body = (rawBody && typeof rawBody === "object" ? rawBody : {}) as Record<
        string,
        unknown
      >;

      const existing = await prisma.commercialActivity.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Atividade não encontrada." });

      const data: Prisma.CommercialActivityUpdateInput = {};

      if ("contactDate" in body) {
        if (body.contactDate === null) data.contactDate = null;
        else {
          const d = parseOptionalIsoDate(body.contactDate);
          if (d === undefined && body.contactDate !== "" && body.contactDate != null) {
            return res.status(400).json({ error: "contactDate inválido." });
          }
          if (d !== undefined) data.contactDate = d;
        }
      }
      if ("channel" in body) {
        if (body.channel === null || body.channel === "") {
          data.channel = null;
        } else {
          const v = normalizeCrmOptionalString(
            body.channel,
            CRM_COMMERCIAL_ACTIVITY_CHANNEL_REASON_MAX,
            true
          );
          if (v === undefined) {
            return res.status(400).json({ error: "channel inválido." });
          }
          data.channel = v;
        }
      }
      if ("reason" in body) {
        if (body.reason === null || body.reason === "") {
          data.reason = null;
        } else {
          const v = normalizeCrmOptionalString(
            body.reason,
            CRM_COMMERCIAL_ACTIVITY_CHANNEL_REASON_MAX,
            true
          );
          if (v === undefined) {
            return res.status(400).json({ error: "reason inválido." });
          }
          data.reason = v;
        }
      }
      if ("subject" in body) {
        const v = normalizeCrmOptionalString(body.subject, CRM_COMMERCIAL_ACTIVITY_SUBJECT_MAX);
        data.subject = v === undefined ? null : v;
      }
      if ("description" in body) {
        const v = normalizeCrmOptionalString(
          body.description,
          CRM_COMMERCIAL_ACTIVITY_DESCRIPTION_MAX
        );
        data.description = v === undefined ? null : v;
      }
      if ("outcome" in body) {
        const v = normalizeCrmOptionalString(body.outcome, CRM_COMMERCIAL_ACTIVITY_SHORT_TEXT_MAX);
        data.outcome = v === undefined ? null : v;
      }
      if ("status" in body) {
        const v = normalizeCrmOptionalString(body.status, 64);
        if (v === undefined) {
          return res.status(400).json({ error: "status inválido (use texto não vazio ou omita o campo)." });
        }
        data.status = v;
      }
      if ("priority" in body) {
        if (body.priority === null) data.priority = null;
        else if (typeof body.priority === "number" && Number.isFinite(body.priority)) {
          data.priority = Math.trunc(body.priority);
        } else if (typeof body.priority === "string" && body.priority.trim()) {
          const p = Number.parseInt(body.priority.trim(), 10);
          if (!Number.isFinite(p)) return res.status(400).json({ error: "priority inválido." });
          data.priority = p;
        } else if (body.priority !== undefined) {
          return res.status(400).json({ error: "priority inválido." });
        }
      }
      if ("assignedTo" in body) {
        const v = normalizeCrmOptionalString(
          body.assignedTo,
          CRM_COMMERCIAL_ACTIVITY_SHORT_TEXT_MAX
        );
        data.assignedTo = v === undefined ? null : v;
      }
      if ("scheduledAt" in body) {
        if (body.scheduledAt === null) data.scheduledAt = null;
        else {
          const d = parseOptionalIsoDate(body.scheduledAt);
          if (
            d === undefined &&
            body.scheduledAt !== "" &&
            body.scheduledAt != null
          ) {
            return res.status(400).json({ error: "scheduledAt inválido." });
          }
          if (d !== undefined) data.scheduledAt = d;
        }
      }
      if ("completedAt" in body) {
        if (body.completedAt === null) data.completedAt = null;
        else {
          const d = parseOptionalIsoDate(body.completedAt);
          if (
            d === undefined &&
            body.completedAt !== "" &&
            body.completedAt != null
          ) {
            return res.status(400).json({ error: "completedAt inválido." });
          }
          if (d !== undefined) data.completedAt = d;
        }
      }
      if ("nextActionAt" in body) {
        if (body.nextActionAt === null) data.nextActionAt = null;
        else {
          const d = parseOptionalIsoDate(body.nextActionAt);
          if (
            d === undefined &&
            body.nextActionAt !== "" &&
            body.nextActionAt != null
          ) {
            return res.status(400).json({ error: "nextActionAt inválido." });
          }
          if (d !== undefined) data.nextActionAt = d;
        }
      }
      if ("nextActionDescription" in body) {
        const v = normalizeCrmOptionalString(
          body.nextActionDescription,
          CRM_COMMERCIAL_ACTIVITY_DESCRIPTION_MAX
        );
        data.nextActionDescription = v === undefined ? null : v;
      }
      if ("closeReason" in body) {
        const v = normalizeCrmOptionalString(
          body.closeReason,
          CRM_COMMERCIAL_ACTIVITY_DESCRIPTION_MAX
        );
        data.closeReason = v === undefined ? null : v;
      }
      if ("salesOrderId" in body) {
        const parsed = parseOptionalUuidField(body.salesOrderId);
        if (parsed === "INVALID") {
          return res.status(400).json({ error: "salesOrderId inválido." });
        }
        const salesOrderLink = await resolveCommercialActivitySalesOrderLink(
          existing.customerId,
          parsed ?? undefined,
          prisma
        );
        if (salesOrderLink.ok === false) {
          return res.status(400).json({ error: salesOrderLink.error });
        }
        applyCommercialActivitySalesOrderToUpdate(data, parsed ?? undefined);
      }
      if ("proposalId" in body) {
        const parsed = parseOptionalUuidField(body.proposalId);
        if (parsed === "INVALID") {
          return res.status(400).json({ error: "proposalId inválido." });
        }
        const proposalLink = await resolveCommercialActivityProposalLink(
          existing.customerId,
          parsed ?? undefined,
          prisma
        );
        if (proposalLink.ok === false) {
          return res.status(400).json({ error: proposalLink.error });
        }
        applyCommercialActivityProposalToUpdate(data, parsed ?? undefined);
      }

      if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: "Nenhum campo para atualizar." });
      }

      const updated = await prisma.commercialActivity.update({
        where: { id },
        data,
        include: COMMERCIAL_ACTIVITY_API_INCLUDE,
      });
      res.json(mapCommercialActivityForApi(updated));
    } catch (error) {
      console.error("PATCH /api/commercial-activities/:id", error);
      res.status(500).json({ error: "Erro ao atualizar atividade comercial." });
    }
  });

  app.get("/api/crm/dashboard/basic", requireAppAuth, requireAnyPermission(["crm.view", "crm.customer_cockpit.view", "customers.view"]), async (req, res) => {
    try {
      const authUser = await getCurrentAppUser(req);
      if (!authUser) {
        return res.status(401).json({ error: "UNAUTHORIZED", message: "Autenticação necessária." });
      }
      const scopeResult = requireCrmCommercialDataScope(authUser);
      if (scopeResult.ok === false) {
        return res.status(scopeResult.status).json(scopeResult.body);
      }
      const payload = await buildCrmDashboardBasicResponse(scopeResult.scope);
      res.json(payload);
    } catch (error) {
      console.error("GET /api/crm/dashboard/basic", error);
      res.status(500).json({ error: "Erro ao montar indicadores do CRM." });
    }
  });

  /** CRM Fase 2 — dashboard gerencial comercial (base principal: SalesOrder). */
  app.get("/api/crm/management-dashboard", requireAppAuth, requirePermission("crm.general.view"), async (_req, res) => {
    try {
      const payload = await buildCrmManagementDashboardResponse();
      res.json(payload);
    } catch (error) {
      console.error("GET /api/crm/management-dashboard", error);
      res.status(500).json({ error: "Erro ao montar dashboard gerencial comercial." });
    }
  });

  /** CRM Fase 3 — gestão comercial por vendedor (base principal: SalesOrder). */
  app.get("/api/crm/seller-dashboard", requireAppAuth, requireAnyPermission(["crm.seller.own", "crm.seller.all"]), async (req, res) => {
    const parseExternalSellerIdQuery = (raw: unknown): number | null => {
      if (raw === undefined || raw === null || raw === "") return null;
      const n = Number.parseInt(String(raw).trim(), 10);
      return Number.isFinite(n) ? n : null;
    };

    const parseResponsibleQuery = (raw: unknown): string | null => {
      if (typeof raw !== "string") return null;
      const t = raw.trim();
      return t.length > 0 ? t : null;
    };

    try {
      const authUser = await getCurrentAppUser(req);
      if (!authUser) {
        return res.status(401).json({
          error: "UNAUTHORIZED",
          message: "Autenticação necessária.",
        });
      }

      const sellerScope = resolveSellerDashboardScope(
        authUser,
        req.query.externalSellerId,
        req.query.responsible,
        parseExternalSellerIdQuery,
        parseResponsibleQuery,
        req.query.sellerIdentityKey
      );
      if (sellerScope.ok === false) {
        return res.status(sellerScope.status).json(sellerScope.body);
      }

      const payload = await buildCrmSellerDashboardResponse({
        scopeMode: sellerScope.scopeMode,
        externalSellerId: sellerScope.externalSellerId,
        responsible: sellerScope.responsible,
        sellerIdentityKey: sellerScope.sellerIdentityKey,
        dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : null,
        dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : null,
        linkedUser:
          sellerScope.scopeMode === "own"
            ? {
                externalSellerId: authUser.externalSellerId,
                sellerResponsibleName: authUser.sellerResponsibleName,
              }
            : null,
      });
      res.json(payload);
    } catch (error) {
      if (error instanceof SellerDashboardBadRequest) {
        return res.status(400).json({ error: error.message });
      }
      console.error("GET /api/crm/seller-dashboard", error);
      res.status(500).json({ error: "Erro ao montar dashboard por vendedor." });
    }
  });

  /** Busca paginada de clientes para o CRM + agregados de CommercialActivity (sem alterar /api/customers). */
  app.get("/api/crm/customers", requireAppAuth, requireAnyPermission(["crm.view", "crm.customer_cockpit.view", "customers.view"]), async (req, res) => {
    try {
      const authUser = await getCurrentAppUser(req);
      if (!authUser) {
        return res.status(401).json({ error: "UNAUTHORIZED", message: "Autenticação necessária." });
      }
      const scopeResult = requireCrmCommercialDataScope(authUser);
      if (scopeResult.ok === false) {
        return res.status(scopeResult.status).json(scopeResult.body);
      }
      const commercialScope = scopeResult.scope;

      const searchRaw = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const limitRaw = typeof req.query.limit === "string" ? req.query.limit.trim() : "";
      const offsetRaw = typeof req.query.offset === "string" ? req.query.offset.trim() : "";
      const filterRaw = typeof req.query.filter === "string" ? req.query.filter.trim() : "all";

      let limit = Number.parseInt(limitRaw || "50", 10);
      if (!Number.isFinite(limit) || limit < 1) limit = 50;
      limit = Math.min(limit, 100);

      let offset = Number.parseInt(offsetRaw || "0", 10);
      if (!Number.isFinite(offset) || offset < 0) offset = 0;

      const filter = parseCrmCustomerListFilter(filterRaw);
      // `sellerName` é alias aceito para `sellerIdentityKey` (ambos normalizados no parse).
      // Para escopo `own` o filtro de vendedor é ignorado de propósito: o backend força o
      // vínculo do usuário logado (vendedor não consegue burlar enviando outro vendedor).
      const sellerIdentityRaw =
        (typeof req.query.sellerIdentityKey === "string" && req.query.sellerIdentityKey.trim()
          ? req.query.sellerIdentityKey
          : req.query.sellerName) ?? null;
      const sellerQuery =
        commercialScope.dataScope === "global"
          ? parseCrmCustomerListSellerQuery(req.query.externalSellerId, sellerIdentityRaw)
          : { externalSellerId: null, sellerIdentityKey: null };

      const payload = await fetchCrmCustomersList(prisma, commercialScope, {
        search: searchRaw,
        filter,
        limit,
        offset,
        sellerQuery,
      });
      res.json(payload);
    } catch (error) {
      console.error("GET /api/crm/customers", error);
      res.status(500).json({ error: "Erro ao buscar clientes para o CRM." });
    }
  });

  /**
   * Perfil de relacionamento (CRM): preferências comerciais e relacionamento profissional.
   * Não deve armazenar dados sensíveis desnecessários (religião, saúde, política, informações íntimas).
   */
  const CRM_PROFILE_MAX_BODY_CHARS = 32000;
  const CRM_PROFILE_SHORT_TEXT_MAX = 500;
  const CRM_PROFILE_LONG_TEXT_MAX = 2000;
  const CRM_PROFILE_SENSITIVITY_VALUES = ["NORMAL", "ATTENTION", "SENSITIVE_AVOID"] as const;
  const CRM_PROFILE_UPDATED_BY_FALLBACK = "Comercial Lazarios";

  const CRM_PROFILE_STRING_FIELDS: { key: string; maxLen: number }[] = [
    { key: "preferredChannel", maxLen: CRM_PROFILE_SHORT_TEXT_MAX },
    { key: "bestContactTime", maxLen: CRM_PROFILE_SHORT_TEXT_MAX },
    { key: "contactFrequency", maxLen: CRM_PROFILE_SHORT_TEXT_MAX },
    { key: "communicationStyle", maxLen: CRM_PROFILE_SHORT_TEXT_MAX },
    { key: "commercialProfile", maxLen: CRM_PROFILE_SHORT_TEXT_MAX },
    { key: "buyingMotivation", maxLen: CRM_PROFILE_SHORT_TEXT_MAX },
    { key: "commonObjections", maxLen: CRM_PROFILE_LONG_TEXT_MAX },
    { key: "relationshipLevel", maxLen: CRM_PROFILE_SHORT_TEXT_MAX },
    { key: "commercialTemperature", maxLen: CRM_PROFILE_SHORT_TEXT_MAX },
    { key: "interests", maxLen: CRM_PROFILE_LONG_TEXT_MAX },
    { key: "favoriteTeam", maxLen: CRM_PROFILE_SHORT_TEXT_MAX },
    { key: "importantDates", maxLen: CRM_PROFILE_LONG_TEXT_MAX },
    { key: "personalPreferences", maxLen: CRM_PROFILE_LONG_TEXT_MAX },
    { key: "avoidTopics", maxLen: CRM_PROFILE_LONG_TEXT_MAX },
    { key: "relationshipNotes", maxLen: CRM_PROFILE_LONG_TEXT_MAX },
    { key: "informationSource", maxLen: CRM_PROFILE_SHORT_TEXT_MAX },
    { key: "updatedByName", maxLen: CRM_PROFILE_SHORT_TEXT_MAX },
  ];

  function normalizeCrmProfileNullableString(
    value: unknown,
    maxLen: number
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== "string") return undefined;
    const t = value.trim();
    if (!t) return null;
    return t.length > maxLen ? t.slice(0, maxLen) : t;
  }

  function parseCrmProfileSensitivity(value: unknown): string {
    if (typeof value !== "string") return "NORMAL";
    const u = value.trim().toUpperCase();
    return (CRM_PROFILE_SENSITIVITY_VALUES as readonly string[]).includes(u) ? u : "NORMAL";
  }

  function mapCrmProfileForApi(row: {
    id: string;
    customerId: string;
    preferredChannel: string | null;
    bestContactTime: string | null;
    contactFrequency: string | null;
    communicationStyle: string | null;
    commercialProfile: string | null;
    buyingMotivation: string | null;
    commonObjections: string | null;
    relationshipLevel: string | null;
    commercialTemperature: string | null;
    interests: string | null;
    favoriteTeam: string | null;
    importantDates: string | null;
    personalPreferences: string | null;
    avoidTopics: string | null;
    relationshipNotes: string | null;
    informationSource: string | null;
    sensitivityLevel: string;
    lastConfirmedAt: Date | null;
    updatedByName: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      customerId: row.customerId,
      preferredChannel: row.preferredChannel,
      bestContactTime: row.bestContactTime,
      contactFrequency: row.contactFrequency,
      communicationStyle: row.communicationStyle,
      commercialProfile: row.commercialProfile,
      buyingMotivation: row.buyingMotivation,
      commonObjections: row.commonObjections,
      relationshipLevel: row.relationshipLevel,
      commercialTemperature: row.commercialTemperature,
      interests: row.interests,
      favoriteTeam: row.favoriteTeam,
      importantDates: row.importantDates,
      personalPreferences: row.personalPreferences,
      avoidTopics: row.avoidTopics,
      relationshipNotes: row.relationshipNotes,
      informationSource: row.informationSource,
      sensitivityLevel: row.sensitivityLevel,
      lastConfirmedAt: row.lastConfirmedAt,
      updatedByName: row.updatedByName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function buildCrmProfileCustomerSummary(customer: {
    id: string;
    companyName: string;
    taxId: string;
  }) {
    return {
      id: customer.id,
      displayName: customer.companyName,
      taxId: customer.taxId,
    };
  }

  type CrmProfileWritableScalars = {
    preferredChannel?: string | null;
    bestContactTime?: string | null;
    contactFrequency?: string | null;
    communicationStyle?: string | null;
    commercialProfile?: string | null;
    buyingMotivation?: string | null;
    commonObjections?: string | null;
    relationshipLevel?: string | null;
    commercialTemperature?: string | null;
    interests?: string | null;
    favoriteTeam?: string | null;
    importantDates?: string | null;
    personalPreferences?: string | null;
    avoidTopics?: string | null;
    relationshipNotes?: string | null;
    informationSource?: string | null;
    sensitivityLevel?: string;
    lastConfirmedAt?: Date | null;
    updatedByName?: string | null;
  };

  function sanitizeCrmProfileUpsertBody(
    body: Record<string, unknown>
  ): { data: CrmProfileWritableScalars; error?: string } {
    const data: CrmProfileWritableScalars = {};

    for (const { key, maxLen } of CRM_PROFILE_STRING_FIELDS) {
      if (!(key in body)) continue;
      const v = normalizeCrmProfileNullableString(body[key], maxLen);
      if (v === undefined) {
        return { data: {}, error: `Campo ${key} inválido.` };
      }
      (data as Record<string, string | null>)[key] = v;
    }

    if ("sensitivityLevel" in body) {
      data.sensitivityLevel = parseCrmProfileSensitivity(body.sensitivityLevel);
    }

    if ("lastConfirmedAt" in body) {
      if (body.lastConfirmedAt === null || body.lastConfirmedAt === "") {
        data.lastConfirmedAt = null;
      } else {
        const d = parseOptionalIsoDate(body.lastConfirmedAt);
        if (d === undefined) {
          return { data: {}, error: "lastConfirmedAt inválido." };
        }
        data.lastConfirmedAt = d;
      }
    }

    if ("updatedByName" in body) {
      const name = normalizeCrmProfileNullableString(body.updatedByName, CRM_PROFILE_SHORT_TEXT_MAX);
      if (name === undefined) {
        return { data: {}, error: "updatedByName inválido." };
      }
      data.updatedByName = name ?? CRM_PROFILE_UPDATED_BY_FALLBACK;
    }

    return { data };
  }

  app.get("/api/crm/customers/:customerId/profile", requireAppAuth, requireAnyPermission(["crm.customer_cockpit.view", "crm.view", "customers.view"]), async (req, res) => {
    const { customerId } = req.params;
    if (!isUuidParam(customerId)) {
      return res.status(400).json({ error: "customerId inválido." });
    }
    try {
      const authUser = await getCurrentAppUser(req);
      if (!authUser) {
        return res.status(401).json({ error: "UNAUTHORIZED", message: "Autenticação necessária." });
      }
      const commercialScope = resolveCrmCommercialAccessScope(authUser);
      if (commercialScope.dataScope === "none") {
        return res.status(403).json({
          error: commercialScope.blockedReason ?? "FORBIDDEN",
          message: commercialScope.blockedMessage ?? "Acesso negado.",
        });
      }
      if (!(await isCustomerInCrmCommercialScope(customerId, commercialScope))) {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Este cliente não pertence à sua carteira comercial.",
        });
      }

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, companyName: true, taxId: true },
      });
      if (!customer) return res.status(404).json({ error: "Cliente não encontrado." });

      const profile = await prisma.crmCustomerProfile.findUnique({
        where: { customerId },
      });

      res.json({
        customer: buildCrmProfileCustomerSummary(customer),
        profile: profile ? mapCrmProfileForApi(profile) : null,
      });
    } catch (error) {
      console.error("GET /api/crm/customers/:customerId/profile", error);
      res.status(500).json({ error: "Erro ao carregar perfil de relacionamento." });
    }
  });

  /** CRM Fase 1H-B — inteligência comercial só leitura (base principal: Pedidos de Venda). */
  app.get("/api/crm/customers/:customerId/commercial-intelligence", requireAppAuth, requireAnyPermission(["crm.customer_cockpit.view", "customers.commercial360.view", "customers.view"]), async (req, res) => {
    const { customerId } = req.params;
    if (!isUuidParam(customerId)) {
      return res.status(400).json({ error: "customerId inválido." });
    }

    const OPEN_NEGOTIATION_PROPOSAL_STATUSES = ["DRAFT", "ANALYSIS", "SENT"] as const;

    try {
      const authUser = await getCurrentAppUser(req);
      if (!authUser) {
        return res.status(401).json({ error: "UNAUTHORIZED", message: "Autenticação necessária." });
      }
      const commercialScope = resolveCrmCommercialAccessScope(authUser);
      if (commercialScope.dataScope === "none") {
        return res.status(403).json({
          error: commercialScope.blockedReason ?? "FORBIDDEN",
          message: commercialScope.blockedMessage ?? "Acesso negado.",
        });
      }
      if (!(await isCustomerInCrmCommercialScope(customerId, commercialScope))) {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Este cliente não pertence à sua carteira comercial.",
        });
      }

      const customerRow = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, companyName: true, tradeName: true, taxId: true },
      });
      if (!customerRow) {
        return res.status(404).json({ error: "Cliente não encontrado." });
      }

      const customerDoc = normalizeCustomerDocument(customerRow.taxId);

      const [activityRows, salesOrdersRaw, negotiationProposals] = await Promise.all([
        prisma.commercialActivity.findMany({
          where: { customerId },
          select: { contactDate: true, createdAt: true, salesOrderId: true },
        }),
        prisma.salesOrder.findMany({
          where: customerRow.taxId
            ? {
                OR: [{ customerId }, { Customer: { taxId: customerRow.taxId } }],
              }
            : { customerId },
          include: {
            Customer: { select: { taxId: true } },
          },
          orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
        }),
        prisma.proposal.findMany({
          where: {
            customerId,
            status: { in: [...OPEN_NEGOTIATION_PROPOSAL_STATUSES] },
          },
          orderBy: { updatedAt: "desc" },
          take: 5,
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            totalNetValue: true,
            createdAt: true,
            updatedAt: true,
            responsible: true,
          },
        }),
      ]);

      const salesOrders = salesOrdersRaw
        .filter((order) =>
          salesOrderMatchesCustomer(order.customerId, customerRow, order.Customer?.taxId)
        )
        .filter((order) =>
          salesOrderMatchesCrmSellerScope(
            { externalSellerId: order.externalSellerId, responsible: order.responsible },
            commercialScope
          )
        )
        .map((order) => ({
          id: order.id,
          orderCode: order.orderCode,
          issueDate: order.issueDate,
          updatedAt: order.updatedAt,
          status: order.status,
          totalNetValue: order.totalNetValue,
          responsible: order.responsible,
          expectedDeliveryDate: order.expectedDeliveryDate,
          nomusRawResponse: order.nomusRawResponse,
        }));

      const linkedMap = await loadSalesOrderLinkedNfeContextMap(
        salesOrders.map((order) => ({
          id: order.id,
          totalNetValue: order.totalNetValue,
          issueDate: order.issueDate,
          expectedDeliveryDate: order.expectedDeliveryDate,
          nomusRawResponse: order.nomusRawResponse,
        }))
      );

      res.json(
        buildCrmCommercialIntelligenceResponse({
          customer: customerRow,
          activities: activityRows,
          salesOrders,
          negotiationProposals,
          linkedNfeContextMap: linkedMap,
        })
      );
    } catch (error) {
      console.error("GET /api/crm/customers/:customerId/commercial-intelligence", error);
      res.status(500).json({ error: "Erro ao carregar inteligência comercial do cliente." });
    }
  });

  app.put("/api/crm/customers/:customerId/profile", requireAppAuth, requirePermission("crm.profile.edit"), async (req, res) => {
    const { customerId } = req.params;
    if (!isUuidParam(customerId)) {
      return res.status(400).json({ error: "customerId inválido." });
    }
    try {
      const authUser = await getCurrentAppUser(req);
      if (!authUser) {
        return res.status(401).json({ error: "UNAUTHORIZED", message: "Autenticação necessária." });
      }
      const commercialScope = resolveCrmCommercialAccessScope(authUser);
      if (commercialScope.dataScope === "none") {
        return res.status(403).json({
          error: commercialScope.blockedReason ?? "FORBIDDEN",
          message: commercialScope.blockedMessage ?? "Acesso negado.",
        });
      }
      if (!(await isCustomerInCrmCommercialScope(customerId, commercialScope))) {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Este cliente não pertence à sua carteira comercial.",
        });
      }

      const rawBody = req.body;
      if (rawBody && typeof rawBody === "object") {
        const approx = JSON.stringify(rawBody).length;
        if (approx > CRM_PROFILE_MAX_BODY_CHARS) {
          return res.status(400).json({ error: "Payload muito grande." });
        }
      }
      const body = (rawBody && typeof rawBody === "object" ? rawBody : {}) as Record<string, unknown>;

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, companyName: true, taxId: true },
      });
      if (!customer) return res.status(404).json({ error: "Cliente não encontrado." });

      const { data, error: sanitizeError } = sanitizeCrmProfileUpsertBody(body);
      if (sanitizeError) {
        return res.status(400).json({ error: sanitizeError });
      }

      const profile = await prisma.crmCustomerProfile.upsert({
        where: { customerId },
        create: {
          customerId,
          sensitivityLevel: data.sensitivityLevel ?? "NORMAL",
          updatedByName: data.updatedByName ?? CRM_PROFILE_UPDATED_BY_FALLBACK,
          ...data,
        },
        update: data,
      });

      res.json({
        customer: buildCrmProfileCustomerSummary(customer),
        profile: mapCrmProfileForApi(profile),
      });
    } catch (error) {
      console.error("PUT /api/crm/customers/:customerId/profile", error);
      res.status(500).json({ error: "Erro ao salvar perfil de relacionamento." });
    }
  });

  registerCrmCustomerCommercialOwnerRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    requirePermission,
    getCurrentAppUser,
  });

  app.post("/api/customers", requireAppAuth, requirePermission("customers.create"), async (req, res) => {
    const customer = await prisma.customer.create({ data: req.body });
    res.json(customer);
  });

  app.put("/api/customers/:id", requireAppAuth, requirePermission("customers.edit"), async (req, res) => {
    const { id } = req.params;
    const customer = await prisma.customer.update({
      where: { id },
      data: req.body,
    });
    res.json(customer);
  });

  app.delete("/api/customers/:id", requireAppAuth, requirePermission("customers.edit"), async (req, res) => {
    const { id } = req.params;
    await prisma.customer.delete({ where: { id } });
    res.json({ success: true });
  });

  // --- API: Proposals (Propostas Comerciais) ---
  const PROPOSAL_STATUS_VALUES = [
    "DRAFT",
    "ANALYSIS",
    "SENT",
    "APPROVED",
    "REJECTED",
    "EXPIRED",
    "CANCELED",
  ] as const;

  function isValidProposalStatus(value: unknown): value is (typeof PROPOSAL_STATUS_VALUES)[number] {
    return typeof value === "string" && PROPOSAL_STATUS_VALUES.includes(value as any);
  }

  function isNumericOverflowError(error: unknown): boolean {
    const e = error as any;
    const text = `${e?.message ?? ""} ${e?.code ?? ""} ${e?.meta?.message ?? ""}`.toLowerCase();
    return (
      text.includes("numeric field overflow") ||
      text.includes("precision 20, scale 6") ||
      text.includes("22003")
    );
  }

  /** Escalares persistíveis em Proposal (POST/PUT); evita chaves desconhecidas/relações no spread para o Prisma. */
  const PROPOSAL_WRITE_SCALAR_KEYS = [
    "title",
    "customerId",
    "status",
    "responsible",
    "companyIssuer",
    "validityDays",
    "paymentTerms",
    "paymentMethod",
    "deliveryTimeDays",
    "freightCondition",
    "deliveryLocation",
    "notes",
    "internalNotes",
    "totalItems",
    "totalGrossValue",
    "totalDiscount",
    "totalNetValue",
    "totalCost",
    "totalMarginValue",
    "totalMarginPerc",
    "totalTaxes",
    "totalCommission",
    "totalFreight",
    "expectedCloseDate",
    "source",
    "lossReason",
    "lossReasonDetail",
    "probabilityPerc",
    "priority",
    "nextActionAt",
    "nextActionNote",
    "sourceSystem",
    "externalProposalId",
    "externalProposalCode",
    "externalCustomerId",
    "externalSellerId",
    "externalCompanyId",
    "externalMovementTypeId",
    "externalOpenedAt",
    "externalRawPayload",
    "priceTableId",
    "priceTableVersionId",
    "priceTableCode",
    "priceTableVersionNumber",
    "priceSource",
  ] as const;

  function pickProposalWriteScalars(body: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of PROPOSAL_WRITE_SCALAR_KEYS) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        out[key] = body[key];
      }
    }
    return out;
  }

  function buildProposalItemCreateInput(item: Record<string, unknown>) {
    const row: Record<string, unknown> = {
      productId: item.productId,
      quantity: item.quantity,
      unit: item.unit,
      unitCost: item.unitCost,
      suggestedPrice: item.suggestedPrice,
      negotiatedPrice: item.negotiatedPrice,
      discountPerc: item.discountPerc,
      discountValue: item.discountValue,
      marginValue: item.marginValue,
      marginPerc: item.marginPerc,
      taxesPerc: item.taxesPerc,
      taxesValue: item.taxesValue,
      commissionPerc: item.commissionPerc,
      commissionValue: item.commissionValue,
      freightValue: item.freightValue,
      notes: item.notes,
    };
    if (Object.prototype.hasOwnProperty.call(item, "priceTableItemId")) {
      row.priceTableItemId = item.priceTableItemId;
    }
    if (Object.prototype.hasOwnProperty.call(item, "priceSource")) {
      row.priceSource = item.priceSource;
    }
    if (Object.prototype.hasOwnProperty.call(item, "pricingSnapshotJson")) {
      row.pricingSnapshotJson = item.pricingSnapshotJson;
    }
    if (Object.prototype.hasOwnProperty.call(item, "priceTableId")) {
      row.priceTableId = item.priceTableId;
    }
    if (Object.prototype.hasOwnProperty.call(item, "priceTableVersionId")) {
      row.priceTableVersionId = item.priceTableVersionId;
    }
    if (Object.prototype.hasOwnProperty.call(item, "priceTableCode")) {
      row.priceTableCode = item.priceTableCode;
    }
    if (Object.prototype.hasOwnProperty.call(item, "priceTableVersionNumber")) {
      row.priceTableVersionNumber = item.priceTableVersionNumber;
    }
    return row;
  }

  function parsePositiveIntQuery(value: unknown, fallback: number): number {
    const raw = Array.isArray(value) ? value[0] : value;
    const parsed = Number.parseInt(String(raw ?? ""), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  function parseDateQueryStart(value: unknown): Date | null {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const date = new Date(`${raw}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseDateQueryEnd(value: unknown): Date | null {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const date = new Date(`${raw}T23:59:59.999`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseDecimalQuery(value: unknown): Prisma.Decimal | null {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const normalized = raw.replace(",", ".");
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;
    return new Prisma.Decimal(parsed);
  }

  app.get("/api/proposals", requireAppAuth, requirePermission("proposals.view"), async (req, res) => {
    const pageRaw = req.query.page;
    const pageSizeRaw = req.query.pageSize;
    const search = String(req.query.search ?? "").trim();
    const status = String(req.query.status ?? "").trim();
    const responsible = String(req.query.responsible ?? "").trim();
    const customerId = String(req.query.customerId ?? "").trim();
    const startDate = parseDateQueryStart(req.query.startDate);
    const endDate = parseDateQueryEnd(req.query.endDate);
    const minNet = parseDecimalQuery(req.query.minNetValue);
    const maxNet = parseDecimalQuery(req.query.maxNetValue);

    const hasPagination = pageRaw !== undefined || pageSizeRaw !== undefined;
    const hasAnyFilter =
      search.length > 0 ||
      status.length > 0 ||
      responsible.length > 0 ||
      customerId.length > 0 ||
      startDate !== null ||
      endDate !== null ||
      minNet !== null ||
      maxNet !== null;

    const where: Prisma.ProposalWhereInput = {
      ...(status && isValidProposalStatus(status) ? { status } : {}),
      ...(responsible ? { responsible } : {}),
      ...(customerId ? { customerId } : {}),
      ...((startDate || endDate)
        ? {
            createdAt: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
      ...((minNet || maxNet)
        ? {
            totalNetValue: {
              ...(minNet ? { gte: minNet } : {}),
              ...(maxNet ? { lte: maxNet } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { Customer: { companyName: { contains: search, mode: "insensitive" } } },
              { Customer: { tradeName: { contains: search, mode: "insensitive" } } },
              { Customer: { taxId: { contains: search, mode: "insensitive" } } },
              ...(Number.isFinite(Number(search)) ? [{ number: Number.parseInt(search, 10) }] : []),
            ],
          }
        : {}),
    };

    if (!hasPagination && !hasAnyFilter) {
      const proposals = await prisma.proposal.findMany({
        include: {
          Customer: true,
          salesOrder: { select: { id: true, orderCode: true, status: true } },
        },
        orderBy: [{ createdAt: "desc" }, { number: "desc" }],
      });
      return res.json(proposals);
    }

    const page = parsePositiveIntQuery(pageRaw, 1);
    const pageSize = Math.min(parsePositiveIntQuery(pageSizeRaw, 50), 200);
    const skip = (page - 1) * pageSize;

    const [rowsRaw, total] = await Promise.all([
      prisma.proposal.findMany({
        where,
        include: {
          Customer: true,
          salesOrder: { select: { id: true, orderCode: true, status: true } },
        },
        orderBy: [{ createdAt: "desc" }, { number: "desc" }],
        skip,
        take: pageSize,
      }),
      prisma.proposal.count({ where }),
    ]);

    const rows = rowsRaw.slice(0, pageSize);

    res.json({
      data: rows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  });

  app.get("/api/proposals/responsibles", requireAppAuth, requirePermission("proposals.view"), async (req, res) => {
    const rows = await prisma.proposal.findMany({
      where: { responsible: { not: null } },
      select: { responsible: true },
      distinct: ["responsible"],
      orderBy: { responsible: "asc" },
    });
    const responsibles = rows
      .map((r) => String(r.responsible ?? "").trim())
      .filter((r) => r.length > 0);
    res.json(responsibles);
  });

  app.post("/api/proposals/:id/generate-sales-order", requireAppAuth, requirePermission("proposals.edit"), async (req, res) => {
    const { id } = req.params;

    const existing = await prisma.salesOrder.findUnique({
      where: { proposalId: id },
      include: {
        items: { include: { Product: true } },
        Customer: true,
        Proposal: { select: { id: true, number: true, title: true } },
      },
    });
    if (existing) {
      return res.status(200).json({ existing: true, salesOrder: existing });
    }

    const proposal = await prisma.proposal.findUnique({
      where: { id },
      include: { items: { include: { Product: true } }, Customer: true },
    });
    if (!proposal) return res.status(404).json({ error: "Proposta não encontrada." });
    if (proposal.status !== "APPROVED") {
      return res.status(400).json({ error: "Apenas propostas aprovadas podem gerar pedido de venda." });
    }
    if (!proposal.customerId) {
      return res.status(400).json({ error: "Proposta sem cliente." });
    }
    if (!proposal.items.length) {
      return res.status(400).json({ error: "Proposta deve ter pelo menos um item." });
    }

    for (const item of proposal.items) {
      if (!item.productId) {
        return res.status(400).json({ error: "Todos os itens devem ter produto vinculado (productId)." });
      }
      const qty = new Prisma.Decimal(item.quantity);
      if (qty.lte(0)) {
        return res.status(400).json({ error: "Cada item deve ter quantidade maior que zero." });
      }
      const neg = new Prisma.Decimal(item.negotiatedPrice);
      if (neg.lte(0)) {
        return res.status(400).json({ error: "Cada item deve ter preço negociado maior que zero." });
      }
      if (!item.Product) {
        return res.status(400).json({ error: `Produto não encontrado para um item da proposta (item ${item.id}).` });
      }
    }

    let orderCode = proposal.externalProposalCode?.trim()
      ? `PV-${proposal.externalProposalCode.trim()}`
      : `PV-${proposal.number}`;
    const orderCodeClash = await prisma.salesOrder.findUnique({ where: { orderCode } });
    if (orderCodeClash) {
      orderCode = `PV-${proposal.number}-${proposal.id.slice(0, 8)}`;
    }

    const issueDate = new Date();
    let expectedDeliveryDate: Date | null = null;
    if (proposal.deliveryTimeDays != null && Number.isFinite(Number(proposal.deliveryTimeDays))) {
      const d = new Date(issueDate);
      d.setDate(d.getDate() + Number(proposal.deliveryTimeDays));
      expectedDeliveryDate = d;
    }

    try {
      const salesOrder = await prisma.$transaction(async (tx) => {
        const header = await tx.salesOrder.create({
          data: {
            proposalId: proposal.id,
            sourceSystem: proposal.sourceSystem ?? null,
            orderCode,
            customerId: proposal.customerId,
            externalCustomerId: proposal.externalCustomerId ?? null,
            responsible: proposal.responsible ?? null,
            externalSellerId: proposal.externalSellerId ?? null,
            companyIssuer: proposal.companyIssuer ?? null,
            externalCompanyId: proposal.externalCompanyId ?? null,
            status: "READY_TO_SEND",
            issueDate,
            expectedDeliveryDate,
            paymentTerms: proposal.paymentTerms ?? null,
            paymentMethod: proposal.paymentMethod ?? null,
            freightCondition: proposal.freightCondition ?? null,
            deliveryLocation: proposal.deliveryLocation ?? null,
            notes: proposal.notes ?? null,
            internalNotes: proposal.internalNotes ?? null,
            totalItems: proposal.totalItems,
            totalGrossValue: proposal.totalGrossValue,
            totalDiscount: proposal.totalDiscount,
            totalNetValue: proposal.totalNetValue,
            totalCost: proposal.totalCost,
            totalMarginValue: proposal.totalMarginValue,
            totalMarginPerc: proposal.totalMarginPerc,
            totalTaxes: proposal.totalTaxes,
            totalFreight: proposal.totalFreight,
          },
        });

        for (const item of proposal.items) {
          const qty = new Prisma.Decimal(item.quantity);
          const neg = new Prisma.Decimal(item.negotiatedPrice);
          const uc = new Prisma.Decimal(item.unitCost);
          const totalNetValue = qty.mul(neg);
          const totalCost = qty.mul(uc);
          const marginValue = totalNetValue.minus(totalCost);
          const marginPerc = totalNetValue.gt(0)
            ? marginValue.div(totalNetValue).mul(new Prisma.Decimal(100))
            : new Prisma.Decimal(0);

          await tx.salesOrderItem.create({
            data: {
              salesOrderId: header.id,
              proposalItemId: item.id,
              productId: item.productId,
              externalProductId: item.externalProductId ?? null,
              skuSnapshot: item.Product!.sku,
              productNameSnapshot: item.Product!.name,
              quantity: item.quantity,
              unit: item.unit ?? "UN",
              unitCost: item.unitCost,
              negotiatedPrice: item.negotiatedPrice,
              totalNetValue,
              totalCost,
              marginValue,
              marginPerc,
              notes: item.notes ?? null,
            },
          });
        }

        return tx.salesOrder.findUnique({
          where: { id: header.id },
          include: {
            items: { include: { Product: true } },
            Customer: true,
            Proposal: { select: { id: true, number: true, title: true, externalProposalCode: true } },
          },
        });
      });

      return res.status(201).json({ existing: false, salesOrder });
    } catch (e: any) {
      console.error("generate-sales-order", e);
      if (e?.code === "P2002") {
        return res.status(409).json({ error: "Conflito de código de pedido. Tente novamente." });
      }
      return res.status(500).json({ error: e?.message || "Erro ao gerar pedido de venda." });
    }
  });

  app.get("/api/proposals/:id", requireAppAuth, requirePermission("proposals.view"), async (req, res) => {
    const { id } = req.params;
    const proposal = await prisma.proposal.findUnique({
      where: { id },
      include: { 
        Customer: true,
        items: { include: { Product: true } }
      },
    });
    res.json(proposal);
  });

  app.post("/api/proposals", requireAppAuth, requirePermission("proposals.create"), async (req, res) => {
    const { items, ...proposalData } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "Payload inválido: items deve ser um array." });
    }
    if (Object.prototype.hasOwnProperty.call(proposalData, "status") && !isValidProposalStatus(proposalData.status)) {
      return res.status(400).json({
        error: `Status inválido. Use um dos valores: ${PROPOSAL_STATUS_VALUES.join(", ")}.`,
      });
    }
    try {
      const proposalScalars = pickProposalWriteScalars(proposalData as Record<string, unknown>);
      const proposal = await prisma.proposal.create({
        data: {
          ...(proposalScalars as any),
          items: {
            create: items.map((item: any) => buildProposalItemCreateInput(item as Record<string, unknown>)),
          },
        },
        include: { items: true },
      });
      res.json(proposal);
    } catch (e: any) {
      console.error("POST /api/proposals", e);
      if (isNumericOverflowError(e)) {
        return res.status(422).json({
          error: "Valores numéricos inválidos ou muito altos na proposta.",
          code: "NUMERIC_FIELD_OVERFLOW",
        });
      }
      return res.status(500).json({ error: "Erro ao salvar proposta." });
    }
  });

  app.put("/api/proposals/:id", requireAppAuth, requirePermission("proposals.edit"), async (req, res) => {
    const { id } = req.params;
    const { items, ...proposalData } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "Payload inválido: items deve ser um array." });
    }
    if (Object.prototype.hasOwnProperty.call(proposalData, "status") && !isValidProposalStatus(proposalData.status)) {
      return res.status(400).json({
        error: `Status inválido. Use um dos valores: ${PROPOSAL_STATUS_VALUES.join(", ")}.`,
      });
    }

    try {
      const proposalScalars = pickProposalWriteScalars(proposalData as Record<string, unknown>);
      const proposal = await prisma.$transaction(async (tx) => {
        await tx.proposalItem.deleteMany({ where: { proposalId: id } });
        return await tx.proposal.update({
          where: { id },
          data: {
            ...(proposalScalars as any),
            items: {
              create: items.map((item: any) => buildProposalItemCreateInput(item as Record<string, unknown>)),
            },
          },
          include: { items: true },
        });
      });
      res.json(proposal);
    } catch (e: any) {
      console.error("PUT /api/proposals/:id", e);
      if (isNumericOverflowError(e)) {
        return res.status(422).json({
          error: "Valores numéricos inválidos ou muito altos na proposta.",
          code: "NUMERIC_FIELD_OVERFLOW",
        });
      }
      return res.status(500).json({ error: "Erro ao atualizar proposta." });
    }
  });

  app.patch("/api/proposals/:id/status", requireAppAuth, requirePermission("proposals.edit"), async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!isValidProposalStatus(status)) {
      return res.status(400).json({
        error: `Status inválido. Use um dos valores: ${PROPOSAL_STATUS_VALUES.join(", ")}.`,
      });
    }
    const proposal = await prisma.proposal.update({
      where: { id },
      data: { status },
    });
    res.json(proposal);
  });

  app.delete("/api/proposals/:id", requireAppAuth, requirePermission("proposals.delete"), async (req, res) => {
    const { id } = req.params;
    await prisma.proposal.delete({ where: { id } });
    res.json({ success: true });
  });

  // --- API: Pedidos de venda internos (origem: proposta aprovada; envio Nomus em etapa futura) ---
  // Futuro: POST /api/sales-orders/:id/send-to-nomus
  // Enviar corpo alinhado ao Nomus POST /rest/pedidos, ex.:
  // { codigoPedido, idEmpresa, idPessoaCliente, idPessoaVendedor, dataEmissao, condicaoPagamentoTexto, observacoes,
  //   itensPedido: [{ item, idProduto, quantidade, valorUnitario, dataEntrega? }] }
  // Preencher nomusRawResponse / sentToNomusAt após resposta; não implementar nesta etapa.

  registerOfficialServerResolvers({
    resolveProductCostAnalysis: async (productId) => {
      const cache = await initAnalysisCache();
      return getProductCostAnalysis(productId, cache, false);
    },
  });

  app.get("/api/sales-orders", requireAppAuth, requirePermission("sales_orders.view"), async (req, res) => {
    try {
      const auth = await readAppSession(req);
      const canViewMarginEconomics =
        auth != null &&
        (hasPermission(auth, "products.tab.cost") || hasPermission(auth, "costs.view"));

      const status = String(req.query.status ?? "").trim();
      const customerId = String(req.query.customerId ?? "").trim();
      const responsible = String(req.query.responsible ?? "").trim();
      const startDate = parseDateQueryStart(req.query.startDate);
      const endDate = parseDateQueryEnd(req.query.endDate);
      // Filtro executivo Ano/Mês por data de emissão (issueDate); inválidos são ignorados.
      const year = parseSalesOrderYearParam(req.query.year);
      const month = parseSalesOrderMonthParam(req.query.month);
      // Busca inteligente (pedido/NF/cliente/vendedor/empresa/itens).
      const q = String(req.query.q ?? "").trim();

      const where = buildSalesOrderListWhere({
        status: status || undefined,
        customerId: customerId || undefined,
        responsible: responsible || undefined,
        startDate,
        endDate,
        year,
        month,
        q: q || undefined,
      });

      const page = parsePositiveIntQuery(req.query.page, 1);
      const pageSize = Math.min(parsePositiveIntQuery(req.query.pageSize, 20), 100);
      const skip = (page - 1) * pageSize;

      const listFilters = {
        status: status || undefined,
        customerId: customerId || undefined,
        responsible: responsible || undefined,
        startDate,
        endDate,
        year,
        month,
        q: q || undefined,
      };

      const [rows, total, summaryOrders, marginOrders] = await Promise.all([
        prisma.salesOrder.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { issueDate: "desc" }],
          skip,
          take: pageSize,
          include: {
            Customer: true,
            Proposal: { select: { id: true, number: true, externalProposalCode: true, title: true } },
          },
        }),
        prisma.salesOrder.count({ where }),
        prisma.salesOrder.findMany({
          where,
          select: SALES_ORDER_RULES_PRISMA_SELECT,
        }),
        canViewMarginEconomics
          ? prisma.salesOrder.findMany({
              where,
              select: SALES_ORDER_LIST_MARGIN_PRISMA_SELECT,
            })
          : Promise.resolve([]),
      ]);

      const officialList = buildOfficialSalesOrderListPayload({
        orders: summaryOrders.map(mapPrismaOrderToSalesOrderRulesInput),
        listFilters,
        referenceDate: new Date(),
        year: year ?? undefined,
        month: month ?? undefined,
      });
      const summary = officialList.summary;

      const data = await attachMarginsToSalesOrders(prisma, rows);

      const marginSummary = canViewMarginEconomics
        ? await buildOfficialSalesOrderListMarginSummary(prisma, marginOrders)
        : undefined;

      res.json({
        data,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        summary,
        marginSummary,
        metricsSource: officialList.metricsSource,
        rulesEngineVersion: officialList.rulesEngineVersion,
      });
    } catch (e: any) {
      console.error("GET /api/sales-orders", e);
      res.status(500).json({ error: e?.message || "Erro ao listar pedidos de venda." });
    }
  });

  registerSalesOrderIntelligenceRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    requireUserAdminOrBootstrap,
  });

  registerSalesOrderMarginIndicatorsRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
  });

  registerSalesOrderResultRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
  });

  registerSalesOrderInternalMarginExportRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
  });

  app.get("/api/sales-orders/:id", requireAppAuth, requireAnyPermission(["sales_orders.detail.view", "sales_orders.view"]), async (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return res.status(400).json({ error: "ID de pedido inválido." });
      }
      const row = await prisma.salesOrder.findUnique({
        where: { id },
        include: {
          items: { orderBy: { createdAt: "asc" }, include: { Product: true, ProposalItem: true } },
          Customer: true,
          Proposal: true,
        },
      });
      if (!row) return res.status(404).json({ error: "Pedido de venda não encontrado." });
      const enriched = await attachMarginToSalesOrderDetail(prisma, row);
      res.json(enriched);
    } catch (e: any) {
      console.error("GET /api/sales-orders/:id", e);
      res.status(500).json({ error: e?.message || "Erro ao carregar pedido de venda." });
    }
  });

  // ===============================
  // Maintenance Requests Module
  // ===============================
  const MAINTENANCE_STATUS_VALUES = [
    "NOVA_SOLICITACAO",
    "EM_ANALISE",
    "AGUARDANDO_MATERIAL",
    "AGUARDANDO_COMPRA",
    "PROGRAMADO",
    "EM_EXECUCAO",
    "CONCLUIDO",
    "CANCELADO",
  ] as const satisfies readonly MaintenanceStatus[];

  const MAINTENANCE_PRIORITY_VALUES = ["BAIXA", "MEDIA", "ALTA", "CRITICA"] as const satisfies readonly MaintenancePriority[];

  const MAINTENANCE_CATEGORY_VALUES = [
    "ELETRICA",
    "HIDRAULICA",
    "PINTURA",
    "CIVIL_ALVENARIA",
    "TELHADO_CALHA",
    "INFRAESTRUTURA",
    "SEGURANCA",
    "LIMPEZA_CORRETIVA",
    "OUTRO",
  ] as const satisfies readonly MaintenanceCategory[];

  function isValidMaintenanceStatus(value: unknown): value is MaintenanceStatus {
    return typeof value === "string" && (MAINTENANCE_STATUS_VALUES as readonly string[]).includes(value);
  }

  function isValidMaintenancePriority(value: unknown): value is MaintenancePriority {
    return typeof value === "string" && (MAINTENANCE_PRIORITY_VALUES as readonly string[]).includes(value);
  }

  function isValidMaintenanceCategory(value: unknown): value is MaintenanceCategory {
    return typeof value === "string" && (MAINTENANCE_CATEGORY_VALUES as readonly string[]).includes(value);
  }

  function parsePage(value: unknown): number {
    return parsePositiveIntQuery(value, 1);
  }

  function parsePageSize(value: unknown): number {
    return Math.min(parsePositiveIntQuery(value, 50), 200);
  }

  function parseBooleanQuery(value: unknown): boolean | undefined {
    const raw = Array.isArray(value) ? value[0] : value;
    const s = String(raw ?? "").trim().toLowerCase();
    if (!s) return undefined;
    if (s === "1" || s === "true" || s === "yes") return true;
    if (s === "0" || s === "false" || s === "no") return false;
    return undefined;
  }

  function normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const t = String(value).trim();
    return t.length ? t : null;
  }

  function parseOptionalDate(value: unknown): Date | null {
    if (value === null || value === undefined || value === "") return null;
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  app.get("/api/maintenance-requests", requireAppAuth, requirePermission("maintenance.view"), async (req, res) => {
    try {
      const search = String(req.query.search ?? "").trim();
      const statusQ = String(req.query.status ?? "").trim();
      const priorityQ = String(req.query.priority ?? "").trim();
      const categoryQ = String(req.query.category ?? "").trim();
      const responsibleQ = String(req.query.responsible ?? "").trim();
      const areaSectorQ = String(req.query.areaSector ?? "").trim();
      const lateOnly = parseBooleanQuery(req.query.lateOnly);
      const page = parsePage(req.query.page);
      const pageSize = parsePageSize(req.query.pageSize);
      const skip = (page - 1) * pageSize;

      if (statusQ && !isValidMaintenanceStatus(statusQ)) {
        return res.status(400).json({ error: "Parâmetro status inválido." });
      }
      if (priorityQ && !isValidMaintenancePriority(priorityQ)) {
        return res.status(400).json({ error: "Parâmetro priority inválido." });
      }
      if (categoryQ && !isValidMaintenanceCategory(categoryQ)) {
        return res.status(400).json({ error: "Parâmetro category inválido." });
      }

      const now = new Date();
      const where: Prisma.MaintenanceRequestWhereInput = {
        ...(statusQ && isValidMaintenanceStatus(statusQ) ? { status: statusQ } : {}),
        ...(priorityQ && isValidMaintenancePriority(priorityQ) ? { priority: priorityQ } : {}),
        ...(categoryQ && isValidMaintenanceCategory(categoryQ) ? { category: categoryQ } : {}),
        ...(responsibleQ ? { responsible: { contains: responsibleQ, mode: "insensitive" } } : {}),
        ...(areaSectorQ ? { areaSector: { contains: areaSectorQ, mode: "insensitive" } } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
                { requester: { contains: search, mode: "insensitive" } },
                { location: { contains: search, mode: "insensitive" } },
                { areaSector: { contains: search, mode: "insensitive" } },
                { responsible: { contains: search, mode: "insensitive" } },
                { materialNotes: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(lateOnly === true
          ? {
              desiredDate: { lt: now },
              status: { notIn: ["CONCLUIDO", "CANCELADO"] },
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        prisma.maintenanceRequest.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: pageSize,
        }),
        prisma.maintenanceRequest.count({ where }),
      ]);

      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      res.json({
        rows,
        total,
        page,
        pageSize,
        totalPages,
      });
    } catch (e: any) {
      console.error("GET /api/maintenance-requests", e);
      res.status(500).json({ error: e?.message || "Erro ao listar solicitações de manutenção." });
    }
  });

  app.post("/api/maintenance-requests", requireAppAuth, requirePermission("maintenance.manage"), async (req, res) => {
    try {
      const body = req.body ?? {};
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const requester = typeof body.requester === "string" ? body.requester.trim() : "";
      const areaSector = typeof body.areaSector === "string" ? body.areaSector.trim() : "";
      const location = typeof body.location === "string" ? body.location.trim() : "";
      const category = body.category;
      const priorityRaw = body.priority;
      const responsible = normalizeOptionalString(body.responsible);
      const desiredDate = parseOptionalDate(body.desiredDate);
      const notes = normalizeOptionalString(body.notes);
      const needsMaterial = Boolean(body.needsMaterial);
      let materialNotes = normalizeOptionalString(body.materialNotes);
      const changedByCreate = normalizeOptionalString(body.changedBy);

      if (!title) return res.status(400).json({ error: "Título é obrigatório." });
      if (!description) return res.status(400).json({ error: "Descrição é obrigatória." });
      if (!requester) return res.status(400).json({ error: "Solicitante é obrigatório." });
      if (!areaSector) return res.status(400).json({ error: "Área/setor é obrigatório." });
      if (!location) return res.status(400).json({ error: "Local é obrigatório." });
      if (!isValidMaintenanceCategory(category)) {
        return res.status(400).json({ error: "Categoria inválida ou obrigatória." });
      }
      let priority: MaintenancePriority = "MEDIA";
      if (priorityRaw !== undefined && priorityRaw !== null && priorityRaw !== "") {
        if (!isValidMaintenancePriority(priorityRaw)) {
          return res.status(400).json({ error: "Prioridade inválida." });
        }
        priority = priorityRaw;
      }
      if (!needsMaterial) {
        materialNotes = null;
      }

      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.maintenanceRequest.create({
          data: {
            title,
            description,
            requester,
            areaSector,
            location,
            category,
            priority,
            status: "NOVA_SOLICITACAO",
            responsible,
            desiredDate,
            notes,
            needsMaterial,
            materialNotes,
          },
        });
        await tx.maintenanceRequestStatusHistory.create({
          data: {
            maintenanceRequestId: row.id,
            fromStatus: null,
            toStatus: "NOVA_SOLICITACAO",
            comment: "Solicitação criada",
            changedBy: changedByCreate,
          },
        });
        return tx.maintenanceRequest.findUniqueOrThrow({
          where: { id: row.id },
          include: { statusHistory: { orderBy: { changedAt: "desc" } } },
        });
      });

      res.status(201).json(created);
    } catch (e: any) {
      console.error("POST /api/maintenance-requests", e);
      res.status(500).json({ error: e?.message || "Erro ao criar solicitação de manutenção." });
    }
  });

  app.get("/api/maintenance-requests/:id/history", requireAppAuth, requirePermission("maintenance.view"), async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const exists = await prisma.maintenanceRequest.findUnique({ where: { id }, select: { id: true } });
      if (!exists) return res.status(404).json({ error: "Solicitação não encontrada." });
      const history = await prisma.maintenanceRequestStatusHistory.findMany({
        where: { maintenanceRequestId: id },
        orderBy: { changedAt: "desc" },
      });
      res.json({ history });
    } catch (e: any) {
      console.error("GET /api/maintenance-requests/:id/history", e);
      res.status(500).json({ error: e?.message || "Erro ao carregar histórico." });
    }
  });

  app.get("/api/maintenance-requests/:id", requireAppAuth, requirePermission("maintenance.view"), async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const row = await prisma.maintenanceRequest.findUnique({
        where: { id },
        include: { statusHistory: { orderBy: { changedAt: "desc" } } },
      });
      if (!row) return res.status(404).json({ error: "Solicitação não encontrada." });
      res.json(row);
    } catch (e: any) {
      console.error("GET /api/maintenance-requests/:id", e);
      res.status(500).json({ error: e?.message || "Erro ao carregar solicitação." });
    }
  });

  app.patch("/api/maintenance-requests/:id", requireAppAuth, requirePermission("maintenance.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const body = req.body ?? {};
      if (Object.prototype.hasOwnProperty.call(body, "status")) {
        return res.status(400).json({
          error: "Alteração de status não é permitida neste endpoint. Use PATCH /api/maintenance-requests/:id/status.",
        });
      }

      const existing = await prisma.maintenanceRequest.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Solicitação não encontrada." });

      const data: Prisma.MaintenanceRequestUpdateInput = {};
      if (Object.prototype.hasOwnProperty.call(body, "title")) {
        const v = typeof body.title === "string" ? body.title.trim() : "";
        if (!v) return res.status(400).json({ error: "Título não pode ser vazio." });
        data.title = v;
      }
      if (Object.prototype.hasOwnProperty.call(body, "description")) {
        const v = typeof body.description === "string" ? body.description.trim() : "";
        if (!v) return res.status(400).json({ error: "Descrição não pode ser vazia." });
        data.description = v;
      }
      if (Object.prototype.hasOwnProperty.call(body, "requester")) {
        const v = typeof body.requester === "string" ? body.requester.trim() : "";
        if (!v) return res.status(400).json({ error: "Solicitante não pode ser vazio." });
        data.requester = v;
      }
      if (Object.prototype.hasOwnProperty.call(body, "areaSector")) {
        const v = typeof body.areaSector === "string" ? body.areaSector.trim() : "";
        if (!v) return res.status(400).json({ error: "Área/setor não pode ser vazio." });
        data.areaSector = v;
      }
      if (Object.prototype.hasOwnProperty.call(body, "location")) {
        const v = typeof body.location === "string" ? body.location.trim() : "";
        if (!v) return res.status(400).json({ error: "Local não pode ser vazio." });
        data.location = v;
      }
      if (Object.prototype.hasOwnProperty.call(body, "category")) {
        if (!isValidMaintenanceCategory(body.category)) {
          return res.status(400).json({ error: "Categoria inválida." });
        }
        data.category = body.category;
      }
      if (Object.prototype.hasOwnProperty.call(body, "priority")) {
        if (!isValidMaintenancePriority(body.priority)) {
          return res.status(400).json({ error: "Prioridade inválida." });
        }
        data.priority = body.priority;
      }
      if (Object.prototype.hasOwnProperty.call(body, "responsible")) {
        data.responsible = normalizeOptionalString(body.responsible);
      }
      if (Object.prototype.hasOwnProperty.call(body, "desiredDate")) {
        const d = parseOptionalDate(body.desiredDate);
        data.desiredDate = d;
      }
      if (Object.prototype.hasOwnProperty.call(body, "notes")) {
        data.notes = normalizeOptionalString(body.notes);
      }
      let nextNeeds = existing.needsMaterial;
      if (Object.prototype.hasOwnProperty.call(body, "needsMaterial")) {
        nextNeeds = Boolean(body.needsMaterial);
        data.needsMaterial = nextNeeds;
      }
      if (Object.prototype.hasOwnProperty.call(body, "materialNotes")) {
        data.materialNotes = nextNeeds ? normalizeOptionalString(body.materialNotes) : null;
      } else if (Object.prototype.hasOwnProperty.call(body, "needsMaterial") && !nextNeeds) {
        data.materialNotes = null;
      }

      if (Object.keys(data).length === 0) {
        const unchanged = await prisma.maintenanceRequest.findUnique({
          where: { id },
          include: { statusHistory: { orderBy: { changedAt: "desc" } } },
        });
        return res.json(unchanged);
      }

      const updated = await prisma.maintenanceRequest.update({
        where: { id },
        data,
        include: { statusHistory: { orderBy: { changedAt: "desc" } } },
      });
      res.json(updated);
    } catch (e: any) {
      console.error("PATCH /api/maintenance-requests/:id", e);
      res.status(500).json({ error: e?.message || "Erro ao atualizar solicitação." });
    }
  });

  app.patch("/api/maintenance-requests/:id/status", requireAppAuth, requirePermission("maintenance.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const body = req.body ?? {};
      const status = body.status;
      if (!isValidMaintenanceStatus(status)) {
        return res.status(400).json({ error: "Status obrigatório ou inválido." });
      }
      const comment = normalizeOptionalString(body.comment);
      const changedBy = normalizeOptionalString(body.changedBy);

      const current = await prisma.maintenanceRequest.findUnique({ where: { id } });
      if (!current) return res.status(404).json({ error: "Solicitação não encontrada." });
      if (current.status === status) {
        const row = await prisma.maintenanceRequest.findUnique({
          where: { id },
          include: { statusHistory: { orderBy: { changedAt: "desc" } } },
        });
        return res.json({
          maintenanceRequest: row,
          statusUnchanged: true,
          message: "Status já era o informado; nenhum registro de histórico foi criado.",
        });
      }

      const updated = await prisma.$transaction(async (tx) => {
        await tx.maintenanceRequest.update({
          where: { id },
          data: { status },
        });
        await tx.maintenanceRequestStatusHistory.create({
          data: {
            maintenanceRequestId: id,
            fromStatus: current.status,
            toStatus: status,
            comment,
            changedBy,
          },
        });
        return tx.maintenanceRequest.findUniqueOrThrow({
          where: { id },
          include: { statusHistory: { orderBy: { changedAt: "desc" } } },
        });
      });

      res.json({ maintenanceRequest: updated });
    } catch (e: any) {
      console.error("PATCH /api/maintenance-requests/:id/status", e);
      res.status(500).json({ error: e?.message || "Erro ao alterar status." });
    }
  });

  // --- API pública: solicitação de reserva de frota (QR Code, sem login) ---
  registerFleetPublicReservationRoutes(app);
  registerFleetPublicReservationShortLinkMiddleware(app);
  registerFleetPublicVehicleChecklistRoutes(app);

  // --- API: Gestão de Frota ---
  registerFleetRoutes(app, {
    requireAppAuth,
    getCurrentAppUser,
  });

  registerExecutiveDashboardRoutes(app, {
    requireAppAuth,
    requirePermission,
    getCurrentAppUser,
  });

  registerNomusAccountsReceivableRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerNomusAccountsPayableRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerFinanceAccountsReceivableRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerFinanceArDueRadarRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerFinanceAccountsPayableRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerFinanceApDueRadarRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerFinanceSuppliersRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerFinanceCostCentersRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerFinanceCostCenterDetailRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerFinanceCostCenterReclassificationRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerFinanceSupplierCostCenterRulesRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerFinanceClassificationRulesRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerFinanceAccountsPayableCostCenterAllocationRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerFinanceUnclassifiedImportRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerFinanceBillingRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerFinanceSalesOrdersRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
  });

  registerFinanceCashFlowRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerFinanceExecutiveReportRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerSalesProductRankingRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerCustomerIntelligenceRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
  });

  registerProjectsRoutes(
    app,
    {
      requireAppAuth,
      requireAnyPermission,
      getCurrentAppUser,
    },
    {
      resolveOfficialProductCostAnalysis: async (productId) => {
        const cache = await initAnalysisCache();
        return getProductCostAnalysis(productId, cache, true);
      },
    }
  );

  registerInventoryRoutes(app, {
    requireAppAuth,
    requireAnyPermission,
    getCurrentAppUser,
  });

  const { registerCompanyIntelligenceRoutes } = await import(
    "./src/lib/companyIntelligenceRoutes.js"
  );
  registerCompanyIntelligenceRoutes(app, {
    requireAppAuth,
    requirePermission,
    requireAnyPermission,
    getCurrentAppUser,
  });

  registerSettingsGlobalsRoutes(
    app,
    {
      requireAppAuth,
      requireBootstrapOrAnyPermission,
    },
    { initAnalysisCache }
  );

  registerSettingsSalesMarginNomusRoutes(app, {
    requireAppAuth,
    requireBootstrapOrAnyPermission,
  });

  registerSettingsNomusSyncRoutes(
    app,
    { requireBootstrapOrAnyPermission },
    {
      listNomusSyncLogEntries,
      buildNomusSummary,
      mergeNomusSummaryWithIntegrationRun,
      loadNomusIntegrationRunByBasename,
      readNomusSyncLogSafe,
      buildNomusIntegrationHealthPayload,
      findNomusIntegrationRunForLog,
      sanitizeLogContent,
      nomusSyncTargets: NOMUS_SYNC_TARGETS,
      maxNomusLogFilesScan: MAX_NOMUS_LOG_FILES_SCAN,
    }
  );

  // API fallback: garante resposta JSON para rotas /api não registradas
  // e evita cair no fallback HTML da SPA (Vite/index.html).
  app.use("/api", (req, res) => {
    res.status(404).json({
      error: "API route not found",
      method: req.method,
      path: req.originalUrl,
    });
  });

  // Global Error Handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Express Error:", err);
    res.status(500).json({ 
      error: err.message || "Internal Server Error",
      stack: process.env.NODE_ENV !== "production" ? err.stack : undefined
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");

    const setSpaHtmlNoCacheHeaders = (res: express.Response) => {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate");
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");
    };

    app.use(
      express.static(distPath, {
        setHeaders(res, filePath) {
          const normalized = filePath.replace(/\\/g, "/");
          if (normalized.endsWith("/index.html") || normalized.endsWith("index.html")) {
            setSpaHtmlNoCacheHeaders(res);
          } else if (normalized.includes("/assets/")) {
            res.set("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      })
    );
    app.get("*", (_req, res) => {
      setSpaHtmlNoCacheHeaders(res);
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(Number(port), host, () => {
    console.log(`Server running on http://${host}:${port}`);
  });
}

startServer();