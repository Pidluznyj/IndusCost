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
 * Cabeçalho institucional padrão IndusCost (logo + empresa à esquerda, metadados à direita).
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

  return (
    <div className={`print-doc-header ${className}`.trim()}>
      <div className="print-doc-header-row">
        <div className="print-doc-company">
          {logoSrc ? (
            <img src={logoSrc} alt={branding.companyName} className="print-doc-logo" />
          ) : null}
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
        </div>
        <div className="print-doc-meta">
          {documentKind ? <p className="print-doc-meta-kind">{documentKind}</p> : null}
          <p className="print-doc-meta-title">
            {documentTitle}
            {documentHighlight ? `: ${documentHighlight}` : ""}
          </p>
          {metaLines.map((line) => (
            <p key={line.label}>
              <span className="print-doc-label">{line.label}: </span>
              {line.value}
            </p>
          ))}
        </div>
      </div>
      {subtitle ? <p className="print-doc-subtitle">{subtitle}</p> : null}
    </div>
  );
}
