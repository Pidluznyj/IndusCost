/**
 * Rotas read-only — Gerar Relatório Analisável (ChatGPT Diagnostic Bundle).
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type express from "express";
import type { RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import { COMMISSIONS_AUDIT_VIEW_PERMISSIONS } from "../commissionsPermissions.js";
import { PRODUCTION_COST_TABLE_VIEW_PERMISSIONS } from "../productionCostTablesUi.js";
import {
  CommissionReceiptClosingDiagnosticValidationError,
  buildAndWriteCommissionReceiptClosingDiagnosticBundle,
  parseCommissionReceiptClosingDiagnosticRequest,
} from "./commissionDiagnostic.server.js";
import type { BuildDiagnosticBundleResult } from "./diagnosticBundleBuilder.server.js";
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
import {
  SystemDiagnosticValidationError,
  buildAndWriteSystemDiagnosticBundle,
  parseSystemDiagnosticRequest,
} from "./systemDiagnostic.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

const DIAGNOSTIC_BUNDLE_PERMISSIONS = [
  ...PRODUCTION_COST_TABLE_VIEW_PERMISSIONS,
  ...COMMISSIONS_AUDIT_VIEW_PERMISSIONS,
  "pricing.view",
  "settings.price_tables.view",
] as const;

async function buildScopeDiagnosticBundle(
  prisma: PrismaClient,
  body: unknown
): Promise<{ scope: string; result: BuildDiagnosticBundleResult }> {
  const raw = body as Record<string, unknown> | null;
  const scope = String(raw?.scope ?? "").trim().toUpperCase();

  if (scope === "SYSTEM") {
    const parsed = parseSystemDiagnosticRequest(body);
    const result = await buildAndWriteSystemDiagnosticBundle(prisma, parsed.context ?? {});
    return { scope: parsed.scope, result };
  }

  if (scope === "PRODUCT_ENGINEERING") {
    const parsed = parseProductEngineeringDiagnosticRequest(body);
    const result = await buildAndWriteProductEngineeringDiagnosticBundle(
      prisma,
      parsed.context
    );
    return { scope: parsed.scope, result };
  }

  if (scope === "PUBLISHED_PRICE") {
    const parsed = parsePublishedPriceDiagnosticRequest(body);
    const result = await buildAndWritePublishedPriceDiagnosticBundle(
      prisma,
      parsed.context
    );
    return { scope: parsed.scope, result };
  }

  if (scope === "COMMISSION_RECEIPT_CLOSING") {
    const parsed = parseCommissionReceiptClosingDiagnosticRequest(body);
    const result = await buildAndWriteCommissionReceiptClosingDiagnosticBundle(
      prisma,
      parsed.context
    );
    return { scope: parsed.scope, result };
  }

  throw new Error(
    'scope deve ser "SYSTEM", "PRODUCT_ENGINEERING", "PUBLISHED_PRICE" ou "COMMISSION_RECEIPT_CLOSING".'
  );
}

function isDiagnosticValidationError(error: unknown): error is Error {
  return (
    error instanceof ProductEngineeringDiagnosticValidationError ||
    error instanceof PublishedPriceDiagnosticValidationError ||
    error instanceof CommissionReceiptClosingDiagnosticValidationError ||
    error instanceof SystemDiagnosticValidationError
  );
}

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
      const { scope, result } = await buildScopeDiagnosticBundle(prisma, req.body);
      res.status(200).json({
        ok: true,
        scope,
        bundleId: result.bundle.manifest.bundleId,
        generatedAt: result.bundle.manifest.generatedAt,
        outputDir: result.outputDir,
        zipPath: result.zipPath,
        fileCount: result.bundle.manifest.files.length,
      });
    } catch (error) {
      if (isDiagnosticValidationError(error)) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message.includes("scope deve ser")) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error("POST /api/diagnostics/chatgpt-bundle", error);
      res.status(500).json({ error: "Erro ao gerar pacote diagnóstico analisável." });
    }
  });

  app.post("/api/diagnostics/report", ...guard, async (req, res) => {
    try {
      const { scope, result } = await buildScopeDiagnosticBundle(prisma, req.body);
      const zipBuffer = readFileSync(result.zipPath);
      const executiveSummary =
        result.bundle.entries["01_EXECUTIVE_SUMMARY.md"] ??
        "# Executive Summary\n\n(Resumo indisponível no bundle.)";
      res.status(200).json({
        ok: true,
        scope,
        bundleId: result.bundle.manifest.bundleId,
        generatedAt: result.bundle.manifest.generatedAt,
        filename: basename(result.zipPath),
        fileCount: result.bundle.manifest.files.length,
        executiveSummary,
        zipBase64: zipBuffer.toString("base64"),
      });
    } catch (error) {
      if (isDiagnosticValidationError(error)) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message.includes("scope deve ser")) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error("POST /api/diagnostics/report", error);
      res.status(500).json({ error: "Erro ao gerar relatório analisável." });
    }
  });
}
