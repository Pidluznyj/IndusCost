/**
 * Cliente BrasilAPI CNPJ — https://brasilapi.com.br/api/cnpj/v1/{cnpj}
 * Host hardcoded no backend (sem URL controlada pelo cliente).
 */
import { CompanyIntelligenceError } from "./companyCnpjErrors.js";
import { formatCep, formatCnpj, isValidCnpj, normalizeCnpj } from "./companyCnpjFormat.js";
import {
  normalizeRegistrationStatusExport,
  parseShareCapital,
  type NormalizedCnpjSummary,
} from "./companyCnpjNormalize.js";

const BRASIL_API_CNPJ_HOST = "https://brasilapi.com.br";

/** CDN/WAF da BrasilAPI rejeita clientes Node sem User-Agent (HTTP 403). */
export const BRASIL_API_USER_AGENT = "IndusCost/1.0 Company Intelligence";

export const BRASIL_API_REQUEST_HEADERS = {
  Accept: "application/json",
  "User-Agent": BRASIL_API_USER_AGENT,
} as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t || null;
}

function formatBrasilApiPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return raw.trim() || null;
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  return `(${ddd}) ${rest}`;
}

function readCnaeFromBrasilApi(
  code: unknown,
  description: unknown
): { code: string; description: string } | null {
  const c = readString(code);
  const d = readString(description);
  if (!c && !d) return null;
  return { code: c ?? "—", description: d ?? "—" };
}

/** Normaliza o JSON da BrasilAPI para o mesmo contrato interno do CNPJ.ws. */
export function normalizeBrasilApiCnpjPayload(raw: unknown): NormalizedCnpjSummary {
  const root = asRecord(raw) ?? {};
  const cnpj = normalizeCnpj(readString(root.cnpj));
  const registrationStatus = readString(root.descricao_situacao_cadastral) ?? readString(root.situacao_cadastral);
  const registrationStatusNormalized = normalizeRegistrationStatusExport(registrationStatus);

  const tipoLog = readString(root.descricao_tipo_de_logradouro);
  const logradouro = readString(root.logradouro);
  const addressParts = [tipoLog, logradouro].filter(Boolean);

  const mainCnae =
    readCnaeFromBrasilApi(root.cnae_fiscal, root.cnae_fiscal_descricao) ??
    readCnaeFromBrasilApi(root.cnae_fiscal, root.descricao_cnae_fiscal);

  const secondaryCnaes = asArray(root.cnaes_secundarios)
    .map((item) => {
      const o = asRecord(item) ?? {};
      return readCnaeFromBrasilApi(o.codigo ?? o.code, o.descricao ?? o.description);
    })
    .filter((x): x is { code: string; description: string } => x != null);

  const partners = asArray(root.qsa).map((s) => {
    const row = asRecord(s) ?? {};
    return {
      name: readString(row.nome_socio) ?? readString(row.nome) ?? "—",
      role: readString(row.qualificacao_socio) ?? readString(row.qualificacao) ?? null,
    };
  });

  const porte =
    readString(root.descricao_porte) ?? readString(root.porte) ?? readString(asRecord(root.porte)?.descricao);

  const legalNature =
    readString(root.natureza_juridica) ??
    readString(asRecord(root.natureza_juridica)?.descricao);

  const isMei =
    Boolean(root.opcao_pelo_mei === true) ||
    (porte?.toUpperCase().includes("MEI") ?? false);

  return {
    cnpj,
    cnpjFormatted: formatCnpj(cnpj),
    companyName: readString(root.razao_social) ?? "—",
    tradeName: readString(root.nome_fantasia),
    registrationStatus,
    registrationStatusNormalized,
    openedAt: readString(root.data_inicio_atividade),
    companySize: porte,
    legalNature,
    shareCapital: parseShareCapital(root.capital_social),
    mainCnae,
    secondaryCnaes,
    address: addressParts.length ? addressParts.join(" ") : logradouro,
    addressNumber: readString(root.numero),
    addressComplement: readString(root.complemento),
    district: readString(root.bairro),
    city: readString(root.municipio) ?? readString(root.cidade),
    state: readString(root.uf),
    zipCode: readString(root.cep) ? formatCep(readString(root.cep)) : null,
    phone: formatBrasilApiPhone(readString(root.ddd_telefone_1) ?? readString(root.telefone)),
    email: readString(root.email),
    stateTaxIds: [],
    partners,
    isMei,
    hasPartners: partners.length > 0,
    sourceUpdatedAt: readString(root.data_situacao_cadastral),
  };
}

export async function fetchBrasilApiCnpj(
  cnpj: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15_000
): Promise<unknown> {
  const digits = normalizeCnpj(cnpj);
  if (!isValidCnpj(digits)) {
    throw new CompanyIntelligenceError("CNPJ inválido.", "INVALID_CNPJ", 422);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${BRASIL_API_CNPJ_HOST}/api/cnpj/v1/${digits}`, {
      signal: controller.signal,
      headers: { ...BRASIL_API_REQUEST_HEADERS },
    });
    if (res.status === 404) {
      throw new CompanyIntelligenceError("CNPJ não encontrado na BrasilAPI.", "CNPJ_NOT_FOUND", 404);
    }
    if (res.status === 429) {
      throw new CompanyIntelligenceError(
        "Limite de consultas da BrasilAPI atingido. Tente novamente em alguns minutos.",
        "RATE_LIMIT",
        429
      );
    }
    if (!res.ok) {
      throw new CompanyIntelligenceError(
        `Falha na BrasilAPI (HTTP ${res.status}).`,
        "UPSTREAM_ERROR",
        502
      );
    }
    const json = await res.json();
    if (!json || typeof json !== "object") {
      throw new CompanyIntelligenceError("Resposta inesperada da BrasilAPI.", "INVALID_PAYLOAD", 502);
    }
    return json;
  } catch (e: unknown) {
    if (e instanceof CompanyIntelligenceError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new CompanyIntelligenceError("Tempo esgotado na BrasilAPI.", "TIMEOUT", 504);
    }
    throw new CompanyIntelligenceError(
      "BrasilAPI indisponível no momento.",
      "UPSTREAM_UNAVAILABLE",
      502
    );
  } finally {
    clearTimeout(timer);
  }
}
