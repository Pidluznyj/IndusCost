/**
 * Hierarquia de fontes cadastrais — Inteligência do Cliente.
 * Nomus é fonte mestre quando o cliente foi sincronizado; fallback local rotulado.
 */

import { toIsoDateOnly } from "@/src/lib/customerIntelligenceUtils.js";
import type { CustomerIntelligenceCustomerInput } from "@/src/lib/customerIntelligenceTypes.js";

export type CustomerIntelligenceFieldSource = "nomus" | "induscost" | "derived" | "unavailable";

/** Chaves conhecidas no payload Nomus `pessoa` para data de cadastro (sync futuro/raw). */
export const NOMUS_PESSOA_REGISTRATION_DATE_KEYS = [
  "dataCadastro",
  "dataInclusao",
  "dataCriacao",
  "clienteDesde",
  "cadastro",
  "registrationDate",
  "createdAt",
] as const;

export const CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS: Record<
  CustomerIntelligenceFieldSource,
  string
> = {
  nomus: "Nomus",
  induscost: "IndusCost",
  derived: "Derivado da UF",
  unavailable: "Não disponível",
};

export type CustomerIntelligenceProfileField = {
  id: string;
  label: string;
  value: string | null;
  displayValue: string;
  source: CustomerIntelligenceFieldSource;
  sourceLabel: string;
};

export type CustomerIntelligenceRegistrationResolution = {
  date: string | null;
  source: CustomerIntelligenceFieldSource;
  sourceLabel: string;
  headerLabel: string;
};

const NOMUS_EXTERNAL_PERSON_ID_PATTERN = /\[NOMUS\]\s*externalPersonId=(\d+)/i;

export function parseNomusExternalPersonId(notes: string | null | undefined): number | null {
  const raw = notes?.trim();
  if (!raw) return null;
  const match = raw.match(NOMUS_EXTERNAL_PERSON_ID_PATTERN);
  if (!match?.[1]) return null;
  const id = Number.parseInt(match[1], 10);
  return Number.isFinite(id) ? id : null;
}

export function isNomusSyncedCustomer(notes: string | null | undefined): boolean {
  return parseNomusExternalPersonId(notes) != null;
}

