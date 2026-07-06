import React from "react";
import {
  EXECUTIVE_REPORT_SOURCES_LABEL,
  formatExecutiveReportGeneratedFooter,
} from "@/src/lib/financeExecutiveReportUxCopy";

export function ExecutiveReportDocumentFooter({ generatedAt }: { generatedAt: string }) {
  return (
    <footer
      className="executive-report-document-footer executive-report-screen-only finance-executive-report-print-no-print"
      data-testid="executive-report-document-footer"
    >
      <p className="executive-report-document-footer-sources">{EXECUTIVE_REPORT_SOURCES_LABEL}</p>
      <p className="executive-report-document-footer-generated">
        {formatExecutiveReportGeneratedFooter(generatedAt)}
      </p>
    </footer>
  );
}
