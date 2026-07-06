/**
 * Rotas read-only — Gerar Relatório Analisável (ChatGPT Diagnostic Bundle).
 */
import type express from "express";
import type { RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import { PRODUCTION_COST_TABLE_VIEW_PERMISSIONS } from "../productionCostTablesUi.js";
import {
  ProductEngineeringDiagnosticValidationError,
  buildAndWriteProductEngineeringDiagnosticBundle,
  parseProductEngineeringDiagnosticRequest,
} from "./productEngineeringDiagnostic.server.js";
import {
  PublishedPriceDiagnosticValidationError,
  buildAndWritePublishedPriceDiagnosticBundle,
  parsePublishedPriceDiagnosticRequest,
} from "./pricingDiagnostic.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

const DIAGNOSTIC_BUNDLE_PERMISSIONS = [
  ...PRODUCTION_COST_TABLE_VIEW_PERMISSIONS,
  "pricing.view",
  "settings.price_tables.view",
] as const;

export function registerDiagnosticBundleRoutes(
  app: express.Express,
  deps: AuthGuards & { prisma: PrismaClient }
): void {
  const { requireAppAuth, requireAnyPermission, prisma } = deps;

  const guard = [
    requireAppAuth,
    requireAnyPermission([...DIAGNOSTIC_BUNDLE_PERMISSIONS]),
  ] as const;

  app.post("/api/diagnostics/chatgpt-bundle", ...guard, async (req, res) => {
    try {
      const raw = req.body as Record<string, unknown> | null;
      const scope = String(raw?.scope ?? "").trim().toUpperCase();

      if (scope === "PRODUCT_ENGINEERING") {
        const parsed = parseProductEngineeringDiagnosticRequest(req.body);
        const result = await buildAndWriteProductEngineeringDiagnosticBundle(
          prisma,
          parsed.context
        );
        res.status(200).json({
          ok: true,
          scope: parsed.scope,
          bundleId: result.bundle.manifest.bundleId,
          generatedAt: result.bundle.manifest.generatedAt,
          outputDir: result.outputDir,
          zipPath: result.zipPath,
          fileCount: result.bundle.manifest.files.length,
          sku: parsed.context.sku ?? null,
          productId: parsed.context.productId ?? null,
        });
        return;
      }

      if (scope === "PUBLISHED_PRICE") {
        const parsed = parsePublishedPriceDiagnosticRequest(req.body);
        const result = await buildAndWritePublishedPriceDiagnosticBundle(
          prisma,
          parsed.context
        );
        res.status(200).json({
          ok: true,
          scope: parsed.scope,
          bundleId: result.bundle.manifest.bundleId,
          generatedAt: result.bundle.manifest.generatedAt,
          outputDir: result.outputDir,
          zipPath: result.zipPath,
          fileCount: result.bundle.manifest.files.length,
          sku: parsed.context.sku ?? null,
          productId: parsed.context.productId ?? null,
          tableCode: parsed.context.tableCode ?? null,
          priceItemId: parsed.context.priceItemId ?? null,
        });
        return;
      }

      res.status(400).json({
        error: 'scope deve ser "PRODUCT_ENGINEERING" ou "PUBLISHED_PRICE".',
      });
    } catch (error) {
      if (
        error instanceof ProductEngineeringDiagnosticValidationError ||
        error instanceof PublishedPriceDiagnosticValidationError
      ) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error("POST /api/diagnostics/chatgpt-bundle", error);
      res.status(500).json({ error: "Erro ao gerar pacote diagnóstico analisável." });
    }
  });
}
