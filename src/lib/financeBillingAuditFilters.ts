import type { BillingAuditDateBase, BillingAuditFilters, BillingAuditValueMode } from "@/src/lib/financeBillingAuditTypes.js";

function parseYear(value: unknown): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(n) && n >= 2000 && n <= 2100) return n;
  return new Date().getFullYear();
}

function parseMonth(value: unknown): number | null {
  if (value == null || value === "" || value === "all") return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : null;
}

function normalizeCnpjQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits : null;
}

function parseDateBase(value: unknown): BillingAuditDateBase {
  const raw = String(value ?? "processamento").toLowerCase();
  if (raw === "emissao" || raw === "issue") return "emissao";
  if (raw === "importacao" || raw === "sync") return "importacao";
  if (raw === "competencia") return "competencia";
  return "processamento";
}

function parseValueMode(value: unknown): BillingAuditValueMode {
  const raw = String(value ?? "pedido_total_net").toLowerCase();
  const map: Record<string, BillingAuditValueMode> = {
    total_nf: "total_nf",
    liquido: "liquido",
    produtos: "produtos",
    servicos: "servicos",
    produtos_servicos: "produtos_servicos",
    sem_impostos: "sem_impostos",
    pedido_total_net: "pedido_total_net",
  };
  return map[raw] ?? "pedido_total_net";
}

function parseBool(value: unknown, defaultValue: boolean): boolean {
  if (value == null || value === "") return defaultValue;
  const raw = String(value).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "sim";
}

export function parseBillingAuditFilters(query: Record<string, unknown>): BillingAuditFilters {
  const classificationRaw = String(query.classification ?? "all").toLowerCase();
  const statusRaw = String(query.status ?? "all").toLowerCase();
  const classification =
    classificationRaw === "market" ||
    classificationRaw === "group" ||
    classificationRaw === "logistics"
      ? classificationRaw
      : "all";
  const status = statusRaw === "authorized" || statusRaw === "cancelled" ? statusRaw : "all";

  return {
    year: parseYear(query.year),
    month: parseMonth(query.month),
    startDate: typeof query.startDate === "string" && query.startDate ? query.startDate : null,
    endDate: typeof query.endDate === "string" && query.endDate ? query.endDate : null,
    dateBase: parseDateBase(query.dateBase),
    companyName: typeof query.companyName === "string" ? query.companyName.trim() || null : null,
    customerName: typeof query.customerName === "string" ? query.customerName.trim() || null : null,
    customerDocument: normalizeCnpjQuery(query.customerCnpj ?? query.cnpj),
    sellerId: typeof query.sellerId === "string" ? query.sellerId.trim() || null : null,
    status,
    cfop: typeof query.cfop === "string" ? query.cfop.trim() || null : null,
    operationNature: typeof query.operationNature === "string" ? query.operationNature.trim() || null : null,
    classification,
    origin: typeof query.origin === "string" ? query.origin.trim() || null : null,
    includeCancelled: parseBool(query.includeCancelled, false),
    includeReturns: parseBool(query.includeReturns, false),
    valueMode: parseValueMode(query.valueMode),
  };
}

export function buildBillingAuditFiltersSummary(filters: BillingAuditFilters): string[] {
  const lines = [
    `Ano: ${filters.year}`,
    filters.month != null ? `Mês: ${filters.month}` : "Mês: todos",
    filters.startDate && filters.endDate
      ? `Intervalo: ${filters.startDate} a ${filters.endDate}`
      : "Intervalo: derivado do ano/mês",
    `Data base: ${filters.dateBase}`,
    `Valor considerado: ${filters.valueMode}`,
    `Status NF: ${filters.status}`,
    `Classificação: ${filters.classification}`,
    `Incluir canceladas: ${filters.includeCancelled ? "sim" : "não"}`,
    `Incluir devoluções: ${filters.includeReturns ? "sim" : "não"}`,
  ];
  if (filters.customerDocument) lines.push(`CNPJ/CPF cliente: ${filters.customerDocument}`);
  if (filters.customerName) lines.push(`Cliente: ${filters.customerName}`);
  if (filters.companyName) lines.push(`Empresa: ${filters.companyName}`);
  return lines;
}

export function buildBillingAuditQueryString(filters: BillingAuditFilters): string {
  const params = new URLSearchParams();
  params.set("year", String(filters.year));
  if (filters.month != null) params.set("month", String(filters.month));
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  params.set("dateBase", filters.dateBase);
  params.set("valueMode", filters.valueMode);
  if (filters.customerDocument) params.set("customerCnpj", filters.customerDocument);
  if (filters.customerName) params.set("customerName", filters.customerName);
  if (filters.companyName) params.set("companyName", filters.companyName);
  if (filters.classification !== "all") params.set("classification", filters.classification);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.includeCancelled) params.set("includeCancelled", "true");
  if (filters.includeReturns) params.set("includeReturns", "true");
  return params.toString();
}
