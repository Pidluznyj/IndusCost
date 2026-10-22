/**
 * Aviso visual de documento comercial para cliente com crédito bloqueado.
 * Não autoriza venda e não relê título: só apresenta a decisão já calculada.
 */
import { classifyCommercialSaleTerms } from "./commercialCreditDecision.js";

export const BLOCKED_DOCUMENT_ROW_LEGEND =
  "Linha vermelha: proposta ou pedido de um cliente com crédito bloqueado. Passe o mouse para ver o motivo.";

const TERMINAL_PROPOSAL = new Set(["REJECTED", "EXPIRED", "CANCELED"]);
const TERMINAL_ORDER = new Set(["CANCELLED", "CANCELED"]);

export type BlockedCustomerDocumentAlert = {
  label: string;
  title: string;
};

function paymentConditionSentence(paymentTerms: string | null | undefined, provided: boolean): string {
  if (!provided) return "Confira se a condição é à vista ou se o documento deve ser interrompido.";
  const kind = classifyCommercialSaleTerms(paymentTerms);
  if (kind === "CASH") return "A condição informada é à vista.";
  if (kind === "ADVANCE") return "A condição informada é antecipada.";
  if (kind === "CREDIT_TERM") return "A condição informada é a prazo.";
  return "A condição de pagamento não ficou clara. Confira antes de deixar seguir.";
}

export function blockedCustomerDocumentAlert(input: {
  customerStatus?: string | null;
  decisionTitle?: string | null;
  reasonLabel?: string | null;
  kind: "proposal" | "sales_order";
  documentStatus?: string | null;
  paymentTerms?: string | null;
  paymentTermsKnown?: boolean;
  hasProposal?: boolean;
}): BlockedCustomerDocumentAlert | null {
  if (input.customerStatus !== "BLOQUEADO" && input.customerStatus !== "BLOQUEIO_CRITICO") return null;
  const status = String(input.documentStatus ?? "").trim().toUpperCase();
  if (input.kind === "proposal" && TERMINAL_PROPOSAL.has(status)) return null;
  if (input.kind === "sales_order" && TERMINAL_ORDER.has(status)) return null;

  const titleBase = input.decisionTitle?.trim() || "CRÉDITO BLOQUEADO";
  const reason = input.reasonLabel?.trim() || "Restrição impeditiva";
  const documentSentence =
    input.kind === "proposal"
      ? "Há uma proposta para este cliente bloqueado."
      : input.hasProposal === false
        ? "Há um pedido de venda sem proposta para este cliente bloqueado."
        : "Há um pedido de venda para este cliente bloqueado.";
  const termsKnown = input.paymentTermsKnown === true || (input.paymentTerms != null && input.paymentTerms.trim() !== "");
  return {
    label:
      input.kind === "sales_order" && input.hasProposal === false
        ? "Crédito bloqueado · sem proposta"
        : "Crédito bloqueado",
    title: `${titleBase}. ${reason}. ${documentSentence} ${paymentConditionSentence(input.paymentTerms, termsKnown)}`,
  };
}