function parseNomusDateValue(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const isoOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
    const d = new Date(isoOnly ? `${trimmed}T12:00:00.000Z` : trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Extrai data de cadastro oficial do raw Nomus `pessoa`, se presente. */
export function extractNomusRegistrationDateFromRaw(raw: unknown): Date | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  for (const key of NOMUS_PESSOA_REGISTRATION_DATE_KEYS) {
    const parsed = parseNomusDateValue(obj[key]);
    if (parsed) return parsed;
  }
  return null;
}

export function resolveCadastralFieldSource(
  isNomusSynced: boolean,
  value: string | null | undefined
): CustomerIntelligenceFieldSource {
  if (value?.trim()) {
    return isNomusSynced ? "nomus" : "induscost";
  }
  return "unavailable";
}

export function resolveCustomerRegistrationDate(input: {
  nomusRegistrationDate: Date | null;
  createdAt: Date;
  isNomusSynced: boolean;
}): CustomerIntelligenceRegistrationResolution {
  if (input.nomusRegistrationDate) {
    return {
      date: toIsoDateOnly(input.nomusRegistrationDate),
      source: "nomus",
      sourceLabel: CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS.nomus,
      headerLabel: "Cadastro no Nomus",
    };
  }

  if (input.isNomusSynced) {
    return {
      date: null,
      source: "unavailable",
      sourceLabel: CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS.unavailable,
      headerLabel: "Cadastro no Nomus",
    };
  }

  return {
    date: toIsoDateOnly(input.createdAt),
    source: "induscost",
    sourceLabel: CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS.induscost,
    headerLabel: "Importado no IndusCost",
  };
}

function displayOrNotInformed(value: string | null | undefined): string {
  const t = value?.trim();
  return t ? t : "Não informado";
}

export function buildCustomerProfileFields(input: {
  customer: CustomerIntelligenceCustomerInput;
  registration: CustomerIntelligenceRegistrationResolution;
  region: string | null;
}): CustomerIntelligenceProfileField[] {
  const { customer, registration, region } = input;
  const isNomusSynced = isNomusSyncedCustomer(customer.notes);

  const regionSource: CustomerIntelligenceFieldSource = region
    ? "derived"
    : "unavailable";
  const regionSourceLabel = CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS[regionSource];

  return [
    {
      id: "registrationDate",
      label: "Data de cadastro",
      value: registration.date,
      displayValue: registration.date
        ? formatDatePtBr(registration.date)
        : "Não informado",
      source: registration.source,
      sourceLabel: registration.sourceLabel,
    },
    {
      id: "legalName",
      label: "Razão social",
      value: customer.companyName,
      displayValue: displayOrNotInformed(customer.companyName),
      source: resolveCadastralFieldSource(isNomusSynced, customer.companyName),
      sourceLabel:
        CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS[
          resolveCadastralFieldSource(isNomusSynced, customer.companyName)
        ],
    },
    {
      id: "tradeName",
      label: "Nome fantasia",
      value: customer.tradeName,
      displayValue: displayOrNotInformed(customer.tradeName),
      source: resolveCadastralFieldSource(isNomusSynced, customer.tradeName),
      sourceLabel:
        CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS[
          resolveCadastralFieldSource(isNomusSynced, customer.tradeName)
        ],
    },
    {
      id: "taxId",
      label: "CNPJ/CPF",
      value: customer.taxId,
      displayValue: displayOrNotInformed(customer.taxId),
      source: resolveCadastralFieldSource(isNomusSynced, customer.taxId),
      sourceLabel:
        CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS[
          resolveCadastralFieldSource(isNomusSynced, customer.taxId)
        ],
    },
    {
      id: "stateTaxId",
      label: "Inscrição estadual",
      value: customer.stateTaxId,
      displayValue: displayOrNotInformed(customer.stateTaxId),
      source: resolveCadastralFieldSource(isNomusSynced, customer.stateTaxId),
      sourceLabel:
        CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS[
          resolveCadastralFieldSource(isNomusSynced, customer.stateTaxId)
        ],
    },
    {
      id: "city",
      label: "Cidade",
      value: customer.city,
      displayValue: displayOrNotInformed(customer.city),
      source: resolveCadastralFieldSource(isNomusSynced, customer.city),
      sourceLabel:
        CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS[
          resolveCadastralFieldSource(isNomusSynced, customer.city)
        ],
    },
    {
      id: "state",
      label: "UF",
      value: customer.state,
      displayValue: displayOrNotInformed(customer.state),
      source: resolveCadastralFieldSource(isNomusSynced, customer.state),
      sourceLabel:
        CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS[
          resolveCadastralFieldSource(isNomusSynced, customer.state)
        ],
    },
    {
      id: "region",
      label: "Região",
      value: region,
      displayValue: displayOrNotInformed(region),
      source: regionSource,
      sourceLabel: regionSourceLabel,
    },
    {
      id: "address",
      label: "Endereço",
      value: customer.address,
      displayValue: displayOrNotInformed(customer.address),
      source: resolveCadastralFieldSource(isNomusSynced, customer.address),
      sourceLabel:
        CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS[
          resolveCadastralFieldSource(isNomusSynced, customer.address)
        ],
    },
    {
      id: "phone",
      label: "Telefone",
      value: customer.phone,
      displayValue: displayOrNotInformed(customer.phone),
      source: resolveCadastralFieldSource(isNomusSynced, customer.phone),
      sourceLabel:
        CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS[
          resolveCadastralFieldSource(isNomusSynced, customer.phone)
        ],
    },
    {
      id: "email",
      label: "E-mail",
      value: customer.email,
      displayValue: displayOrNotInformed(customer.email),
      source: resolveCadastralFieldSource(isNomusSynced, customer.email),
      sourceLabel:
        CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS[
          resolveCadastralFieldSource(isNomusSynced, customer.email)
        ],
    },
    {
      id: "commercialOwner",
      label: "Responsável comercial",
      value: customer.accountOwner,
      displayValue: displayOrNotInformed(customer.accountOwner),
      source: resolveCadastralFieldSource(isNomusSynced, customer.accountOwner),
      sourceLabel:
        CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS[
          resolveCadastralFieldSource(isNomusSynced, customer.accountOwner)
        ],
    },
    {
      id: "status",
      label: "Status cadastral",
      value: customer.status,
      displayValue: displayOrNotInformed(customer.status),
      source: resolveCadastralFieldSource(isNomusSynced, customer.status),
      sourceLabel:
        CUSTOMER_INTELLIGENCE_FIELD_SOURCE_LABELS[
          resolveCadastralFieldSource(isNomusSynced, customer.status)
        ],
    },
  ];
}

export function buildCustomerIntelligenceProfileDataQualityWarnings(input: {
  customer: CustomerIntelligenceCustomerInput;
  registration: CustomerIntelligenceRegistrationResolution;
  isNomusSynced: boolean;
  hasActiveCommercialFilter: boolean;
  financialLinkedByCnpj: boolean;
}): string[] {
  const warnings: string[] = [];

  if (input.isNomusSynced && !input.registration.date) {
    warnings.push("Data de cadastro oficial não encontrada no Nomus.");
  }

  if (input.isNomusSynced && !input.customer.city?.trim() && !input.customer.state?.trim()) {
    warnings.push("Cidade/UF não informados no cadastro do Nomus.");
  } else if (input.isNomusSynced) {
    if (!input.customer.city?.trim()) {
      warnings.push("Cidade não informada no cadastro do Nomus.");
    }
    if (!input.customer.state?.trim()) {
      warnings.push("UF não informada no cadastro do Nomus.");
    }
  }

  if (input.isNomusSynced && !input.customer.accountOwner?.trim()) {
    warnings.push("Responsável comercial não informado no Nomus.");
  }

  if (!input.isNomusSynced && input.registration.source === "induscost") {
    warnings.push("Cadastro local — dados podem diferir do Nomus.");
  }

  if (input.hasActiveCommercialFilter) {
    warnings.push("Histórico exibido conforme filtros aplicados.");
  }

  if (input.financialLinkedByCnpj) {
    warnings.push("Dados financeiros vinculados por CNPJ.");
  }

  return warnings;
}

function formatDatePtBr(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "Não informado";
  return d.toLocaleDateString("pt-BR");
}
