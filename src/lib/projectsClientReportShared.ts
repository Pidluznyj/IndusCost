/** Tipos client-safe — relatório comercial para cliente (sem custos internos). */

export const PROJECT_CLIENT_REPORT_TITLE = "Proposta Comercial — Relatório Geral do Cliente";
export const PROJECT_CLIENT_REPORT_BUTTON_LABEL = "Proposta Cliente";
export const PROJECT_CLIENT_REPORT_ROUTE_SUFFIX = "client-report";
export const PROJECT_CLIENT_REPORT_VERSION = "1.0";
export const PROJECT_CLIENT_REPORT_ISSUER_NAME = "IndusCost";
export const PROJECT_CLIENT_REPORT_NOT_INFORMED = "Não informado";

export const PROJECT_CLIENT_REPORT_DISCLAIMER =
  "Os valores apresentados correspondem ao preço comercial final dos produtos/conjunto, conforme premissas do projeto na data de emissão deste relatório. Este relatório não apresenta abertura de custos internos, composição de margem ou memória de cálculo.";

export const PROJECT_CLIENT_REPORT_EXECUTIVE_SUMMARY =
  "Este relatório apresenta os produtos desenvolvidos para o projeto, com seus respectivos preços comerciais finais e o valor total estimado do conjunto.";

export type ProjectClientReportProduct = {
  id: string;
  sku: string | null;
  name: string;
  description: string;
  quantityPerSet: number;
  unit: string;
  finalUnitPrice: number | null;
  finalTotalPrice: number | null;
  notes: string | null;
};

export type ProjectClientReportCommercialTerms = {
  paymentTerms: string | null;
  deliveryTerms: string | null;
  proposalValidity: string | null;
  freightTerms: string | null;
  notes: string | null;
  exclusivity: string | null;
};

export type ProjectClientReportPayload = {
  generatedAt: string;
  reportVersion: string;
  title: string;
  disclaimer: string;
  executiveSummary: string;
  project: {
    id: string;
    code: string;
    name: string;
    customerName: string;
    commercialResponsibleName: string | null;
    issuedAt: string;
    validUntil: string | null;
    issuerName: string;
  };
  products: ProjectClientReportProduct[];
  summary: {
    productsCount: number;
    finalSetPrice: number | null;
    finalSetPriceLabel: string;
    estimatedQuantity: number | null;
    totalProposalValue: number | null;
    currency: "BRL";
    pricingPending: boolean;
  };
  commercialTerms: ProjectClientReportCommercialTerms;
};
