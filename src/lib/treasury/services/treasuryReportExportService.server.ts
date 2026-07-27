/**
 * Serviço — exportação de relatórios da Tesouraria.
 */

import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { TreasuryReportQuery } from "../contracts/treasurySchemas.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  buildTreasuryReportExportCsv,
  buildTreasuryReportExportFilename,
  buildTreasuryReportExportPayload,
  buildTreasuryReportExportPdf,
  buildTreasuryReportExportWorkbook,
  treasuryReportWorkbookToBytes,
  type TreasuryReportExportFormat,
} from "../treasuryReportExport.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import {
  buildTreasuryReportActor,
  createTreasuryReportService,
  type TreasuryReportService,
} from "./treasuryReportService.server.js";
import type { PrismaClient } from "@prisma/client";

export type TreasuryReportExportActor = {
  canViewReports: boolean;
  canExport: boolean;
  isSuperAdmin: boolean;
  reportActor: ReturnType<typeof buildTreasuryReportActor>;
};

export function buildTreasuryReportExportActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryReportExportActor {
  return {
    canViewReports: canTreasuryCapability(user, "viewReports"),
    canExport: canTreasuryCapability(user, "export"),
    isSuperAdmin: user.role === "SUPER_ADMIN",
    reportActor: buildTreasuryReportActor(user, requestId),
  };
}

export type TreasuryReportExportResult = {
  filename: string;
  contentType: string;
  body: Buffer;
  generatedAt: string;
};

export type TreasuryReportExportService = {
  exportReport(
    actor: TreasuryReportExportActor,
    query: TreasuryReportQuery,
    format: TreasuryReportExportFormat
  ): Promise<TreasuryReportExportResult>;
};

const CONTENT_TYPES: Record<TreasuryReportExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export function createTreasuryReportExportService(deps: {
  prisma?: PrismaClient;
  reportService?: TreasuryReportService;
}): TreasuryReportExportService {
  const reportService =
    deps.reportService ??
    createTreasuryReportService({ prisma: deps.prisma });

  return {
    async exportReport(actor, query, format) {
      if (!actor.canViewReports && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar relatórios da Tesouraria."
        );
      }
      if (!actor.canExport && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para exportar relatórios da Tesouraria."
        );
      }

      const report = await reportService.getReport(actor.reportActor, query);
      const generatedAt = new Date().toISOString();
      const payload = buildTreasuryReportExportPayload(report, generatedAt);
      const filename = buildTreasuryReportExportFilename(
        query.reportKey,
        format,
        generatedAt
      );

      if (format === "csv") {
        return {
          filename,
          contentType: CONTENT_TYPES.csv,
          body: Buffer.from(buildTreasuryReportExportCsv(payload), "utf8"),
          generatedAt,
        };
      }
      if (format === "xlsx") {
        const wb = buildTreasuryReportExportWorkbook(payload);
        return {
          filename,
          contentType: CONTENT_TYPES.xlsx,
          body: Buffer.from(treasuryReportWorkbookToBytes(wb)),
          generatedAt,
        };
      }
      return {
        filename,
        contentType: CONTENT_TYPES.pdf,
        body: buildTreasuryReportExportPdf(payload),
        generatedAt,
      };
    },
  };
}
