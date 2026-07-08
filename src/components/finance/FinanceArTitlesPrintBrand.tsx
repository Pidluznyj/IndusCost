import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { resolvePrintLogoSrc } from "@/src/lib/printBranding";
import {
  FINANCE_AR_TITLES_PRINT_LOGO_MAX_HEIGHT_PX,
  FINANCE_AR_TITLES_PRINT_LOGO_MAX_WIDTH_PX,
} from "@/src/lib/financeArTitlesPrintMeta";

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
          width={FINANCE_AR_TITLES_PRINT_LOGO_MAX_WIDTH_PX}
          height={FINANCE_AR_TITLES_PRINT_LOGO_MAX_HEIGHT_PX}
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
