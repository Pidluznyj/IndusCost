import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PRINT_COMPANY_DOC_FALLBACK, resolvePrintLogoSrc } from "@/src/lib/printBranding";

export type PrintHeaderMetaLine = {
  label: string;
  value: string;
};

export type PrintHeaderProps = {
  branding: BrandingSettingsDTO;
  documentKind?: string;
  documentTitle: string;
  documentHighlight?: string;
  metaLines: PrintHeaderMetaLine[];
  subtitle?: string | null;
  className?: string;
};

function nonEmpty(s: string | null | undefined): string | null {
  if (!s?.trim()) return null;
  return s.trim();
}

/**
 * Cabeçalho institucional padrão IndusCost — 3 colunas: logo | empresa | documento.
 * Usa div.print-doc-header — nunca <header> — para não ser ocultado por CSS global de print.
 */
export function PrintHeader({
  branding,
  documentKind,
  documentTitle,
  documentHighlight,
  metaLines,
  subtitle,
  className = "",
}: PrintHeaderProps) {
  const logoSrc = resolvePrintLogoSrc(branding);
  const slogan = nonEmpty(branding.slogan);
  const documentLabel = documentHighlight
    ? `${documentTitle}: ${documentHighlight}`
    : documentTitle;

  return (
    <div className={`print-doc-header ${className}`.trim()}>
      <div className="print-doc-header-grid">
        <div className="print-doc-logo-wrap">
          {logoSrc ? (
            <img src={logoSrc} alt={branding.companyName} className="print-doc-logo" />
          ) : null}
        </div>
        <div className="print-doc-company-text">
          <p className="print-doc-company-name">{branding.companyName}</p>
          {slogan ? <p className="print-doc-company-slogan">{slogan}</p> : null}
          <p>
            <span className="print-doc-label">CNPJ: </span>
            {PRINT_COMPANY_DOC_FALLBACK.taxId}
          </p>
          <p>{PRINT_COMPANY_DOC_FALLBACK.addressLine}</p>
          <p>
            <span className="print-doc-label">E-mail: </span>
            {PRINT_COMPANY_DOC_FALLBACK.email}
          </p>
        </div>
        <div className="print-doc-meta">
          {documentKind ? <p className="print-doc-meta-kind">{documentKind}</p> : null}
          <p className="print-doc-meta-title">{documentLabel}</p>
          {metaLines.map((line) => (
            <p key={line.label} className="print-doc-meta-line">
              <span className="print-doc-label">{line.label}: </span>
              <span className="print-doc-meta-value">{line.value}</span>
            </p>
          ))}
        </div>
      </div>
      {subtitle ? <p className="print-doc-subtitle">{subtitle}</p> : null}
      <div className="print-doc-header-rule" aria-hidden="true" />
    </div>
  );
}
