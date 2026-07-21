import { mergeSalesOrderOperationalPresenceWhere } from "./nomus/nomusSourcePresencePolicy.js";

export type MaterialDemandMode = "quantity" | "value" | "orders" | "products";
export type MaterialDemandDateBasis = "issueDate" | "expectedDeliveryDate";

export type MaterialDemandInvoicingScope = "all" | "invoiced" | "portfolio";

export type MaterialDemandFilters = {
  startDate: string | null;
  endDate: string | null;
  dateBasis: MaterialDemandDateBasis;
  /** @deprecated prefer statuses — kept for backward compatibility */
  status: string | null;
  statuses: string[];
  customerId: string | null;
  productId: string | null;
  materialId: string | null;
  companyIssuer: string | null;
  unitKey: string | null;
  mode: MaterialDemandMode;
  search: string;
  includeOrdersWithoutDeliveryDate: boolean;
  /** Escopo de faturamento para previsto x realizado (all | invoiced | portfolio). */
  invoicingScope: MaterialDemandInvoicingScope;
  /** Vendedor/responsável comercial (filtro opcional). */
  seller: string | null;
};

export const MATERIAL_DEMAND_NO_DELIVERY_PERIOD = "__sem_entrega__";

export const SALES_ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Rascunho",
  READY_TO_SEND: "Pronto para envio",
  SENT_TO_NOMUS: "Enviado ao Nomus",
  CANCELLED: "Cancelado",
  ERROR: "Erro",
};

export const SALES_ORDER_FIRM_STATUSES = ["READY_TO_SEND", "SENT_TO_NOMUS"] as const;

export const ALL_SALES_ORDER_STATUSES = [
  "DRAFT",
  "READY_TO_SEND",
  "SENT_TO_NOMUS",
  "CANCELLED",
  "ERROR",
] as const;

export function salesOrderStatusLabel(status: string): string {
  return SALES_ORDER_STATUS_LABELS[status] ?? status;
}

export function materialDemandPeriodLabel(periodKey: string): string {
  if (periodKey === MATERIAL_DEMAND_NO_DELIVERY_PERIOD) return "Sem data de entrega";
  const [yy, mm] = periodKey.split("-");
  if (!yy || !mm) return periodKey;
  return `${mm}/${yy}`;
}

export function materialDemandDeliveryPeriodKey(expectedDeliveryDate: Date | null): string {
  if (!expectedDeliveryDate) return MATERIAL_DEMAND_NO_DELIVERY_PERIOD;
  const d = new Date(expectedDeliveryDate);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function materialDemandIssuePeriodKey(issueDate: Date): string {
  const d = new Date(issueDate);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function materialDemandAggregationPeriodKey(
  dateBasis: MaterialDemandDateBasis,
  issueDate: Date,
  expectedDeliveryDate: Date | null
): string {
  return dateBasis === "expectedDeliveryDate"
    ? materialDemandDeliveryPeriodKey(expectedDeliveryDate)
    : materialDemandIssuePeriodKey(issueDate);
}

export function parseMaterialDemandStatuses(raw: unknown): string[] {
  if (typeof raw === "string" && raw.trim()) {
    return [
      ...new Set(
        raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    ];
  }
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((s) => String(s).trim()).filter(Boolean))];
  }
  return [];
}

