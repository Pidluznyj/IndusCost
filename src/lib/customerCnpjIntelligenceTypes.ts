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
};

export const CNPJ_COMPARE_STATUS_LABEL: Record<string, string> = {
  EQUAL: "Igual",
  DIFFERENT: "Diferente",
  EMPTY_ERP: "Vazio no ERP",
  EMPTY_API: "Vazio na API",
  SUGGESTED: "Novo dado sugerido",
};
