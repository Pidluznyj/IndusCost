/**
 * Retorno SINTÉTICO no formato do OpenAPI v3 (DefineLimitePositivoRetorno) para o modo de demonstração e para os
 * testes. Nenhum dado real: razão social, valores e datas são fictícios e o `consultaUid` começa com "demo-".
 * Nunca é enviado a lugar nenhum; nunca é cobrado; nunca é gravado como consulta real (mode = DEMO).
 */
import { randomUUID } from "node:crypto";

export const DEMO_COMPANY_NAME = "EMPRESA DEMONSTRACAO LTDA (SIMULADO)";

export function buildBoaVistaDemoResponse(input: { cnpj: string; companyName?: string; now?: Date; variant?: "restricted" | "clear" | "partial" }): unknown {
  const now = input.now ?? new Date();
  const stamp = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00`;
  const variant = input.variant ?? "restricted";
  const metaDados = {
    consultaNome: "Boa Vista - Define Limite Positivo Pessoa Jurídica",
    consultaUid: `demo-${randomUUID()}`,
    chave: `CNPJ=${input.cnpj};`,
    usuario: "simulacao@induscost.local",
    mensagem: "Resultado SIMULADO para demonstração. Nenhuma consulta foi feita ao provedor.",
    resultadoId: 1,
    resultado: "Sucesso",
    apiVersao: "v3",
    enviarCallback: false,
    gerarComprovante: false,
    urlComprovante: null,
    assincrono: false,
    data: stamp,
    tempoExecucaoMs: 1,
  };
  if (variant === "partial") {
    return { metaDados, retorno: { cnpj: input.cnpj, razaoSocial: input.companyName ?? DEMO_COMPANY_NAME, situacao: "ATIVO" } };
  }
  const restricted = variant === "restricted";
  const months = ["OUT/2025", "NOV/2025", "DEZ/2025", "JAN/2026", "FEV/2026", "MAR/2026", "ABR/2026", "MAI/2026", "JUN/2026", "JUL/2026", "AGO/2026", "SET/2026"];
  const serie = (values: Array<number | string>) => months.map((periodo, index) => ({ periodo, pontuacao_Mensal: String(values[index] ?? "0") }));
  return {
    metaDados,
    retorno: {
      cnpj: input.cnpj,
      razaoSocial: input.companyName ?? DEMO_COMPANY_NAME,
      razaoSocialAnterior: null,
      nomeFantasia: "DEMONSTRACAO",
      situacao: "ATIVO",
      situacaoSintegra: null,
      dataSituacao: "01/01/2020",
      dataConsulta: stamp,
      dataFundacao: "13/04/1976",
      dataEncerramento: null,
      naturezaJuridica: "SOCIEDADE EMPRESARIA LIMITADA",
      faixaFuncionarios: "DE 50 A 99",
      quantidadeFiliais: "5",
      capitalSocial: "900000,00",
      porte: "MEDIA EMPRESA",
      opcaoTributaria: "LUCRO PRESUMIDO",
      ramoAtividadePrimario: "FABRICACAO DE TINTAS",
      cnaePrimario: "2071-1/00",
      enderecos: [{ logradouro: "RUA EXEMPLO", numero: "100", complemento: null, bairro: "CENTRO", cidade: "SAO PAULO", uf: "SP", cep: "01000-000" }],
      decisoes: { codigoSituacao: restricted ? "2" : "1", descricao: restricted ? "NEGOCIACAO COM CAUTELA" : "NEGOCIACAO NORMAL", resultado: restricted ? "RECOMENDACAO DE ANALISE CAUTELOSA" : "RECOMENDACAO DE NEGOCIACAO", layout: "DL" },
      score: {
        layout: "DL",
        tipoScore: "SCORE PJ",
        score: restricted ? "593" : "812",
        execucao: "OK",
        descrPlano: "DEFINE LIMITE POSITIVO PJ",
        descrScore: "SCORE DE RISCO DE CREDITO 12 MESES",
        classificacaoABC: restricted ? "B" : "A",
        classificacaoNumero: restricted ? "5" : "2",
        probabilidadeInadimplencia: restricted ? "13,0" : "2,1",
        texto: "PROBABILIDADE DE INADIMPLENCIA EM 12 MESES",
        risco: restricted ? "NEGOCIACAO COM CAUTELA" : "RISCO BAIXO",
        modeloScore: "MODELO DEMONSTRACAO",
        informante: "BOA VISTA",
      },
      indicadores: {
        creditoObtido: { pontuacao: "26044", ocorrencias: serie([2601, 3114, 2725, 2600, 2645, 3033, 2856, 2921, 1548, 1629, 237, 135]) },
        compromissos: { pontuacao: "0,9", ocorrencias: serie(["0.1", "0.1", "0.1", "0.1", "0.1", "0.1", "0", "0.1", "0.1", "0.1", "0", "0"]) },
        pagamentoPontual: { pontuacao: "100", ocorrencias: serie([100, 100, 100, 100, 100, 99, 100, 100, 100, 100, 100, 100]) },
        pagamentoAtrasado: { ocorrencias: [{ descricao: "6 A 15 DIAS", pontuacao: "0", itens: serie(Array(12).fill(0)) }] },
        eventosPessoaJuridica: { pontuacao: "0", ocorrencias: [] },
        periodoRelacionamentoFornecedores: { pontuacao: "48", ocorrencias: [{ periodo: "ACIMA DE 36 MESES", valor: "48" }] },
      },
      restricoes: {
        pendenciasFinanceiras: restricted
          ? { quantidade: "1", valorTotal: "26003,86", periodoInicial: "05/2023", periodoFinal: "05/2023", ultimoVencimento: "22/05/2023", dataPrimeiro: "22/05/2023", dataMaior: "22/05/2023", totalCredores: "1", valorMaior: "26003,86", valorPrimeiro: "26003,86", provedores: ["SCPC"], ocorrencias: [{ dataVencimento: "22/05/2023", dataInclusao: "30/06/2023", informante: "SCPC SAO PAULO/SP", tipoDevedor: "DEVEDOR", credor: "CREDOR SIMULADO", moeda: "R$", valor: "26003,86", contrato: "SIM-1", origem: "SAO PAULO/SP", subjudice: "NAO", modalidade: "DUPLICATA", entidade: "SCPC" }] }
          : { quantidade: "0", valorTotal: "0,00", ocorrencias: [] },
        protestos: restricted
          ? { quantidade: "6", valorTotal: "51481,31", ultimoProtesto: "16/10/2026", dataPrimeiro: "24/04/2026", dataUltimo: "16/10/2026", dataMaior: "16/10/2026", valorPrimeiro: "4528,80", valorUltimo: "14986,86", valorMaior: "14986,86", ocorrencias: [{ data: "16/10/2026", moeda: "R$", valor: "14986,86", valorCustas: null, quantidade: "1", cartorio: "1 TABELIAO", origem: "ARACATUBA/SP", credor: "CREDOR SIMULADO", anuencia: "NAO", tipoAnotacao: "PROTESTO", subjudice: "NAO", vencimento: "01/10/2026" }] }
          : { quantidade: "0", valorTotal: "0,00", ocorrencias: [] },
        chequesSemFundoBacen: { quantidade: "0", correntista: null, tipoPessoa: "J", documento: null },
        chequesSemFundoVarejo: { quantidade: "0", correntista: null, tipoPessoa: "J", documento: null },
        contumacia: { quantidade: "0", dataPrimeiraOcorrencia: null, dataUltimaOcorrencia: null },
        acoesCiveis: restricted
          ? { quantidade: "3", valorTotal: "280666,76", valorPrimeiro: "0,00", valorUltimo: "0,00", valorMaior: "280666,76", valorMenor: "0,00", dataPrimeira: "28/04/2022", dataUltimo: "06/08/2026", dataMaior: "29/01/2025", dataMenor: "28/04/2022", ocorrencias: [{ requerido: "EMPRESA DEMONSTRACAO", valor: "280666,76", acao: "ACAO EXECUTIVA FEDERAL", documento: null, foro: "FEDERAL", origem: "SAO JOSE DO RIO PRETO/SP", vara: "1", comarca: "SAO JOSE DO RIO PRETO", autor: "AUTOR SIMULADO", processo: "0000000-00.2025.4.03.0000", dataDistribuicao: "29/01/2025" }] }
          : { quantidade: "0", valorTotal: "0,00", ocorrencias: [] },
        falenciaRecuperacaoJudicial: { quantidade: "0", periodoInicial: null, periodoFinal: null, ocorrencias: [] },
        limiteCredito: { descricao: "LIMITE DE CREDITO SUGERIDO", valor: restricted ? "316700,00" : "850000,00", texto: "VALOR SUGERIDO PELO MODELO DEFINE LIMITE" },
        faturamentoPresumido: { faixa: "ACIMA DE R$ 9.100.000", faturamentoAnual: "ACIMA DE R$ 9.100.000", mensagem: null, dataReferencia: "12/2025", valorPresumido: "9100000,00", dadosCadastroPositivo: "SIM" },
      },
      governancas: {
        quantidadeAdministradores: "0",
        administradores: [],
        quantidadeSocios: "2",
        socios: [
          { nome: "SOCIO SIMULADO UM", documento: "00000000191", percentualParticipacao: "60", tipoDocumento: "CPF", situacaoDocumento: "REGULAR", restricoes: [] },
          { nome: "SOCIO SIMULADO DOIS", documento: "00000000272", percentualParticipacao: "40", tipoDocumento: "CPF", situacaoDocumento: "REGULAR", restricoes: [] },
        ],
      },
      alertas: restricted ? [{ titulo: "RESTRICOES RELEVANTES", observacao: "Há protestos e ações cíveis no dossiê simulado.", tipo: "ALERTA" }] : [],
      historicoConsulta: { quantidadeOcorrencias: "174", dataInicial: "10/2025", dataFinal: "10/2026", detalhes: [] },
      participacoes: { quantidadeParticipacoesSocioAdm: "0", participacoesSocioAdmOutrasEmpresas: [], quantidadeParticipacoesConsultada: "0", participacoesEmpresasConsultadas: [] },
    },
  };
}
