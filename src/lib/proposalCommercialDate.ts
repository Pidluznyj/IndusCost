/**
 * Data COMERCIAL da proposta — regra única (browser + server safe).
 *
 * `createdAt` é auditoria de criação no IndusCost: para proposta importada, é
 * o instante em que o sync rodou, não quando a proposta foi aberta no Nomus.
 * A CP 01350 foi aberta em 03/08/2026 e importada em 04/08/2026; a tela
 * mostrava 04/08 porque lia `createdAt`.
 *
 * REGRA
 *   proposta com origem Nomus  → `externalOpenedAt` (data oficial da origem)
 *   proposta criada no IndusCost → `createdAt` (ela nasceu aqui)
 *
 * FALLBACK (documentado de propósito)
 * Proposta Nomus SEM `externalOpenedAt` cai em `createdAt` — não há outra data
 * disponível, e esconder a linha seria pior que mostrar uma data aproximada.
 * O caso é sinalizado por {@link isProposalCommercialDateFallback} para a tela
 * poder marcar visualmente e para a reconciliação poder listar os afetados.
 * Esse fallback NÃO deve ser usado como se fosse a data oficial em relatório
 * comercial sem a marcação.
 */

export type ProposalCommercialDateInput = {
  createdAt: Date | string | null | undefined;
  externalOpenedAt?: Date | string | null;
  sourceSystem?: string | null;
};

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A proposta veio de sistema externo (hoje: Nomus)? */
export function isExternalSourcedProposal(
  sourceSystem: string | null | undefined
): boolean {
  return typeof sourceSystem === "string" && sourceSystem.trim() !== "";
}

/**
 * Data que representa a proposta comercialmente.
 * `null` só quando não há nenhuma data utilizável.
 */
export function resolveProposalCommercialDate(
  proposal: ProposalCommercialDateInput
): Date | null {
  if (isExternalSourcedProposal(proposal.sourceSystem)) {
    const opened = toValidDate(proposal.externalOpenedAt);
    if (opened) return opened;
  }
  return toValidDate(proposal.createdAt);
}

/**
 * A data exibida é fallback (proposta externa sem data de origem)?
 * Serve para marcar na tela e para a reconciliação encontrar os casos.
 */
export function isProposalCommercialDateFallback(
  proposal: ProposalCommercialDateInput
): boolean {
  if (!isExternalSourcedProposal(proposal.sourceSystem)) return false;
  return toValidDate(proposal.externalOpenedAt) == null;
}

/** Formata a data comercial em pt-BR; `—` quando não há data. */
export function formatProposalCommercialDate(
  proposal: ProposalCommercialDateInput
): string {
  const date = resolveProposalCommercialDate(proposal);
  if (!date) return "—";
  return date.toLocaleDateString("pt-BR");
}
