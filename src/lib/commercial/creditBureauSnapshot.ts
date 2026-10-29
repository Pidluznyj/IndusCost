/**
 * Resumo das consultas externas de crédito de um cliente (Boa Vista via LIKE SERASA, QUOD, IEPTB), compartilhado pelo
 * painel de crédito da Ficha CNPJ e pelo relatório impresso — os dois mostram exatamente os mesmos números.
 */
export type BureauSnapshot = {
  boaVista: {
    state: string;
    stateLabel: string;
    simulated: boolean;
    score: number | null;
    scoreRaw: string | null;
    scoreClass: string | null;
    defaultProbability: string | null;
    suggestedLimitCents: number | null;
    consultedAt: string | null;
  } | null;
  quod: { state: string; score: number | null; consultedAt: string | null } | null;
  ieptb: { state: string; label: string; count: number | null; totalAmount: number | null; consultedAt: string | null } | null;
};

export const EMPTY_BUREAU_SNAPSHOT: BureauSnapshot = { boaVista: null, quod: null, ieptb: null };
