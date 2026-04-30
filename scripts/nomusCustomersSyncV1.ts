import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { normalizeTaxId } from "./nomusNumberParser.ts";

const prisma = new PrismaClient();

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_RETRY_BASE_MS = 700;

type JsonObject = Record<string, unknown>;

type EligibleCustomer = {
  externalId: number;
  taxId: string;
  companyName: string;
  tradeName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  raw: JsonObject;
};

type BlockedCustomer = {
  externalId: number | null;
  name: string | null;
  reasons: string[];
};

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

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
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
  if (customHeaderName && customHeaderValue) headers[customHeaderName] = customHeaderValue;
  return headers;
}

function buildNomusUrl(baseUrl: string, resource: string): URL {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedResource = resource.replace(/^\/+/, "");
  return new URL(normalizedResource, normalizedBase);
}

async function fetchJsonWithRetry(url: URL, maxRetries: number, retryBaseMs: number): Promise<unknown> {
  const headers = buildNomusHeaders();
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await fetch(url, { method: "GET", headers });
    if (res.ok) return res.json();
    const body = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === maxRetries) {
      throw new Error(`Falha HTTP ${res.status} em ${url.toString()}: ${body.slice(0, 300)}`);
    }
    await sleep(retryBaseMs * Math.pow(2, attempt));
  }
  throw new Error("Estado inesperado no retry HTTP.");
}

function pickArrayFromUnknown(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const candidates = [data.pessoas, data.data, data.results, data.items, (data.data as Record<string, unknown> | undefined)?.pessoas];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function hasNextPage(payload: unknown, page: number, currentLen: number): boolean {
  if (!payload || typeof payload !== "object") return currentLen > 0;
  if (Array.isArray(payload)) return currentLen > 0;
  const data = payload as Record<string, unknown>;
  const totalPages = toInt(data.totalPaginas) ?? toInt(data.totalPages) ?? toInt(data.paginas);
  if (totalPages != null) return page < totalPages;
  if (typeof data.hasMore === "boolean") return data.hasMore;
  return currentLen > 0;
}

async function fetchAllNomusCustomers(baseUrl: string): Promise<JsonObject[]> {
  const pageSize = Math.max(1, toInt(process.env.NOMUS_PAGE_SIZE) ?? DEFAULT_PAGE_SIZE);
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);
  const startPage = Math.max(1, toInt(process.env.NOMUS_CUSTOMERS_START_PAGE) ?? 1);
  const maxPages = Math.max(1, toInt(process.env.NOMUS_CUSTOMERS_MAX_PAGES) ?? toInt(process.env.NOMUS_MAX_PAGES) ?? 200);
  const lastPage = startPage + maxPages - 1;

  const rows: JsonObject[] = [];
  let page = startPage;

  while (true) {
    const url = buildNomusUrl(baseUrl, "pessoas");
    url.searchParams.set("pagina", String(page));
    url.searchParams.set("tamanhoPagina", String(pageSize));
    const payload = await fetchJsonWithRetry(url, maxRetries, retryBaseMs);
    const arr = pickArrayFromUnknown(payload).filter((x): x is JsonObject => !!x && typeof x === "object");
    if (arr.length === 0) break;
    rows.push(...arr);
    console.warn(`[nomus-customers-v1] página ${page} lida com ${arr.length} pessoas; acumulado=${rows.length}.`);
    if (page >= lastPage) {
      console.warn(
        `[nomus-customers-v1] limite de bloco atingido: startPage=${startPage}, maxPages=${maxPages}, lastPage=${lastPage}.`
      );
      break;
    }
    if (!hasNextPage(payload, page, arr.length)) break;
    page += 1;
  }
  return rows;
}

function mapCustomers(raw: JsonObject[]): { eligible: EligibleCustomer[]; blocked: BlockedCustomer[] } {
  const eligible: EligibleCustomer[] = [];
  const blocked: BlockedCustomer[] = [];

  for (const pessoa of raw) {
    const externalId = toInt(pessoa.id);
    const taxId = normalizeTaxId((pessoa.cnpj as unknown) ?? (pessoa.cpf as unknown));
    const companyName = asString(pessoa.razaoSocial) ?? asString(pessoa.nome);
    const reasons: string[] = [];
    if (externalId == null) reasons.push("MISSING_EXTERNAL_ID");
    if (!taxId) reasons.push("MISSING_TAX_ID");
    if (!companyName) reasons.push("MISSING_COMPANY_NAME");
    if (reasons.length > 0) {
      blocked.push({ externalId, name: companyName, reasons });
      continue;
    }
    eligible.push({
      externalId: externalId!,
      taxId: taxId!,
      companyName: companyName!,
      tradeName: asString(pessoa.nomeFantasia),
      contactName: asString(pessoa.nomeContato),
      email: asString(pessoa.email),
      phone: asString(pessoa.telefone) ?? asString(pessoa.celular),
      city: asString(pessoa.cidade),
      state: asString(pessoa.uf),
      raw: pessoa,
    });
  }
  return { eligible, blocked };
}

async function runDry(eligible: EligibleCustomer[]) {
  const existing = await prisma.customer.findMany({
    where: { taxId: { in: eligible.map((c) => c.taxId) } },
    select: { id: true, taxId: true, companyName: true },
  });
  const byTaxId = new Map(existing.map((c) => [c.taxId, c]));
  const createsPreview: Array<{ externalId: number; taxId: string; companyName: string }> = [];
  const updatesPreview: Array<{ id: string; externalId: number; taxId: string; companyName: string }> = [];
  for (const c of eligible) {
    const current = byTaxId.get(c.taxId);
    if (!current) createsPreview.push({ externalId: c.externalId, taxId: c.taxId, companyName: c.companyName });
    else updatesPreview.push({ id: current.id, externalId: c.externalId, taxId: c.taxId, companyName: c.companyName });
  }
  return { createsPreview: createsPreview.slice(0, 50), updatesPreview: updatesPreview.slice(0, 50) };
}

async function runApply(eligible: EligibleCustomer[]): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const c of eligible) {
    const current = await prisma.customer.findUnique({ where: { taxId: c.taxId }, select: { id: true } });
    const data = {
      companyName: c.companyName,
      tradeName: c.tradeName,
      contactName: c.contactName,
      email: c.email,
      phone: c.phone,
      city: c.city,
      state: c.state,
      status: "ACTIVE",
      notes: `[NOMUS] externalPersonId=${c.externalId}`,
    };
    if (current) {
      await prisma.customer.update({ where: { id: current.id }, data });
      updated += 1;
    } else {
      await prisma.customer.create({ data: { ...data, taxId: c.taxId, country: "Brasil" } });
      created += 1;
    }
  }
  return { created, updated };
}

async function main(): Promise<void> {
  const isApply = process.argv.includes("--apply");
  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const raw = await fetchAllNomusCustomers(baseUrl);
  const { eligible, blocked } = mapCustomers(raw);
  const dry = await runDry(eligible);
  const blockedReasons: Record<string, number> = {};
  for (const b of blocked) for (const r of b.reasons) blockedReasons[r] = (blockedReasons[r] ?? 0) + 1;

  const applied = isApply ? await runApply(eligible) : null;
  console.log(
    JSON.stringify(
      {
        mode: isApply ? "apply" : "dry-run",
        summary: {
          totalRead: raw.length,
          eligibleCount: eligible.length,
          blockedCount: blocked.length,
          blockedReasons,
          createsPreview: dry.createsPreview,
          updatesPreview: dry.updatesPreview,
          blockedPreview: blocked.slice(0, 50),
        },
        applied,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error("[nomus-customers-v1] erro:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

