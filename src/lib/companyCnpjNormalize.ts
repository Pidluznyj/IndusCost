import { formatCep, formatCnpj, normalizeCnpj } from "./companyCnpjFormat.js";

export type NormalizedCnpjSummary = {
  cnpj: string;
  cnpjFormatted: string;
  companyName: string;
  tradeName: string | null;
  registrationStatus: string | null;
  registrationStatusNormalized: string | null;
  openedAt: string | null;
  companySize: string | null;
  legalNature: string | null;
  shareCapital: number | null;
  mainCnae: { code: string; description: string } | null;
  secondaryCnaes: { code: string; description: string }[];
  address: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  email: string | null;
  stateTaxIds: { number: string; state: string | null; status: string | null }[];
  partners: { name: string; role: string | null }[];
  isMei: boolean;
  hasPartners: boolean;
  sourceUpdatedAt: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t || null;
}

function readCnae(item: unknown): { code: string; description: string } | null {
  const o = asRecord(item);
  if (!o) return null;
  const code = readString(o.id) ?? readString(o.codigo);
  const description = readString(o.descricao);
  if (!code && !description) return null;
  return { code: code ?? "—", description: description ?? "—" };
}

function normalizeRegistrationStatus(status: string | null): string | null {
  if (!status) return null;
  const s = status.trim().toUpperCase();
  if (s.startsWith("ATIV")) return "ATIVA";
  return s;
}

export function isRegistrationActive(statusNormalized: string | null): boolean {
  return statusNormalized === "ATIVA";
}

export function parseShareCapital(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(String(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function normalizePublicCnpjPayload(raw: unknown): NormalizedCnpjSummary {
  const root = asRecord(raw) ?? {};
  const est = asRecord(root.estabelecimento) ?? {};
  const porte = asRecord(root.porte);
  const natureza = asRecord(root.natureza_juridica);
  const simples = asRecord(root.simples);
  const cidade = asRecord(est.cidade);
  const estado = asRecord(est.estado);

  const cnpj = normalizeCnpj(readString(est.cnpj) ?? readString(root.cnpj));
  const registrationStatus = readString(est.situacao_cadastral);
  const registrationStatusNormalized = normalizeRegistrationStatus(registrationStatus);

  const tipoLog = readString(est.tipo_logradouro);
  const logradouro = readString(est.logradouro);
  const addressParts = [tipoLog, logradouro].filter(Boolean);

  const ddd1 = readString(est.ddd1);
  const tel1 = readString(est.telefone1);
  const phone =
    ddd1 && tel1 ? `(${ddd1}) ${tel1}` : tel1 ?? null;

  const stateTaxIds = asArray(est.inscricoes_estaduais).map((ie) => {
    const row = asRecord(ie) ?? {};
    return {
      number: readString(row.inscricao_estadual) ?? readString(row.numero) ?? "—",
      state: readString(asRecord(row.estado)?.sigla) ?? readString(row.estado),
      status: readString(row.situacao) ?? readString(row.situacao_cadastral),
    };
  });

  const partners = asArray(root.socios).map((s) => {
    const row = asRecord(s) ?? {};
    const qual = asRecord(row.qualificacao_socio);
    return {
      name: readString(row.nome) ?? "—",
      role: readString(qual?.descricao) ?? readString(row.tipo),
    };
  });

  const isMei =
    Boolean(simples && readString(simples.mei) === "Sim") ||
    (readString(porte?.descricao)?.toUpperCase().includes("MEI") ?? false);

  return {
    cnpj,
    cnpjFormatted: formatCnpj(cnpj),
    companyName: readString(root.razao_social) ?? "—",
    tradeName: readString(est.nome_fantasia),
    registrationStatus,
    registrationStatusNormalized,
    openedAt: readString(est.data_inicio_atividade),
    companySize: readString(porte?.descricao),
    legalNature: readString(natureza?.descricao),
    shareCapital: parseShareCapital(root.capital_social),
    mainCnae: readCnae(est.atividade_principal),
    secondaryCnaes: asArray(est.atividades_secundarias)
      .map(readCnae)
      .filter((x): x is { code: string; description: string } => x != null),
    address: addressParts.length ? addressParts.join(" ") : null,
    addressNumber: readString(est.numero),
    addressComplement: readString(est.complemento),
    district: readString(est.bairro),
    city: readString(cidade?.nome),
    state: readString(estado?.sigla),
    zipCode: readString(est.cep) ? formatCep(readString(est.cep)) : null,
    phone,
    email: readString(est.email),
    stateTaxIds,
    partners,
    isMei,
    hasPartners: partners.length > 0,
    sourceUpdatedAt: readString(root.atualizado_em) ?? readString(est.atualizado_em),
  };
}

export function summaryToCustomerDraft(summary: NormalizedCnpjSummary): Record<string, string> {
  const primaryIe = summary.stateTaxIds[0]?.number;
  return {
    companyName: summary.companyName,
    tradeName: summary.tradeName ?? "",
    taxId: summary.cnpj,
    stateTaxId: primaryIe && primaryIe !== "—" ? primaryIe : "",
    email: summary.email ?? "",
    phone: summary.phone ?? "",
    address: summary.address ?? "",
    city: summary.city ?? "",
    state: summary.state ?? "",
    zipCode: summary.zipCode?.replace(/\D/g, "") ?? "",
    country: "Brasil",
    segment: summary.mainCnae?.description ?? "",
    notes: "Cadastro criado a partir de consulta CNPJ pública.",
    status: "ACTIVE",
  };
}
