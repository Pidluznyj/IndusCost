import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { resolvePrintLogoSrc } from "@/src/lib/printBranding";
import { EXECUTIVE_REPORT_DOCUMENT_TITLE } from "@/src/lib/financeExecutiveReportUtils";
import { EXECUTIVE_REPORT_PRINT_DATA_NOTE } from "@/src/lib/financeExecutiveReportUxCopy";

export function ExecutivePrintPageHeader({
  branding,
  periodLabel,
  reportDateLabel,
  companyLabel,
}: {
  branding: BrandingSettingsDTO;
  periodLabel: string;
  reportDateLabel: string;
  companyLabel: string;
}) {
  const logoSrc = resolvePrintLogoSrc(branding);

  return (
    <div className="executive-print-page-header" aria-hidden="true">
      <div className="executive-print-page-header-brand">
        {logoSrc ? (
          <img src={logoSrc} alt="Lazarios / Koppetel" className="executive-print-page-logo" />
        ) : (
          <span className="executive-print-page-brand-text">Lazarios · Koppetel</span>
        )}
      </div>
      <div className="executive-print-page-header-title">
        <p className="executive-print-page-header-doc">{EXECUTIVE_REPORT_DOCUMENT_TITLE}</p>
        <p className="executive-print-page-header-meta">
          {companyLabel} · {periodLabel} · Base {reportDateLabel}
        </p>
      </div>
      <div className="executive-print-page-header-source">{EXECUTIVE_REPORT_PRINT_DATA_NOTE}</div>
    </div>
  );
}
