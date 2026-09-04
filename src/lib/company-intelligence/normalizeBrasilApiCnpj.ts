import { formatCep, formatCnpj, normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";
import { parseShareCapital, type NormalizedCnpjSummary } from "@/src/lib/companyCnpjNormalize.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t || null;
}

function normalizeRegistrationStatus(status: string | null): string | null {
  if (!status) return null;
  const s = status.trim().toUpperCase();
  if (s.startsWith("ATIV")) return "ATIVA";
  return s;
}

function formatPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  return raw.trim() || null;
}

function readCnae(
  codeValue: unknown,
  descriptionValue: unknown
): { code: string; description: string } | null {
  const code = readString(codeValue);
  const description = readString(descriptionValue);
  if (!code && !description) return null;
  return { code: code ?? "—", description: description ?? "—" };
}

export function isUsableBrasilApiPayload(raw: unknown): boolean {
  const root = asRecord(raw);
  if (!root) return false;
  const name = readString(root.razao_social);
  const cnpj = normalizeCnpj(readString(root.cnpj));
  return Boolean(name) && cnpj.length === 14;
}

export function normalizeBrasilApiCnpjPayload(raw: unknown): NormalizedCnpjSummary {
  const root = asRecord(raw) ?? {};
  const cnpj = normalizeCnpj(readString(root.cnpj));
  const registrationStatus =
    readString(root.descricao_situacao_cadastral) ?? readString(root.situacao_cadastral);
  const registrationStatusNormalized = normalizeRegistrationStatus(registrationStatus);

  const logradouro = readString(root.logradouro);
  const numero = readString(root.numero);
  const addressParts = [logradouro, numero].filter(Boolean);

  const secondaryCnaes = asArray(root.cnaes_secundarios)
    .map((item) => {
      const row = asRecord(item) ?? {};
      return readCnae(row.codigo ?? row.cnae, row.codigo_descricao ?? row.descricao);
    })
    .filter((x): x is { code: string; description: string } => x != null);

  const partners = asArray(root.qsa).map((item) => {
    const row = asRecord(item) ?? {};
    return {
      name: readString(row.nome_socio) ?? readString(row.nome) ?? "—",
      role: readString(row.qualificacao_socio) ?? readString(row.qualificacao),
    };
  });

  const meiRaw = root.opcao_pelo_mei;
  const isMei =
    meiRaw === true ||
    readString(meiRaw)?.toUpperCase() === "SIM" ||
    (readString(root.porte)?.toUpperCase().includes("MEI") ?? false);

  const cep = readString(root.cep);

  return {
    cnpj,
    cnpjFormatted: formatCnpj(cnpj),
    companyName: readString(root.razao_social) ?? "—",
    tradeName: readString(root.nome_fantasia),
    registrationStatus,
    registrationStatusNormalized,
    openedAt: readString(root.data_inicio_atividade),
    companySize: readString(root.descricao_porte) || readString(root.porte),
    legalNature: readString(root.natureza_juridica),
    shareCapital: parseShareCapital(root.capital_social),
    mainCnae: readCnae(root.cnae_fiscal, root.cnae_fiscal_descricao),
    secondaryCnaes,
    address: addressParts.length ? addressParts.join(" ") : logradouro,
    addressNumber: numero,
    addressComplement: readString(root.complemento),
    district: readString(root.bairro),
    city: readString(root.municipio),
    state: readString(root.uf)?.toUpperCase() ?? null,
    zipCode: cep ? formatCep(cep) : null,
    phone: formatPhone(readString(root.ddd_telefone_1) ?? readString(root.telefone)),
    email: readString(root.email),
    stateTaxIds: [],
    partners,
    isMei,
    hasPartners: partners.length > 0,
    sourceUpdatedAt:
      readString(root.data_situacao_cadastral) ?? readString(root.atualizado_em),
  };
}
