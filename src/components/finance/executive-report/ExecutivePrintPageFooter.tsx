import React from "react";
import {
  EXECUTIVE_REPORT_SOURCES_LABEL,
  formatExecutiveReportGeneratedFooter,
} from "@/src/lib/financeExecutiveReportUxCopy";

export function ExecutivePrintPageFooter({
  pageNumber,
  totalPages,
  generatedAt,
}: {
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
}) {
  return (
    <div className="executive-print-page-footer" aria-hidden="true">
      <span className="executive-print-page-footer-sources">{EXECUTIVE_REPORT_SOURCES_LABEL}</span>
      <span className="executive-print-page-footer-page">
        Página {pageNumber} de {totalPages}
      </span>
      <span className="executive-print-page-footer-generated">
        {formatExecutiveReportGeneratedFooter(generatedAt)}
      </span>
    </div>
  );
}
