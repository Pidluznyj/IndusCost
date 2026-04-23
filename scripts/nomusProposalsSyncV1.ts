import "dotenv/config";
import { Prisma, PrismaClient, ProposalStatus } from "@prisma/client";
import { normalizeTaxId, parseNomusPtBrNumber } from "./nomusNumberParser.ts";

const prisma = new PrismaClient();

const SOURCE_SYSTEM = "NOMUS";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_RETRY_BASE_MS = 700;
const KNOWN_MISSING_SKU = "660.01AA";

type JsonObject = Record<string, unknown>;

type ProposalPlan = {
  externalProposalId: number;
  externalProposalCode: string;
  title: string;
  customerId: string;
  customerExternalId: number;
  sellerExternalId: number | null;
  companyExternalId: number | null;
  movementTypeExternalId: number | null;
  openedAt: Date | null;
  status: ProposalStatus;
  header: JsonObject;
  totalItems: number;
  totalGrossValue: number;
  totalNetValue: number;
  totalTaxes: number;
  totalCost: number;
  totalMarginValue: number;
  totalMarginPerc: number;
  items: Array<{
    externalItemId: number | null;
    externalProductId: number | null;
    externalItemStatus: string | null;
    externalRawPayload: JsonObject;
    productId: string;
    quantity: number;
    unit: string | null;
    unitCost: number;
    suggestedPrice: number;
    negotiatedPrice: number;
    discountPerc: number;
    discountValue: number;
    marginValue: number;
    marginPerc: number;
    taxesPerc: number;
    taxesValue: number;
    commissionPerc: number;
    commissionValue: number;
    freightValue: number;
    notes: string | null;
  }>;
};

type ExistingProposalRef = {
  id: string;
  externalProposalId: number | null;
  externalProposalCode: string | null;
};

type BlockedProposal = {
  externalProposalId: number;
  externalProposalCode: string;
  reasons: string[];
  missingSkus: string[];
  missingCustomerExternalId: number | null;
};

type DryRunResult = {
  totalRead: number;
  eligibleCount: number;
  blockedCount: number;
  unresolvedCustomers: number;
  unresolvedProducts: number;
  missingSkus: string[];
  missingCustomers: number[];
  blockedProposalCodes: string[];
  createsPreview: Array<{ externalProposalId: number; externalProposalCode: string }>;
  updatesPreview: Array<{ externalProposalId: number; externalProposalCode: string; id: string }>;
  blockedPreview: BlockedProposal[];
};

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d-]/g, "");
    if (!normalized) return null;
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseNomusDateTime(input: unknown): Date | null {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input;
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso;

  const m = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!m) return null;
  const dd = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  const yyyy = Number.parseInt(m[3], 10);
  const hh = Number.parseInt(m[4] ?? "0", 10);
  const mi = Number.parseInt(m[5] ?? "0", 10);
  const ss = Number.parseInt(m[6] ?? "0", 10);
  const parsed = new Date(Date.UTC(yyyy, mm - 1, dd, hh, mi, ss));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildNomusHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = (process.env.NOMUS_TOKEN ?? "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const customHeaderName = (process.env.NOMUS_AUTH_HEADER_NAME ?? "").trim();
  const customHeaderValue = (process.env.NOMUS_AUTH_HEADER_VALUE ?? "").trim();
  if (customHeaderName && customHeaderValue) {
    headers[customHeaderName] = customHeaderValue;
  }
  return headers;
}

async function fetchJsonWithRetry(url: URL, maxRetries: number, retryBaseMs: number): Promise<unknown> {
  const headers = buildNomusHeaders();
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, { method: "GET", headers });
    if (res.ok) return res.json();

    const isRetryable = res.status === 429 || res.status >= 500;
    if (!isRetryable || attempt === maxRetries) {
      const body = await res.text().catch(() => "");
      throw new Error(`Falha HTTP ${res.status} em ${url.toString()}: ${body.slice(0, 300)}`);
    }

    const retryAfterSec = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
    const waitMs =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : retryBaseMs * Math.pow(2, attempt);
    await sleep(waitMs);
  }

  throw new Error("Estado inesperado no retry HTTP.");
}

