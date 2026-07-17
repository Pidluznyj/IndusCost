import type express from "express";
import type { PrismaClient } from "@prisma/client";
import type { RequestHandler } from "express";
import { ENGINEERING_RESOURCE_KEYS } from "./engineeringAccess.js";
import {
  buildMaterialMarketIntelligenceExportDocumentForRequest,
  parseMaterialMarketIntelligenceExportRequest,
} from "./materialMarketIntelligenceExport.server.js";
import { renderMaterialMarketIntelligenceExport } from "./materialMarketIntelligenceExport.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

type RouteDeps = {
  prisma: PrismaClient;
};

function sendExport(
  res: express.Response,
  rendered: ReturnType<typeof renderMaterialMarketIntelligenceExport>
) {
  res.setHeader("Content-Type", rendered.contentType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${rendered.filename}"`
  );
  if (typeof rendered.body === "string") {
    return res.status(200).send(rendered.body);
  }
  return res.status(200).send(Buffer.from(rendered.body));
}

async function handleExport(
  req: express.Request,
  res: express.Response,
  deps: RouteDeps
) {
  const parsed = parseMaterialMarketIntelligenceExportRequest({
    query: req.query as Record<string, unknown>,
    body: req.body,
  });
  if (parsed.ok === false) {
    return res.status(400).json({ error: parsed.message });
  }

  const built = await buildMaterialMarketIntelligenceExportDocumentForRequest(deps.prisma, {
    scope: parsed.scope,
    filters: parsed.filters,
    simulationResult: parsed.simulationResult,
  });
  if (built.ok === false) {
    return res.status(built.status).json({ error: built.message });
  }

  const rendered = renderMaterialMarketIntelligenceExport(built.document, parsed.format);
  return sendExport(res, rendered);
}

export function registerMaterialMarketIntelligenceExportRoutes(
  app: express.Application,
  guards: AuthGuards,
  deps: RouteDeps
): void {
  const { requireAppAuth, requireResource } = guards;
  const guard = [
    requireAppAuth,
    requireResource(ENGINEERING_RESOURCE_KEYS.marketIntelligence, "view"),
  ] as const;

  app.get(
    "/api/materials/market-intelligence/export",
    ...guard,
    async (req, res) => {
      try {
        await handleExport(req, res, deps);
      } catch (error) {
        console.error("GET /api/materials/market-intelligence/export", error);
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Não foi possível exportar a Inteligência de Mercado.",
        });
      }
    }
  );

  app.post(
    "/api/materials/market-intelligence/export",
    ...guard,
    async (req, res) => {
      try {
        await handleExport(req, res, deps);
      } catch (error) {
        console.error("POST /api/materials/market-intelligence/export", error);
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Não foi possível exportar a Inteligência de Mercado.",
        });
      }
    }
  );
}