export function parseMaterialDemandFilters(
  q: Record<string, unknown>,
  overrides?: Partial<MaterialDemandFilters>
): MaterialDemandFilters {
  const modeRaw = typeof q.mode === "string" ? q.mode : "";
  const mode: MaterialDemandMode =
    modeRaw === "value" || modeRaw === "orders" || modeRaw === "products" ? modeRaw : "quantity";
  const dateBasisRaw = typeof q.dateBasis === "string" ? q.dateBasis : "";
  const dateBasis: MaterialDemandDateBasis =
    dateBasisRaw === "issueDate" ? "issueDate" : "expectedDeliveryDate";

  const statusesFromParam = parseMaterialDemandStatuses(q.statuses);
  const legacyStatus =
    typeof q.status === "string" && q.status && q.status !== "ALL" ? q.status.trim() : null;
  const statuses =
    statusesFromParam.length > 0 ? statusesFromParam : legacyStatus ? [legacyStatus] : [];

  const includeRaw = typeof q.includeOrdersWithoutDeliveryDate === "string" ? q.includeOrdersWithoutDeliveryDate : "";
  const includeOrdersWithoutDeliveryDate = includeRaw !== "false" && includeRaw !== "0";

  const invoicingScopeRaw = typeof q.invoicingScope === "string" ? q.invoicingScope : "";
  const invoicingScope: MaterialDemandInvoicingScope =
    invoicingScopeRaw === "invoiced" || invoicingScopeRaw === "portfolio"
      ? invoicingScopeRaw
      : "all";

  const sellerRaw =
    typeof q.seller === "string" && q.seller.trim()
      ? q.seller.trim()
      : typeof q.responsible === "string" && q.responsible.trim()
        ? q.responsible.trim()
        : null;

  const base: MaterialDemandFilters = {
    startDate: typeof q.startDate === "string" && q.startDate ? q.startDate : null,
    endDate: typeof q.endDate === "string" && q.endDate ? q.endDate : null,
    dateBasis,
    status: legacyStatus,
    statuses,
    customerId: typeof q.customerId === "string" && q.customerId ? q.customerId : null,
    productId: typeof q.productId === "string" && q.productId ? q.productId : null,
    materialId: typeof q.materialId === "string" && q.materialId ? q.materialId : null,
    companyIssuer: typeof q.companyIssuer === "string" && q.companyIssuer.trim() ? q.companyIssuer.trim() : null,
    unitKey: typeof q.unitKey === "string" && q.unitKey.trim() ? q.unitKey.trim() : null,
    mode,
    search: typeof q.search === "string" ? q.search.trim().toLowerCase() : "",
    includeOrdersWithoutDeliveryDate,
    invoicingScope,
    seller: sellerRaw,
  };
  return { ...base, ...(overrides ?? {}) };
}

export function materialDemandFiltersCacheKey(filters: MaterialDemandFilters): string {
  return JSON.stringify(filters);
}

export function buildMaterialDemandSalesOrderWhere(
  filters: MaterialDemandFilters,
  options?: {
    env?: Record<string, string | undefined>;
    /** Default OPERATIONAL — aplica exclusão MISSING_CONFIRMED quando a flag está on. */
    includeConfirmedMissing?: boolean;
  }
): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (filters.startDate || filters.endDate) {
    const dateRange: { gte?: Date; lte?: Date } = {};
    if (filters.startDate) dateRange.gte = new Date(filters.startDate);
    if (filters.endDate) {
      const d = new Date(filters.endDate);
      d.setHours(23, 59, 59, 999);
      dateRange.lte = d;
    }
    if (filters.dateBasis === "expectedDeliveryDate") {
      if (filters.includeOrdersWithoutDeliveryDate) {
        where.OR = [{ expectedDeliveryDate: dateRange }, { expectedDeliveryDate: null }];
      } else {
        where.expectedDeliveryDate = dateRange;
      }
    } else {
      where.issueDate = dateRange;
    }
  }

  if (filters.statuses.length > 0) {
    where.status = filters.statuses.length === 1 ? filters.statuses[0] : { in: filters.statuses };
  } else if (filters.status) {
    where.status = filters.status;
  }

  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.companyIssuer) where.companyIssuer = filters.companyIssuer;
  if (filters.seller) {
    // Preferência Nomus (mesmo eixo da listagem); fallback textual em nomusSellerName.
    const asNum = Number(filters.seller);
    if (Number.isInteger(asNum) && asNum > 0) {
      where.externalSellerId = asNum;
    } else {
      where.nomusSellerName = { contains: filters.seller, mode: "insensitive" };
    }
  }
  if (filters.productId) where.items = { some: { productId: filters.productId } };

  // OP-02: mesma política de presença das visões operacionais.
  return mergeSalesOrderOperationalPresenceWhere(where, {
    env: options?.env,
    includeConfirmedMissing: options?.includeConfirmedMissing,
  }) as Record<string, unknown>;
}

