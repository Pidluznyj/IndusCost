import React from "react";
import {
  EXECUTIVE_REPORT_PRINT_DATA_NOTE,
  formatExecutiveReportGeneratedFooter,
} from "@/src/lib/financeExecutiveReportUxCopy";

export function ExecutivePrintPageFooter({
  pageNumber,
  generatedAt,
}: {
  pageNumber: number;
  generatedAt: string;
}) {
  return (
    <div className="executive-print-page-footer" aria-hidden="true">
      <span className="executive-print-page-footer-sources">{EXECUTIVE_REPORT_PRINT_DATA_NOTE}</span>
      <span className="executive-print-page-footer-page">Página {pageNumber}</span>
      <span className="executive-print-page-footer-generated">
        {formatExecutiveReportGeneratedFooter(generatedAt)}
      </span>
    </div>
  );
}
