import { FINANCE_INTERNAL_GROUP_COMPANIES } from "./financeInternalGroupExclusions.js";

export type FinanceExecutiveReportCompany = "all" | "lazarios" | "koppetel" | "sm";

export function parseFinanceExecutiveReportCompany(value: unknown): FinanceExecutiveReportCompany {
  const raw = String(value ?? "all").trim().toLowerCase();
  if (raw === "lazarios" || raw === "koppetel" || raw === "sm") return raw;
  return "all";
}

export function mapExecutiveReportCompanyToFilter(
  company: FinanceExecutiveReportCompany
): string | undefined {
  switch (company) {
    case "lazarios":
      return "Lazarios";
    case "koppetel":
      return "Koppetel";
    case "sm":
      return "SM";
    default:
      return undefined;
  }
}

/** CNPJ emitente Nomus (NF-e / pedido) para filtro de empresa no relatório executivo. */
export function mapExecutiveReportCompanyToEmitterCnpj(
  company: FinanceExecutiveReportCompany
): string | undefined {
  if (company === "all") return undefined;
  const needle = mapExecutiveReportCompanyToFilter(company);
  if (!needle) return undefined;
  const match = FINANCE_INTERNAL_GROUP_COMPANIES.find((c) =>
    c.aliases.some((alias) => alias.toLowerCase().includes(needle.toLowerCase()))
  );
  return match?.cnpj;
}
