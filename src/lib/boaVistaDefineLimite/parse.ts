/**
 * Lê SOMENTE campos documentados no OpenAPI v3 da Direct Data para "BoaVistaDefineLimitePositivoPJ"
 * (schema DefineLimitePositivoRetorno → metaDados + retorno). Todos os campos do `retorno` são strings opcionais.
 *
 * Regras:
 *  - campo ausente vira null / "informação indisponível", nunca zero nem "sem restrição";
 *  - o score é texto sem escala documentada: guarda-se o texto e, quando for inteiro, o número, sem reescalar;
 *  - o limite de crédito só é apresentado quando `restricoes.limiteCredito.valor` existir e for monetário;
 *  - documentos de sócios/administradores são mascarados; nomes ficam (dado cadastral público), e-mail não é lido.
 */
import { BOA_VISTA_DEFINE_LIMITE_PARSER_VERSION, BOA_VISTA_LIMIT_NOTE, BOA_VISTA_SCORE_SCALE_NOTE } from "./config.js";

export type BoaVistaMonthlyPoint = { period: string | null; value: string | null };

export type BoaVistaIndicator = { score: string | null; series: BoaVistaMonthlyPoint[] };

export type BoaVistaOccurrenceGroup = {
  /** Quantidade informada pelo provedor (texto bruto); null = não informado. */
  count: string | null;
  countNumber: number | null;
  totalLabel: string | null;
  totalCents: number | null;
  firstDate: string | null;
  lastDate: string | null;
  /** O nó existia no retorno. false = ausência de informação, NÃO ausência de restrição. */
  present: boolean;
  items: Array<Record<string, string | null>>;
};

export type BoaVistaSections = {
  identification: {
    companyName: string | null;
    previousCompanyName: string | null;
    tradeName: string | null;
    cnpj: string | null;
    registrationStatus: string | null;
    registrationStatusDate: string | null;
    foundedAt: string | null;
    closedAt: string | null;
    legalNature: string | null;
    companySize: string | null;
    capitalLabel: string | null;
    employeesRange: string | null;
    branchesCount: string | null;
    mainActivity: string | null;
    mainCnae: string | null;
    taxOption: string | null;
    city: string | null;
    state: string | null;
  };
  score: {
    raw: string | null;
    value: number | null;
    scale: null;
    scaleNote: string;
    type: string | null;
    model: string | null;
    description: string | null;
    classABC: string | null;
    classNumber: string | null;
    defaultProbability: string | null;
    risk: string | null;
    text: string | null;
    planDescription: string | null;
  };
  decision: { code: string | null; description: string | null; result: string | null };
  limit: {
    available: boolean;
    valueLabel: string | null;
    valueCents: number | null;
    description: string | null;
    text: string | null;
    note: string;
  };
  revenue: {
    range: string | null;
    annualLabel: string | null;
    presumedLabel: string | null;
    presumedCents: number | null;
    referenceDate: string | null;
    message: string | null;
  };
  financialBehavior: {
    present: boolean;
    creditObtained: BoaVistaIndicator | null;
    commitments: BoaVistaIndicator | null;
    punctualPayments: BoaVistaIndicator | null;
    latePayments: Array<{ description: string | null; score: string | null; series: BoaVistaMonthlyPoint[] }>;
    businessEvents: { score: string | null; items: Array<{ indicator: string | null; period: string | null; score: string | null }> } | null;
    supplierRelationship: { score: string | null; items: Array<{ period: string | null; value: string | null }> } | null;
  };
  restrictions: {
    present: boolean;
    financialPending: BoaVistaOccurrenceGroup;
    protests: BoaVistaOccurrenceGroup;
    civilLawsuits: BoaVistaOccurrenceGroup;
    bankruptcyRecovery: BoaVistaOccurrenceGroup;
    bouncedChecksBacen: { present: boolean; count: string | null; countNumber: number | null };
    bouncedChecksRetail: { present: boolean; count: string | null; countNumber: number | null };
    recurrence: { present: boolean; count: string | null; firstAt: string | null; lastAt: string | null };
  };
  governance: {
    present: boolean;
    partnersCount: string | null;
    adminsCount: string | null;
    partners: Array<{ name: string | null; document: string | null; share: string | null; documentStatus: string | null; restrictionsCount: number | null }>;
    admins: Array<{ name: string | null; document: string | null; role: string | null; since: string | null; documentStatus: string | null }>;
  };
  alerts: Array<{ title: string | null; note: string | null; type: string | null }>;
  queryHistory: { present: boolean; count: string | null; from: string | null; to: string | null };
  providerMeta: {
    queryId: string | null;
    queryName: string | null;
    resultId: number | null;
    result: string | null;
    message: string | null;
    queriedAt: string | null;
    receiptUrl: string | null;
    sourceQueryDate: string | null;
  };
  parserVersion: string;
  /** Campos documentados que vieram vazios e importam para a leitura (registrados para o relatório). */
  unavailable: string[];
};

