import type express from "express";
import type { RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import { loadAndBuildProposalInternalManagementPdf } from "./proposalInternalManagementPdf.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
};

async function handleInternalManagementLoad(
  deps: { prisma: PrismaClient; isUuid: (value: unknown) => value is string },
  proposalId: string,
  res: express.Response,
  mode: "pdf" | "document"
) {
  if (!deps.isUuid(proposalId)) {
    return res.status(400).json({
      error: "INVALID_ID",
      message: "Identificador da proposta inválido.",
    });
  }

  const result = await loadAndBuildProposalInternalManagementPdf(
    deps.prisma,
    proposalId
  );
  if (!result.ok) {
    return res.status(result.status).json({
      error: result.code,
      message: result.message,
    });
  }

  if (mode === "document") {
    return res.json({ document: result.document });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${result.filename}"`
  );
  return res.send(result.buffer);
}

export function registerProposalInternalManagementPdfRoutes(
  app: express.Application,
  guards: AuthGuards,
  deps: { prisma: PrismaClient; isUuid: (value: unknown) => value is string }
): void {
  const { requireAppAuth, requirePermission } = guards;

  app.get(
    "/api/proposals/:proposalId/internal-management-document",
    requireAppAuth,
    requirePermission("proposals.view"),
    async (req, res) => {
      try {
        return await handleInternalManagementLoad(
          deps,
          req.params.proposalId,
          res,
          "document"
        );
      } catch (error) {
        console.error(
          "GET /api/proposals/:proposalId/internal-management-document",
          error
        );
        return res.status(500).json({
          error: "INTERNAL_MANAGEMENT_DOCUMENT_FAILED",
          message:
            "Não foi possível montar o relatório gerencial interno da proposta.",
        });
      }
    }
  );

  app.get(
    "/api/proposals/:proposalId/internal-management-pdf",
    requireAppAuth,
    requirePermission("proposals.view"),
    async (req, res) => {
      try {
        return await handleInternalManagementLoad(
          deps,
          req.params.proposalId,
          res,
          "pdf"
        );
      } catch (error) {
        console.error("GET /api/proposals/:proposalId/internal-management-pdf", error);
        return res.status(500).json({
          error: "INTERNAL_MANAGEMENT_PDF_FAILED",
          message: "Não foi possível gerar o PDF gerencial interno da proposta.",
        });
      }
    }
  );
}