function pickArrayFromUnknown(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const candidates = [
    data.propostas,
    data.data,
    (data.data as Record<string, unknown> | undefined)?.propostas,
    data.results,
    data.items,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function hasNextPage(payload: unknown, page: number, pageSize: number, currentLen: number): boolean {
  if (!payload || typeof payload !== "object") return currentLen >= pageSize;
  const data = payload as Record<string, unknown>;
  const totalPages = toInt(data.totalPaginas) ?? toInt(data.totalPages) ?? toInt(data.paginas);
  if (totalPages != null) return page < totalPages;
  if (typeof data.hasMore === "boolean") return data.hasMore;
  return currentLen >= pageSize;
}

async function fetchAllNomusProposals(baseUrl: string): Promise<JsonObject[]> {
  const pageSize = Math.max(1, toInt(process.env.NOMUS_PAGE_SIZE) ?? DEFAULT_PAGE_SIZE);
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);

  const proposals: JsonObject[] = [];
  let page = 1;

  while (true) {
    const url = new URL("/rest/propostas", baseUrl);
    url.searchParams.set("pagina", String(page));
    url.searchParams.set("limite", String(pageSize));

    const payload = await fetchJsonWithRetry(url, maxRetries, retryBaseMs);
    const arr = pickArrayFromUnknown(payload).filter(
      (entry): entry is JsonObject => !!entry && typeof entry === "object"
    );
    proposals.push(...arr);

    if (!hasNextPage(payload, page, pageSize, arr.length)) break;
    page += 1;
  }

  return proposals;
}

async function mapPessoaBridgeByExternalCustomerId(
  baseUrl: string,
  externalCustomerIds: number[]
): Promise<Map<number, { taxId: string | null; customerId: string | null }>> {
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);

  const localCustomers = await prisma.customer.findMany({
    select: { id: true, taxId: true },
  });
  const localByTaxId = new Map<string, string>();
  for (const customer of localCustomers) {
    const taxId = normalizeTaxId(customer.taxId);
    if (taxId) localByTaxId.set(taxId, customer.id);
  }

  const bridge = new Map<number, { taxId: string | null; customerId: string | null }>();
  const uniqueIds = [...new Set(externalCustomerIds)].filter((id) => id > 0);

  const concurrency = 12;
  for (let i = 0; i < uniqueIds.length; i += concurrency) {
    const chunk = uniqueIds.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (idCliente) => {
        const url = new URL("/rest/pessoas", baseUrl);
        url.searchParams.set("id", String(idCliente));
        const payload = await fetchJsonWithRetry(url, maxRetries, retryBaseMs);
        const arr = pickArrayFromUnknown(payload);
        const pessoa =
          (arr.find((x): x is JsonObject => !!x && typeof x === "object") as JsonObject | undefined) ??
          ((payload && typeof payload === "object" ? (payload as JsonObject) : undefined) as JsonObject | undefined);

        const taxId = normalizeTaxId((pessoa?.cnpj as unknown) ?? (pessoa?.cpf as unknown));
        const customerId = taxId ? (localByTaxId.get(taxId) ?? null) : null;
        return { idCliente, taxId, customerId };
      })
    );

    for (const result of chunkResults) {
      bridge.set(result.idCliente, { taxId: result.taxId, customerId: result.customerId });
    }
  }

  return bridge;
}

async function mapLatestUnitCostByProductId(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map<string, number>();

  const logs = await prisma.costCalculationLog.findMany({
    where: { productId: { in: productIds } },
    select: {
      productId: true,
      totalCiu: true,
      totalCfc: true,
      totalCgt: true,
      calculatedAt: true,
    },
    orderBy: [{ productId: "asc" }, { calculatedAt: "desc" }],
  });

  const map = new Map<string, number>();
  for (const log of logs) {
    if (map.has(log.productId)) continue;
    const unitCost = Number(log.totalCiu) + Number(log.totalCfc) + Number(log.totalCgt);
    map.set(log.productId, Number.isFinite(unitCost) ? unitCost : 0);
  }
  return map;
}

function toPrismaDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(Number.isFinite(value) ? value : 0);
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

