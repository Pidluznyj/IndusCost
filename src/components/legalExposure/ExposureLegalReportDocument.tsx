/**
 * Chrome compartilhado dos relatórios jurídicos A4 do Exposure.
 */

import React from "react";
import { Scale } from "lucide-react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import {
  resolvePrintCoverLogoSrc,
  resolvePrintLogoSrc,
} from "@/src/lib/printBranding";
import {
  EXPOSURE_PRINT_CONFIDENTIAL,
  EXPOSURE_PRINT_FOOTER_BRAND,
  formatPrintWhen,
} from "@/src/lib/legalExposure/legalExposurePrint";

export function ExposureLegalReportPage({
  pageId,
  pageNumber,
  totalPages,
  cover = false,
  flow = false,
  branding,
  documentTitle,
  asOf,
  children,
}: {
  pageId: string;
  pageNumber: number;
  totalPages: number;
  cover?: boolean;
  flow?: boolean;
  branding: BrandingSettingsDTO;
  documentTitle: string;
  asOf: string;
  children: React.ReactNode;
}) {
  const logoSrc = resolvePrintLogoSrc(branding);
  return (
    <article
      className={`exposure-legal-print-page${cover ? " exposure-legal-print-page--cover" : ""}${flow ? " exposure-legal-print-page--flow" : ""}`}
      data-print-page={pageId}
      data-testid={`exposure-legal-print-page-${pageId}`}
    >
      {cover ? null : (
        <div className="exposure-legal-print-page-header">
          <div>
            {logoSrc ? (
              <img src={logoSrc} alt="" className="exposure-legal-print-page-logo" />
            ) : (
              <p className="exposure-legal-print-page-header-doc">{branding.companyName}</p>
            )}
          </div>
          <div>
            <p className="exposure-legal-print-page-header-doc">{documentTitle}</p>
            <p className="exposure-legal-print-page-header-meta">Data-base {formatPrintWhen(asOf)}</p>
          </div>
        </div>
      )}
      <div className="exposure-legal-print-page-body">{children}</div>
      {cover ? null : (
        <div className="exposure-legal-print-page-footer">
          <span>
            {logoSrc ? <img src={logoSrc} alt="" className="exposure-legal-print-page-footer-logo" /> : null}{" "}
            {EXPOSURE_PRINT_FOOTER_BRAND}
          </span>
          <span>{formatPrintWhen(asOf)}</span>
          <span className="exposure-legal-print-page-footer-page">
            Página {pageNumber} de {totalPages}
          </span>
          <span>{EXPOSURE_PRINT_CONFIDENTIAL}</span>
        </div>
      )}
    </article>
  );
}

export function ExposureLegalReportPrintCover({
  branding,
  title,
  kicker,
  subtitle,
  processNumber,
  companies,
  asOf,
}: {
  branding: BrandingSettingsDTO;
  title: string;
  kicker: string;
  subtitle: string;
  processNumber?: string | null;
  companies: string;
  asOf: string;
}) {
  const logoSrc = resolvePrintLogoSrc(branding) ?? resolvePrintCoverLogoSrc(branding);
  const lightLogo = false;
  return (
    <div className="exposure-legal-print-cover" data-testid="exposure-legal-report-cover">
      {logoSrc ? (
        <img
          src={logoSrc}
          alt={branding.companyName}
          className="exposure-legal-print-cover-logo"
          data-light={lightLogo ? "true" : undefined}
        />
      ) : (
        <p className="exposure-legal-print-cover-kicker">{branding.companyName}</p>
      )}
      <p className="exposure-legal-print-cover-kicker">{kicker}</p>
      <h1 className="exposure-legal-print-cover-title">{title}</h1>
      <p className="exposure-legal-print-cover-subtitle">{subtitle}</p>
      {processNumber ? (
        <div>
          <p className="exposure-legal-print-cover-label">Processo</p>
          <p className="exposure-legal-print-cover-cnj">{processNumber}</p>
        </div>
      ) : null}
      <div className="exposure-legal-print-cover-meta">
        <div>
          <p className="exposure-legal-print-cover-label">Empresas do grupo</p>
          <p className="exposure-legal-print-cover-value">{companies}</p>
        </div>
        <div>
          <p className="exposure-legal-print-cover-label">Dados consultados até</p>
          <p className="exposure-legal-print-cover-value">{formatPrintWhen(asOf)}</p>
        </div>
      </div>
      <Scale className="exposure-legal-print-cover-mark" size={72} strokeWidth={1.1} aria-hidden="true" />
    </div>
  );
}
