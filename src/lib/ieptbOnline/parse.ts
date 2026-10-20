/**
 * Lê somente campos documentados do Protestos Nacional IEPTB Online.
 * Campo ausente não vira "sem protesto". Valor monetário chega como string no catálogo.
 */

import { IEPTB_COVERAGE_NOTE, IEPTB_EMPTY_NOTE } from "./config.js";

export type IeptbTitle = {
  protestedAt: string | null;
  amountLabel: string | null;
  amount: number | null;
  document: string | null;
};

export type IeptbOffice = {
  cityCode: string | null;
  city: string | null;
  protestCount: number | null;
  totalAmountLabel: string | null;
  totalAmount: number | null;
  titles: IeptbTitle[];
};

export type IeptbStateGroup = {
  state: string | null;
  protestCount: number | null;
  totalAmountLabel: string | null;
  totalAmount: number | null;
  offices: IeptbOffice[];
};

export type IeptbSections = {
  coverageNote: string;
  document: string | null;
  hasProtests: boolean | null;
  protestCount: number | null;
  totalAmountLabel: string | null;
  totalAmount: number | null;
  notes: string | null;
  states: IeptbStateGroup[];
  async: boolean;
  consultedAtLabel: string | null;
  providerQueryId: string | null;
  providerMessage: string | null;
};

export type ParsedIeptbOnline = {
  partial: boolean;
  insufficient: boolean;
  confirmedProtest: boolean;
  confirmedClear: boolean;
  protestCount: number | null;
  totalAmount: number | null;
  states: string[];
  sections: IeptbSections;
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function list(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map(record).filter((item): item is Record<string, unknown> => item != null);
}

/** Aceita número ou string do catálogo ("1234,56" / "1.234,56") sem inventar escala. */
export function parseIeptbMoney(value: unknown): { label: string | null; amount: number | null } {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { label: value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), amount: value };
  }
  const label = text(value);
  if (!label) return { label: null, amount: null };
  const compact = label.replace(/\s/g, "");
  let amount: number | null = null;
  if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(compact)) {
    amount = Number(compact.replace(/\./g, "").replace(",", "."));
  } else if (/^-?\d+,\d{1,2}$/.test(compact)) {
    amount = Number(compact.replace(",", "."));
  } else if (/^-?\d+(\.\d+)?$/.test(compact)) {
    amount = Number(compact);
  }
  return { label, amount: amount != null && Number.isFinite(amount) ? amount : null };
}

export function parseIeptbOnline(body: unknown): ParsedIeptbOnline {
  const root = record(body);
  const meta = record(root?.metaDados);
  const retorno = record(root?.retorno);
  const asyncFlag = meta?.assincrono === true;
  const groups = list(retorno?.protestos).map((group) => {
    const stateTotal = parseIeptbMoney(group.valorTotalProtestosEstado);
    return {
      state: text(group.estado),
      protestCount: numberOrNull(group.numeroTotalProtestosUF),
      totalAmountLabel: stateTotal.label,
      totalAmount: stateTotal.amount,
      offices: list(group.cartorios).map((office) => {
        const officeTotal = parseIeptbMoney(office.valorTotalProtestosCartorio);
        return {
          cityCode: text(office.codigoCidade),
          city: text(office.cidade),
          protestCount: numberOrNull(office.numeroProtestos),
          totalAmountLabel: officeTotal.label,
          totalAmount: officeTotal.amount,
          titles: list(office.titulos).map((title) => {
            const money = parseIeptbMoney(title.valorProtestado);
            return {
              protestedAt: text(title.dataProtesto),
              amountLabel: money.label,
              amount: money.amount,
              document: text(title.documento),
            };
          }),
        };
      }),
    };
  });
  const total = parseIeptbMoney(retorno?.valorTotalProtestos);
  const hasProtests = typeof retorno?.constamProtestos === "boolean" ? retorno.constamProtestos : null;
  const protestCount = numberOrNull(retorno?.numeroTotalProtestos);
  const pendingPresent = retorno != null;
  const insufficient = !retorno || asyncFlag && retorno == null;
  const partial = insufficient || (root != null && retorno == null) || asyncFlag && hasProtests == null;
  const listedPositive =
    groups.some(
      (group) =>
        (group.protestCount ?? 0) > 0 ||
        (group.totalAmount ?? 0) > 0 ||
        group.offices.some((office) => (office.protestCount ?? 0) > 0 || office.titles.length > 0)
    ) || (protestCount ?? 0) > 0;
  const confirmedProtest = pendingPresent && (hasProtests === true || listedPositive);
  const confirmedClear = pendingPresent && hasProtests === false && !listedPositive && !asyncFlag;

  return {
    partial,
    insufficient,
    confirmedProtest,
    confirmedClear,
    protestCount,
    totalAmount: total.amount,
    states: [...new Set(groups.map((group) => group.state).filter((item): item is string => item != null))],
    sections: {
      coverageNote: IEPTB_COVERAGE_NOTE,
      document: text(retorno?.documentoConsultado),
      hasProtests,
      protestCount,
      totalAmountLabel: total.label,
      totalAmount: total.amount,
      notes: text(retorno?.observacoes),
      states: groups,
      async: asyncFlag,
      consultedAtLabel: text(meta?.data),
      providerQueryId: text(meta?.consultaUid),
      providerMessage: text(meta?.mensagem),
    },
  };
}

export function ieptbEmptyLabel(parsed: ParsedIeptbOnline): string | null {
  return parsed.confirmedClear ? IEPTB_EMPTY_NOTE : null;
}

export type ProtestOverlapHint = {
  source: "QUOD" | "IEPTB";
  city: string | null;
  amount: number | null;
  date: string | null;
  possibleMatch: boolean;
};

/** Não soma fontes. Só marca possível correspondência quando cidade+valor coincidem. */
export function hintProtestOverlap(input: {
  quodCities: Array<{ city: string | null; amount: number | null }>;
  ieptbTitles: Array<{ city: string | null; amount: number | null; date: string | null }>;
}): ProtestOverlapHint[] {
  const hints: ProtestOverlapHint[] = [];
  for (const title of input.ieptbTitles) {
    const possibleMatch =
      title.city != null &&
      title.amount != null &&
      input.quodCities.some(
        (row) =>
          row.city != null &&
          row.amount != null &&
          row.city.trim().toLocaleLowerCase("pt-BR") === title.city.trim().toLocaleLowerCase("pt-BR") &&
          Math.abs(row.amount - title.amount) < 0.009
      );
    hints.push({ source: "IEPTB", city: title.city, amount: title.amount, date: title.date, possibleMatch });
  }
  return hints;
}
