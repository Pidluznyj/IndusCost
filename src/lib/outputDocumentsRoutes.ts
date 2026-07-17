/**
 * DS-04.1–04.4 — Rotas read-only Comercial → Documentos de Saída.
 * Auth: requireResource granular + escopo comercial oficial + raw gated.
 */

import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import {
  loadOutputDocumentsList,
  loadOutputDocumentsSummary,
} from "@/src/lib/output-documents/outputDocumentsList.server.js";
import { OutputDocumentsListQueryError } from "@/src/lib/output-documents/outputDocumentsListQuery.js";
import {
  loadOutputDocumentDetail,
  OutputDocumentDetailInvalidIdError,
} from "@/src/lib/output-documents/outputDocumentsDetail.server.js";
import {
  isOutputDocumentInPortfolio,
  loadOutputDocumentsPortfolioKeys,
  portfolioKeysToDocumentWhere,
  resolveOutputDocumentsAccessScope,
} from "@/src/lib/output-documents/outputDocumentsAccessScope.js";
import {
  decideOutputDocumentRawAccess,
  logOutputDocumentRawAccess,
  parseIncludeRawFlag,
} from "@/src/lib/output-documents/outputDocumentsRawAccess.js";
import {
  authorizeRequireResource,
} from "@/src/lib/security/requireResource.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

function canViewResource(
  user: AppAuthContext,
  resourceKey: string
): boolean {
  const decision = authorizeRequireResource(user, resourceKey, "view", {
    legacyCompatMode: true,
  });
  return decision.ok;
}

export function registerOutputDocumentsRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;

  const listGuard = [
    requireAppAuth,
    requireResource(
      COMMERCIAL_RESOURCE_KEYS.outputDocuments,
      COMMERCIAL_ACTIONS.view
    ),
  ] as const;

  const detailGuard = [
    requireAppAuth,
    requireResource(
      COMMERCIAL_RESOURCE_KEYS.outputDocumentsDetail,
      COMMERCIAL_ACTIONS.view
    ),
  ] as const;

  app.get(
    "/api/commercial/output-documents/summary",
    ...listGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const { prisma } = await import("@/src/lib/prisma.js");
        const scope = await resolveOutputDocumentsAccessScope(user, prisma);
        if (!scope.ok) return res.status(scope.status).json(scope.body);

        let scopeWhere = null;
        if (scope.mode === "own_portfolio") {
          const keys = await loadOutputDocumentsPortfolioKeys(
            prisma,
            scope.allowedCustomerIds
          );
          scopeWhere = portfolioKeysToDocumentWhere(keys);
        }

        const payload = await loadOutputDocumentsSummary(
          req.query as Record<string, unknown>,
          { prisma, scopeWhere }
        );
        return res.json(payload);
      } catch (error) {
        if (error instanceof OutputDocumentsListQueryError) {
          return res.status(400).json({ error: error.message });
        }
        console.error("GET /api/commercial/output-documents/summary", error);
        return res.status(500).json({
          error: "Não foi possível carregar o resumo de Documentos de Saída.",
        });
      }
    }
  );

  app.get("/api/commercial/output-documents", ...listGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const { prisma } = await import("@/src/lib/prisma.js");
      const scope = await resolveOutputDocumentsAccessScope(user, prisma);
      if (!scope.ok) return res.status(scope.status).json(scope.body);

      let scopeWhere = null;
      if (scope.mode === "own_portfolio") {
        const keys = await loadOutputDocumentsPortfolioKeys(
          prisma,
          scope.allowedCustomerIds
        );
        scopeWhere = portfolioKeysToDocumentWhere(keys);
      }

      const payload = await loadOutputDocumentsList(
        req.query as Record<string, unknown>,
        { prisma, scopeWhere }
      );
      return res.json(payload);
    } catch (error) {
      if (error instanceof OutputDocumentsListQueryError) {
        return res.status(400).json({ error: error.message });
      }
      console.error("GET /api/commercial/output-documents", error);
      return res
        .status(500)
        .json({ error: "Não foi possível carregar Documentos de Saída." });
    }
  });

  app.get(
    "/api/commercial/output-documents/:id",
    ...detailGuard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const includeRaw = parseIncludeRawFlag(
          (req.query as Record<string, unknown>).includeRaw
        );
        if (includeRaw) {
          const rawDecision = decideOutputDocumentRawAccess({
            user,
            includeRaw: true,
          });
          if (!rawDecision.allowed) {
            return res.status(rawDecision.status).json(rawDecision.body);
          }
        }

        const { prisma } = await import("@/src/lib/prisma.js");
        const scope = await resolveOutputDocumentsAccessScope(user, prisma);
        if (!scope.ok) return res.status(scope.status).json(scope.body);

        const canViewFinancial = canViewResource(
          user,
          COMMERCIAL_RESOURCE_KEYS.outputDocumentsFinancial
        );
        const canViewAudit = canViewResource(
          user,
          COMMERCIAL_RESOURCE_KEYS.outputDocumentsAudit
        );
        const canViewRaw = canViewResource(
          user,
          COMMERCIAL_RESOURCE_KEYS.outputDocumentsRaw
        );

        const payload = await loadOutputDocumentDetail(
          String(req.params.id ?? ""),
          {
            prisma,
            includeRaw: includeRaw && canViewRaw,
            permissions: {
              canViewFinancial,
              canViewAudit,
              canViewRaw: includeRaw && canViewRaw,
            },
          }
        );
        if (!payload) {
          return res
            .status(404)
            .json({ error: "Documento de Saída não encontrado." });
        }

        if (scope.mode === "own_portfolio") {
          const inScope = await isOutputDocumentInPortfolio(prisma, {
            allowedCustomerIds: scope.allowedCustomerIds,
            idNfe: payload.document.idNfe,
            externalId: payload.document.externalId,
            linkedSalesOrderIds: payload.orders.map((o) => o.salesOrderId),
          });
          if (!inScope) {
            return res.status(403).json({
              error: "Documento fora do escopo comercial do usuário.",
              code: "OUTPUT_DOCUMENTS_OUT_OF_SCOPE",
            });
          }
        }

        if (includeRaw && canViewRaw) {
          logOutputDocumentRawAccess({
            userId: user.id,
            role: user.role,
            allowed: true,
            includeRaw: true,
            documentExternalId: payload.document.externalId,
            reason: "GRANTED",
          });
        }

        return res.json(payload);
      } catch (error) {
        if (error instanceof OutputDocumentDetailInvalidIdError) {
          return res.status(400).json({ error: error.message });
        }
        console.error("GET /api/commercial/output-documents/:id", error);
        return res.status(500).json({
          error: "Não foi possível carregar o detalhe do Documento de Saída.",
        });
      }
    }
  );
}
