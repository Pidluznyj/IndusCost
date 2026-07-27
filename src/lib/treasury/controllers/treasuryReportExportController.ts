/**
 * Controllers HTTP — exportação de relatórios da Tesouraria.
 */

import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import { parseTreasuryReportQuery } from "../contracts/treasurySchemas.js";
import {
  buildTreasuryReportExportActor,
  createTreasuryReportExportService,
  type TreasuryReportExportService,
} from "../services/treasuryReportExportService.server.js";
import type { TreasuryReportExportFormat } from "../treasuryReportExport.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "../treasuryHttp.js";

export type TreasuryReportExportControllerDeps = {
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  service?: TreasuryReportExportService;
};

function parseFormat(raw: string | undefined): TreasuryReportExportFormat | null {
  if (raw === "csv" || raw === "xlsx" || raw === "pdf") return raw;
  return null;
}

export function createTreasuryReportExportControllers(
  deps: TreasuryReportExportControllerDeps
) {
  const service =
    deps.service ?? createTreasuryReportExportService({ prisma });

  async function withAuth(
    req: Request,
    res: Response,
    fn: (user: AppAuthContext, requestId: string) => Promise<void>
  ): Promise<void> {
    const requestId = resolveTreasuryRequestId(req);
    res.setHeader("x-request-id", requestId);
    try {
      const user = await deps.getCurrentAppUser(req);
      if (!user) {
        sendTreasuryError(res, {
          requestId,
          error: "Autenticação necessária.",
          code: "UNAUTHORIZED",
        });
        return;
      }
      await fn(user, requestId);
    } catch (err) {
      handleTreasuryRouteError(res, requestId, err);
    }
  }

  function exportWithFormat(format: TreasuryReportExportFormat) {
    return (req: Request, res: Response) =>
      withAuth(req, res, async (user, requestId) => {
        const query = parseTreasuryReportQuery(
          req.params.reportKey,
          req.query as Record<string, unknown>
        );
        const result = await service.exportReport(
          buildTreasuryReportExportActor(user, requestId),
          query,
          format
        );
        res.setHeader("Content-Type", result.contentType);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${result.filename}"`
        );
        res.setHeader("x-generated-at", result.generatedAt);
        res.status(200).send(result.body);
      });
  }

  return {
    exportCsv: exportWithFormat("csv"),
    exportXlsx: exportWithFormat("xlsx"),
    exportPdf: exportWithFormat("pdf"),
    /** @deprecated use exportCsv|exportXlsx|exportPdf */
    exportReport: (req: Request, res: Response) => {
      const format = parseFormat(req.params.format);
      if (!format) {
        const requestId = resolveTreasuryRequestId(req);
        sendTreasuryError(res, {
          requestId,
          error: "Formato de exportação inválido (csv|xlsx|pdf).",
          code: "VALIDATION_ERROR",
          field: "format",
        });
        return;
      }
      return exportWithFormat(format)(req, res);
    },
  };
}
