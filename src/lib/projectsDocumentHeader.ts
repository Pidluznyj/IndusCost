/**
 * Projetos — bloco documental comum dos cinco documentos (regra pura, browser-safe).
 *
 * Todo documento emitido carrega: emitente (Configurações de Marca), cliente, projeto,
 * documento (número, revisão), emissão (data, usuário) e origem dos valores. O cabeçalho é
 * montado no servidor e congelado junto com o conteúdo na emissão (ProjectIssuedDocument).
 */
import type { ProjectDetail } from "@/src/types/projects.js";
import { PROJECT_DOCUMENT_VALUE_MODE_LABELS, type ProjectDocumentValueSource } from "./projectsDocumentValues.js";
import { formatTaxId } from "./projectsCustomerLink.js";
import { PROJECT_STATUS_LABEL, PROJECT_TYPE_LABEL } from "./projectsExecutiveReport.js";

export const PROJECT_DOCUMENT_TYPES = [
  "QUICK_FORM",
  "FULL_FORM",
  "SPREADSHEET",
  "EXECUTIVE_REPORT",
  "CLIENT_PROPOSAL",
] as const;
export type ProjectDocumentType = (typeof PROJECT_DOCUMENT_TYPES)[number];

export type ProjectDocumentAudience = "INTERNAL" | "CLIENT";

export const PROJECT_DOCUMENT_TYPE_META: Record<
  ProjectDocumentType,
  { title: string; code: string; slug: string; audience: ProjectDocumentAudience }
> = {
  QUICK_FORM: { title: "Ficha Rápida de Estimativa do Projeto", code: "FR", slug: "ficha-rapida", audience: "INTERNAL" },
  FULL_FORM: { title: "Ficha Completa de Abertura de Projeto", code: "FC", slug: "ficha-completa", audience: "INTERNAL" },
  SPREADSHEET: { title: "Planilha de Dados do Projeto", code: "PL", slug: "planilha", audience: "INTERNAL" },
  EXECUTIVE_REPORT: { title: "Relatório Gerencial de Projeto", code: "RG", slug: "relatorio-gerencial", audience: "INTERNAL" },
  CLIENT_PROPOSAL: { title: "Proposta Comercial", code: "PC", slug: "proposta-cliente", audience: "CLIENT" },
};

export function isProjectDocumentType(v: unknown): v is ProjectDocumentType {
  return typeof v === "string" && (PROJECT_DOCUMENT_TYPES as readonly string[]).includes(v);
}

export function projectDocumentTypeFromSlug(slug: string): ProjectDocumentType | null {
  const hit = PROJECT_DOCUMENT_TYPES.find((t) => PROJECT_DOCUMENT_TYPE_META[t].slug === slug || t === slug);
  return hit ?? null;
}

/** Ex.: PRJ-00012-PC-R03 (código do projeto + tipo + revisão de 2 dígitos). */
export function formatProjectDocumentNumber(projectCode: string, type: ProjectDocumentType, revision: number): string {
  return `${projectCode}-${PROJECT_DOCUMENT_TYPE_META[type].code}-R${String(revision).padStart(2, "0")}`;
}

export type ProjectDocumentIssuer = {
  legalName: string | null;
  tradeName: string | null;
  document: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoDataUrl: string | null;
};

export type BrandingIssuerSource = {
  companyName?: string | null;
  tradeName?: string | null;
  document?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  proposalLogoDataUrl?: string | null;
  systemExpandedLogoDataUrl?: string | null;
  systemCompactLogoDataUrl?: string | null;
};

const clean = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);
const isImageDataUrl = (v: string | null | undefined) => typeof v === "string" && /^data:image\//i.test(v.trim());

/** Emitente a partir das Configurações de Marca. Sem valores fixos no código. */
export function buildIssuerFromBranding(row: BrandingIssuerSource | null): ProjectDocumentIssuer {
  const logo = [row?.proposalLogoDataUrl, row?.systemExpandedLogoDataUrl, row?.systemCompactLogoDataUrl].find(
    isImageDataUrl,
  );
  return {
    legalName: clean(row?.companyName),
    tradeName: clean(row?.tradeName),
    document: row?.document ? formatTaxId(row.document) ?? clean(row.document) : null,
    address: clean(row?.address),
    phone: clean(row?.phone),
    email: clean(row?.email),
    website: clean(row?.website),
    logoDataUrl: logo ? logo.trim() : null,
  };
}