export type ParsedBoaVistaDefineLimite = {
  /** `retorno` ausente ou sem nenhum bloco útil: a consulta não pode ser considerada concluída. */
  insufficient: boolean;
  /** Algum bloco esperado faltou (score, restrições ou cadastro); o resultado é gravado como PARCIAL. */
  partial: boolean;
  score: number | null;
  scoreRaw: string | null;
  scoreClass: string | null;
  riskText: string | null;
  defaultProbability: string | null;
  suggestedLimitCents: number | null;
  suggestedLimitLabel: string | null;
  /** Alguma restrição com quantidade > 0 informada pelo provedor (pendências, protestos, ações, falência/RJ, cheques). */
  confirmedRestriction: boolean;
  restrictionCount: number | null;
  sections: BoaVistaSections;
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function list(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map(record).filter((item): item is Record<string, unknown> => item != null);
}

function intOrNull(value: string | null): number | null {
  if (value == null) return null;
  const digits = value.replace(/\./g, "").trim();
  if (!/^-?\d+$/.test(digits)) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Valores monetários chegam como texto ("R$ 316.700,00", "316700,00", "316700.00", "26003.86"). Devolve centavos
 * só quando o texto é inequivocamente monetário; qualquer outra coisa fica como rótulo bruto, sem número.
 */
export function parseBrlToCents(value: unknown): { label: string | null; cents: number | null } {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { label: value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), cents: Math.round(value * 100) };
  }
  const label = text(value);
  if (!label) return { label: null, cents: null };
  const compact = label.replace(/^R\$\s*/i, "").replace(/\s/g, "");
  let amount: number | null = null;
  if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(compact)) amount = Number(compact.replace(/\./g, "").replace(",", "."));
  else if (/^-?\d+,\d{1,2}$/.test(compact)) amount = Number(compact.replace(",", "."));
  else if (/^-?\d{1,3}(,\d{3})+\.\d{1,2}$/.test(compact)) amount = Number(compact.replace(/,/g, ""));
  else if (/^-?\d+(\.\d{1,2})?$/.test(compact)) amount = Number(compact);
  if (amount == null || !Number.isFinite(amount)) return { label, cents: null };
  return { label, cents: Math.round(amount * 100) };
}

export function maskBoaVistaDocument(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return "documento informado";
  return `•••${digits.slice(-2)}`;
}

function series(value: unknown): BoaVistaMonthlyPoint[] {
  return list(value).map((point) => ({ period: text(point.periodo), value: text(point.pontuacao_Mensal ?? point.pontuacaoMensal) }));
}

function indicator(value: unknown): BoaVistaIndicator | null {
  const row = record(value);
  if (!row) return null;
  return { score: text(row.pontuacao), series: series(row.ocorrencias) };
}

function stringMap(row: Record<string, unknown>, keys: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of keys) out[key] = text(row[key]);
  return out;
}

function group(value: unknown, itemKeys: string[], dates: { first: string[]; last: string[] }): BoaVistaOccurrenceGroup {
  const row = record(value);
  if (!row) return { count: null, countNumber: null, totalLabel: null, totalCents: null, firstDate: null, lastDate: null, present: false, items: [] };
  const count = text(row.quantidade);
  const total = parseBrlToCents(row.valorTotal);
  const pick = (names: string[]) => names.map((name) => text(row[name])).find((item) => item != null) ?? null;
  return {
    count,
    countNumber: intOrNull(count),
    totalLabel: total.label,
    totalCents: total.cents,
    firstDate: pick(dates.first),
    lastDate: pick(dates.last),
    present: true,
    items: list(row.ocorrencias).map((item) => stringMap(item, itemKeys)),
  };
}

function checks(value: unknown): { present: boolean; count: string | null; countNumber: number | null } {
  const row = record(value);
  if (!row) return { present: false, count: null, countNumber: null };
  const count = text(row.quantidade);
  return { present: true, count, countNumber: intOrNull(count) };
}

