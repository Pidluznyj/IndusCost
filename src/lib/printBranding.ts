import type { BrandingSettingsDTO } from "@/src/types/branding";

/** Dados institucionais Lazarios/Koppetel até existir bloco estruturado no branding. */
export const PRINT_COMPANY_DOC_FALLBACK = {
  taxId: "14.055.501/0001-80",
  addressLine: "Rua Carlos Essenfelder, Boqueirão, Curitiba - PR, CEP 81730-060",
  email: "paulo@grupolazarios.com.br",
} as const;

export function resolvePrintLogoSrc(branding: BrandingSettingsDTO): string | null {
  const candidates = [
    branding.proposalLogoDataUrl,
    branding.systemExpandedLogoDataUrl,
    branding.systemCompactLogoDataUrl,
  ];
  for (const src of candidates) {
    if (typeof src === "string" && src.trim().toLowerCase().startsWith("data:image/")) {
      return src.trim();
    }
  }
  return null;
}

export function formatPrintDate(value: string | Date | null | undefined): string {
  if (value == null) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function formatPrintDateTime(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR");
}

export function mergePrintBranding(data: BrandingSettingsDTO, defaults: BrandingSettingsDTO): BrandingSettingsDTO {
  return {
    ...defaults,
    ...data,
    companyName:
      typeof data.companyName === "string" && data.companyName.trim()
        ? data.companyName.trim()
        : defaults.companyName,
    slogan: typeof data.slogan === "string" ? data.slogan : defaults.slogan,
  };
}