export type ProjectDocumentCustomer = {
  name: string;
  document: string | null;
  linked: boolean;
  linkSource: string | null;
  registry: {
    companyName: string;
    tradeName: string | null;
    taxId: string | null;
    stateTaxId: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    contactName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

export function buildDocumentCustomer(detail: ProjectDetail): ProjectDocumentCustomer {
  const c = detail.customer ?? null;
  return {
    name: detail.customerName,
    document: detail.customerDocument ? formatTaxId(detail.customerDocument) ?? detail.customerDocument : null,
    linked: !!detail.customerId,
    linkSource: detail.customerLinkSource ?? null,
    registry: c
      ? {
          companyName: c.companyName,
          tradeName: c.tradeName,
          taxId: formatTaxId(c.taxId),
          stateTaxId: c.stateTaxId,
          address: c.address,
          city: c.city,
          state: c.state,
          zipCode: c.zipCode,
          contactName: c.contactName,
          email: c.email,
          phone: c.phone,
        }
      : null,
  };
}

export type ProjectDocumentHeader = {
  schemaVersion: 1;
  documentType: ProjectDocumentType;
  documentTitle: string;
  audience: ProjectDocumentAudience;
  status: "PREVIEW" | "ISSUED";
  documentNumber: string | null;
  revision: number | null;
  /** Emissão (ISSUED) ou geração da prévia (PREVIEW). */
  issuedAt: string;
  issuedBy: { userId: string | null; name: string };
  issuer: ProjectDocumentIssuer;
  customer: ProjectDocumentCustomer;
  project: {
    id: string;
    code: string;
    title: string;
    statusLabel: string;
    typeLabel: string;
    versionId: string | null;
    versionNumber: number | null;
    commercialOwner: string | null;
    technicalOwner: string | null;
  };
  values: {
    mode: ProjectDocumentValueSource["mode"];
    modeLabel: string;
    pricingSavedAt: string | null;
    stale: boolean;
    /** Só em documentos internos. */
    staleReasons: string[];
  };
  /** Avisos de completude do documento (internos). */
  warnings: string[];
};

export type ProjectDocumentEnvelope<T = unknown> = {
  header: ProjectDocumentHeader;
  body: T;
};

export function buildProjectDocumentHeader(input: {
  type: ProjectDocumentType;
  detail: ProjectDetail;
  issuer: ProjectDocumentIssuer;
  valueSource: ProjectDocumentValueSource;
  issuedAt: string;
  issuedBy: { userId: string | null; name: string };
  revision: number | null;
}): ProjectDocumentHeader {
  const { type, detail, issuer, valueSource } = input;
  const meta = PROJECT_DOCUMENT_TYPE_META[type];
  const internal = meta.audience === "INTERNAL";
  const warnings: string[] = [];
  if (!issuer.legalName) warnings.push("Razão social do emitente não configurada em Configurações de Marca.");
  if (!issuer.document) warnings.push("CNPJ do emitente não configurado em Configurações de Marca.");
  if (!detail.customerId) warnings.push("Projeto sem vínculo com o cadastro oficial de clientes.");
  if (!detail.customerDocument) warnings.push("Cliente sem CNPJ/CPF informado.");
  if (valueSource.mode === "NO_SAVED_PRICING") warnings.push("Projeto sem precificação salva: preços a definir.");
  if (valueSource.stale) warnings.push("A precificação salva diverge dos custos atuais do projeto.");
  return {
    schemaVersion: 1,
    documentType: type,
    documentTitle: meta.title,
    audience: meta.audience,
    status: input.revision != null ? "ISSUED" : "PREVIEW",
    documentNumber: input.revision != null ? formatProjectDocumentNumber(detail.code, type, input.revision) : null,
    revision: input.revision,
    issuedAt: input.issuedAt,
    issuedBy: input.issuedBy,
    issuer,
    customer: buildDocumentCustomer(detail),
    project: {
      id: detail.id,
      code: detail.code,
      title: detail.title,
      statusLabel: PROJECT_STATUS_LABEL[detail.status] ?? detail.status,
      typeLabel: PROJECT_TYPE_LABEL[detail.projectType] ?? detail.projectType,
      versionId: detail.currentVersion?.id ?? null,
      versionNumber: detail.currentVersion?.versionNumber ?? null,
      commercialOwner: detail.commercialOwner?.trim() || null,
      technicalOwner: detail.technicalOwner?.trim() || null,
    },
    values: {
      mode: valueSource.mode,
      modeLabel: PROJECT_DOCUMENT_VALUE_MODE_LABELS[valueSource.mode],
      pricingSavedAt: valueSource.pricingSavedAt,
      stale: valueSource.stale,
      staleReasons: internal ? valueSource.staleReasons.map((r) => r.message) : [],
    },
    warnings: internal ? warnings : [],
  };
}

/**
 * Impedimentos de emissão. Proposta ao cliente exige precificação salva, atual e completa;
 * documentos internos podem ser emitidos com os avisos impressos no próprio documento.
 */
export function projectDocumentIssueBlockers(
  type: ProjectDocumentType,
  valueSource: Pick<ProjectDocumentValueSource, "mode" | "stale" | "staleReasons">,
  extra?: { pricingPending?: boolean; productsCount?: number },
): string[] {
  if (PROJECT_DOCUMENT_TYPE_META[type].audience !== "CLIENT") return [];
  const out: string[] = [];
  if (valueSource.mode === "NO_SAVED_PRICING") {
    out.push("Salve a precificação do projeto (Custos do Projeto › Precificação) antes de emitir a proposta.");
  } else if (valueSource.stale) {
    out.push(
      "A precificação salva está desatualizada em relação aos custos/amortização atuais. Revise e salve a precificação novamente antes de emitir.",
    );
    out.push(...valueSource.staleReasons.map((r) => r.message));
  }
  if (extra?.productsCount === 0) out.push("A proposta não tem itens precificados.");
  else if (extra?.pricingPending) out.push("Há itens sem preço final na precificação salva.");
  return out;
}

export function formatDocumentDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}
