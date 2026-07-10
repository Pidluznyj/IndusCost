import type express from "express";
import type { RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import { loadAndBuildProposalInternalManagementPdf } from "./proposalInternalManagementPdf.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
};

export function registerProposalInternalManagementPdfRoutes(
  app: express.Application,
  guards: AuthGuards,
  deps: { prisma: PrismaClient; isUuid: (value: unknown) => value is string }
): void {
  const { requireAppAuth, requirePermission } = guards;

  app.get(
    "/api/proposals/:proposalId/internal-management-pdf",
    requireAppAuth,
    requirePermission("proposals.view"),
    async (req, res) => {
      try {
        const proposalId = req.params.proposalId;
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

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${result.filename}"`
        );
        return res.send(result.buffer);
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
