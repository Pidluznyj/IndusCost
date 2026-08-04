// src/components/ProposalModule.tsx
import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X,
  Loader2,
  FileText,
  Calendar,
  User,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  Save,
  ArrowLeft,
  Package,
  PlusCircle,
  Calculator,
  DollarSign,
  Percent,
  Info,
  ExternalLink,
  Printer,
  LayoutDashboard,
  ShoppingCart,
  Tag,
  Eye,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk, fetchOk, HttpError } from "@/src/lib/http";
import { moneyAmountToFilterParam } from "@/src/lib/moneyRangeFilter";
import { SearchableSelect, type SelectOption } from "./shared/SearchableSelect";
import { Proposal, Customer, ProposalItem, ProposalStatus } from "@/src/types/commercial";
import { Product } from "@/src/types/product";
import { motion, AnimatePresence } from "motion/react";
import { STORAGE_OPEN_PROPOSAL_KEY } from "@/src/lib/salesFunnel";
import { CalculatedValue } from "./shared/CalculatedValue";
import {
  calculateProposalLineMargin,
  calculateProposalMarginSummary,
} from "@/src/lib/proposalLineMargin";
import {
  resolveProposalFreightAbsolute,
  resolveProposalFreightPercent,
} from "@/src/lib/proposalFreightPercent";
import { previewProposalCommercialMargins } from "@/src/lib/proposalCommercialMarginPreview";
import {
  buildProposalCommercialSummaryView,
  formatProposalCommercialMoney,
  formatProposalCommercialPercent,
  formatProposalCommercialTierPosition,
  proposalCommercialMarginUnavailableLabel,
} from "@/src/lib/proposalCommercialMarginDisplay";
import { parseProposalCommercialPricingSnapshot } from "@/src/lib/proposalCommercialMarginSnapshot";
import { ProposalCommercialMarginTooltip } from "@/src/components/proposal/ProposalCommercialMarginTooltip";
import {
  ProposalListSummaryCards,
  type ProposalListSummary,
} from "@/src/components/proposal/ProposalListSummaryCards";
import "@/src/components/proposal/proposal-commercial-margin.css";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { PROPOSAL_TOUR_STEPS } from "@/src/tours/proposalTourSteps";
import { ProposalAnalysisModal } from "@/src/components/proposal/ProposalAnalysisModal";
import {
  formatProposalCommercialDate,
  isProposalCommercialDateFallback,
  resolveProposalCommercialDate,
} from "@/src/lib/proposalCommercialDate";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  canCreateProposal,
  canDeleteProposal,
  canEditProposal,
  canPrintProposal,
} from "@/src/lib/modulePermissions";
import {
  canViewCustomers,
  canViewProducts,
} from "@/src/lib/commercialEngineeringPermissions";
import {
  buildProposalInternalManagementPrintPath,
  PROPOSAL_INTERNAL_MANAGEMENT_PDF_BUTTON_LABEL,
} from "@/src/lib/proposalInternalManagementPdf";
const PAGE_SIZE = 20;

/** Mesma aba de impressão para cliente que o ícone de impressora da listagem (`/proposals/:id/print`). */
function openProposalClientPrintTab(proposalId: string) {
  window.open(`/proposals/${proposalId}/print`, "_blank", "noopener,noreferrer");
}

/** Relatório gerencial interno — mesma base visual da proposta cliente, com grids de custo/margem. */
function openProposalInternalManagementPrintTab(proposalId: string) {
  window.open(
    buildProposalInternalManagementPrintPath(proposalId),
    "_blank",
    "noopener,noreferrer"
  );
}

type ProposalListResponse = {
  data: Proposal[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary?: ProposalListSummary;
};

function buildProposalSummaryFromRows(rows: Proposal[]): ProposalListSummary {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const totalProposals = rows.length;
  let totalNetAmount = 0;
  let totalGrossAmount = 0;
  let yearToDateCount = 0;
  let monthToDateCount = 0;
  let openProposalsCount = 0;
  let openProposalsAmount = 0;
  let convertedProposalsCount = 0;
  let convertedProposalsAmount = 0;

  for (const p of rows) {
    const net = Number.isFinite(Number(p.totalNetValue)) ? Number(p.totalNetValue) : 0;
    const gross = Number.isFinite(Number(p.totalGrossValue)) ? Number(p.totalGrossValue) : 0;
    totalNetAmount += net;
    totalGrossAmount += gross;

    // KPI de "propostas no ano/mês" conta pela data COMERCIAL, não pela data em
    // que o sync importou — senão uma carga do Nomus joga propostas antigas no
    // mês corrente.
    const commercialDate = resolveProposalCommercialDate(p);
    if (commercialDate && Number.isFinite(commercialDate.getTime())) {
      if (commercialDate.getFullYear() === currentYear) {
        yearToDateCount += 1;
        if (commercialDate.getMonth() === currentMonth) {
          monthToDateCount += 1;
        }
      }
    }

    const hasSalesOrder = Boolean(p.salesOrder?.id);
    const isApproved = p.status === "APPROVED";
    const isOpen = !hasSalesOrder && (p.status === "DRAFT" || p.status === "ANALYSIS" || p.status === "SENT");

    if (hasSalesOrder || isApproved) {
      convertedProposalsCount += 1;
      convertedProposalsAmount += net;
    } else if (isOpen) {
      openProposalsCount += 1;
      openProposalsAmount += net;
    }
  }

  const averageNetValue = totalProposals > 0 ? totalNetAmount / totalProposals : 0;
  const conversionRate = totalProposals > 0 ? (convertedProposalsCount / totalProposals) * 100 : null;

  return {
    totalProposals,
    totalNetAmount,
    totalGrossAmount,
    averageNetValue,
    yearToDateCount,
    monthToDateCount,
    openProposalsCount,
    openProposalsAmount,
    convertedProposalsCount,
    convertedProposalsAmount,
    conversionRate,
  };
}

function isPaginatedProposalResponse(value: unknown): value is ProposalListResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.data);
}

const STATUS_CONFIG: Record<ProposalStatus, { label: string; color: string; icon: any }> = {
  DRAFT: { label: "Rascunho", color: "bg-slate-500/10 text-slate-600", icon: FileText },
  ANALYSIS: { label: "Em Análise", color: "bg-blue-500/10 text-blue-600", icon: Clock },
  SENT: { label: "Enviada", color: "bg-purple-500/10 text-purple-600", icon: ExternalLink },
  APPROVED: { label: "Aprovada", color: "bg-green-500/10 text-green-600", icon: CheckCircle2 },
  REJECTED: { label: "Rejeitada", color: "bg-red-500/10 text-red-600", icon: X },
  EXPIRED: { label: "Expirada", color: "bg-orange-500/10 text-orange-600", icon: AlertCircle },
  CANCELED: { label: "Cancelada", color: "bg-gray-500/10 text-gray-600", icon: Trash2 },
};

const PROPOSAL_STATUS_SELECT_OPTIONS = (Object.entries(STATUS_CONFIG) as [ProposalStatus, (typeof STATUS_CONFIG)["DRAFT"]][]).map(
  ([key, cfg]) => ({
    value: key,
    label: cfg.label,
    searchTerms: `${key} ${cfg.label}`,
  })
);

const FREIGHT_CONDITION_OPTIONS = [
  { value: "CIF", label: "CIF (Emitente)", searchTerms: "CIF emitente" },
  { value: "FOB", label: "FOB (Destinatário)", searchTerms: "FOB destinatario destinatário" },
];

function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function safeOptionalInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