export type MaterialDemandCoverage = {
  ordersMatched: number;
  ordersWithoutDeliveryDate: number;
  orderItemsTotal: number;
  orderItemsProcessed: number;
  orderItemsSkippedInvalidQty: number;
  orderItemsSkippedAnalysisFailure: number;
  orderItemsSkippedExplosionError: number;
  orderItemsSkippedNoMaterials: number;
  uniqueMaterials: number;
  sampleSkipped: Array<{
    orderCode: string;
    productSku: string | null;
    productName: string | null;
    reason: string;
  }>;
};

export function createMaterialDemandCoverage(): MaterialDemandCoverage {
  return {
    ordersMatched: 0,
    ordersWithoutDeliveryDate: 0,
    orderItemsTotal: 0,
    orderItemsProcessed: 0,
    orderItemsSkippedInvalidQty: 0,
    orderItemsSkippedAnalysisFailure: 0,
    orderItemsSkippedExplosionError: 0,
    orderItemsSkippedNoMaterials: 0,
    uniqueMaterials: 0,
    sampleSkipped: [],
  };
}

export function recordMaterialDemandSkip(
  coverage: MaterialDemandCoverage,
  sample: MaterialDemandCoverage["sampleSkipped"][number]
): void {
  if (coverage.sampleSkipped.length < 12) {
    coverage.sampleSkipped.push(sample);
  }
}

export function filtersToQueryParams(
  f: Record<string, string | boolean | string[] | undefined | null>
): URLSearchParams {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (v == null || v === "" || v === false) return;
    if (k === "includeOrdersWithoutDeliveryDate" && v === true) {
      qs.set(k, "true");
      return;
    }
    if (Array.isArray(v)) {
      if (v.length > 0) qs.set(k, v.join(","));
      return;
    }
    if (typeof v === "boolean") {
      qs.set(k, v ? "true" : "false");
      return;
    }
    qs.set(k, String(v));
  });
  return qs;
}

export type MaterialDemandUiFilters = {
  startDate: string;
  endDate: string;
  dateBasis: MaterialDemandDateBasis;
  statuses: string[];
  customerId: string;
  productId: string;
  materialId: string;
  companyIssuer: string;
  unitKey: string;
  mode: MaterialDemandMode;
  search: string;
  includeOrdersWithoutDeliveryDate: boolean;
};

function formatYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function resolveMaterialDemandPeriodPreset(
  preset: "ytd" | "last90" | "thisMonth" | "lastMonth" | "next30" | "next60" | "next90" | "nextMonth",
  dateBasis: MaterialDemandDateBasis
): Pick<MaterialDemandUiFilters, "startDate" | "endDate"> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayYmd = formatYmdLocal(today);

  if (dateBasis === "expectedDeliveryDate") {
    if (preset === "next30") {
      const end = new Date(today);
      end.setDate(end.getDate() + 30);
      return { startDate: todayYmd, endDate: formatYmdLocal(end) };
    }
    if (preset === "next60") {
      const end = new Date(today);
      end.setDate(end.getDate() + 60);
      return { startDate: todayYmd, endDate: formatYmdLocal(end) };
    }
    if (preset === "next90") {
      const end = new Date(today);
      end.setDate(end.getDate() + 90);
      return { startDate: todayYmd, endDate: formatYmdLocal(end) };
    }
    if (preset === "thisMonth") {
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return {
        startDate: formatYmdLocal(new Date(today.getFullYear(), today.getMonth(), 1)),
        endDate: formatYmdLocal(end),
      };
    }
    if (preset === "nextMonth") {
      const start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 2, 0);
      return { startDate: formatYmdLocal(start), endDate: formatYmdLocal(end) };
    }
    if (preset === "lastMonth") {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { startDate: formatYmdLocal(start), endDate: formatYmdLocal(end) };
    }
    const end = new Date(today);
    end.setDate(end.getDate() + 30);
    return { startDate: todayYmd, endDate: formatYmdLocal(end) };
  }

  if (preset === "ytd") {
    return { startDate: formatYmdLocal(new Date(today.getFullYear(), 0, 1)), endDate: todayYmd };
  }
  if (preset === "thisMonth") {
    return {
      startDate: formatYmdLocal(new Date(today.getFullYear(), today.getMonth(), 1)),
      endDate: todayYmd,
    };
  }
  if (preset === "lastMonth") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { startDate: formatYmdLocal(start), endDate: formatYmdLocal(end) };
  }
  const start = new Date(today);
  start.setDate(start.getDate() - 90);
  return { startDate: formatYmdLocal(start), endDate: todayYmd };
}