async function buildPlans(): Promise<{
  plans: ProposalPlan[];
  blocked: BlockedProposal[];
  missingSkus: Set<string>;
  missingCustomers: Set<number>;
  rawProposalsCount: number;
}> {
  const nomusBaseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const rawProposals = await fetchAllNomusProposals(nomusBaseUrl);

  const externalCustomerIds = rawProposals
    .map((proposal) => toInt(proposal.idCliente))
    .filter((id): id is number => id != null);
  const customerBridge = await mapPessoaBridgeByExternalCustomerId(nomusBaseUrl, externalCustomerIds);

  const allSkus = new Set<string>();
  for (const proposal of rawProposals) {
    const items = Array.isArray(proposal.itensProposta) ? proposal.itensProposta : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const sku = asString((item as JsonObject).codigoProduto);
      if (sku) allSkus.add(sku);
    }
  }

  const products = await prisma.product.findMany({
    where: { sku: { in: [...allSkus] } },
    select: { id: true, sku: true },
  });
  const productBySku = new Map(products.map((p) => [p.sku, p.id]));
  const unitCostByProductId = await mapLatestUnitCostByProductId(products.map((p) => p.id));

  const plans: ProposalPlan[] = [];
  const blocked: BlockedProposal[] = [];
  const missingSkus = new Set<string>();
  const missingCustomers = new Set<number>();

  for (const proposal of rawProposals) {
    const externalProposalId = toInt(proposal.id);
    if (externalProposalId == null) continue;

    const externalProposalCode =
      asString(proposal.proposta) ?? `NOMUS-${externalProposalId.toString().padStart(6, "0")}`;

    const externalCustomerId = toInt(proposal.idCliente);
    const bridge = externalCustomerId != null ? customerBridge.get(externalCustomerId) : undefined;
    const customerId = bridge?.customerId ?? null;

    const proposalItemsRaw = Array.isArray(proposal.itensProposta)
      ? (proposal.itensProposta.filter((x): x is JsonObject => !!x && typeof x === "object") as JsonObject[])
      : [];

    const unresolvedSkus = new Set<string>();
    const mappedItems: ProposalPlan["items"] = [];
    let totalCost = 0;

    for (const item of proposalItemsRaw) {
      const sku = asString(item.codigoProduto);
      const productId = sku ? (productBySku.get(sku) ?? null) : null;
      if (!productId) {
        if (sku) unresolvedSkus.add(sku);
        continue;
      }

      const quantity = parseNomusPtBrNumber(item.qtde);
      const negotiatedPrice = parseNomusPtBrNumber(item.valorUnitario);
      const unitCost = unitCostByProductId.get(productId) ?? 0;
      const lineRevenue = negotiatedPrice * quantity;
      const lineCost = unitCost * quantity;
      const marginValue = lineRevenue - lineCost;
      const marginPerc = lineRevenue > 0 ? (marginValue / lineRevenue) * 100 : 0;
      totalCost += lineCost;

      mappedItems.push({
        externalItemId: toInt(item.id),
        externalProductId: toInt(item.idProduto),
        externalItemStatus: asString(item.status),
        externalRawPayload: item,
        productId,
        quantity,
        unit: asString(item.nomeUnidadeMedida),
        unitCost,
        suggestedPrice: negotiatedPrice,
        negotiatedPrice,
        discountPerc: 0,
        discountValue: 0,
        marginValue,
        marginPerc,
        taxesPerc: 0,
        taxesValue: 0,
        commissionPerc: 0,
        commissionValue: 0,
        freightValue: 0,
        notes: null,
      });
    }

    const reasons: string[] = [];
    if (externalCustomerId == null || !customerId) {
      reasons.push("CUSTOMER_NOT_RESOLVED");
      if (externalCustomerId != null) missingCustomers.add(externalCustomerId);
    }
    if (unresolvedSkus.size > 0) reasons.push("MISSING_PRODUCT_SKU");

    for (const sku of unresolvedSkus) missingSkus.add(sku);

    if (reasons.length > 0) {
      blocked.push({
        externalProposalId,
        externalProposalCode,
        reasons,
        missingSkus: [...unresolvedSkus].sort(),
        missingCustomerExternalId: externalCustomerId,
      });
      continue;
    }

    const totalNetValue = parseNomusPtBrNumber(proposal.valorTotal);
    const totalGrossValueRaw = parseNomusPtBrNumber(proposal.valorTotalNfe);
    const totalGrossValue = totalGrossValueRaw > 0 ? totalGrossValueRaw : totalNetValue;
    const totalTaxes = parseNomusPtBrNumber(proposal.totalTributacao);
    const totalMarginValue = totalNetValue - totalCost;
    const totalMarginPerc = totalNetValue > 0 ? (totalMarginValue / totalNetValue) * 100 : 0;

    plans.push({
      externalProposalId,
      externalProposalCode,
      title: externalProposalCode,
      customerId,
      customerExternalId: externalCustomerId!,
      sellerExternalId: toInt(proposal.idVendedor),
      companyExternalId: toInt(proposal.idEmpresa),
      movementTypeExternalId: toInt(proposal.idTipoMovimentacao),
      openedAt: parseNomusDateTime(proposal.dataHoraAbertura),
      status: "SENT",
      header: proposal,
      totalItems: mappedItems.length,
      totalGrossValue,
      totalNetValue,
      totalTaxes,
      totalCost,
      totalMarginValue,
      totalMarginPerc,
      items: mappedItems,
    });
  }

  return { plans, blocked, missingSkus, missingCustomers, rawProposalsCount: rawProposals.length };
}