/** Custo unitário ausente (null) ≠ 0 — usado na margem oficial (paridade Pedido de Venda). */
function toNullableUnitCost(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Formata valor monetário para exibição na grade (R$ 1.234,56). */
function formatMoneyDisplay(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Formata percentual para exibição na grade (15,50%). */
function formatPercentDisplay(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

/** Formata valor numérico para o atributo `value` de input type="number". */
function formatMoneyInputValue(value: unknown, decimals = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(decimals);
}

const PROPOSAL_MAX_ABS_MONEY = 999_999_999_999.99;
const PROPOSAL_MAX_QTY = 1_000_000;
const PROPOSAL_MAX_PERCENT = 100;

function validateProposalPayloadForSafeDecimals(payload: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const checkAbsMax = (label: string, value: unknown, maxAbs = PROPOSAL_MAX_ABS_MONEY) => {
    if (!isFiniteNumber(value)) {
      errors.push(`${label}: valor inválido.`);
      return;
    }
    if (Math.abs(value) > maxAbs) {
      errors.push(`${label}: valor acima do limite permitido.`);
    }
  };
  const checkPercentRange = (label: string, value: unknown, min = 0, max = PROPOSAL_MAX_PERCENT) => {
    if (!isFiniteNumber(value)) {
      errors.push(`${label}: percentual inválido.`);
      return;
    }
    if (value < min || value > max) {
      errors.push(`${label}: percentual deve estar entre ${min}% e ${max}%.`);
    }
  };

  checkAbsMax("Total bruto da proposta", payload.totalGrossValue);
  checkAbsMax("Total de desconto da proposta", payload.totalDiscount);
  checkAbsMax("Total líquido da proposta", payload.totalNetValue);
  checkAbsMax("Total de custo da proposta", payload.totalCost);
  checkAbsMax("Total de margem da proposta", payload.totalMarginValue);
  checkAbsMax("Total de impostos da proposta", payload.totalTaxes);
  checkAbsMax("Total de comissão da proposta", payload.totalCommission);
  checkAbsMax("Total de frete da proposta", payload.totalFreight);

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!Array.isArray(payload.items)) {
    errors.push("Itens da proposta: formato inválido.");
    return errors;
  }

  items.forEach((row, idx) => {
    const item = (row ?? {}) as Record<string, unknown>;
    const skuOrProduct = typeof item.productId === "string" ? item.productId : `#${idx + 1}`;
    const prefix = `Item ${skuOrProduct}`;

    if (!isFiniteNumber(item.quantity)) {
      errors.push(`${prefix}: quantidade inválida.`);
    } else if (item.quantity <= 0) {
      errors.push(`${prefix}: quantidade deve ser maior que zero.`);
    } else if (item.quantity > PROPOSAL_MAX_QTY) {
      errors.push(`${prefix}: quantidade acima do limite permitido (${PROPOSAL_MAX_QTY.toLocaleString("pt-BR")}).`);
    }

    if (item.unitCost != null && item.unitCost !== "") {
      checkAbsMax(`${prefix}: custo unitário`, item.unitCost);
    }
    checkAbsMax(`${prefix}: preço sugerido`, item.suggestedPrice);
    checkAbsMax(`${prefix}: preço negociado`, item.negotiatedPrice);
    checkPercentRange(`${prefix}: desconto`, item.discountPerc, 0, PROPOSAL_MAX_PERCENT);
    checkAbsMax(`${prefix}: valor de desconto`, item.discountValue);
    checkAbsMax(`${prefix}: valor de margem`, item.marginValue);
    checkAbsMax(`${prefix}: valor de impostos`, item.taxesValue);
    checkAbsMax(`${prefix}: valor de comissão`, item.commissionValue);
    checkAbsMax(`${prefix}: valor de frete`, item.freightValue);

    // NaN = custo de produção ausente (margem oficial indisponível) — permitido.
    if (isFiniteNumber(item.marginPerc) && Math.abs(item.marginPerc) > 10_000) {
      errors.push(`${prefix}: margem percentual fora do intervalo permitido.`);
    }
  });

  return errors;
}

function normalizeProposalItem(
  item: Partial<ProposalItem> & { productId: string }
): ProposalItem {
  return {
    ...item,
    productId: item.productId,
    Product: item.Product,
    id: item.id,
    proposalId: item.proposalId,
    quantity: safeNum(item.quantity, 1),
    unit: item.unit ?? "UN",
    // null = sem custo de produção vigente (margem "—", paridade Pedido).
    unitCost: toNullableUnitCost(item.unitCost),
    suggestedPrice: safeNum(item.suggestedPrice),
    negotiatedPrice: safeNum(item.negotiatedPrice),
    discountPerc: safeNum(item.discountPerc),
    discountValue: safeNum(item.discountValue),
    marginValue: Number.isFinite(Number(item.marginValue)) ? Number(item.marginValue) : 0,
    marginPerc: Number.isFinite(Number(item.marginPerc)) ? Number(item.marginPerc) : Number.NaN,
    taxesPerc: safeNum(item.taxesPerc),
    taxesValue: safeNum(item.taxesValue),
    commissionPerc: safeNum(item.commissionPerc),
    commissionValue: safeNum(item.commissionValue),
    freightValue: safeNum(item.freightValue),
    notes: item.notes,
    calculationExplainability: item.calculationExplainability,
    priceTableItemId: item.priceTableItemId,
    priceSource: item.priceSource,
    pricingSnapshotJson: item.pricingSnapshotJson,
    commercialPricingSnapshotJson: item.commercialPricingSnapshotJson,
    commercialFormation: item.commercialFormation ?? null,
    priceTableId: item.priceTableId,
    priceTableVersionId: item.priceTableVersionId,
    priceTableCode: item.priceTableCode,
    priceTableVersionNumber: item.priceTableVersionNumber,
  };
}

type CommercialFormationApiOk = NonNullable<ProposalItem["commercialFormation"]> & {
  ok: true;
};

async function fetchCommercialFormationForPreview(
  productId: string
): Promise<ProposalItem["commercialFormation"]> {
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(
    `/api/products/${productId}/commercial-formation?referenceDate=${encodeURIComponent(today)}`,
    { credentials: "include" }
  );
  if (!res.ok) return null;
  const body = (await res.json()) as CommercialFormationApiOk | { ok: false };
  if (!body || (body as { ok?: boolean }).ok !== true) return null;
  const ok = body as CommercialFormationApiOk;
  return {
    formationContextId: ok.formationContextId,
    referenceDate: ok.referenceDate,
    frozenCostUnit: ok.frozenCostUnit,
    taxRate: ok.taxRate,
    freightRate: ok.freightRate,
    freightAbsoluteUnit: ok.freightAbsoluteUnit,
    otherVariablesRate: ok.otherVariablesRate,
    tiers: ok.tiers,
  };
}

function proposalItemHasUsableCommercialFormation(
  item: Pick<
    ProposalItem,
    "commercialFormation" | "commercialPricingSnapshotJson" | "pricingSnapshotJson"
  >
): boolean {
  const formation = item.commercialFormation;
  if (
    formation &&
    Array.isArray(formation.tiers) &&
    formation.tiers.length >= 2 &&
    formation.frozenCostUnit != null
  ) {
    return true;
  }
  const snap =
    parseProposalCommercialPricingSnapshot(item.commercialPricingSnapshotJson) ??
    parseProposalCommercialPricingSnapshot(item.pricingSnapshotJson);
  return Boolean(
    snap &&
      Array.isArray(snap.tiers) &&
      snap.tiers.length >= 2 &&
      snap.frozenCostUnit != null
  );
}

/** Carrega formação comercial do produto — independente de tabela de preço. */
async function hydrateProposalItemsCommercialFormation(
  items: ProposalItem[]
): Promise<ProposalItem[]> {
  const missingProductIds = [
    ...new Set(
      items
        .filter((it) => it.productId && !proposalItemHasUsableCommercialFormation(it))
        .map((it) => it.productId as string)
    ),
  ];
  if (missingProductIds.length === 0) return items;

  const formationByProductId = new Map<string, ProposalItem["commercialFormation"]>();
  await Promise.all(
    missingProductIds.map(async (productId) => {
      formationByProductId.set(
        productId,
        await fetchCommercialFormationForPreview(productId)
      );
    })
  );

  return items.map((it) => {
    if (!it.productId || proposalItemHasUsableCommercialFormation(it)) return it;
    const formation = formationByProductId.get(it.productId);
    if (!formation) return it;
    return { ...it, commercialFormation: formation };
  });
}

type PriceTableListRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  defaultMarginPct: number;
  latestPublishedVersion: {
    id: string;
    versionNumber: number;
    status: string;
    publishedAt?: string | null;
  } | null;
};

type PublishedPriceDefaults = {
  unitCost: number;
  suggestedPrice: number;
  negotiatedPrice: number;
  marginPerc: number;
  taxesValue: number;
  freightValue: number;
  freightPercent?: number;
  freightAbsolute?: number;
  commissionPerc?: number;
  commissionValue?: number;
};

type PublishedPriceApiResponse = {
  priceSource: string;
  priceTable: { id: string; code: string; name: string; defaultMarginPct: number };
  version: { id: string; versionNumber: number; status: string };
  product: { id: string; sku: string; name: string };
  item: {
    priceTableItemId: string;
    salePrice: number;
    frozenTotalCost: number;
    marginPct: number;
  };
  proposalDefaults: PublishedPriceDefaults;
  warnings: Array<{ code: string; message: string }>;
};

function mapPublishedPriceHttpError(status: number, body: Record<string, unknown>): string {
  const code = typeof body.code === "string" ? body.code : "";
  if (code === "NO_PUBLISHED_PRICE_TABLE_VERSION") {
    return "A tabela selecionada não possui versão publicada vigente.";
  }
  if (code === "NO_PRICE_TABLE_ITEM") {
    return "Produto não encontrado na versão publicada da tabela selecionada.";
  }
  if (code === "PRODUCT_NOT_FOUND") {
    return "Produto não encontrado.";
  }
  const msg = typeof body.message === "string" ? body.message.trim() : "";
  if (msg) return msg;
  return "Não foi possível carregar o preço publicado deste produto.";
}

/** Valores reconhecidos hoje em ProposalItem.priceSource. String livre no banco. */
const ITEM_PRICE_SOURCE_PRICE_TABLE = "PRICE_TABLE";
const ITEM_PRICE_SOURCE_MANUAL = "MANUAL";
/** Item nasceu de uma tabela publicada mas teve preço/desconto ajustado manualmente.
 * Preserva os metadados de tabela (priceTableId/Code/Version/...) para auditoria. */
const ITEM_PRICE_SOURCE_MANUAL_OVERRIDE = "MANUAL_OVERRIDE";

/**
 * Recalcula campos derivados de um ProposalItem após uma mudança.
 * Margem oficial = Pedido de Venda (receita − custo produção; sem impostos/comissão/frete na %).
 */
function recomputeItemDerivedFields(
  itemIn: ProposalItem,
  discountPath: "perc" | "value" | "none"
): ProposalItem {
  const item = { ...itemIn };
  const qty = safeNum(item.quantity);
  const negotiated = safeNum(item.negotiatedPrice);
  const unitCost = toNullableUnitCost(item.unitCost);
  const gross = qty * negotiated;

  if (discountPath === "perc") {
    item.discountValue = safeNum(gross * (safeNum(item.discountPerc) / 100));
  } else if (discountPath === "value") {
    const dv = safeNum(item.discountValue);
    item.discountPerc = gross > 0 ? safeNum((dv / gross) * 100) : 0;
    item.discountValue = dv;
  }

  const discountVal = safeNum(item.discountValue);
  const freightPerc = resolveProposalFreightPercent(item.pricingSnapshotJson);
  const freightAbsolute = resolveProposalFreightAbsolute(item.pricingSnapshotJson);
  const margin = calculateProposalLineMargin({
    quantity: qty,
    negotiatedPrice: negotiated,
    discountValue: discountVal,
    taxesPerc: safeNum(item.taxesPerc),
    commissionPerc: safeNum(item.commissionPerc),
    freightPerc,
    freightValue: freightPerc > 0 ? freightAbsolute : freightAbsolute || safeNum(item.freightValue),
    // Custo de produção vigente (GET) — não usar custo congelado da tabela comercial.
    unitCost,
    productId: item.productId,
    lineId: item.id ?? null,
  });

  item.taxesValue = margin.taxesValue;
  item.commissionValue = margin.commissionValue;
  item.freightValue = margin.freightValue;
  item.marginValue = margin.marginValue ?? 0;
  // NaN → exibe "—" (custo de produção ausente / CUSTO_ZERO).
  item.marginPerc = margin.marginPerc ?? Number.NaN;
  item.unitCost = unitCost;

  return normalizeProposalItem(item);
}

async function fetchPublishedPriceJson(
  priceTableId: string,
  productId: string
): Promise<PublishedPriceApiResponse> {
  const res = await fetch(`/api/price-tables/${priceTableId}/products/${productId}/published-price`);
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!res.ok) {
    throw new Error(mapPublishedPriceHttpError(res.status, body));
  }
  return body as unknown as PublishedPriceApiResponse;
}

type NumericInputCellProps = {
  value: number;
  onChange: (next: number) => void;
  className?: string;
  step?: string;
  decimals?: number;
  ariaLabel?: string;
};

/**
 * Input numérico controlado que mostra o valor formatado (2 casas) quando não focado
 * e o rascunho cru enquanto o usuário digita. O estado numérico exposto via `onChange`
 * NÃO é forçado a 2 casas — apenas a apresentação é arredondada. Evita exibir
 * NaN/undefined/null e mantém compatibilidade com `parseFloat`/`type="number"`.
 */
function NumericInputCell({
  value,
  onChange,
  className,
  step = "0.01",
  decimals = 2,
  ariaLabel,
}: NumericInputCellProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState<string>("");

  const displayValue = focused ? draft : formatMoneyInputValue(value, decimals);

  return (
    <input
      type="number"
      step={step}
      aria-label={ariaLabel}
      className={className}
      value={displayValue}
      onFocus={() => {
        setFocused(true);
        setDraft(formatMoneyInputValue(value, decimals));
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = parseFloat(raw);
        onChange(Number.isFinite(parsed) ? parsed : 0);
      }}
      onBlur={() => {
        setFocused(false);
      }}
    />
  );
}