export function buildDefaultMaterialDemandUiFilters(
  context: "products" | "sales-orders"
): MaterialDemandUiFilters {
  if (context === "sales-orders") {
    const dateBasis: MaterialDemandDateBasis = "issueDate";
    const { startDate, endDate } = resolveMaterialDemandPeriodPreset("ytd", dateBasis);
    return {
      startDate,
      endDate,
      dateBasis,
      statuses: [...SALES_ORDER_FIRM_STATUSES],
      customerId: "",
      productId: "",
      materialId: "",
      companyIssuer: "",
      unitKey: "",
      mode: "value",
      search: "",
      includeOrdersWithoutDeliveryDate: true,
    };
  }

  const dateBasis: MaterialDemandDateBasis = "expectedDeliveryDate";
  const { startDate, endDate } = resolveMaterialDemandPeriodPreset("next30", dateBasis);
  return {
    startDate,
    endDate,
    dateBasis,
    statuses: [],
    customerId: "",
    productId: "",
    materialId: "",
    companyIssuer: "",
    unitKey: "",
    mode: "value",
    search: "",
    includeOrdersWithoutDeliveryDate: true,
  };
}

export function materialDemandUiFiltersToQueryParams(f: MaterialDemandUiFilters): URLSearchParams {
  return filtersToQueryParams({
    startDate: f.startDate,
    endDate: f.endDate,
    dateBasis: f.dateBasis,
    statuses: f.statuses,
    customerId: f.customerId || undefined,
    productId: f.productId || undefined,
    materialId: f.materialId || undefined,
    companyIssuer: f.companyIssuer || undefined,
    unitKey: f.unitKey || undefined,
    mode: f.mode,
    search: f.search || undefined,
    includeOrdersWithoutDeliveryDate: f.includeOrdersWithoutDeliveryDate,
  });
}

export function parseMaterialDemandUiFiltersFromSearchParams(
  params: URLSearchParams,
  context: "products" | "sales-orders"
): MaterialDemandUiFilters {
  const raw: Record<string, unknown> = {};
  params.forEach((v, k) => {
    raw[k] = v;
  });
  const parsed = parseMaterialDemandFilters(raw);
  const defaults = buildDefaultMaterialDemandUiFilters(context);
  return {
    startDate: parsed.startDate ?? defaults.startDate,
    endDate: parsed.endDate ?? defaults.endDate,
    dateBasis: parsed.dateBasis,
    statuses: parsed.statuses.length > 0 ? parsed.statuses : defaults.statuses,
    customerId: parsed.customerId ?? "",
    productId: parsed.productId ?? "",
    materialId: parsed.materialId ?? "",
    companyIssuer: parsed.companyIssuer ?? "",
    unitKey: parsed.unitKey ?? "",
    mode: parsed.mode,
    search: parsed.search,
    includeOrdersWithoutDeliveryDate: parsed.includeOrdersWithoutDeliveryDate,
  };
}
