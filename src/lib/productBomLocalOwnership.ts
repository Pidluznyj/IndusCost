/**
 * Ownership de ProductBOM em reescritas locais (editor de composição e import
 * Excel fazem deleteMany + create).
 *
 * Regra do contrato Nomus → IndusCost:
 * - Linha que JÁ existia mantém seus campos de ownership (sourceSystem,
 *   isNomusControlled, localException, lastNomusSyncAt, nomusComponentCode) —
 *   reescrever a estrutura não pode apagar a marca de linha Nomus nem a de
 *   exceção local (senão o próximo sync Nomus removeria Furação/Montagem).
 * - Linha NOVA criada localmente em produto Nomus-controlled nasce como
 *   exceção local formal: localException=true, sourceSystem="INDUSCOST".
 * - Linha nova em produto local nasce sourceSystem="INDUSCOST" sem exceção
 *   (produto local nunca é alvo de reconciliação Nomus).
 *
 * Puro (sem Prisma) para ser testável; o matching é por vínculo
 * (materialId/childProductId), consumindo duplicatas em ordem (FIFO).
 */

export type PreviousBomLineOwnership = {
  materialId: string | null;
  childProductId: string | null;
  sourceSystem: string | null;
  isNomusControlled: boolean;
  localException: boolean;
  lastNomusSyncAt: Date | null;
  nomusComponentCode: string | null;
};

export type BomOwnershipFields = {
  sourceSystem: string | null;
  isNomusControlled: boolean;
  localException: boolean;
  lastNomusSyncAt: Date | null;
  nomusComponentCode: string | null;
};

function linkKey(line: { materialId?: string | null; childProductId?: string | null }): string {
  if (line.materialId) return `mat:${line.materialId}`;
  if (line.childProductId) return `child:${line.childProductId}`;
  return "none";
}

export type BomOwnershipResolver = {
  /** Ownership para a linha reescrita; consome a linha anterior correspondente. */
  resolve: (line: { materialId?: string | null; childProductId?: string | null }) => BomOwnershipFields;
};

export function createBomOwnershipResolver(input: {
  previousLines: PreviousBomLineOwnership[];
  parentIsNomusControlled: boolean;
}): BomOwnershipResolver {
  const queues = new Map<string, PreviousBomLineOwnership[]>();
  for (const prev of input.previousLines) {
    const key = linkKey(prev);
    const queue = queues.get(key) ?? [];
    queue.push(prev);
    queues.set(key, queue);
  }

  return {
    resolve(line) {
      const key = linkKey(line);
      const queue = queues.get(key);
      const prev = queue?.shift();
      if (prev) {
        return {
          sourceSystem: prev.sourceSystem,
          isNomusControlled: prev.isNomusControlled,
          localException: prev.localException,
          lastNomusSyncAt: prev.lastNomusSyncAt,
          nomusComponentCode: prev.nomusComponentCode,
        };
      }
      return {
        sourceSystem: "INDUSCOST",
        isNomusControlled: false,
        localException: input.parentIsNomusControlled,
        lastNomusSyncAt: null,
        nomusComponentCode: null,
      };
    },
  };
}

export function isParentNomusControlled(parent: {
  isNomusControlled?: boolean | null;
  sourceSystem?: string | null;
}): boolean {
  return Boolean(parent.isNomusControlled) || parent.sourceSystem === "NOMUS";
}