export const ProposalModule = () => {
  const auth = useAuth();
  const permissions = usePermissions();
  const proposalCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
    canViewResource: permissions.canViewResource,
  };
  const allowCreate = canCreateProposal(proposalCheck);
  const allowViewProducts = canViewProducts(proposalCheck);
  const allowViewCustomers = canViewCustomers(proposalCheck);
  /** Criar/editar itens exige catálogo de produtos e clientes — sem isso, some o botão (sem alert 403). */
  const allowCreateWithCatalog = allowCreate && allowViewProducts && allowViewCustomers;
  const allowEdit = canEditProposal(proposalCheck);
  const allowDelete = canDeleteProposal(proposalCheck);
  const allowPrint = canPrintProposal(proposalCheck);

  const navigate = useNavigate();
  const [view, setView] = useState<"list" | "form">("list");
  const [tourOpen, setTourOpen] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [listStatusFilter, setListStatusFilter] = useState<"" | ProposalStatus>("");
  const [listResponsibleFilter, setListResponsibleFilter] = useState("");
  const [responsibleOptions, setResponsibleOptions] = useState<string[]>([]);
  const [listCustomerIdFilter, setListCustomerIdFilter] = useState("");
  const [listStartDate, setListStartDate] = useState("");
  const [listEndDate, setListEndDate] = useState("");
  const [listMinValue, setListMinValue] = useState("");
  const [listMaxValue, setListMaxValue] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalProposals, setTotalProposals] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState<ProposalListSummary | null>(null);
  const [editingProposal, setEditingProposal] = useState<Proposal | null>(null);
  const [analysisProposalId, setAnalysisProposalId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [salesOrderActionId, setSalesOrderActionId] = useState<string | null>(null);
  const [priceTables, setPriceTables] = useState<PriceTableListRow[]>([]);
  /** Avisos de preço publicado (piloto etc.) nesta sessão de edição; limpa ao mudar tabela. */
  const [tablePriceSessionAlerts, setTablePriceSessionAlerts] = useState<string[]>([]);
  /** Aviso discreto ao trocar a tabela padrão com itens já na proposta. */
  const [defaultTableChangedNotice, setDefaultTableChangedNotice] = useState<string | null>(null);
  /** Índice do item cuja tabela está sendo trocada (loading discreto por linha). */
  const [itemPriceTableUpdatingIndex, setItemPriceTableUpdatingIndex] = useState<number | null>(null);
  /** Índice do item com o popover de origem de preço aberto. */
  const [itemOriginMenuOpenIndex, setItemOriginMenuOpenIndex] = useState<number | null>(null);
  const itemOriginMenuRef = useRef<HTMLDivElement | null>(null);
  /** Evita loop ao tentar hidratar formação comercial ausente (ex.: proposta sem tabela). */
  const formationHydrateAttemptedRef = useRef<Set<string>>(new Set());
  /** Índices dos itens selecionados para ações em massa (desconto em lote etc.). */
  const [selectedItemIndexes, setSelectedItemIndexes] = useState<Set<number>>(new Set());
  /** Input de desconto % para ação em massa. String para permitir vazio/parcial enquanto digita. */
  const [bulkDiscountInput, setBulkDiscountInput] = useState<string>("");

  // Form State
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [formData, setFormData] = useState<Partial<Proposal>>({
    title: "",
    customerId: "",
    status: "DRAFT",
    responsible: "",
    validityDays: 15,
    paymentTerms: "",
    paymentMethod: "",
    deliveryTimeDays: 7,
    freightCondition: "CIF",
    deliveryLocation: "",
    notes: "",
    items: []
  });

  const fetchReferenceData = useCallback(async () => {
    const loadOptional = async <T,>(
      url: string,
      fallback: T,
      enabled: boolean
    ): Promise<T> => {
      if (!enabled) return fallback;
      try {
        return await fetchJsonOk<T>(url);
      } catch (e) {
        // 403/401: usuário sem permissão do cadastro — não bloquear a lista de propostas.
        if (e instanceof HttpError && (e.status === 403 || e.status === 401)) {
          return fallback;
        }
        console.warn(`${url} (propostas):`, e);
        return fallback;
      }
    };

    try {
      const r = await fetchJsonOk<string[]>("/api/proposals/responsibles");
      setResponsibleOptions(Array.isArray(r) ? r : []);
    } catch (e) {
      if (!(e instanceof HttpError && (e.status === 403 || e.status === 401))) {
        console.warn("GET /api/proposals/responsibles (propostas):", e);
      }
      setResponsibleOptions([]);
    }

    const [c, pr, pt] = await Promise.all([
      loadOptional<Customer[]>("/api/customers", [], allowViewCustomers),
      loadOptional<Product[]>("/api/products", [], allowViewProducts),
      loadOptional<PriceTableListRow[]>("/api/price-tables", [], true),
    ]);
    setCustomers(Array.isArray(c) ? c : []);
    setProducts(Array.isArray(pr) ? pr : []);
    setPriceTables(
      Array.isArray(pt)
        ? pt.filter((t) => String(t.status).toUpperCase() === "ACTIVE")
        : []
    );
  }, [allowViewCustomers, allowViewProducts]);

  const priceTableSelectOptions = useMemo((): SelectOption[] => {
    const opts: SelectOption[] = [
      {
        value: "",
        label: "Sem tabela / preço manual",
        searchTerms: "sem tabela manual legado pricing snapshot",
      },
    ];
    const sorted = [...priceTables].sort((a, b) => {
      const aPub = a.latestPublishedVersion ? 0 : 1;
      const bPub = b.latestPublishedVersion ? 0 : 1;
      if (aPub !== bPub) return aPub - bPub;
      return a.code.localeCompare(b.code);
    });
    for (const t of sorted) {
      const pub = t.latestPublishedVersion;
      if (pub) {
        opts.push({
          value: t.id,
          label: `${t.name} (${t.code})`,
          sublabel: `Versão publicada v${pub.versionNumber}`,
          searchTerms: `${t.name} ${t.code} atacado varejo`,
        });
      } else {
        opts.push({
          value: `__unpublished__${t.id}`,
          label: `${t.name} (${t.code})`,
          sublabel: "Sem versão publicada — publique na Formação de Preço",
          searchTerms: `${t.name} ${t.code} draft indisponivel`,
          disabled: true,
        });
      }
    }
    return opts;
  }, [priceTables]);

  const warningsFromItemSnapshots = useMemo(() => {
    const lines = new Set<string>();
    for (const it of formData.items || []) {
      const raw = it.pricingSnapshotJson?.warnings;
      if (!Array.isArray(raw)) continue;
      for (const w of raw) {
        if (w && typeof w === "object" && "message" in w && typeof (w as { message?: unknown }).message === "string") {
          const m = String((w as { message: string }).message).trim();
          if (m) lines.add(m);
        }
        if (typeof w === "string" && w.trim()) lines.add(w.trim());
      }
    }
    return Array.from(lines);
  }, [formData.items]);

  const mergedTablePriceAlerts = useMemo(() => {
    return Array.from(new Set([...warningsFromItemSnapshots, ...tablePriceSessionAlerts]));
  }, [warningsFromItemSnapshots, tablePriceSessionAlerts]);

  useEffect(() => {
    if (!defaultTableChangedNotice) return;
    const id = window.setTimeout(() => setDefaultTableChangedNotice(null), 10000);
    return () => window.clearTimeout(id);
  }, [defaultTableChangedNotice]);

  useEffect(() => {
    if (itemOriginMenuOpenIndex === null) return;
    const onDown = (e: MouseEvent) => {
      if (
        itemOriginMenuRef.current &&
        !itemOriginMenuRef.current.contains(e.target as Node)
      ) {
        setItemOriginMenuOpenIndex(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setItemOriginMenuOpenIndex(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [itemOriginMenuOpenIndex]);

  const handlePriceTableSelectionChange = useCallback(
    (nextTableId: string) => {
      const hasItems = (formData.items?.length ?? 0) > 0;
      const prevTrim = (formData.priceTableId ?? "").trim();
      const nextTrim = nextTableId.trim();
      const selectionChanged = prevTrim !== nextTrim;

      setTablePriceSessionAlerts([]);
      if (!nextTrim) {
        setFormData((prev) => ({
          ...prev,
          priceTableId: null,
          priceTableVersionId: null,
          priceTableCode: null,
          priceTableVersionNumber: null,
          priceSource: null,
        }));
        if (hasItems && selectionChanged) {
          setDefaultTableChangedNotice(
            "A tabela padrão foi alterada. Os itens já adicionados não foram recalculados; a nova tabela será usada apenas para os próximos itens."
          );
        }
        return;
      }
      const table = priceTables.find((t) => t.id === nextTrim);
      if (!table?.latestPublishedVersion) {
        alert("A tabela selecionada não possui versão publicada vigente.");
        return;
      }
      setFormData((prev) => ({
        ...prev,
        priceTableId: table.id,
        priceTableVersionId: table.latestPublishedVersion.id,
        priceTableCode: table.code,
        priceTableVersionNumber: table.latestPublishedVersion.versionNumber,
        priceSource: "PRICE_TABLE",
      }));
      if (hasItems && selectionChanged) {
        setDefaultTableChangedNotice(
          "A tabela padrão foi alterada. Os itens já adicionados não foram recalculados; a nova tabela será usada apenas para os próximos itens."
        );
      }
    },
    [formData.items, formData.priceTableId, priceTables]
  );

  const listFiltersKey = useMemo(
    () =>
      JSON.stringify({
        searchTerm,
        listStatusFilter,
        listResponsibleFilter,
        listCustomerIdFilter,
        listStartDate,
        listEndDate,
        listMinValue,
        listMaxValue,
      }),
    [
      searchTerm,
      listStatusFilter,
      listResponsibleFilter,
      listCustomerIdFilter,
      listStartDate,
      listEndDate,
      listMinValue,
      listMaxValue,
    ]
  );

  const listCustomerFilterOptions = useMemo((): SelectOption[] => {
    const sorted = customers
      .slice()
      .sort((a, b) => (a.companyName || "").localeCompare(b.companyName || ""));
    return [
      { value: "", label: "Todos os clientes", searchTerms: "todos todos os clientes" },
      ...sorted.map((c) => {
        const label = (c.companyName || c.tradeName || "Cliente").trim();
        const tax = (c.taxId || "").trim();
        const stateTax = (c.stateTaxId || "").trim();
        return {
          value: c.id,
          label,
          sublabel: tax ? `CNPJ/CPF: ${tax}` : undefined,
          searchTerms: [label, c.tradeName, c.companyName, tax, stateTax].filter(Boolean).join(" "),
        };
      }),
    ];
  }, [customers]);

  const listResponsibleFilterOptions = useMemo((): SelectOption[] => {
    return [
      { value: "", label: "Todos os responsáveis", searchTerms: "todos todos os responsáveis" },
      ...responsibleOptions.map((r) => ({
        value: r,
        label: r,
        searchTerms: r,
      })),
    ];
  }, [responsibleOptions]);

  const prevListFiltersKeyRef = useRef<string | null>(null);

  const loadProposalListPage = useCallback(
    async (page: number, signal?: AbortSignal) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(PAGE_SIZE));
        if (searchTerm.trim()) params.set("search", searchTerm.trim());
        if (listStatusFilter) params.set("status", listStatusFilter);
        if (listResponsibleFilter.trim()) params.set("responsible", listResponsibleFilter.trim());
        if (listCustomerIdFilter) params.set("customerId", listCustomerIdFilter);
        if (listStartDate) params.set("startDate", listStartDate);
        if (listEndDate) params.set("endDate", listEndDate);
        if (listMinValue.trim()) {
          const minParam = moneyAmountToFilterParam(listMinValue);
          if (minParam) params.set("minNetValue", minParam);
        }
        if (listMaxValue.trim()) {
          const maxParam = moneyAmountToFilterParam(listMaxValue);
          if (maxParam) params.set("maxNetValue", maxParam);
        }

        const response = await fetchJsonOk<ProposalListResponse | Proposal[]>(
          `/api/proposals?${params.toString()}`,
          { signal }
        );
        if (signal?.aborted) return;

        if (Array.isArray(response)) {
          const fallbackTotal = response.length;
          const safePage = Math.max(1, page);
          const start = (safePage - 1) * PAGE_SIZE;
          const raw = response.slice(start, start + PAGE_SIZE);
          setProposals(raw.slice(0, PAGE_SIZE));
          setCurrentPage(safePage);
          setTotalPages(Math.max(1, Math.ceil(fallbackTotal / PAGE_SIZE)));
          setTotalProposals(fallbackTotal);
          setSummary(buildProposalSummaryFromRows(response));
        } else if (isPaginatedProposalResponse(response)) {
          const raw = response.data;
          setProposals(raw.slice(0, PAGE_SIZE));
          setCurrentPage(Number.isFinite(Number(response.page)) ? Number(response.page) : 1);
          setTotalPages(Number.isFinite(Number(response.totalPages)) ? Math.max(1, Number(response.totalPages)) : 1);
          setTotalProposals(Number.isFinite(Number(response.total)) ? Number(response.total) : 0);
          setSummary(response.summary ?? buildProposalSummaryFromRows(response.data));
        } else {
          setProposals([]);
          setCurrentPage(1);
          setTotalPages(1);
          setTotalProposals(0);
          setSummary(null);
        }
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        console.error("Erro ao buscar propostas:", error);
        alert(error instanceof Error ? error.message : "Não foi possível carregar propostas.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [
      searchTerm,
      listStatusFilter,
      listResponsibleFilter,
      listCustomerIdFilter,
      listStartDate,
      listEndDate,
      listMinValue,
      listMaxValue,
    ]
  );

  useEffect(() => {
    void fetchReferenceData();
  }, [fetchReferenceData]);

  useEffect(() => {
    const ac = new AbortController();
    const prevKey = prevListFiltersKeyRef.current;
    const filtersChanged = prevKey !== null && prevKey !== listFiltersKey;
    prevListFiltersKeyRef.current = listFiltersKey;

    const pageToFetch = filtersChanged ? 1 : currentPage;
    if (filtersChanged && currentPage !== 1) {
      setCurrentPage(1);
    }

    void loadProposalListPage(pageToFetch, ac.signal);

    return () => ac.abort();
  }, [currentPage, listFiltersKey, loadProposalListPage]);

  const handleCreateNew = () => {
    setEditingProposal(null);
    setTablePriceSessionAlerts([]);
    setDefaultTableChangedNotice(null);
    setSelectedItemIndexes(new Set());
    setBulkDiscountInput("");
    formationHydrateAttemptedRef.current = new Set();
    setFormData({
      title: "",
      customerId: "",
      status: "DRAFT",
      responsible: "",
      validityDays: 15,
      paymentTerms: "",
      paymentMethod: "",
      deliveryTimeDays: 7,
      freightCondition: "CIF",
      deliveryLocation: "",
      notes: "",
      items: [],
    });
    setAnalysisProposalId(null);
    setView("form");
  };

  const handleEdit = useCallback(async (id: string) => {
    setAnalysisProposalId(null);
    setLoading(true);
    formationHydrateAttemptedRef.current = new Set();
    try {
      const data = await fetchJsonOk<Proposal & { items?: ProposalItem[] }>(`/api/proposals/${id}`);
      const items = Array.isArray(data.items)
        ? data.items.map((it: ProposalItem) =>
            recomputeItemDerivedFields(normalizeProposalItem(it), "none")
          )
        : [];
      const hydratedItems = await hydrateProposalItemsCommercialFormation(items);
      for (const it of hydratedItems) {
        if (it.productId) formationHydrateAttemptedRef.current.add(it.productId);
      }
      setEditingProposal(data);
      setTablePriceSessionAlerts([]);
      setDefaultTableChangedNotice(null);
      setSelectedItemIndexes(new Set());
      setBulkDiscountInput("");
      setFormData({ ...data, items: hydratedItems });
      setView("form");
    } catch (error) {
      console.error("Erro ao buscar proposta:", error);
      alert(error instanceof Error ? error.message : "Não foi possível abrir a proposta.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(STORAGE_OPEN_PROPOSAL_KEY);
    } catch {
      return;
    }
    if (!id) return;
    try {
      sessionStorage.removeItem(STORAGE_OPEN_PROPOSAL_KEY);
    } catch {
      /* ignore */
    }
    void handleEdit(id);
  }, [loading, handleEdit]);

  const buildSavePayload = useCallback(() => {
    const status =
      typeof formData.status === "string" &&
      PROPOSAL_STATUS_SELECT_OPTIONS.some((o) => o.value === formData.status)
        ? (formData.status as ProposalStatus)
        : "DRAFT";

    const items = (formData.items || []).map((raw) => {
      const item = normalizeProposalItem(raw as ProposalItem);
      const row: Record<string, unknown> = {
        productId: item.productId,
        quantity: safeNum(item.quantity, 1),
        unit: item.unit ?? "UN",
        // Persistência Decimal: null → 0; server reanexa custo vigente no write.
        unitCost: toNullableUnitCost(item.unitCost) ?? 0,
        suggestedPrice: safeNum(item.suggestedPrice),
        negotiatedPrice: safeNum(item.negotiatedPrice),
        discountPerc: safeNum(item.discountPerc),
        discountValue: safeNum(item.discountValue),
        marginValue: Number.isFinite(Number(item.marginValue)) ? Number(item.marginValue) : 0,
        marginPerc: Number.isFinite(Number(item.marginPerc)) ? Number(item.marginPerc) : 0,
        taxesPerc: safeNum(item.taxesPerc),
        taxesValue: safeNum(item.taxesValue),
        commissionPerc: safeNum(item.commissionPerc),
        commissionValue: safeNum(item.commissionValue),
        freightValue: safeNum(item.freightValue),
        notes: item.notes ?? null,
      };
      if (item.priceTableItemId !== undefined) row.priceTableItemId = typeof item.priceTableItemId === "string" ? item.priceTableItemId.trim() || null : (item.priceTableItemId ?? null);
      if (item.priceSource !== undefined) row.priceSource = typeof item.priceSource === "string" ? item.priceSource.trim() || null : (item.priceSource ?? null);
      if (item.pricingSnapshotJson !== undefined) row.pricingSnapshotJson = item.pricingSnapshotJson;
      // Snapshot comercial: envia prévia só como hint; backend recalcula e sobrescreve.
      if (item.commercialPricingSnapshotJson !== undefined) {
        row.commercialPricingSnapshotJson = item.commercialPricingSnapshotJson;
      }
      // Nunca enviar formação em sessão / margem calculada no cliente como autoridade.
      if (item.priceTableId !== undefined) row.priceTableId = typeof item.priceTableId === "string" ? item.priceTableId.trim() || null : (item.priceTableId ?? null);
      if (item.priceTableVersionId !== undefined) row.priceTableVersionId = typeof item.priceTableVersionId === "string" ? item.priceTableVersionId.trim() || null : (item.priceTableVersionId ?? null);
      if (item.priceTableCode !== undefined) row.priceTableCode = typeof item.priceTableCode === "string" ? item.priceTableCode.trim() || null : (item.priceTableCode ?? null);
      if (item.priceTableVersionNumber !== undefined) row.priceTableVersionNumber = item.priceTableVersionNumber ?? null;
      return row;
    });

    const payload: Record<string, unknown> = {
      title: formData.title?.trim() || null,
      customerId: formData.customerId,
      status,
      responsible: formData.responsible?.trim() || null,
      companyIssuer: formData.companyIssuer?.trim() || null,
      validityDays: safeInt(formData.validityDays, 15),
      paymentTerms: formData.paymentTerms?.trim() || null,
      paymentMethod: formData.paymentMethod?.trim() || null,
      deliveryTimeDays: safeOptionalInt(formData.deliveryTimeDays),
      freightCondition: formData.freightCondition || "CIF",
      deliveryLocation: formData.deliveryLocation?.trim() || null,
      notes: formData.notes?.trim() || null,
      internalNotes: formData.internalNotes?.trim() || null,
      totalItems: safeInt(formData.totalItems, 0),
      totalGrossValue: safeNum(formData.totalGrossValue),
      totalDiscount: safeNum(formData.totalDiscount),
      totalNetValue: safeNum(formData.totalNetValue),
      totalCost: safeNum(formData.totalCost),
      totalMarginValue: Number.isFinite(Number(formData.totalMarginValue))
        ? Number(formData.totalMarginValue)
        : 0,
      totalMarginPerc: Number.isFinite(Number(formData.totalMarginPerc))
        ? Number(formData.totalMarginPerc)
        : 0,
      totalTaxes: safeNum(formData.totalTaxes),
      totalCommission: safeNum(formData.totalCommission),
      totalFreight: safeNum(formData.totalFreight),
      items,
    };
    if (formData.priceTableId !== undefined) payload.priceTableId = typeof formData.priceTableId === "string" ? formData.priceTableId.trim() || null : (formData.priceTableId ?? null);
    if (formData.priceTableVersionId !== undefined) payload.priceTableVersionId = typeof formData.priceTableVersionId === "string" ? formData.priceTableVersionId.trim() || null : (formData.priceTableVersionId ?? null);
    if (formData.priceTableCode !== undefined) payload.priceTableCode = typeof formData.priceTableCode === "string" ? formData.priceTableCode.trim() || null : (formData.priceTableCode ?? null);
    if (formData.priceTableVersionNumber !== undefined) payload.priceTableVersionNumber = formData.priceTableVersionNumber ?? null;
    if (formData.priceSource !== undefined) payload.priceSource = typeof formData.priceSource === "string" ? formData.priceSource.trim() || null : (formData.priceSource ?? null);
    return payload;
  }, [formData]);

  const handleSave = async () => {
    if (saving) return;
    if (!formData.customerId) {
      alert("Selecione um cliente.");
      return;
    }
    if (!formData.items || formData.items.length === 0) {
      alert("Adicione pelo menos um item à proposta.");
      return;
    }

    const method = editingProposal ? "PUT" : "POST";
    const url = editingProposal ? `/api/proposals/${editingProposal.id}` : "/api/proposals";

    try {
      setSaving(true);
      const payload = buildSavePayload();
      // Anexa snapshot de prévia apenas como hint de data/formação; servidor sobrescreve.
      if (Array.isArray(payload.items)) {
        payload.items = (payload.items as Array<Record<string, unknown>>).map((row, idx) => {
          const snap = commercialPreview.snapshots[idx];
          if (snap) row.commercialPricingSnapshotJson = snap;
          return row;
        });
      }
      const validationErrors = validateProposalPayloadForSafeDecimals(payload);
      if (validationErrors.length > 0) {
        alert(
          `Existem valores muito altos ou inválidos na proposta. Revise quantidade, desconto e preço negociado antes de salvar.\n\n- ${validationErrors
            .slice(0, 4)
            .join("\n- ")}`
        );
        return;
      }
      await fetchJsonOk(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await loadProposalListPage(currentPage);
      setView("list");
    } catch (error) {
      console.error("Erro ao salvar proposta:", error);
      alert(error instanceof Error ? error.message : "Não foi possível salvar a proposta.");
    } finally {
      setSaving(false);
    }
  };

  const handleSalesOrderFromProposal = useCallback(
    async (p: Proposal) => {
      if (p.salesOrder?.id) {
        navigate(`/sales-orders/${p.salesOrder.id}`);
        return;
      }
      setSalesOrderActionId(p.id);
      try {
        const res = await fetchJsonOk<{ salesOrder: { id: string } }>(`/api/proposals/${p.id}/generate-sales-order`, {
          method: "POST",
        });
        navigate(`/sales-orders/${res.salesOrder.id}`);
        void loadProposalListPage(currentPage);
      } catch (error) {
        console.error("Erro ao gerar pedido de venda:", error);
        alert(error instanceof Error ? error.message : "Não foi possível gerar o pedido de venda.");
      } finally {
        setSalesOrderActionId(null);
      }
    },
    [navigate, loadProposalListPage, currentPage]
  );

  const handleOpenInternalManagementPdf = useCallback((proposalId: string) => {
    openProposalInternalManagementPrintTab(proposalId);
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta proposta permanentemente?")) return;
    try {
      await fetchOk(`/api/proposals/${id}`, { method: "DELETE" });
      void loadProposalListPage(currentPage);
    } catch (error) {
      console.error("Erro ao excluir proposta:", error);
      alert(error instanceof Error ? error.message : "Não foi possível excluir a proposta.");
    }
  };

  const addItem = async (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    const selectedTableId = formData.priceTableId?.trim() || "";

    try {
      const qty = 1;

      if (selectedTableId) {
        const [data, productionSnapshot, commercialFormation] = await Promise.all([
          fetchPublishedPriceJson(selectedTableId, productId),
          fetchJsonOk<{ unitCost?: unknown }>(`/api/products/${productId}/pricing-snapshot`).catch(
            () => null
          ),
          fetchCommercialFormationForPreview(productId),
        ]);
        const df = data.proposalDefaults;
        // Tabela = preços comerciais; custo = produção vigente (não frozenTotalCost).
        // Ausente → null (nunca 0 falso → 100% de margem).
        const unitCost =
          toNullableUnitCost(productionSnapshot?.unitCost) ??
          toNullableUnitCost((product as { totalCost?: unknown }).totalCost);
        const suggestedPrice = safeNum(df.suggestedPrice);
        const negotiatedPrice = safeNum(df.negotiatedPrice);
        const taxesValueFixed = safeNum(df.taxesValue);
        const freightVal = safeNum(df.freightValue);
        const gross = qty * suggestedPrice;
        const taxesPerc = gross > 0 ? safeNum((taxesValueFixed / gross) * 100) : 0;
        const commissionPerc = safeNum(df.commissionPerc);
        const commissionValue =
          safeNum(df.commissionValue) > 0
            ? safeNum(df.commissionValue) * qty
            : safeNum(gross * (commissionPerc / 100));

        const snapshotPayload: Record<string, unknown> = {
          ...(data as unknown as Record<string, unknown>),
          capturedAt: new Date().toISOString(),
        };

        const newItem = recomputeItemDerivedFields(
          normalizeProposalItem({
            productId,
            Product: product,
            quantity: qty,
            unit: "UN",
            unitCost,
            suggestedPrice,
            negotiatedPrice,
            discountPerc: 0,
            discountValue: 0,
            taxesPerc,
            taxesValue: taxesValueFixed,
            commissionPerc,
            commissionValue,
            freightValue: freightVal,
            priceTableItemId: data.item.priceTableItemId,
            priceSource: "PRICE_TABLE",
            pricingSnapshotJson: snapshotPayload,
            commercialFormation: commercialFormation
              ? {
                  ...commercialFormation,
                  priceTableId: data.priceTable.id,
                  priceTableVersionId: data.version.id,
                }
              : null,
            priceTableId: data.priceTable.id,
            priceTableVersionId: data.version.id,
            priceTableCode: data.priceTable.code,
            priceTableVersionNumber: data.version.versionNumber,
          }),
          "none"
        );

        const warnMsgs = (data.warnings ?? [])
          .map((w) => (typeof w?.message === "string" ? w.message.trim() : ""))
          .filter(Boolean);
        if (warnMsgs.length) {
          setTablePriceSessionAlerts((prev) => Array.from(new Set([...prev, ...warnMsgs])));
        }

        setFormData((prev) => ({
          ...prev,
          items: [...(prev.items || []), newItem],
        }));
        return;
      }

      const snapshot = await fetchJsonOk<{
        unitCost?: unknown;
        suggestedPrice?: unknown;
        taxesPerc?: unknown;
        commissionPerc?: unknown;
        freightValue?: unknown;
        calculationExplainability?: ProposalItem["calculationExplainability"];
      }>(`/api/products/${productId}/pricing-snapshot`);
      const commercialFormation = await fetchCommercialFormationForPreview(productId);

      const unitCost = toNullableUnitCost(snapshot.unitCost);
      const suggestedPrice = safeNum(snapshot.suggestedPrice);
      const taxesPerc = safeNum(snapshot.taxesPerc);
      const commissionPerc = safeNum(snapshot.commissionPerc);
      const freightVal = safeNum(snapshot.freightValue);

      const newItem = recomputeItemDerivedFields(
        normalizeProposalItem({
          productId,
          Product: product,
          quantity: qty,
          unit: "UN",
          unitCost,
          suggestedPrice,
          negotiatedPrice: suggestedPrice,
          discountPerc: 0,
          discountValue: 0,
          taxesPerc,
          commissionPerc,
          freightValue: freightVal,
          calculationExplainability: snapshot.calculationExplainability,
          priceSource: "MANUAL",
          commercialFormation,
          pricingSnapshotJson: {
            capturedAt: new Date().toISOString(),
            source: "PRODUCT_PRICING_SNAPSHOT",
            proposalDefaults: {
              freightPercent: 0,
              freightAbsolute: freightVal,
              commissionPerc,
            },
          },
        }),
        "none"
      );

      setFormData((prev) => ({
        ...prev,
        items: [...(prev.items || []), newItem],
      }));
    } catch (error) {
      console.error("Erro ao adicionar item:", error);
      alert(error instanceof Error ? error.message : "Não foi possível obter preço/custo do produto.");
    }
  };

  /**
   * Aplica a versão publicada vigente de uma tabela a um item já existente.
   * Reusa exatamente a mesma matemática usada em addItem (ramo published-price),
   * preservando quantity, notes e id do item. Desconto é zerado, igual ao addItem.
   */
  const applyPriceTableToItem = async (index: number, priceTableId: string) => {
    if (itemPriceTableUpdatingIndex !== null) return;
    const items = formData.items ?? [];
    const current = items[index];
    if (!current?.productId) return;

    const currentSnap = parseProposalCommercialPricingSnapshot(
      current.commercialPricingSnapshotJson
    );
    if (currentSnap || current.priceTableId) {
      const ok = window.confirm(
        "Atualizar item para a tabela vigente?\n\n" +
          "Esta ação recalcula preço e margem comercial com a formação atual.\n" +
          "Não ocorre automaticamente — confirme para continuar."
      );
      if (!ok) return;
    }

    setItemPriceTableUpdatingIndex(index);
    try {
      const [data, commercialFormation] = await Promise.all([
        fetchPublishedPriceJson(priceTableId, current.productId),
        fetchCommercialFormationForPreview(current.productId),
      ]);
      const qty = safeNum(current.quantity, 1);

      const df = data.proposalDefaults;
      // Preserva custo de produção já carregado (GET / pricing-snapshot).
      // A tabela só troca preço sugerido e percentuais comerciais.
      const unitCost = toNullableUnitCost(current.unitCost);
      const suggestedPrice = safeNum(df.suggestedPrice);
      const negotiatedPrice = safeNum(df.negotiatedPrice);
      const taxesValueFixed = safeNum(df.taxesValue);
      const freightVal = safeNum(df.freightValue);
      const gross = qty * suggestedPrice;
      const taxesPerc = gross > 0 ? safeNum((taxesValueFixed / gross) * 100) : 0;
      const commissionPerc = safeNum(df.commissionPerc);
      const commissionValue =
        safeNum(df.commissionValue) > 0
          ? safeNum(df.commissionValue) * qty
          : safeNum(gross * (commissionPerc / 100));

      const snapshotPayload: Record<string, unknown> = {
        ...(data as unknown as Record<string, unknown>),
        capturedAt: new Date().toISOString(),
      };

      const updated = recomputeItemDerivedFields(
        normalizeProposalItem({
          ...current,
          productId: current.productId,
          quantity: qty,
          unitCost,
          suggestedPrice,
          negotiatedPrice,
          discountPerc: 0,
          discountValue: 0,
          taxesPerc,
          taxesValue: taxesValueFixed,
          commissionPerc,
          commissionValue,
          freightValue: freightVal,
          priceTableItemId: data.item.priceTableItemId,
          priceSource: ITEM_PRICE_SOURCE_PRICE_TABLE,
          pricingSnapshotJson: snapshotPayload,
          commercialPricingSnapshotJson: null,
          commercialFormation: commercialFormation
            ? {
                ...commercialFormation,
                priceTableId: data.priceTable.id,
                priceTableVersionId: data.version.id,
              }
            : null,
          priceTableId: data.priceTable.id,
          priceTableVersionId: data.version.id,
          priceTableCode: data.priceTable.code,
          priceTableVersionNumber: data.version.versionNumber,
          calculationExplainability: undefined,
        }),
        "none"
      );

      setFormData((prev) => {
        const arr = [...(prev.items ?? [])];
        if (arr[index]) arr[index] = updated;
        return { ...prev, items: arr };
      });

      const warnMsgs = (data.warnings ?? [])
        .map((w) => (typeof w?.message === "string" ? w.message.trim() : ""))
        .filter(Boolean);
      if (warnMsgs.length) {
        setTablePriceSessionAlerts((prev) => Array.from(new Set([...prev, ...warnMsgs])));
      }
    } catch (error) {
      console.error("Erro ao trocar tabela do item:", error);
      alert(error instanceof Error ? error.message : "Não foi possível trocar a tabela deste item.");
    } finally {
      setItemPriceTableUpdatingIndex(null);
    }
  };

  /**
   * Marca o item como preço manual. Limpa os campos diretos de tabela,
   * mas preserva pricingSnapshotJson com uma anotação de auditoria.
   * Não recalcula nada.
   */
  const markItemAsManual = (index: number) => {
    if (itemPriceTableUpdatingIndex !== null) return;
    setFormData((prev) => {
      const arr = [...(prev.items ?? [])];
      const cur = arr[index];
      if (!cur) return prev;
      const prevSnapshot = cur.pricingSnapshotJson;
      const annotatedSnapshot: Record<string, unknown> | null =
        prevSnapshot && typeof prevSnapshot === "object"
          ? {
              ...(prevSnapshot as Record<string, unknown>),
              previousPriceSource: cur.priceSource ?? null,
              manualMarkedAt: new Date().toISOString(),
            }
          : prevSnapshot ?? null;
      arr[index] = normalizeProposalItem({
        ...cur,
        priceTableId: null,
        priceTableVersionId: null,
        priceTableCode: null,
        priceTableVersionNumber: null,
        priceTableItemId: null,
        priceSource: ITEM_PRICE_SOURCE_MANUAL,
        pricingSnapshotJson: annotatedSnapshot,
      });
      return { ...prev, items: arr };
    });
  };

  const updateItem = (index: number, updates: Partial<ProposalItem>) => {
    const newItems = [...(formData.items || [])];
    const merged = { ...newItems[index], ...updates };
    if (updates.unitCost !== undefined || updates.suggestedPrice !== undefined) {
      (merged as ProposalItem).calculationExplainability = undefined;
    }
    const normalized = normalizeProposalItem(merged);
    const discountPath: "perc" | "value" | "none" =
      updates.discountPerc !== undefined
        ? "perc"
        : updates.discountValue !== undefined
          ? "value"
          : "none";
    newItems[index] = recomputeItemDerivedFields(normalized, discountPath);
    setFormData((prev) => ({ ...prev, items: newItems }));
  };

  const removeItem = (index: number) => {
    const newItems = [...(formData.items || [])];
    newItems.splice(index, 1);
    setFormData((prev) => ({ ...prev, items: newItems }));
    setSelectedItemIndexes((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i === index) return;
        next.add(i > index ? i - 1 : i);
      });
      return next;
    });
  };

  const toggleItemSelection = (index: number) => {
    setSelectedItemIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAllItemsSelected = () => {
    const total = formData.items?.length ?? 0;
    if (total === 0) return;
    setSelectedItemIndexes((prev) => {
      if (prev.size === total) return new Set();
      const all = new Set<number>();
      for (let i = 0; i < total; i++) all.add(i);
      return all;
    });
  };

  const clearItemSelection = () => {
    setSelectedItemIndexes(new Set());
  };

  /**
   * Aplica um desconto percentual a todos os itens selecionados.
   * - Reusa recomputeItemDerivedFields para preservar a fórmula existente.
   * - Itens vindos de tabela viram MANUAL_OVERRIDE preservando metadados de tabela.
   * - Anota pricingSnapshotJson com manualOverrideAt/Reason/bulkDiscountPerc para auditoria.
   * - Não toca em itens não selecionados, em cabeçalho, em produto ou em outros campos.
   */
  const applyBulkDiscount = () => {
    const raw = bulkDiscountInput.trim();
    if (!raw) {
      alert("Informe um desconto entre 0 e 100.");
      return;
    }
    const perc = parseFloat(raw.replace(",", "."));
    if (!Number.isFinite(perc)) {
      alert("Desconto inválido. Use um número entre 0 e 100.");
      return;
    }
    if (perc < 0) {
      alert("Desconto não pode ser negativo.");
      return;
    }
    if (perc > 100) {
      alert("Desconto não pode ser maior que 100%.");
      return;
    }
    if (selectedItemIndexes.size === 0) return;

    const overrideAt = new Date().toISOString();
    const indexes: number[] = Array.from(selectedItemIndexes);

    setFormData((prev) => {
      const items = [...(prev.items ?? [])];
      indexes.forEach((idx) => {
        const cur = items[idx];
        if (!cur) return;

        const wasTable =
          cur.priceSource === ITEM_PRICE_SOURCE_PRICE_TABLE ||
          (typeof cur.priceTableId === "string" && cur.priceTableId.trim() !== "");
        const alreadyManual = cur.priceSource === ITEM_PRICE_SOURCE_MANUAL;
        const alreadyOverride = cur.priceSource === ITEM_PRICE_SOURCE_MANUAL_OVERRIDE;

        let nextItem: ProposalItem = normalizeProposalItem({ ...cur, discountPerc: perc });

        if (wasTable && !alreadyManual && !alreadyOverride) {
          nextItem.priceSource = ITEM_PRICE_SOURCE_MANUAL_OVERRIDE;
          const prevSnap = nextItem.pricingSnapshotJson;
          const baseSnap: Record<string, unknown> =
            prevSnap && typeof prevSnap === "object"
              ? { ...(prevSnap as Record<string, unknown>) }
              : prevSnap != null
                ? { previousSnapshot: prevSnap }
                : {};
          baseSnap.manualOverrideAt = overrideAt;
          baseSnap.manualOverrideReason = "BULK_DISCOUNT";
          baseSnap.bulkDiscountPerc = perc;
          nextItem.pricingSnapshotJson = baseSnap;
        } else if (alreadyOverride) {
          const prevSnap = nextItem.pricingSnapshotJson;
          if (prevSnap && typeof prevSnap === "object") {
            nextItem.pricingSnapshotJson = {
              ...(prevSnap as Record<string, unknown>),
              manualOverrideAt: overrideAt,
              manualOverrideReason: "BULK_DISCOUNT",
              bulkDiscountPerc: perc,
            };
          }
        }

        items[idx] = recomputeItemDerivedFields(nextItem, "perc");
      });
      return { ...prev, items };
    });
  };

  // Totais consolidados — margem oficial = Pedido de Venda (ponderada pela receita PV)
  const totals = useMemo(() => {
    const items = formData.items || [];
    const totalGross = items.reduce(
      (acc, i) => acc + safeNum(i.quantity) * safeNum(i.negotiatedPrice),
      0
    );
    const totalDiscount = items.reduce((acc, i) => acc + safeNum(i.discountValue), 0);
    const totalNet = totalGross - totalDiscount;
    const totalTaxes = items.reduce((acc, i) => acc + safeNum(i.taxesValue), 0);
    const totalComm = items.reduce((acc, i) => acc + safeNum(i.commissionValue), 0);
    const totalFreight = items.reduce((acc, i) => acc + safeNum(i.freightValue), 0);

    const lineMargins = items.map((i) => {
      const freightPerc = resolveProposalFreightPercent(i.pricingSnapshotJson);
      const freightAbsolute = resolveProposalFreightAbsolute(i.pricingSnapshotJson);
      return calculateProposalLineMargin({
        quantity: safeNum(i.quantity),
        negotiatedPrice: safeNum(i.negotiatedPrice),
        discountValue: safeNum(i.discountValue),
        taxesPerc: safeNum(i.taxesPerc),
        commissionPerc: safeNum(i.commissionPerc),
        freightPerc,
        freightValue:
          freightPerc > 0 ? freightAbsolute : freightAbsolute || safeNum(i.freightValue),
        unitCost: toNullableUnitCost(i.unitCost),
        productId: i.productId,
        lineId: i.id ?? null,
      });
    });
    const marginSummary = calculateProposalMarginSummary(lineMargins);
    const totalCost = marginSummary.hasAnyCost
      ? lineMargins.reduce(
          (acc, row) => acc + (row.costMissing ? 0 : (row.totalCost ?? 0)),
          0
        )
      : 0;

    return {
      totalItems: items.length,
      totalGross,
      totalDiscount,
      totalNet,
      totalCost,
      totalTaxes,
      totalComm,
      totalFreight,
      totalMarginValue: marginSummary.totalMarginValue ?? 0,
      totalMarginPerc: marginSummary.totalMarginPerc ?? Number.NaN,
    };
  }, [formData.items]);

  /** Prévia da margem comercial — motor puro (backend autoritativo no save). */
  const commercialPreview = useMemo(() => {
    const items = formData.items ?? [];
    const preview = previewProposalCommercialMargins(
      items.map((i) => ({
        productId: i.productId,
        quantity: safeNum(i.quantity),
        suggestedPrice: safeNum(i.suggestedPrice),
        negotiatedPrice: safeNum(i.negotiatedPrice),
        discountPerc: safeNum(i.discountPerc),
        discountValue: safeNum(i.discountValue),
        priceTableId: i.priceTableId,
        priceTableVersionId: i.priceTableVersionId,
        priceSource: i.priceSource,
        commercialPricingSnapshotJson: i.commercialPricingSnapshotJson,
        pricingSnapshotJson: i.pricingSnapshotJson,
        commercialFormation: i.commercialFormation,
      }))
    );
    return {
      ...preview,
      view: buildProposalCommercialSummaryView(preview.byIndex, preview.summary),
    };
  }, [formData.items]);

  // Sem tabela: ainda assim carrega formação do produto para margem pelo preço negociado.
  useEffect(() => {
    if (view !== "form") return;
    const items = formData.items ?? [];
    const pending = items.filter(
      (it) =>
        Boolean(it.productId) &&
        !proposalItemHasUsableCommercialFormation(it) &&
        !formationHydrateAttemptedRef.current.has(it.productId as string)
    );
    if (pending.length === 0) return;

    for (const it of pending) {
      if (it.productId) formationHydrateAttemptedRef.current.add(it.productId);
    }

    let cancelled = false;
    void hydrateProposalItemsCommercialFormation(items).then((next) => {
      if (cancelled) return;
      const changed = next.some(
        (it, idx) => it.commercialFormation !== items[idx]?.commercialFormation
      );
      if (!changed) return;
      setFormData((prev) => ({ ...prev, items: next }));
    });

    return () => {
      cancelled = true;
    };
  }, [view, formData.items]);

  // Sincronizar totais com o formData para salvar
  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      totalItems: totals.totalItems,
      totalGrossValue: totals.totalGross,
      totalDiscount: totals.totalDiscount,
      totalNetValue: totals.totalNet,
      totalCost: totals.totalCost,
      totalTaxes: totals.totalTaxes,
      totalCommission: totals.totalComm,
      totalFreight: totals.totalFreight,
      // Espelho da faixa "Margem comercial" (não a margem de produção).
      totalMarginValue:
        commercialPreview.view.commercialMarginTotalValue ?? Number.NaN,
      totalMarginPerc:
        commercialPreview.view.commercialMarginTotalPercent ?? Number.NaN,
    }));
  }, [
    totals,
    commercialPreview.view.commercialMarginTotalValue,
    commercialPreview.view.commercialMarginTotalPercent,
  ]);

  const handleOpenClientPrintView = () => {
    const id = editingProposal?.id?.trim();
    if (!id) {
      alert("Salve a proposta antes de visualizar a versão para cliente.");
      return;
    }
    openProposalClientPrintTab(id);
  };

  const filteredProposals = proposals;
  const pagedProposals = useMemo(() => filteredProposals.slice(0, PAGE_SIZE), [filteredProposals]);

  const listShownRange = useMemo(() => {
    if (totalProposals === 0 || pagedProposals.length === 0) return { from: 0, to: 0 };
    const from = (currentPage - 1) * PAGE_SIZE + 1;
    const to = from + pagedProposals.length - 1;
    return { from, to };
  }, [totalProposals, currentPage, pagedProposals.length]);

  const clearListFilters = () => {
    setSearchTerm("");
    setListStatusFilter("");
    setListResponsibleFilter("");
    setListCustomerIdFilter("");
    setListStartDate("");
    setListEndDate("");
    setListMinValue("");
    setListMaxValue("");
  };

  if (view === "form") {
    return (
      <>
      <div className="space-y-6 pb-20" data-tour="proposals-root">
        {/* Form Header */}
        <div className="flex items-center justify-between" data-tour="proposals-form-actions">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setView("list")}
              className="p-2 rounded-full hover:bg-accent transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h3 className="text-2xl font-bold">
                {editingProposal ? `Editar Proposta #${editingProposal.number}` : "Nova Proposta Comercial"}
              </h3>
              <p className="text-sm text-muted-foreground">Preencha os dados e configure os itens para gerar a proposta.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <TourHelpButton onClick={() => setTourOpen(true)} />
            <button
              type="button"
              onClick={handleOpenClientPrintView}
              title="Abre a versão para cliente em nova aba. Salve a proposta antes para refletir as últimas alterações."
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm hover:bg-accent"
            >
              <Eye className="h-4 w-4" aria-hidden />
              Pré-visualizar para cliente
            </button>
            <div className={cn("min-w-[200px]", STATUS_CONFIG[formData.status as ProposalStatus]?.color, "rounded-lg border border-border p-0.5")}>
              <SearchableSelect
                className="border-0 bg-transparent"
                placeholder="Status..."
                options={PROPOSAL_STATUS_SELECT_OPTIONS}
                value={formData.status || "DRAFT"}
                onChange={(v) => setFormData({ ...formData, status: v as ProposalStatus })}
              />
            </div>
            {editingProposal && (
              <button
                type="button"
                onClick={() => handleOpenInternalManagementPdf(editingProposal.id)}
                title="Uso interno — inclui custo, margem e comissão. Abre layout formatado para imprimir/salvar PDF."
                className="flex items-center gap-2 bg-slate-800 text-white px-6 py-2 rounded-lg font-bold hover:bg-slate-700 transition-colors shadow-lg"
                data-testid="proposal-internal-management-pdf"
              >
                <FileText className="h-4 w-4" />
                {PROPOSAL_INTERNAL_MANAGEMENT_PDF_BUTTON_LABEL}
              </button>
            )}
            <button 
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2 rounded-lg font-bold hover:opacity-90 transition-opacity shadow-lg"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Salvando..." : "Salvar Proposta"}
            </button>
          </div>
        </div>

        {(formData.priceSource === "PRICE_TABLE" && formData.priceTableCode && formData.priceTableVersionNumber != null) ||
        mergedTablePriceAlerts.length > 0 ||
        defaultTableChangedNotice ? (
          <div className="space-y-2">
            {formData.priceSource === "PRICE_TABLE" &&
              formData.priceTableCode &&
              formData.priceTableVersionNumber != null && (
                <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-slate-900 dark:border-emerald-700 dark:bg-emerald-50">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-800" aria-hidden />
                  <div className="text-slate-900">
                    Tabela padrão para novos itens:{" "}
                    <span className="font-semibold text-emerald-950">
                      {formData.priceTableCode} v{formData.priceTableVersionNumber}
                    </span>
                    .
                  </div>
                </div>
              )}
            {defaultTableChangedNotice && (
              <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs leading-relaxed text-slate-900 dark:border-slate-600 dark:bg-slate-100 dark:text-slate-900">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" aria-hidden />
                <p>{defaultTableChangedNotice}</p>
              </div>
            )}
            {mergedTablePriceAlerts.length > 0 && (
              <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-slate-900 dark:border-amber-700 dark:bg-amber-50">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-900" aria-hidden />
                <div className="min-w-0 flex-1 text-slate-900">
                  <p className="font-semibold text-amber-950">
                    A tabela publicada possui avisos. Revise antes de enviar a proposta.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-900">
                    {mergedTablePriceAlerts.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <div className="space-y-4">
          {/* Top: Client, header & commercial conditions (compact) */}
            <div
              className="bg-card rounded-xl border border-border p-4 shadow-sm space-y-3"
              data-tour="proposals-form-header"
            >
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <User className="h-3.5 w-3.5" /> Cliente, cabeçalho e condições
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="space-y-1 md:col-span-5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Título da Proposta</label>
                  <input
                    type="text"
                    placeholder="Ex: Fornecimento de Peças - Projeto X"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                    value={formData.title}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                  />
                </div>

                <div className="space-y-1 md:col-span-4">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Cliente</label>
                  <SearchableSelect
                    required
                    placeholder="Selecione um cliente..."
                    options={customers.map((c) => {
                      const primary = (c.companyName || c.tradeName || "").trim() || "Cliente";
                      const sub =
                        c.tradeName && c.companyName && c.tradeName !== c.companyName
                          ? c.tradeName
                          : c.taxId || undefined;
                      return {
                        value: c.id,
                        label: primary,
                        sublabel: sub,
                        searchTerms: [c.companyName, c.tradeName, c.taxId].filter(Boolean).join(" "),
                      };
                    })}
                    value={formData.customerId || ""}
                    onChange={(val) => setFormData({...formData, customerId: val})}
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Responsável</label>
                  <input
                    type="text"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                    value={formData.responsible}
                    onChange={(e) => setFormData({...formData, responsible: e.target.value})}
                  />
                </div>

                <div className="space-y-1 md:col-span-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Validade</label>
                  <input
                    type="number"
                    title="Validade em dias"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                    value={formData.validityDays}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        validityDays: safeInt(e.target.value, 15),
                      })
                    }
                  />
                </div>

                <div className="space-y-1 md:col-span-4">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">
                    Tabela padrão (novos itens)
                  </label>
                  <SearchableSelect
                    placeholder="Sem tabela / preço manual"
                    options={priceTableSelectOptions}
                    value={formData.priceTableId ?? ""}
                    unknownSelectionLabel="Tabela não listada (verifique cadastro ou publicação)"
                    onChange={(val) => handlePriceTableSelectionChange(val ?? "")}
                  />
                </div>

                <div className="space-y-1 md:col-span-3">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Condição de Pagamento</label>
                  <input
                    type="text"
                    placeholder="Ex: 30/60/90 dias"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                    value={formData.paymentTerms}
                    onChange={(e) => setFormData({...formData, paymentTerms: e.target.value})}
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Frete</label>
                  <SearchableSelect
                    placeholder="Condição de frete..."
                    options={FREIGHT_CONDITION_OPTIONS}
                    value={formData.freightCondition || "CIF"}
                    onChange={(v) => setFormData({ ...formData, freightCondition: v })}
                  />
                </div>

                <div className="space-y-1 md:col-span-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Prazo</label>
                  <input
                    type="number"
                    title="Prazo de entrega em dias"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                    value={formData.deliveryTimeDays}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        deliveryTimeDays: safeOptionalInt(e.target.value),
                      })
                    }
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Local de Entrega</label>
                  <input
                    type="text"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                    value={formData.deliveryLocation}
                    onChange={(e) => setFormData({...formData, deliveryLocation: e.target.value})}
                  />
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground leading-snug">
                Tabela padrão vale só para novos itens; itens existentes mantêm a origem de preço. Tabelas sem versão
                publicada ficam listadas, mas indisponíveis até publicação na Formação de Preço.
              </p>
            </div>

          {/* Middle: Items editor (full width) */}
            <div
              className="bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col min-h-[70vh]"
              data-tour="proposals-form-items"
            >
              <div className="p-4 border-b border-border bg-accent/30 flex flex-wrap items-center gap-3 justify-between">
                <div className="flex items-center gap-3 shrink-0">
                  <h4 className="font-bold flex items-center gap-2">
                    <Package className="h-4 w-4" /> Proposta — Edição
                  </h4>
                </div>
                <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
                  <div className="w-full min-w-[20rem] max-w-2xl" data-testid="proposal-add-product-search">
                    <SearchableSelect
                      placeholder="+ Adicionar Produto (SKU ou nome)..."
                      options={products.map((p) => ({
                        value: p.id,
                        label: `${p.sku} — ${p.name}`,
                        sublabel: p.type === "COMPONENT" ? "Componente" : "Produto",
                        searchTerms: `${p.sku} ${p.name}`,
                      }))}
                      value=""
                      onChange={(val) => val && addItem(val)}
                    />
                  </div>
                </div>
              </div>

              {(formData.items?.length ?? 0) > 0 ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-accent/20 px-3 py-2 text-xs">
                  <span className="font-bold">
                    Itens selecionados:{" "}
                    <span className={cn(selectedItemIndexes.size > 0 ? "text-primary" : "text-muted-foreground")}>
                      {selectedItemIndexes.size}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground" htmlFor="bulk-discount-input">
                      Desconto %
                    </label>
                    <input
                      id="bulk-discount-input"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      inputMode="decimal"
                      value={bulkDiscountInput}
                      onChange={(e) => setBulkDiscountInput(e.target.value)}
                      placeholder="0,00"
                      className="w-24 rounded-md border border-border bg-background px-2 py-1 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={applyBulkDiscount}
                    disabled={selectedItemIndexes.size === 0 || bulkDiscountInput.trim() === ""}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    title={
                      selectedItemIndexes.size === 0
                        ? "Selecione ao menos um item."
                        : "Aplica o desconto % aos itens selecionados."
                    }
                  >
                    <Percent className="h-3.5 w-3.5" /> Aplicar desconto
                  </button>
                  <button
                    type="button"
                    onClick={clearItemSelection}
                    disabled={selectedItemIndexes.size === 0}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-bold hover:bg-accent disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" /> Limpar seleção
                  </button>
                  <p className="text-[10px] text-muted-foreground leading-snug ml-auto max-w-[360px]">
                    Itens vindos de tabela passam para <span className="font-bold">Manual sobre …</span> ao receber desconto manual,
                    preservando a origem para auditoria.
                  </p>
                </div>
              ) : null}

              {(formData.items?.length ?? 0) > 0 ? (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4 py-2.5"
                  data-testid="proposal-total-commercial-margin-strip"
                >
                  <p className="text-[11px] text-muted-foreground leading-snug max-w-xl">
                    Margem comercial em tempo real (formação congelada + preço líquido). Total ponderado pelo
                    valor líquido — nunca média simples. O save recalcula no servidor.
                  </p>
                  <div className="flex items-baseline gap-2 shrink-0">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Margem comercial
                    </span>
                    <span
                      className={cn(
                        "text-base font-bold font-mono tabular-nums",
                        commercialPreview.view.commercialMarginTotalPercent == null
                          ? "text-muted-foreground"
                          : commercialPreview.view.commercialMarginTotalPercent >= 20
                            ? "text-green-600"
                            : commercialPreview.view.commercialMarginTotalPercent >= 10
                              ? "text-orange-600"
                              : "text-red-600"
                      )}
                      data-testid="proposal-total-commercial-margin-perc"
                    >
                      {formatProposalCommercialPercent(
                        commercialPreview.view.commercialMarginTotalPercent
                      )}
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="flex-1 overflow-x-auto">
                  <table className="min-w-[960px] w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-accent/20 border-b border-border">
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground w-[36px] min-w-[36px]">
                          <input
                            type="checkbox"
                            aria-label="Selecionar todos os itens"
                            checked={
                              (formData.items?.length ?? 0) > 0 &&
                              selectedItemIndexes.size === (formData.items?.length ?? 0)
                            }
                            ref={(el) => {
                              if (!el) return;
                              const total = formData.items?.length ?? 0;
                              el.indeterminate =
                                selectedItemIndexes.size > 0 && selectedItemIndexes.size < total;
                            }}
                            onChange={toggleAllItemsSelected}
                            className="h-3.5 w-3.5 rounded accent-primary cursor-pointer"
                          />
                        </th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground">Produto</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground min-w-[110px] w-[110px]">Qtd</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground">Sugerido</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground min-w-[100px] w-[100px]">Negociado</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground min-w-[100px] w-[100px]">Desc %</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground text-right">Total Líq.</th>
                        <th
                          className="p-3 text-[10px] font-bold uppercase text-muted-foreground text-right min-w-[120px]"
                          title="Margem comercial (formação). Produção permanece no detalhe interno."
                        >
                          Margem com.
                        </th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {formData.items?.map((item, idx) => (
                        <tr
                          key={idx}
                          className={cn(
                            "hover:bg-accent/10 transition-colors group",
                            selectedItemIndexes.has(idx) && "bg-primary/5"
                          )}
                        >
                          <td className="p-3 align-top">
                            <input
                              type="checkbox"
                              aria-label={`Selecionar item ${idx + 1}`}
                              checked={selectedItemIndexes.has(idx)}
                              onChange={() => toggleItemSelection(idx)}
                              className="h-3.5 w-3.5 rounded accent-primary cursor-pointer"
                            />
                          </td>
                          <td className="p-3">
                            <div className="max-w-[200px]">
                              <p className="text-xs font-bold truncate">{item.Product?.sku}</p>
                              <p className="text-[10px] text-muted-foreground truncate">{item.Product?.name}</p>
                              <div className="mt-1 flex items-center gap-1 flex-wrap">
                                {item.priceSource === ITEM_PRICE_SOURCE_PRICE_TABLE && (
                                  <span
                                    className="rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground"
                                    title="Preço congelado da tabela publicada"
                                  >
                                    Preço da tabela
                                    {(() => {
                                      const directCode = typeof item.priceTableCode === "string"
                                        ? item.priceTableCode.trim()
                                        : "";
                                      const directVn = Number(item.priceTableVersionNumber);
                                      if (directCode && Number.isFinite(directVn)) {
                                        return ` · ${directCode} v${directVn}`;
                                      }
                                      const s = item.pricingSnapshotJson as Record<string, unknown> | null | undefined;
                                      const pt = s?.priceTable as { code?: string } | undefined;
                                      const ver = s?.version as { versionNumber?: unknown } | undefined;
                                      const vn = Number(ver?.versionNumber);
                                      if (pt?.code && Number.isFinite(vn)) {
                                        return ` · ${pt.code} v${vn}`;
                                      }
                                      return "";
                                    })()}
                                  </span>
                                )}
                                {item.priceSource === ITEM_PRICE_SOURCE_MANUAL && (
                                  <span
                                    className="rounded border border-border bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800"
                                    title="Preço definido manualmente (sem tabela publicada vinculada)"
                                  >
                                    Preço manual
                                  </span>
                                )}
                                {item.priceSource === ITEM_PRICE_SOURCE_MANUAL_OVERRIDE && (
                                  <span
                                    className="rounded border border-orange-300 bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-800"
                                    title="Item originalmente da tabela, com ajuste manual aplicado. Metadados da tabela preservados."
                                  >
                                    Manual sobre
                                    {(() => {
                                      const directCode =
                                        typeof item.priceTableCode === "string"
                                          ? item.priceTableCode.trim()
                                          : "";
                                      const directVn = Number(item.priceTableVersionNumber);
                                      if (directCode && Number.isFinite(directVn)) {
                                        return ` ${directCode} v${directVn}`;
                                      }
                                      const s = item.pricingSnapshotJson as
                                        | Record<string, unknown>
                                        | null
                                        | undefined;
                                      const pt = s?.priceTable as { code?: string } | undefined;
                                      const ver = s?.version as { versionNumber?: unknown } | undefined;
                                      const vn = Number(ver?.versionNumber);
                                      if (pt?.code && Number.isFinite(vn)) {
                                        return ` ${pt.code} v${vn}`;
                                      }
                                      return " tabela";
                                    })()}
                                  </span>
                                )}
                                <div className="relative">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setItemOriginMenuOpenIndex(
                                        itemOriginMenuOpenIndex === idx ? null : idx
                                      );
                                    }}
                                    disabled={
                                      itemPriceTableUpdatingIndex !== null &&
                                      itemPriceTableUpdatingIndex !== idx
                                    }
                                    aria-haspopup="menu"
                                    aria-expanded={itemOriginMenuOpenIndex === idx}
                                    title="Trocar origem do preço deste item"
                                    className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                                  >
                                    {itemPriceTableUpdatingIndex === idx ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Tag className="h-3 w-3" />
                                    )}
                                  </button>
                                  {itemOriginMenuOpenIndex === idx && (
                                    <div
                                      ref={itemOriginMenuRef}
                                      role="menu"
                                      className="absolute z-50 left-0 top-full mt-1 w-60 rounded-xl border border-border bg-card p-2 shadow-xl"
                                    >
                                      <p className="text-[10px] font-bold uppercase text-muted-foreground px-2 py-1">
                                        Origem do preço
                                      </p>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          setItemOriginMenuOpenIndex(null);
                                          markItemAsManual(idx);
                                        }}
                                        disabled={
                                          itemPriceTableUpdatingIndex !== null ||
                                          item.priceSource === ITEM_PRICE_SOURCE_MANUAL
                                        }
                                        className={cn(
                                          "w-full text-left px-2 py-1.5 rounded-md text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
                                          item.priceSource === ITEM_PRICE_SOURCE_MANUAL &&
                                            "bg-accent/40 font-bold"
                                        )}
                                      >
                                        Preço manual
                                        {item.priceSource === ITEM_PRICE_SOURCE_MANUAL ? " · atual" : ""}
                                      </button>
                                      <div className="my-1 border-t border-border" />
                                      {(() => {
                                        if (priceTables.length === 0) {
                                          return (
                                            <p className="px-2 py-1 text-[11px] text-muted-foreground">
                                              Nenhuma tabela comercial ativa.
                                            </p>
                                          );
                                        }
                                        const sorted = [...priceTables].sort((a, b) => {
                                          const aPub = a.latestPublishedVersion ? 0 : 1;
                                          const bPub = b.latestPublishedVersion ? 0 : 1;
                                          if (aPub !== bPub) return aPub - bPub;
                                          return a.code.localeCompare(b.code);
                                        });
                                        return sorted.map((t) => {
                                          const pub = t.latestPublishedVersion;
                                          const isCurrent =
                                            !!pub &&
                                            item.priceSource === ITEM_PRICE_SOURCE_PRICE_TABLE &&
                                            item.priceTableId === t.id &&
                                            item.priceTableVersionId === pub.id;
                                          const isUnpublished = !pub;
                                          return (
                                            <button
                                              key={t.id}
                                              type="button"
                                              role="menuitem"
                                              onClick={() => {
                                                if (isUnpublished) return;
                                                setItemOriginMenuOpenIndex(null);
                                                void applyPriceTableToItem(idx, t.id);
                                              }}
                                              disabled={
                                                isUnpublished ||
                                                itemPriceTableUpdatingIndex !== null ||
                                                isCurrent
                                              }
                                              title={
                                                isUnpublished
                                                  ? "Sem versão publicada — publique na Formação de Preço"
                                                  : undefined
                                              }
                                              className={cn(
                                                "w-full text-left px-2 py-1.5 rounded-md text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
                                                isCurrent && "bg-accent/40 font-bold",
                                                isUnpublished && "hover:bg-transparent"
                                              )}
                                            >
                                              <span className="font-mono">{t.code}</span>
                                              {pub ? ` v${pub.versionNumber}` : ""}
                                              {isCurrent ? " · atual" : ""}
                                              <span className="block text-[10px] text-muted-foreground truncate">
                                                {isUnpublished
                                                  ? "Sem versão publicada"
                                                  : t.name}
                                              </span>
                                            </button>
                                          );
                                        });
                                      })()}
                                      <div className="mt-1 border-t border-border pt-1">
                                        <p className="px-2 py-0.5 text-[10px] leading-snug text-muted-foreground">
                                          DRAFTs geradas na Formação de Preço ficam disponíveis na proposta somente após publicação.
                                        </p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="p-3 min-w-[110px]">
                            <input
                              type="number"
                              step="0.00001"
                              className="w-full min-w-[96px] p-1 rounded border border-border bg-background text-xs text-right tabular-nums outline-none"
                              value={item.quantity}
                              onChange={(e) => updateItem(idx, { quantity: parseFloat(e.target.value) || 0 })}
                            />
                          </td>
                          <td className="p-3 text-xs font-mono text-blue-600 font-medium">
                            <CalculatedValue meta={item.calculationExplainability?.suggestedPrice ?? null} hideIcon>
                              <span>{formatMoneyDisplay(item.suggestedPrice)}</span>
                            </CalculatedValue>
                          </td>
                          <td className="p-3 min-w-[100px] w-[100px]">
                            <NumericInputCell
                              ariaLabel="Preço negociado"
                              className="w-full min-w-[88px] p-1 rounded border border-border bg-background text-xs font-mono text-right tabular-nums outline-none focus:ring-1 focus:ring-primary"
                              value={safeNum(item.negotiatedPrice)}
                              onChange={(v) => updateItem(idx, { negotiatedPrice: v })}
                            />
                          </td>
                          <td className="p-3 min-w-[100px]">
                            <NumericInputCell
                              ariaLabel="Desconto percentual"
                              className="w-full min-w-[80px] p-1 rounded border border-border bg-background text-xs text-right tabular-nums outline-none"
                              value={safeNum(item.discountPerc)}
                              onChange={(v) => updateItem(idx, { discountPerc: v })}
                            />
                          </td>
                          <td className="p-3 text-right text-xs font-bold font-mono">
                            {formatMoneyDisplay(
                              safeNum(item.quantity) * safeNum(item.negotiatedPrice) - safeNum(item.discountValue)
                            )}
                          </td>
                          <td
                            className="p-3 text-right"
                            data-testid={`proposal-item-commercial-margin-${idx}`}
                          >
                            {(() => {
                              const cm = commercialPreview.byIndex[idx];
                              if (!cm) {
                                return (
                                  <span className="text-xs text-muted-foreground">—</span>
                                );
                              }
                              if (!cm.isComplete) {
                                return (
                                  <div className="inline-flex items-start justify-end gap-1">
                                    <div className="text-right">
                                      <p
                                        className="text-[10px] font-bold text-amber-700"
                                        data-testid={`proposal-item-commercial-margin-unavailable-${idx}`}
                                      >
                                        Margem não calculada
                                      </p>
                                      <p className="text-[9px] text-muted-foreground max-w-[140px]">
                                        {proposalCommercialMarginUnavailableLabel(cm.reasonCode)}
                                      </p>
                                    </div>
                                    <ProposalCommercialMarginTooltip
                                      item={cm}
                                      testId={`proposal-commercial-margin-tooltip-${idx}`}
                                    />
                                  </div>
                                );
                              }
                              const pct = cm.commercialMarginPercent ?? Number.NaN;
                              return (
                                <div className="inline-flex items-start justify-end gap-1">
                                  <div className="text-right">
                                    <p
                                      className={cn(
                                        "text-xs font-bold font-mono tabular-nums",
                                        pct >= 20
                                          ? "text-green-600"
                                          : pct >= 10
                                            ? "text-orange-600"
                                            : "text-red-600"
                                      )}
                                    >
                                      {formatProposalCommercialPercent(pct)}
                                    </p>
                                    <p className="text-[9px] text-muted-foreground font-mono">
                                      {formatProposalCommercialMoney(cm.commercialMarginValue)}
                                    </p>
                                    <p className="text-[9px] text-muted-foreground">
                                      {formatProposalCommercialTierPosition(cm.tierPosition)}
                                    </p>
                                  </div>
                                  <ProposalCommercialMarginTooltip
                                    item={cm}
                                    testId={`proposal-commercial-margin-tooltip-${idx}`}
                                  />
                                </div>
                              );
                            })()}
                          </td>
                          <td className="p-3 text-center">
                            <button 
                              onClick={() => removeItem(idx)}
                              className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {(!formData.items || formData.items.length === 0) && (
                        <tr>
                          <td colSpan={9} className="p-12 text-center text-muted-foreground italic text-sm">
                            Nenhum produto adicionado. Use o seletor acima para começar.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

              {/* Summary Footer — comercial (ponderado) + líquidos */}
              <div
                className="p-6 bg-accent/30 border-t border-border grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 gap-6"
                data-testid="proposal-commercial-summary"
              >
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Ref. tabelas</p>
                  <p className="text-lg font-bold font-mono">
                    {formatProposalCommercialMoney(commercialPreview.view.referenceTableTotal)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Concessão total:{" "}
                    {formatProposalCommercialMoney(
                      commercialPreview.view.totalCommercialConcession
                    )}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Descontos / redução</p>
                  <p className="text-lg font-bold font-mono text-red-600">
                    -{formatProposalCommercialMoney(commercialPreview.view.explicitDiscountTotal)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Manual:{" "}
                    {formatProposalCommercialMoney(commercialPreview.view.manualReductionTotal)}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Valor líquido proposto</p>
                  <p className="text-lg font-bold font-mono text-primary">
                    {formatMoneyDisplay(totals.totalNet)}
                  </p>
                </div>
                <div className="space-y-1 border-l border-border pl-6">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">
                    Margem comercial
                  </p>
                  <p
                    className={cn(
                      "text-lg font-bold font-mono",
                      commercialPreview.view.commercialMarginTotalPercent == null
                        ? "text-muted-foreground"
                        : commercialPreview.view.commercialMarginTotalPercent >= 20
                          ? "text-green-600"
                          : commercialPreview.view.commercialMarginTotalPercent >= 10
                            ? "text-orange-600"
                            : "text-red-600"
                    )}
                    data-testid="proposal-footer-commercial-margin-perc"
                  >
                    {formatProposalCommercialPercent(
                      commercialPreview.view.commercialMarginTotalPercent
                    )}
                  </p>
                  <p
                    className="text-xs font-mono text-muted-foreground"
                    data-testid="proposal-footer-commercial-margin-value"
                  >
                    {formatProposalCommercialMoney(
                      commercialPreview.view.commercialMarginTotalValue
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Cobertura{" "}
                    {formatProposalCommercialPercent(commercialPreview.view.coveragePercent)}
                    {" · "}
                    {commercialPreview.view.itemsCalculated}/
                    {commercialPreview.view.itemsActive} itens
                  </p>
                </div>
              </div>
            </div>

          {/* Bottom: Observações (PDF) + Notas internas */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-4">
              <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Info className="h-4 w-4" /> Observações da Proposta (PDF)
              </h4>
              <textarea
                rows={4}
                placeholder="Condições especiais, validade, observações técnicas..."
                className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm resize-none"
                value={formData.notes}
                onChange={(e) => setFormData({...formData, notes: e.target.value})}
              />
            </div>
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-4">
              <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Notas Internas</h4>
              <textarea
                rows={4}
                placeholder="Observações que não aparecem no PDF da proposta..."
                className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm resize-none"
                value={formData.internalNotes}
                onChange={(e) => setFormData({...formData, internalNotes: e.target.value})}
              />
            </div>
          </div>
        </div>

        <GuidedTour
          open={tourOpen}
          onClose={() => setTourOpen(false)}
          steps={PROPOSAL_TOUR_STEPS}
          tourName="Tour de Propostas"
        />
      </div>
      </>
    );
  }

  return (
    <div className="space-y-6" data-tour="proposals-root">
      {/* List Header */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        data-tour="proposals-toolbar"
      >
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex flex-col xl:flex-row xl:items-center gap-2">
            <div className="relative w-full xl:flex-1 xl:min-w-[260px] xl:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por número, cliente ou título..."
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              className="w-full xl:w-[180px] rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={listStatusFilter}
              onChange={(e) => setListStatusFilter(e.target.value as any)}
            >
              <option value="">Todos os status</option>
              {(Object.keys(STATUS_CONFIG) as ProposalStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_CONFIG[s]?.label ?? s}
                </option>
              ))}
            </select>

            <SearchableSelect
              className="w-full xl:w-[200px]"
              options={listResponsibleFilterOptions}
              value={listResponsibleFilter}
              onChange={(v) => setListResponsibleFilter(v)}
              placeholder="Todos os responsáveis"
              searchInputPlaceholder="Buscar responsável..."
              emptyMessage="Nenhum responsável encontrado"
              pinOptionValues={[""]}
              listMaxHeight={320}
            />

            <SearchableSelect
              className="w-full xl:w-[220px]"
              options={listCustomerFilterOptions}
              value={listCustomerIdFilter}
              onChange={(v) => setListCustomerIdFilter(v)}
              placeholder="Todos os clientes"
              searchInputPlaceholder="Buscar cliente..."
              emptyMessage="Nenhum cliente encontrado"
              pinOptionValues={[""]}
              listMaxHeight={320}
            />
          </div>

          <div className="flex flex-col xl:flex-row xl:items-center gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[10px] font-bold uppercase text-muted-foreground">Período</label>
              <input
                type="date"
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
                value={listStartDate}
                onChange={(e) => setListStartDate(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">até</span>
              <input
                type="date"
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
                value={listEndDate}
                onChange={(e) => setListEndDate(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2" data-testid="proposals-filter-net-value">
              <label className="text-[10px] font-bold uppercase text-muted-foreground">Valor líquido</label>
              <div className="flex h-9 items-stretch overflow-hidden rounded-lg border border-border bg-card transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
                <span
                  className="flex shrink-0 items-center border-r border-border bg-muted/40 px-2.5 text-[11px] font-semibold tracking-wide text-muted-foreground"
                  aria-hidden="true"
                >
                  R$
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="w-[120px] border-0 bg-transparent px-2.5 text-sm tabular-nums outline-none placeholder:text-muted-foreground/70"
                  placeholder="De"
                  value={listMinValue}
                  onChange={(e) => setListMinValue(e.target.value)}
                  onBlur={() =>
                    setListMinValue((prev) => moneyAmountToFilterParam(prev) || prev.trim())
                  }
                  aria-label="Valor líquido mínimo"
                  data-testid="proposals-filter-min-net-value"
                />
                <span className="flex shrink-0 items-center px-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  até
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="w-[120px] border-0 bg-transparent px-2.5 text-sm tabular-nums outline-none placeholder:text-muted-foreground/70"
                  placeholder="Até"
                  value={listMaxValue}
                  onChange={(e) => setListMaxValue(e.target.value)}
                  onBlur={() =>
                    setListMaxValue((prev) => moneyAmountToFilterParam(prev) || prev.trim())
                  }
                  aria-label="Valor líquido máximo"
                  data-testid="proposals-filter-max-net-value"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {totalProposals === 0 ? (
                <>Nenhuma proposta no filtro atual.</>
              ) : (
                <>
                  Exibindo{" "}
                  <span className="font-bold text-foreground">
                    {listShownRange.from}–{listShownRange.to}
                  </span>{" "}
                  de <span className="font-bold text-foreground">{totalProposals}</span> proposta(s).
                </>
              )}
            </p>
            <button
              type="button"
              onClick={clearListFilters}
              disabled={
                !searchTerm.trim() &&
                !listStatusFilter &&
                !listResponsibleFilter.trim() &&
                !listCustomerIdFilter &&
                !listStartDate &&
                !listEndDate &&
                !listMinValue.trim() &&
                !listMaxValue.trim()
              }
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-sm font-medium disabled:opacity-50 disabled:hover:bg-card"
            >
              <X className="h-4 w-4" />
              Limpar filtros
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TourHelpButton onClick={() => setTourOpen(true)} />
          {allowCreateWithCatalog ? (
            <button
              onClick={handleCreateNew}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
            >
              <Plus className="h-4 w-4" />
              Nova Proposta
            </button>
          ) : null}
        </div>
      </div>

      <ProposalListSummaryCards summary={summary} loading={loading} />

      {/* Proposals List */}
      <div
        className="bg-card rounded-xl border border-border overflow-hidden shadow-sm"
        data-tour="proposals-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-accent/50 border-b border-border">
                <th className="p-4 font-semibold text-sm">Nº / Título</th>
                <th className="p-4 font-semibold text-sm">Cliente</th>
                <th className="p-4 font-semibold text-sm">Data</th>
                <th className="p-4 font-semibold text-sm">Valor Líquido</th>
                <th
                  className="p-4 font-semibold text-sm text-right"
                  title="Margem comercial total (mesma do formulário da proposta)"
                >
                  Margem
                </th>
                <th className="p-4 font-semibold text-sm">Status</th>
                <th className="p-4 font-semibold text-sm text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">Carregando propostas...</p>
                  </td>
                </tr>
              ) : pagedProposals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    Nenhuma proposta encontrada.
                  </td>
                </tr>
              ) : (
                pagedProposals.map((p) => (
                  <tr key={p.id} className="hover:bg-accent/30 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-bold text-sm">#{p.number}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[150px]">{p.title || "Sem título"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-sm font-medium">{p.Customer?.companyName}</p>
                      <p className="text-[10px] text-muted-foreground">{p.Customer?.taxId}</p>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />{" "}
                        {formatProposalCommercialDate(p)}
                        {isProposalCommercialDateFallback(p) ? (
                          <span
                            className="text-[10px] text-amber-600"
                            title="Proposta importada sem data de abertura na origem — exibindo a data de importação no IndusCost."
                          >
                            *
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-4 font-mono text-sm font-bold">
                      {Number.isFinite(Number(p.totalNetValue))
                        ? Number(p.totalNetValue).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                        : "—"}
                    </td>
                    <td className="p-4 text-right" data-testid={`proposal-list-margin-${p.id}`}>
                      {p.totalMarginPerc != null && Number.isFinite(Number(p.totalMarginPerc)) ? (
                        <p
                          className={cn(
                            "text-sm font-bold tabular-nums leading-tight",
                            Number(p.totalMarginPerc) >= 20
                              ? "text-green-600"
                              : Number(p.totalMarginPerc) >= 10
                                ? "text-orange-600"
                                : "text-red-600"
                          )}
                        >
                          {formatPercentDisplay(p.totalMarginPerc)}
                        </p>
                      ) : (
                        <div className="text-xs font-bold text-muted-foreground">—</div>
                      )}
                    </td>
                    <td className="p-4">
                      <div className={cn(
                        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        STATUS_CONFIG[p.status]?.color
                      )}>
                        {STATUS_CONFIG[p.status]?.label}
                      </div>
                    </td>
                    <td className="p-4 text-right whitespace-nowrap align-middle">
                      <div className="inline-flex flex-shrink-0 items-center justify-end gap-1.5">
                        {p.status === "APPROVED" ? (
                          <button
                            type="button"
                            onClick={() => void handleSalesOrderFromProposal(p)}
                            disabled={salesOrderActionId === p.id}
                            className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-violet-600 transition-all disabled:opacity-50"
                            title={p.salesOrder ? "Abrir pedido de venda" : "Gerar pedido de venda"}
                          >
                            {salesOrderActionId === p.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <ShoppingCart className="h-4 w-4" />
                            )}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setAnalysisProposalId(p.id)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-emerald-600 transition-all"
                          title="Análise (dashboard)"
                        >
                          <LayoutDashboard className="h-4 w-4" />
                        </button>
                        {allowEdit ? (
                          <button
                            onClick={() => handleEdit(p.id)}
                            className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                            title="Editar"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        ) : null}
                        {allowPrint ? (
                          <button
                            onClick={() => openProposalClientPrintTab(p.id)}
                            className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-blue-500 transition-all"
                            title="Imprimir proposta"
                          >
                            <Printer className="h-4 w-4" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleOpenInternalManagementPdf(p.id)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-slate-800 transition-all"
                          title="PDF gerencial interno — uso interno; inclui custo, margem e comissão."
                          data-testid={`proposal-internal-management-pdf-${p.id}`}
                        >
                          <FileText className="h-4 w-4" />
                        </button>
                        {allowDelete ? (
                          <button
                            onClick={() => handleDelete(p.id)}
                            className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-red-500 transition-all"
                            title="Excluir"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Página <span className="font-semibold text-foreground">{currentPage}</span> de{" "}
          <span className="font-semibold text-foreground">{totalPages}</span> · {PAGE_SIZE} por página
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage <= 1 || loading}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-accent disabled:opacity-50 disabled:hover:bg-background"
          >
            <ArrowLeft className="h-4 w-4" />
            Anterior
          </button>
          <button
            type="button"
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage >= totalPages || loading}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-accent disabled:opacity-50 disabled:hover:bg-background"
          >
            Próxima
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <GuidedTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={PROPOSAL_TOUR_STEPS}
        tourName="Tour de Propostas"
      />

      <ProposalAnalysisModal
        open={analysisProposalId !== null}
        proposalId={analysisProposalId}
        onClose={() => setAnalysisProposalId(null)}
        onEdit={handleEdit}
      />
    </div>
  );
};