async function runDry(plans: ProposalPlan[], blocked: BlockedProposal[], rawProposalsCount: number): Promise<DryRunResult> {
  const existing = await prisma.proposal.findMany({
    where: {
      sourceSystem: SOURCE_SYSTEM,
      externalProposalId: { in: plans.map((p) => p.externalProposalId) },
    },
    select: { id: true, externalProposalId: true, externalProposalCode: true },
  });

  const existingByExternalId = new Map<number, ExistingProposalRef>();
  for (const row of existing) {
    if (row.externalProposalId == null) continue;
    existingByExternalId.set(row.externalProposalId, row);
  }

  const createsPreview: DryRunResult["createsPreview"] = [];
  const updatesPreview: DryRunResult["updatesPreview"] = [];

  for (const plan of plans) {
    const current = existingByExternalId.get(plan.externalProposalId);
    if (!current) {
      createsPreview.push({
        externalProposalId: plan.externalProposalId,
        externalProposalCode: plan.externalProposalCode,
      });
      continue;
    }
    updatesPreview.push({
      externalProposalId: plan.externalProposalId,
      externalProposalCode: plan.externalProposalCode,
      id: current.id,
    });
  }

  return {
    totalRead: rawProposalsCount,
    eligibleCount: plans.length,
    blockedCount: blocked.length,
    unresolvedCustomers: blocked.filter((b) => b.reasons.includes("CUSTOMER_NOT_RESOLVED")).length,
    unresolvedProducts: blocked.filter((b) => b.reasons.includes("MISSING_PRODUCT_SKU")).length,
    missingSkus: [...new Set(blocked.flatMap((b) => b.missingSkus))].sort(),
    missingCustomers: [...new Set(blocked.map((b) => b.missingCustomerExternalId).filter((x): x is number => x != null))],
    blockedProposalCodes: blocked.map((b) => b.externalProposalCode),
    createsPreview: createsPreview.slice(0, 50),
    updatesPreview: updatesPreview.slice(0, 50),
    blockedPreview: blocked.slice(0, 50),
  };
}

