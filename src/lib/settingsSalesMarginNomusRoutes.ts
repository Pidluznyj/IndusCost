import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  listActiveSalesTaxRules,
  resolveSalesTaxRuleById,
  type ResolvedSalesTaxRule,
} from "@/src/lib/averageSalesTaxEngine.js";
import {
  buildSalesMarginNomusPreview,
  type SalesMarginNomusPreviewQuery,
} from "@/src/lib/salesMarginNomusConfig.server.js";
import {
  loadSalesMarginNomusConfig,
  normalizeSalesMarginNomusConfigInput,
  saveSalesMarginNomusConfig,
  type SalesMarginNomusConfig,
  validateSalesMarginNomusConfigForSave,
} from "@/src/lib/salesMarginNomusConfig.js";
import {
  SETTINGS_GLOBAL_PARAMS_EDIT_PERMISSIONS,
  SETTINGS_GLOBAL_PARAMS_VIEW_PERMISSIONS,
} from "@/src/lib/settingsGlobalsRoutes.js";
import { OFFICIAL_SM_RULES_SOURCE } from "@/src/lib/salesMarginRulesAdapter.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireBootstrapOrAnyPermission: (permissions: string[]) => RequestHandler;
};

export const SETTINGS_SALES_MARGIN_NOMUS_VIEW_PERMISSIONS = [
  ...SETTINGS_GLOBAL_PARAMS_VIEW_PERMISSIONS,
] as const;

export const SETTINGS_SALES_MARGIN_NOMUS_EDIT_PERMISSIONS = [
  ...SETTINGS_GLOBAL_PARAMS_EDIT_PERMISSIONS,
] as const;

export const SALES_MARGIN_NOMUS_PRODUCT_TAX_PRIORITY_NOTE =
  "Produtos com ProductPricing → TaxRule específica têm prioridade sobre a regra padrão Nomus.";

export type SalesMarginNomusSettingsPayload = {
  config: SalesMarginNomusConfig;
  configRowId: string | null;
  taxRules: ResolvedSalesTaxRule[];
  selectedTaxRule: ResolvedSalesTaxRule | null;
  metricsSource: typeof OFFICIAL_SM_RULES_SOURCE;
  productTaxPriorityNote: string;
};

export async function buildSalesMarginNomusSettingsPayload(input: {
  config: SalesMarginNomusConfig;
  configRowId: string | null;
  taxRules?: ResolvedSalesTaxRule[];
}): Promise<SalesMarginNomusSettingsPayload> {
  const taxRules = input.taxRules ?? (await listActiveSalesTaxRules(prisma));
  const selectedTaxRule = input.config.defaultTaxRuleId
    ? await resolveSalesTaxRuleById(prisma, input.config.defaultTaxRuleId)
    : null;
  return {
    config: input.config,
    configRowId: input.configRowId,
    taxRules,
    selectedTaxRule,
    metricsSource: OFFICIAL_SM_RULES_SOURCE,
    productTaxPriorityNote: SALES_MARGIN_NOMUS_PRODUCT_TAX_PRIORITY_NOTE,
  };
}

function parsePreviewQuery(q: Record<string, unknown>): SalesMarginNomusPreviewQuery {
  const year = Number(q.year ?? new Date().getFullYear());
  const month = Number(q.month ?? new Date().getMonth() + 1);
  return {
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    month: Number.isFinite(month) ? Math.min(12, Math.max(1, month)) : 1,
    customerId: typeof q.customerId === "string" && q.customerId.trim() ? q.customerId.trim() : null,
    productId: typeof q.productId === "string" && q.productId.trim() ? q.productId.trim() : null,
    asOfDate: typeof q.asOfDate === "string" && q.asOfDate.trim() ? q.asOfDate.trim() : null,
  };
}

export function registerSettingsSalesMarginNomusRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const { requireAppAuth, requireBootstrapOrAnyPermission } = auth;
  const viewGuard = [
    requireAppAuth,
    requireBootstrapOrAnyPermission([...SETTINGS_SALES_MARGIN_NOMUS_VIEW_PERMISSIONS]),
  ] as const;
  const editGuard = [
    requireAppAuth,
    requireBootstrapOrAnyPermission([...SETTINGS_SALES_MARGIN_NOMUS_EDIT_PERMISSIONS]),
  ] as const;

  app.get("/api/settings/sales-margin-nomus", ...viewGuard, async (_req, res) => {
    try {
      const [{ config, configRowId }, taxRules] = await Promise.all([
        loadSalesMarginNomusConfig(prisma),
        listActiveSalesTaxRules(prisma),
      ]);
      const payload = await buildSalesMarginNomusSettingsPayload({
        config,
        configRowId,
        taxRules,
      });
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/settings/sales-margin-nomus", error);
      return res.status(500).json({ error: "Erro ao carregar configuração de margem Nomus." });
    }
  });

  app.put("/api/settings/sales-margin-nomus", ...editGuard, async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const config = normalizeSalesMarginNomusConfigInput(body);

      const selectedTaxRule = config.defaultTaxRuleId
        ? await resolveSalesTaxRuleById(prisma, config.defaultTaxRuleId)
        : null;

      const validation = validateSalesMarginNomusConfigForSave(config, selectedTaxRule);
      if (!validation.ok) {
        return res.status(400).json({ error: validation.error, code: validation.code });
      }

      const { configRowId: existingId } = await loadSalesMarginNomusConfig(prisma);
      const saved = await saveSalesMarginNomusConfig(prisma, config, existingId);

      const { config: reloaded } = await loadSalesMarginNomusConfig(prisma);
      const taxRules = await listActiveSalesTaxRules(prisma);
      const payload = await buildSalesMarginNomusSettingsPayload({
        config: reloaded,
        configRowId: saved.configRowId,
        taxRules,
      });

      return res.json(payload);
    } catch (error) {
      console.error("PUT /api/settings/sales-margin-nomus", error);
      return res.status(500).json({ error: "Erro ao salvar configuração de margem Nomus." });
    }
  });

  app.get("/api/settings/sales-margin-nomus/preview", ...viewGuard, async (req, res) => {
    try {
      const payload = await buildSalesMarginNomusPreview(
        prisma,
        parsePreviewQuery(req.query as Record<string, unknown>)
      );
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/settings/sales-margin-nomus/preview", error);
      return res.status(500).json({ error: "Erro ao gerar preview de margem Nomus." });
    }
  });
}
