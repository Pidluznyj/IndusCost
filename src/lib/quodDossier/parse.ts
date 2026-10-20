/**
 * Lê somente campos documentados do Dossiê QUOD Completo.
 * Campo ausente não vira "sem restrição".
 */

export type QuodAddress = {
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export type QuodSections = {
  identification: {
    companyName: string | null;
    tradeName: string | null;
    cnpj: string | null;
    registrationStatus: string | null;
    legalNature: string | null;
    foundedAt: string | null;
    mainCnae: string | null;
    address: QuodAddress | null;
  };
  score: {
    value: number | null;
    scale: null;
    scaleNote: string;
    paymentCapacity: string | null;
    profile: string | null;
    reasons: string[];
    indicators: Array<{ name: string | null; status: string | null; risk: string | null; note: string | null }>;
  };
  restrictions: {
    status: string | null;
    total: number | null;
    present: boolean;
    items: Array<{ kind: string; amount: number | null; date: string | null; source: string | null; situation: string | null }>;
  };
  protests: {
    coverageNote: string;
    groups: Array<{
      situation: string | null;
      totalAmount: number | null;
      note: string | null;
      offices: Array<{ city: string | null; name: string | null; count: number | null; amount: number | null }>;
    }>;
  };
  proceedings: {
    lawsuits: Array<{ number: string | null; type: string | null; status: string | null; amount: number | null; filedAt: string | null; court: string | null; city: string | null }>;
    bankruptcy: Array<{ company: string | null; reason: string | null; amount: number | null; status: string | null; occurredAt: string | null }>;
    bouncedChecks: Array<{ bank: string | null; branch: string | null; lastAt: string | null; count: number | null }>;
  };
  paymentBehavior: {
    present: boolean;
    loanCount: number | null;
    revolvingCount: number | null;
    cardCount: number | null;
    consortiumCount: number | null;
  };
  providerMessage: string | null;
  providerQueryId: string | null;
};

export type ParsedQuodDossier = {
  partial: boolean;
  insufficient: boolean;
  confirmedRestriction: boolean;
  restrictionCount: number | null;
  score: number | null;
  sections: QuodSections;
};

const SCALE_NOTE =
  "O Dossiê QUOD Completo não declara a escala do score no retorno. O número é exibido como veio do provedor e não é convertido para 0–100.";
const PROTEST_NOTE =
  "Os protestos deste dossiê cobrem São Paulo, conforme a documentação Direct Data. Não são uma certidão nacional. Esta consulta não dispara o IEPTB.";

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

function address(value: unknown): QuodAddress | null {
  const row = record(value);
  if (!row) return null;
  return {
    street: text(row.logradouro),
    number: text(row.numero),
    complement: text(row.complemento),
    district: text(row.bairro),
    city: text(row.cidade),
    state: text(row.uf),
    zip: text(row.cep),
  };
}

function maskDocument(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return "documento informado";
  return `•••${digits.slice(-2)}`;
}

export function parseQuodDossier(body: unknown): ParsedQuodDossier {
  const root = record(body);
  const meta = record(root?.metaDados);
  const retorno = record(root?.retorno);
  const legal = record(retorno?.entidadeJuridica);
  const cadastral = record(legal?.dadosCadastrais);
  const scoreBlock = record(record(legal?.scoreEntidades)?.entidadeJuridica);
  const physicalScore = record(record(legal?.scoreEntidades)?.entidadeFisica);
  const pending = record(legal?.pendenciaFinanceira);
  const protests = list(pending?.protestos);
  const lawsuits = list(pending?.acoesJudiciais);
  const bankruptcy = list(pending?.recuperacoesJudiciaisFalencia);
  const checks = list(pending?.chequesSemFundo);
  const indicators = list(scoreBlock?.indicadoresNegocio);
  const payment = record(record(retorno?.entidadeFisica)?.frequenciaPagamentos);

  const protestGroups = protests.map((group) => {
    const offices = list(group.cartorios).map((office) => ({
      city: text(office.cidade),
      name: text(office.nome),
      count: numberOrNull(office.quantidadeProtestos),
      amount: numberOrNull(office.valorProtestado),
    }));
    return {
      situation: text(group.situacao),
      totalAmount: numberOrNull(group.valorTotal),
      note: text(group.observacao),
      offices,
    };
  });

  const restrictionItems = [
    ...protestGroups.flatMap((group) =>
      group.offices.map((office) => ({
        kind: "Protesto (São Paulo)",
        amount: office.amount,
        date: null,
        source: office.name ?? office.city,
        situation: group.situation,
      }))
    ),
    ...lawsuits.map((row) => ({
      kind: "Ação judicial",
      amount: numberOrNull(row.valor),
      date: text(row.dataAjuizamento),
      source: text(row.tipoTribunal) ?? text(row.forum),
      situation: text(row.status),
    })),
    ...bankruptcy.map((row) => ({
      kind: "Recuperação judicial ou falência",
      amount: numberOrNull(row.valor),
      date: text(row.dataOcorrencia),
      source: text(row.nomeEmpresa),
      situation: text(row.status),
    })),
    ...checks.map((row) => ({
      kind: "Cheque sem fundo",
      amount: null,
      date: text(row.dataUltimaOcorrencia),
      source: text(row.nomeAgencia) ?? text(row.codigoBanco),
      situation: null,
    })),
  ];

  const total = numberOrNull(pending?.totalPendencia);
  const listedPositive =
    protestGroups.some((group) => (group.totalAmount ?? 0) > 0 || group.offices.some((office) => (office.count ?? 0) > 0 || (office.amount ?? 0) > 0)) ||
    lawsuits.length > 0 ||
    bankruptcy.length > 0 ||
    checks.some((row) => (numberOrNull(row.quantidadeOcorrencia) ?? 0) > 0 || text(row.codigoBanco) != null);
  const confirmedRestriction = (total != null && total > 0) || listedPositive || protests.length > 0;
  const pendingPresent = pending != null;
  const insufficient = !retorno || !legal || !pendingPresent;
  const partial = insufficient || (root != null && retorno == null);

  const score = numberOrNull(scoreBlock?.score);
  const restrictionCount = total != null ? total : pendingPresent ? restrictionItems.length : null;

  return {
    partial,
    insufficient,
    confirmedRestriction: pendingPresent ? confirmedRestriction : false,
    restrictionCount,
    score,
    sections: {
      identification: {
        companyName: text(cadastral?.razaoSocial),
        tradeName: text(cadastral?.nomeFantasia),
        cnpj: text(retorno?.documentoConsultado) ?? text(cadastral?.cnpj),
        registrationStatus: text(cadastral?.situacaoCadastral),
        legalNature: text(cadastral?.naturezaJuridica),
        foundedAt: text(cadastral?.dataFundacao),
        mainCnae: [text(cadastral?.codigoAtividadePrincipal), text(cadastral?.descricaoAtividadePrincipal)].filter(Boolean).join(" — ") || null,
        address: address(cadastral?.endereco),
      },
      score: {
        value: score,
        scale: null,
        scaleNote: SCALE_NOTE,
        paymentCapacity: text(physicalScore?.capacidadePagamento),
        profile: text(physicalScore?.perfil),
        reasons: Array.isArray(scoreBlock?.motivos) ? scoreBlock.motivos.map(text).filter((item): item is string => item != null) : [],
        indicators: indicators.map((row) => ({
          name: text(row.indicador),
          status: text(row.status),
          risk: text(row.risco),
          note: text(row.observacao),
        })),
      },
      restrictions: {
        status: text(pending?.status),
        total,
        present: pendingPresent,
        items: restrictionItems,
      },
      protests: { coverageNote: PROTEST_NOTE, groups: protestGroups },
      proceedings: {
        lawsuits: lawsuits.map((row) => ({
          number: text(row.numeroProcessoPrincipal),
          type: text(row.tipoProcesso),
          status: text(row.status),
          amount: numberOrNull(row.valor),
          filedAt: text(row.dataAjuizamento),
          court: text(row.tipoTribunal),
          city: text(row.cidade),
        })),
        bankruptcy: bankruptcy.map((row) => ({
          company: text(row.nomeEmpresa),
          reason: text(row.motivo),
          amount: numberOrNull(row.valor),
          status: text(row.status),
          occurredAt: text(row.dataOcorrencia),
        })),
        bouncedChecks: checks.map((row) => ({
          bank: text(row.codigoBanco),
          branch: text(row.numeroAgencia) ?? text(row.nomeAgencia),
          lastAt: text(row.dataUltimaOcorrencia),
          count: numberOrNull(row.quantidadeOcorrencia),
        })),
      },
      paymentBehavior: {
        present: payment != null,
        loanCount: payment ? list(payment.emprestimos).length : null,
        revolvingCount: payment ? list(payment.rotativos).length : null,
        cardCount: payment ? list(payment.cartoesCredito).length : null,
        consortiumCount: payment ? list(payment.consorcios).length : null,
      },
      providerMessage: text(meta?.mensagem),
      providerQueryId: text(meta?.consultaUid),
    },
  };
}

export function quodPartnerPreview(body: unknown): Array<{ name: string | null; role: string | null; share: number | null; document: string | null }> {
  const legal = record(record(record(body)?.retorno)?.entidadeJuridica);
  const board = list(record(legal?.quadroSocietario)?.informacoes);
  return board.map((row) => ({
    name: text(row.entidade) ?? text(row.nomeEmpresa),
    role: text(row.funcaoSocio),
    share: numberOrNull(row.percentualParticipacao),
    document: maskDocument(row.documento),
  }));
}
