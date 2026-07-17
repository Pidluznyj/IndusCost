/**
 * DS-04.1 / DS-04.2 — Rotas read-only Comercial → Documentos de Saída.
 *
 * Autorização provisória (até DS-07 seed `commercial.output_documents`):
 * mesmo padrão de sold-products — requireAnyPermission com bag comercial.
 */

import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  loadOutputDocumentsList,
  loadOutputDocumentsSummary,
} from "@/src/lib/output-documents/outputDocumentsList.server.js";
import { OutputDocumentsListQueryError } from "@/src/lib/output-documents/outputDocumentsListQuery.js";
import {
  loadOutputDocumentDetail,
  OutputDocumentDetailInvalidIdError,
} from "@/src/lib/output-documents/outputDocumentsDetail.server.js";
import { COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

/**
 * Bag provisória de visualização.
 * Inclui alias canônico futuro + grants comerciais já existentes.
 */
export const OUTPUT_DOCUMENTS_VIEW_PERMISSIONS = [
  `${COMMERCIAL_RESOURCE_KEYS.outputDocuments}.view`,
  "sales_orders.view",
  "sales_orders.detail.view",
  "crm.view",
  "crm.general.view",
  "reports.view",
] as const;

export function registerOutputDocumentsRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;
  const guard = [
    requireAppAuth,
    requireAnyPermission([...OUTPUT_DOCUMENTS_VIEW_PERMISSIONS]),
  ] as const;

  app.get(
    "/api/commercial/output-documents/summary",
    ...guard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const payload = await loadOutputDocumentsSummary(
          req.query as Record<string, unknown>
        );
        return res.json(payload);
      } catch (error) {
        if (error instanceof OutputDocumentsListQueryError) {
          return res.status(400).json({ error: error.message });
        }
        console.error("GET /api/commercial/output-documents/summary", error);
        return res
          .status(500)
          .json({
            error: "Não foi possível carregar o resumo de Documentos de Saída.",
          });
      }
    }
  );

  app.get("/api/commercial/output-documents", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const payload = await loadOutputDocumentsList(
        req.query as Record<string, unknown>
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
    ...guard,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });

        const { prisma } = await import("@/src/lib/prisma.js");
        const payload = await loadOutputDocumentDetail(String(req.params.id ?? ""), {
          prisma,
        });
        if (!payload) {
          return res
            .status(404)
            .json({ error: "Documento de Saída não encontrado." });
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
