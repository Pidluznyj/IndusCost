/**
 * FASE 2C — quais NFes entram na consulta de Contas a Receber do pedido.
 *
 * Reproduz exatamente o que o audit calcula hoje como
 *
 *     nfeIdsForReceivables = [...nfeMap.keys()].filter((id) => id > 0)
 *
 * (orderFullAuditService.ts). O `nfeMap` é montado em duas etapas — NFes
 * relacionadas primeiro, depois um laço SEQUENCIAL sobre os facts O2C — e a
 * segunda etapa tem um short-circuit que uma simples união de conjuntos NÃO
 * reproduz:
 *
 *   quando o número do fact casa com uma entrada JÁ existente, o
 *   `evidenceNfeId` daquele fact **não** vira chave nova.
 *
 * Ignorar isso adicionaria um `sourceInvoiceId` a mais na consulta de AR, e com
 * ele CRs que o audit não enxerga — cobertura maior, residual menor. Move
 * dinheiro. Por isso esta função replica o laço, e não o resumo dele.
 *
 * Os surrogates negativos (fact só com número, sem NFe identificada) são
 * criados durante o processamento porque um fact POSTERIOR pode casar por
 * número com eles — mas nunca aparecem no retorno, exatamente como o
 * `.filter(id > 0)` legado sempre descartou.
 *
 * Sem Prisma. Sem I/O.
 */

/** NFe já resolvida para o pedido; `numero` = `related.nfeNumber ?? link.nfeNumber`. */
export type ReceivableNfeRelatedInput = {
  nfeExternalId: number;
  numero: string | null;
};

/** Fact O2C na ORDEM original — a sequência importa. */
export type ReceivableNfeFactInput = {
  nfeNumber: string | null;
  nfeHeaderValue: number | null;
  /** `o2cEvidence.nfeExternalId` */
  nfeExternalId: number | null;
  /** `o2cEvidence.stockDocumentIdNfe` — fallback quando não há `nfeExternalId`. */
  stockDocumentIdNfe: number | null;
};

export type CollectOrderReceivableNfeIdsInput = {
  relatedNfes: ReadonlyArray<ReceivableNfeRelatedInput>;
  facts: ReadonlyArray<ReceivableNfeFactInput>;
};

type NfeEntry = { nfeExternalId: number; numero: string | null };

/**
 * IDs positivos de NFe que devem alimentar a consulta de AR do pedido,
 * na mesma ordem que o `nfeMap` legado produziria.
 */
export function collectOrderReceivableNfeIds(
  input: CollectOrderReceivableNfeIdsInput
): number[] {
  const nfeMap = new Map<number, NfeEntry>();

  // Etapa 1 — NFes relacionadas (mesmos guards do audit).
  for (const related of input.relatedNfes) {
    if (related.nfeExternalId <= 0) continue;
    if (nfeMap.has(related.nfeExternalId)) continue;
    nfeMap.set(related.nfeExternalId, {
      nfeExternalId: related.nfeExternalId,
      numero: related.numero,
    });
  }

  // Índice número → id das relacionadas (primeira ocorrência vence).
  // Atenção: o audit monta este índice sobre TODAS as relacionadas, inclusive
  // as de id não-positivo, que não viraram entrada. Nesse caso o `get` abaixo
  // devolve undefined e a busca cai na varredura por `numero`.
  const relatedByNumber = new Map<string, number>();
  for (const related of input.relatedNfes) {
    const num = related.numero?.trim();
    if (num && !relatedByNumber.has(num)) {
      relatedByNumber.set(num, related.nfeExternalId);
    }
  }

  // Etapa 2 — facts, na ordem.
  for (const fact of input.facts) {
    const nfeNumber = fact.nfeNumber?.trim();
    const evidenceNfeId =
      fact.nfeExternalId != null && fact.nfeExternalId > 0
        ? fact.nfeExternalId
        : fact.stockDocumentIdNfe != null && fact.stockDocumentIdNfe > 0
          ? fact.stockDocumentIdNfe
          : null;

    if (!nfeNumber && fact.nfeHeaderValue == null && evidenceNfeId == null) {
      continue;
    }

    let entry: NfeEntry | undefined =
      evidenceNfeId != null ? nfeMap.get(evidenceNfeId) : undefined;

    if (!entry && nfeNumber) {
      const knownId = relatedByNumber.get(nfeNumber);
      if (knownId != null) entry = nfeMap.get(knownId);
      if (!entry) {
        for (const candidate of nfeMap.values()) {
          if (candidate.numero?.trim() === nfeNumber) {
            entry = candidate;
            break;
          }
        }
      }
    }

    // TRAVA: se casou por número, `evidenceNfeId` NÃO entra como chave nova.
    if (!entry && evidenceNfeId != null) {
      entry = { nfeExternalId: evidenceNfeId, numero: nfeNumber ?? null };
      nfeMap.set(evidenceNfeId, entry);
    }

    if (!entry && nfeNumber) {
      // Placeholder do legado: depende do tamanho corrente do Map.
      const surrogate = -(nfeMap.size + 1);
      nfeMap.set(surrogate, { nfeExternalId: surrogate, numero: nfeNumber });
    }
  }

  return [...nfeMap.keys()].filter((id) => id > 0);
}
