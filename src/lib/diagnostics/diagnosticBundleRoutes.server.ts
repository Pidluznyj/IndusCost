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

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

export function registerDiagnosticBundleRoutes(
  app: express.Express,
  deps: AuthGuards & { prisma: PrismaClient }
): void {
  const { requireAppAuth, requireAnyPermission, prisma } = deps;

  const guard = [
    requireAppAuth,
    requireAnyPermission([...PRODUCTION_COST_TABLE_VIEW_PERMISSIONS]),
  ] as const;

  app.post("/api/diagnostics/chatgpt-bundle", ...guard, async (req, res) => {
    try {
      const parsed = parseProductEngineeringDiagnosticRequest(req.body);
      if (parsed.scope !== "PRODUCT_ENGINEERING") {
        res.status(400).json({ error: "Escopo não suportado nesta rota." });
        return;
      }

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
    } catch (error) {
      if (error instanceof ProductEngineeringDiagnosticValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error("POST /api/diagnostics/chatgpt-bundle", error);
      res.status(500).json({ error: "Erro ao gerar pacote diagnóstico analisável." });
    }
  });
}
