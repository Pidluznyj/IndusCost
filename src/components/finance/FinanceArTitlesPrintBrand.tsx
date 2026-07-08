import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { resolvePrintLogoSrc } from "@/src/lib/printBranding";

const BRAND_TEXT_FALLBACK = "Grupo Lazarios";

export function FinanceArTitlesPrintBrand({ branding }: { branding: BrandingSettingsDTO }) {
  const logoSrc = resolvePrintLogoSrc(branding);
  const fallbackName =
    typeof branding.companyName === "string" && branding.companyName.trim()
      ? branding.companyName.trim()
      : BRAND_TEXT_FALLBACK;

  if (logoSrc) {
    return (
      <div className="finance-ar-titles-print-brand">
        <img
          src={logoSrc}
          alt={fallbackName}
          className="finance-ar-titles-print-logo"
        />
      </div>
    );
  }

  return (
    <div className="finance-ar-titles-print-brand finance-ar-titles-print-brand--text">
      <span className="finance-ar-titles-print-brand-fallback">{fallbackName}</span>
    </div>
  );
}