export function parseBoaVistaDefineLimite(body: unknown): ParsedBoaVistaDefineLimite {
  const root = record(body);
  const meta = record(root?.metaDados);
  const retorno = record(root?.retorno);
  const scoreBlock = record(retorno?.score);
  const decision = record(retorno?.decisoes);
  const indicators = record(retorno?.indicadores);
  const restrictions = record(retorno?.restricoes);
  const limit = record(restrictions?.limiteCredito);
  const revenue = record(restrictions?.faturamentoPresumido);
  const governance = record(retorno?.governancas);
  const history = record(retorno?.historicoConsulta);
  const addresses = list(retorno?.enderecos);
  const unavailable: string[] = [];

  const scoreRaw = text(scoreBlock?.score);
  const scoreValue = intOrNull(scoreRaw);
  const limitValue = parseBrlToCents(limit?.valor);
  const presumed = parseBrlToCents(revenue?.valorPresumido);
  const capital = parseBrlToCents(retorno?.capitalSocial);

  if (!scoreBlock) unavailable.push("score");
  if (!limit || limitValue.label == null) unavailable.push("limiteCredito");
  if (!restrictions) unavailable.push("restricoes");
  if (!indicators) unavailable.push("indicadores");
  if (!governance) unavailable.push("governancas");

  const sections: BoaVistaSections = {
    identification: {
      companyName: text(retorno?.razaoSocial),
      previousCompanyName: text(retorno?.razaoSocialAnterior),
      tradeName: text(retorno?.nomeFantasia),
      cnpj: text(retorno?.cnpj),
      registrationStatus: text(retorno?.situacao),
      registrationStatusDate: text(retorno?.dataSituacao),
      foundedAt: text(retorno?.dataFundacao),
      closedAt: text(retorno?.dataEncerramento),
      legalNature: text(retorno?.naturezaJuridica),
      companySize: text(retorno?.porte),
      capitalLabel: capital.label,
      employeesRange: text(retorno?.faixaFuncionarios),
      branchesCount: text(retorno?.quantidadeFiliais),
      mainActivity: text(retorno?.ramoAtividadePrimario),
      mainCnae: text(retorno?.cnaePrimario),
      taxOption: text(retorno?.opcaoTributaria),
      city: text(addresses[0]?.cidade),
      state: text(addresses[0]?.uf),
    },
    score: {
      raw: scoreRaw,
      value: scoreValue,
      scale: null,
      scaleNote: BOA_VISTA_SCORE_SCALE_NOTE,
      type: text(scoreBlock?.tipoScore),
      model: text(scoreBlock?.modeloScore),
      description: text(scoreBlock?.descrScore),
      classABC: text(scoreBlock?.classificacaoABC),
      classNumber: text(scoreBlock?.classificacaoNumero),
      defaultProbability: text(scoreBlock?.probabilidadeInadimplencia),
      risk: text(scoreBlock?.risco),
      text: text(scoreBlock?.texto),
      planDescription: text(scoreBlock?.descrPlano),
    },
    decision: { code: text(decision?.codigoSituacao), description: text(decision?.descricao), result: text(decision?.resultado) },
    limit: {
      available: limitValue.label != null,
      valueLabel: limitValue.label,
      valueCents: limitValue.cents,
      description: text(limit?.descricao),
      text: text(limit?.texto),
      note: BOA_VISTA_LIMIT_NOTE,
    },
    revenue: {
      range: text(revenue?.faixa),
      annualLabel: text(revenue?.faturamentoAnual),
      presumedLabel: presumed.label,
      presumedCents: presumed.cents,
      referenceDate: text(revenue?.dataReferencia),
      message: text(revenue?.mensagem),
    },
    financialBehavior: {
      present: indicators != null,
      creditObtained: indicator(indicators?.creditoObtido),
      commitments: indicator(indicators?.compromissos),
      punctualPayments: indicator(indicators?.pagamentoPontual),
      latePayments: list(record(indicators?.pagamentoAtrasado)?.ocorrencias).map((row) => ({
        description: text(row.descricao),
        score: text(row.pontuacao),
        series: series(row.itens),
      })),
      businessEvents: indicators?.eventosPessoaJuridica
        ? {
            score: text(record(indicators.eventosPessoaJuridica)?.pontuacao),
            items: list(record(indicators.eventosPessoaJuridica)?.ocorrencias).map((row) => ({ indicator: text(row.indicador), period: text(row.periodo), score: text(row.pontuacao) })),
          }
        : null,
      supplierRelationship: indicators?.periodoRelacionamentoFornecedores
        ? {
            score: text(record(indicators.periodoRelacionamentoFornecedores)?.pontuacao),
            items: list(record(indicators.periodoRelacionamentoFornecedores)?.ocorrencias).map((row) => ({ period: text(row.periodo), value: text(row.valor) })),
          }
        : null,
    },
    restrictions: {
      present: restrictions != null,
      financialPending: group(restrictions?.pendenciasFinanceiras, ["dataVencimento", "dataInclusao", "informante", "credor", "moeda", "valor", "origem", "modalidade", "subjudice", "entidade"], {
        first: ["dataPrimeiro", "periodoInicial"],
        last: ["ultimoVencimento", "periodoFinal"],
      }),
      protests: group(restrictions?.protestos, ["data", "moeda", "valor", "valorCustas", "quantidade", "cartorio", "origem", "credor", "anuencia", "tipoAnotacao", "subjudice", "vencimento"], {
        first: ["dataPrimeiro"],
        last: ["ultimoProtesto", "dataUltimo"],
      }),
      civilLawsuits: group(restrictions?.acoesCiveis, ["acao", "valor", "foro", "vara", "comarca", "autor", "processo", "dataDistribuicao", "origem"], {
        first: ["dataPrimeira"],
        last: ["dataUltimo"],
      }),
      bankruptcyRecovery: group(restrictions?.falenciaRecuperacaoJudicial, ["tipo", "data", "origem", "vara"], {
        first: ["periodoInicial"],
        last: ["periodoFinal"],
      }),
      bouncedChecksBacen: checks(restrictions?.chequesSemFundoBacen),
      bouncedChecksRetail: checks(restrictions?.chequesSemFundoVarejo),
      recurrence: (() => {
        const row = record(restrictions?.contumacia);
        return { present: row != null, count: text(row?.quantidade), firstAt: text(row?.dataPrimeiraOcorrencia), lastAt: text(row?.dataUltimaOcorrencia) };
      })(),
    },
    governance: {
      present: governance != null,
      partnersCount: text(governance?.quantidadeSocios),
      adminsCount: text(governance?.quantidadeAdministradores),
      partners: list(governance?.socios).map((row) => ({
        name: text(row.nome),
        document: maskBoaVistaDocument(row.documento),
        share: text(row.percentualParticipacao),
        documentStatus: text(row.situacaoDocumento),
        restrictionsCount: Array.isArray(row.restricoes) ? row.restricoes.length : null,
      })),
      admins: list(governance?.administradores).map((row) => ({
        name: text(row.nome),
        document: maskBoaVistaDocument(row.documento),
        role: text(row.cargo),
        since: text(row.dataEntrada),
        documentStatus: text(row.situacaoDocumento),
      })),
    },
    alerts: list(retorno?.alertas).map((row) => ({ title: text(row.titulo), note: text(row.observacao), type: text(row.tipo) })),
    queryHistory: { present: history != null, count: text(history?.quantidadeOcorrencias), from: text(history?.dataInicial), to: text(history?.dataFinal) },
    providerMeta: {
      queryId: text(meta?.consultaUid),
      queryName: text(meta?.consultaNome),
      resultId: typeof meta?.resultadoId === "number" ? meta.resultadoId : null,
      result: text(meta?.resultado),
      message: text(meta?.mensagem),
      queriedAt: text(meta?.data),
      receiptUrl: text(meta?.urlComprovante),
      sourceQueryDate: text(retorno?.dataConsulta),
    },
    parserVersion: BOA_VISTA_DEFINE_LIMITE_PARSER_VERSION,
    unavailable,
  };

  const groups = [sections.restrictions.financialPending, sections.restrictions.protests, sections.restrictions.civilLawsuits, sections.restrictions.bankruptcyRecovery];
  const counts = [...groups.map((item) => item.countNumber), sections.restrictions.bouncedChecksBacen.countNumber, sections.restrictions.bouncedChecksRetail.countNumber];
  const known = counts.filter((count): count is number => count != null);
  const restrictionCount = restrictions && known.length > 0 ? known.reduce((sum, count) => sum + count, 0) : null;
  const insufficient = !retorno || (!scoreBlock && !restrictions && !sections.identification.companyName);
  const partial = !insufficient && (!scoreBlock || !restrictions);

  return {
    insufficient,
    partial,
    score: scoreValue,
    scoreRaw,
    scoreClass: sections.score.classABC,
    riskText: sections.score.risk ?? sections.decision.description,
    defaultProbability: sections.score.defaultProbability,
    suggestedLimitCents: limitValue.cents,
    suggestedLimitLabel: limitValue.label,
    confirmedRestriction: known.some((count) => count > 0),
    restrictionCount,
    sections,
  };
}

/** Retorno bruto com documentos de pessoas mascarados e e-mail/telefones removidos (só quando a retenção está ligada). */
export function redactBoaVistaRawPayload(body: unknown): unknown {
  const root = record(body);
  if (!root) return null;
  const retorno = record(root.retorno);
  if (!retorno) return { metaDados: root.metaDados ?? null, retorno: null };
  const governance = record(retorno.governancas);
  const participations = record(retorno.participacoes);
  const maskPeople = (rows: unknown) => list(rows).map((row) => ({ ...row, documento: maskBoaVistaDocument(row.documento), cpfCnpj: maskBoaVistaDocument(row.cpfCnpj) }));
  return {
    metaDados: root.metaDados ?? null,
    retorno: {
      ...retorno,
      email: undefined,
      telefones: undefined,
      governancas: governance ? { ...governance, socios: maskPeople(governance.socios), administradores: maskPeople(governance.administradores) } : undefined,
      participacoes: participations ? { ...participations, participacoesSocioAdmOutrasEmpresas: maskPeople(participations.participacoesSocioAdmOutrasEmpresas) } : undefined,
    },
  };
}