async function applyPlans(plans: ProposalPlan[]): Promise<{ created: number; updated: number }> {
  const existing = await prisma.proposal.findMany({
    where: {
      sourceSystem: SOURCE_SYSTEM,
      externalProposalId: { in: plans.map((p) => p.externalProposalId) },
    },
    select: { id: true, externalProposalId: true },
  });
  const existingByExternalId = new Map<number, ExistingProposalRef>();
  for (const row of existing) {
    if (row.externalProposalId == null) continue;
    existingByExternalId.set(row.externalProposalId, { id: row.id, externalProposalId: row.externalProposalId, externalProposalCode: null });
  }

  let created = 0;
  let updated = 0;

  for (const plan of plans) {
    const current = existingByExternalId.get(plan.externalProposalId);
    await prisma.$transaction(async (tx) => {
      const proposalCreateData: Prisma.ProposalUncheckedCreateInput = {
        sourceSystem: SOURCE_SYSTEM,
        externalProposalId: plan.externalProposalId,
        externalProposalCode: plan.externalProposalCode,
        externalCustomerId: plan.customerExternalId,
        externalSellerId: plan.sellerExternalId,
        externalCompanyId: plan.companyExternalId,
        externalMovementTypeId: plan.movementTypeExternalId,
        externalOpenedAt: plan.openedAt,
        externalRawPayload: toInputJsonValue(plan.header),
        title: plan.title,
        customerId: plan.customerId,
        status: plan.status,
        totalItems: plan.totalItems,
        totalGrossValue: toPrismaDecimal(plan.totalGrossValue),
        totalDiscount: new Prisma.Decimal(0),
        totalNetValue: toPrismaDecimal(plan.totalNetValue),
        totalCost: toPrismaDecimal(plan.totalCost),
        totalMarginValue: toPrismaDecimal(plan.totalMarginValue),
        totalMarginPerc: toPrismaDecimal(plan.totalMarginPerc),
        totalTaxes: toPrismaDecimal(plan.totalTaxes),
        totalCommission: new Prisma.Decimal(0),
        totalFreight: new Prisma.Decimal(0),
      };

      let proposalId: string;
      if (!current) {
        const createdProposal = await tx.proposal.create({ data: proposalCreateData, select: { id: true } });
        proposalId = createdProposal.id;
      } else {
        const proposalUpdateData: Prisma.ProposalUncheckedUpdateInput = proposalCreateData;
        const updatedProposal = await tx.proposal.update({
          where: { id: current.id },
          data: proposalUpdateData,
          select: { id: true },
        });
        proposalId = updatedProposal.id;
      }

      await tx.proposalItem.deleteMany({ where: { proposalId } });
      if (plan.items.length > 0) {
        await tx.proposalItem.createMany({
          data: plan.items.map((item) => ({
            proposalId,
            externalItemId: item.externalItemId,
            externalProductId: item.externalProductId,
            externalItemStatus: item.externalItemStatus,
            externalRawPayload: toInputJsonValue(item.externalRawPayload),
            productId: item.productId,
            quantity: toPrismaDecimal(item.quantity),
            unit: item.unit,
            unitCost: toPrismaDecimal(item.unitCost),
            suggestedPrice: toPrismaDecimal(item.suggestedPrice),
            negotiatedPrice: toPrismaDecimal(item.negotiatedPrice),
            discountPerc: toPrismaDecimal(item.discountPerc),
            discountValue: toPrismaDecimal(item.discountValue),
            marginValue: toPrismaDecimal(item.marginValue),
            marginPerc: toPrismaDecimal(item.marginPerc),
            taxesPerc: toPrismaDecimal(item.taxesPerc),
            taxesValue: toPrismaDecimal(item.taxesValue),
            commissionPerc: toPrismaDecimal(item.commissionPerc),
            commissionValue: toPrismaDecimal(item.commissionValue),
            freightValue: toPrismaDecimal(item.freightValue),
            notes: item.notes,
          })),
        });
      }
    });

    if (current) updated += 1;
    else created += 1;
  }

  return { created, updated };
}

async function main(): Promise<void> {
  const isApply = process.argv.includes("--apply");
  const { plans, blocked, missingSkus, missingCustomers, rawProposalsCount } = await buildPlans();
  const dry = await runDry(plans, blocked, rawProposalsCount);

  if (missingSkus.has(KNOWN_MISSING_SKU)) {
    console.warn(`[sync-v1] SKU conhecido ainda sem cadastro local: ${KNOWN_MISSING_SKU}`);
  }

  console.log(
    JSON.stringify(
      {
        mode: isApply ? "apply" : "dry-run",
        summary: dry,
        applied: null,
      },
      null,
      2
    )
  );

  if (!isApply) return;

  const result = await applyPlans(plans);
  console.log(
    JSON.stringify(
      {
        mode: "apply",
        summary: dry,
        applied: result,
        skippedBlockedProposals: blocked.map((b) => ({
          externalProposalId: b.externalProposalId,
          externalProposalCode: b.externalProposalCode,
          reasons: b.reasons,
        })),
        missingSkus: [...missingSkus].sort(),
        missingCustomers: [...missingCustomers].sort((a, b) => a - b),
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error("[sync-v1] erro:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

