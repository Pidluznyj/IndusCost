import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import type { FinanceExecutiveReportCover } from "@/src/lib/financeExecutiveReportTypes";
import { isPrintCoverLogoLightOnDark, resolvePrintCoverLogoSrc } from "@/src/lib/printBranding";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import { EXECUTIVE_REPORT_PRINT_DATA_NOTE } from "@/src/lib/financeExecutiveReportUxCopy";

export function ExecutiveReportPrintCover({
  cover,
  generatedAt,
  branding,
}: {
  cover: FinanceExecutiveReportCover;
  generatedAt: string;
  branding: BrandingSettingsDTO;
}) {
  const logoSrc = resolvePrintCoverLogoSrc(branding);
  const lightLogo = isPrintCoverLogoLightOnDark(branding, logoSrc);

  return (
    <div className="executive-print-cover" data-testid="executive-report-cover">
      <div className="executive-print-cover-brand">
        {logoSrc ? (
          <img
            src={logoSrc}
            alt="Lazarios / Koppetel"
            className="executive-print-cover-logo"
            data-light={lightLogo ? "true" : undefined}
          />
        ) : (
          <p className="executive-print-cover-brand-fallback">Lazarios · Koppetel</p>
        )}
      </div>
      <h1 className="executive-print-cover-title">RELATÓRIO PRESIDENCIAL</h1>
      <p className="executive-print-cover-subtitle">{cover.subtitle}</p>
      <div className="executive-print-cover-grid">
        <div>
          <p className="executive-print-cover-label">Data-base</p>
          <p className="executive-print-cover-value">{cover.reportDateLabel}</p>
        </div>
        <div>
          <p className="executive-print-cover-label">Empresa</p>
          <p className="executive-print-cover-value">{cover.companyLabel ?? "Consolidado"}</p>
        </div>
        <div>
          <p className="executive-print-cover-label">Período</p>
          <p className="executive-print-cover-value">{cover.periodLabel}</p>
        </div>
        <div>
          <p className="executive-print-cover-label">Emitido em</p>
          <p className="executive-print-cover-value">{formatFinanceDateTime(generatedAt)}</p>
        </div>
      </div>
      <p className="executive-print-cover-source">{EXECUTIVE_REPORT_PRINT_DATA_NOTE}</p>
    </div>
  );
}
