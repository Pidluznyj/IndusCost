export type CnpjCompareField = {
  field: string;
  label: string;
  kind: string;
  kindLabel: string;
  erpValue: string | null;
  apiValue: string | null;
  status: string;
  suggestedValue: string | null;
  selectable: boolean;
};

export type CnpjPublicContactField = {
  field: "phone" | "email";
  label: string;
  apiValue: string | null;
  erpValue: string | null;
  disclaimer: string;
};

export type CnpjErpCommercialField = {
  field: string;
  label: string;
  erpValue: string | null;
  kindLabel: string;
};

export type CnpjSourceStatusView = {
  source: string;
  displayName: string;
  role: string;
  status: string;
  fetchedAt: string | null;
  fromCache: boolean;
  latencyMs: number | null;
  message: string | null;
};

export type CnpjFieldProvenanceView = {
  field: string;
  label: string;
  chosenValue: string | null;
  chosenSource: string | null;
  values: { source: string; value: string | null }[];
  status: string;
};

export type CnpjEconomicIndicatorView = {
  code: string;
  name: string;
  value: number | null;
  unit: string;
  referenceDate: string | null;
  displayValue: string;
  status: string;
  source: string;
};

export type CnpjEconomicContextView = {
  status: string;
  fetchedAt: string;
  fromCache: boolean;
  sourceLabel: string;
  disclaimer: string;
  indicators: CnpjEconomicIndicatorView[];
};

export type CnpjIntelligencePayload = {
  lookupId: string;
  cnpj: string;
  source: string;
  fetchedAt: string;
  expiresAt: string;
  fromCache: boolean;
  summary: {
    cnpjFormatted: string;
    companyName: string;
    tradeName: string | null;
    registrationStatus: string | null;
    openedAt: string | null;
    companySize: string | null;
    legalNature: string | null;
    shareCapital: number | null;
    mainCnae: { code: string; description: string } | null;
    secondaryCnaes: { code: string; description: string }[];
    address: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    phone: string | null;
    email: string | null;
    stateTaxIds: { number: string; state: string | null; status: string | null }[];
    partners: { name: string; role: string | null }[];
  };
  risk: {
    score: number;
    verdict: string;
    riskLevel: string;
    saleRecommendation: string;
    explanation: string[];
    blockedByRegistration: boolean;
  };
  commercial: {
    insights: { code: string; title: string; description: string }[];
    crossSell: { category: string; suggestions: string[] }[];
    taxAlerts: { code: string; level: string; message: string }[];
    disclaimer: string;
  };
  comparison: {
    fields: CnpjCompareField[];
    publicContacts: CnpjPublicContactField[];
    erpCommercialFields: CnpjErpCommercialField[];
    equalCount: number;
    differentCount: number;
    suggestedUpdates: number;
  } | null;
  erpCommercialData: Record<string, string | null> | null;
  publicContactSuggestion: {
    phone: string | null;
    email: string | null;
    disclaimer: string;
  } | null;
  customerDraft: Record<string, string> | null;
  filledFieldCount: number;
  rawJson: unknown;
  sources?: CnpjSourceStatusView[];
  provenance?: CnpjFieldProvenanceView[];
  conflicts?: CnpjFieldProvenanceView[];
  partialResult?: boolean;
  registryRole?: "primary" | "fallback";
  economicContext?: CnpjEconomicContextView | null;
};

export const CNPJ_COMPARE_STATUS_LABEL: Record<string, string> = {
  EQUAL: "Igual",
  DIFFERENT: "Diferente",
  EMPTY_ERP: "Vazio no ERP",
  EMPTY_API: "Vazio na API",
  SUGGESTED: "Novo dado sugerido",
};

export const CNPJ_PROVIDER_STATUS_LABEL: Record<string, string> = {
  SUCCESS: "OK",
  NOT_FOUND: "Não encontrado",
  RATE_LIMIT: "Limite atingido",
  TIMEOUT: "Tempo esgotado",
  ERROR: "Indisponível",
  INVALID_PAYLOAD: "Resposta inválida",
  SKIPPED_CACHE: "Cache",
  UNAVAILABLE: "Indisponível",
};

export const CNPJ_REGISTRY_COMPARE_LABEL: Record<string, string> = {
  MATCH: "Iguais",
  DIFFERENT: "Divergente",
  MISSING_PRIMARY: "Só na complementar",
  MISSING_SECONDARY: "Só na principal",
  SINGLE_SOURCE: "Uma fonte",
};
