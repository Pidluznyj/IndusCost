/**
 * Query helpers da listagem de Propostas (browser + server safe).
 */
import { parseMoneyAmountInput } from "./moneyRangeFilter.js";

/**
 * Coluna de data COMERCIAL usada em filtro, ordenação e contagem.
 *
 * É uma coluna GERADA no Postgres (migration
 * 20260804120000_proposal_commercial_date) com a mesma regra do domínio
 * (`resolveProposalCommercialDate`): `externalOpenedAt` quando a proposta tem
 * origem externa, senão `createdAt`.
 *
 * `createdAt` continua existindo, mas é AUDITORIA da importação — para
 * proposta do Nomus é o instante em que o sync rodou, não a data de abertura.
 * Usá-lo como data comercial fazia a CP 01350 (aberta 03/08, importada 04/08)
 * aparecer, ordenar e ser contada como 04/08.
 */
export const PROPOSAL_COMMERCIAL_DATE_FIELD = "commercialDate" as const;

/** Fragmento `where` para o recorte por período na data comercial. */
export function buildProposalListCommercialDateWhere(
  startDate: Date | null,
  endDate: Date | null
):
  | { commercialDate: { gte?: Date; lte?: Date } }
  | Record<string, never> {
  if (!startDate && !endDate) return {};
  return {
    commercialDate: {
      ...(startDate ? { gte: startDate } : {}),
      ...(endDate ? { lte: endDate } : {}),
    },
  };
}

/**
 * Ordenação padrão da listagem: data comercial desc, número desc como
 * desempate estável.
 *
 * O desempate por `number` não é cosmético: sem chave única na ordenação, duas
 * propostas com a mesma data podem trocar de posição entre páginas e o mesmo
 * registro aparecer duas vezes (ou sumir) na paginação.
 */
export function buildProposalListOrderBy(): Array<
  Record<string, "asc" | "desc">
> {
  return [{ commercialDate: "desc" }, { number: "desc" }];
}

/** Aceita número livre (inclui milhar/decimal BR). Negativo/inválido → null. */
export function parseProposalListNetValueParam(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  }
  const parsed = parseMoneyAmountInput(String(raw));
  if (parsed == null || !Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

/** Fragmento Prisma `where` para De/Até em `Proposal.totalNetValue`. */
export function buildProposalListNetValueWhere(
  minNetValue: number | null,
  maxNetValue: number | null
): { totalNetValue: { gte?: number; lte?: number } } | Record<string, never> {
  const min =
    minNetValue != null && Number.isFinite(minNetValue) ? minNetValue : null;
  const max =
    maxNetValue != null && Number.isFinite(maxNetValue) ? maxNetValue : null;
  if (min == null && max == null) return {};
  return {
    totalNetValue: {
      ...(min != null ? { gte: min } : {}),
      ...(max != null ? { lte: max } : {}),
    },
  };
}
