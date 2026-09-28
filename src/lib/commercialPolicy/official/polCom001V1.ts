/**
 * Pacote publicável da POL-COM-001 versão 1.0.
 * O texto normativo vem do documento oficial. Perguntas e declarações
 * apontam para esse texto e não criam regra comercial nova.
 */
import { hashPolicyContent, type PolicyQuestion, type PolicyVersionBody } from "../commercialPolicyRules.js";
import { POL_COM_001_CHAPTERS, officialPolicyPlainText } from "./polCom001V1Document.js";
import { POL_COM_001_TITLE } from "./polCom001V1View.js";

export {
  POL_COM_001_APPROVER,
  POL_COM_001_AREA,
  POL_COM_001_CLASSIFICATION,
  POL_COM_001_CNPJ,
  POL_COM_001_CODE,
  POL_COM_001_COMPANY,
  POL_COM_001_TITLE,
  POL_COM_001_VERSION_LABEL,
  isOfficialCommercialPolicyContent,
} from "./polCom001V1View.js";

export const POL_COM_001_SUMMARY_RULES = [
  "clientes, leads, oportunidades, propostas, preços, históricos, cadastros, canais e informações comerciais são ativos da empresa;",
  "a atribuição de cliente ou carteira representa responsabilidade comercial e não propriedade pessoal do cliente;",
  "a comissão será determinada pela operação específica, pela classificação do cliente, pela Margem Oficial, pela Matriz vigente e pela efetiva atuação comercial registrada;",
  "a cobertura de ausência tem finalidade de continuidade do atendimento e não constitui, por si só, transferência definitiva de carteira ou penalidade;",
  "vendas específicas materialmente iniciadas antes de uma cobertura devem ser preservadas, enquanto novas demandas surgidas durante a cobertura seguem as regras da Seção 8;",
  "Cópias informais, planilhas locais ou mensagens não substituem o cadastro oficial vigente.",
  "O período de 90 dias corridos sem novo Pedido de Venda aprovado constitui gatilho automático para verificação da condição de Responsável Comercial do cliente.",
  "A leitura, o acesso ou o aceite eletrônico desta Política não autorizam sua distribuição externa.",
];

export const POL_COM_001_DECLARATIONS = [
  "Declaro que tive acesso integral à Política Comercial e de Comissionamento POL-COM-001, versão 1.0.",
  "Declaro que li e compreendi as regras aplicáveis às minhas atividades comerciais.",
  "Declaro que compreendi as regras relativas a carteira, CRM, registros comerciais, precificação, margem, comissionamento, cobertura e demais procedimentos descritos na Política.",
  "Comprometo-me a observar as regras e procedimentos oficiais aplicáveis durante minhas atividades.",
  "Declaro estar ciente de que este documento possui classificação de USO INTERNO E RESTRITO.",
  "Comprometo-me a não divulgar, reproduzir, compartilhar ou disponibilizar a Política e suas informações a terceiros sem autorização, ressalvadas as hipóteses legalmente permitidas.",
  "Reconheço que este aceite será registrado eletronicamente com dados técnicos destinados a comprovar autoria, integridade e momento do aceite.",
];

export const POL_COM_001_QUESTIONS: PolicyQuestion[] = [
  {
    id: "q-carteira",
    reviewChapterId: "10-responsabilidade-comercial-e-carteira",
    prompt: "A carteira de clientes atribuída ao vendedor é propriedade pessoal dele?",
    options: [
      { id: "a", text: "Sim. O cliente pertence ao vendedor que o atende." },
      { id: "b", text: "Não. A carteira é ativo da empresa e a atribuição representa responsabilidade comercial, não propriedade pessoal do cliente." },
      { id: "c", text: "Sim, depois de 90 dias sem compra." },
    ],
    correctOptionId: "b",
    explanation:
      "A Política afirma que clientes, leads, oportunidades e informações comerciais são ativos da empresa, e que a atribuição de carteira representa responsabilidade comercial, não propriedade pessoal do cliente.",
  },
  {
    id: "q-registro",
    reviewChapterId: "4-definicoes",
    prompt: "O que a Política define como Registro Material?",
    options: [
      { id: "a", text: "Somente anotação particular do vendedor, fora dos sistemas da empresa." },
      { id: "b", text: "CRM, e-mail, proposta, cotação, WhatsApp corporativo, documento do cliente, ordem de compra, log de sistema ou outro elemento contemporâneo e verificável." },
      { id: "c", text: "Apenas o Pedido de Venda já faturado." },
    ],
    correctOptionId: "b",
    explanation:
      "A definição oficial de Registro Material é: CRM, e-mail, proposta, cotação, WhatsApp corporativo, documento do cliente, ordem de compra, log de sistema ou outro elemento contemporâneo e verificável.",
  },
  {
    id: "q-historico",
    reviewChapterId: "8-vendas-recorrentes-oem-cobertura-e-canais-de-entrada",
    prompt: "A existência de relacionamento histórico com o cliente, por si só, garante a comissão da nova operação?",
    options: [
      { id: "a", text: "Sim. Toda venda futura do cliente pertence automaticamente ao Responsável Comercial." },
      { id: "b", text: "Não. Relacionamento histórico, compras anteriores ou condição habitual não caracterizam, isoladamente, negociação específica já materialmente iniciada." },
      { id: "c", text: "Sim, quando o cliente é OEM." },
    ],
    correctOptionId: "b",
    explanation:
      "A Política diz que relacionamento histórico, tabela previamente negociada, compras anteriores, condição habitual, cadastro de carteira ou mera chegada de mensagem não caracterizam, isoladamente, negociação específica já materialmente iniciada. Cliente recorrente ou OEM também não determina, isoladamente, a atribuição da comissão.",
  },
  {
    id: "q-iniciada",
    reviewChapterId: "8-vendas-recorrentes-oem-cobertura-e-canais-de-entrada",
    prompt: "Uma operação já materialmente iniciada e comprovável antes da ausência permanece atribuída a quem?",
    options: [
      { id: "a", text: "Ao Vendedor de Cobertura, porque ele concluiu o pedido." },
      { id: "b", text: "Ao Responsável Comercial original." },
      { id: "c", text: "À administração, sem comissão." },
    ],
    correctOptionId: "b",
    explanation:
      "A Seção 8.3 determina que permanecerá atribuída ao Responsável Comercial original a operação que, antes da ausência, já possua negociação específica materialmente iniciada e comprovável.",
  },
  {
    id: "q-cobertura",
    reviewChapterId: "8-vendas-recorrentes-oem-cobertura-e-canais-de-entrada",
    prompt: "Durante a cobertura, surge nova demanda sem operação específica materialmente iniciada antes. A quem a Política atribui essa venda?",
    options: [
      { id: "a", text: "Sempre ao Responsável Comercial ausente, por ser a carteira dele." },
      { id: "b", text: "Ao Vendedor de Cobertura que efetivamente assumir, conduzir e concluir a operação, observadas as demais regras da Política." },
      { id: "c", text: "A venda fica sem comissão até o retorno do responsável." },
    ],
    correctOptionId: "b",
    explanation:
      "A Seção 8.4 diz que o Vendedor de Cobertura que efetivamente assumir, conduzir e concluir a operação fará jus à atribuição comercial e à comissão correspondente àquela venda, observadas as demais regras da Política.",
  },
  {
    id: "q-noventa",
    reviewChapterId: "11-inatividade-de-cliente-e-revisao-de-carteira",
    prompt: "Ao final de 90 dias corridos sem novo Pedido de Venda aprovado e sem registro válido no CRM, o que a Política prevê?",
    options: [
      { id: "a", text: "Nada muda até o Supervisor decidir." },
      { id: "b", text: "O cliente deixa automaticamente de possuir Responsável Comercial exclusivo e fica disponível para redistribuição, prospecção ou reativação." },
      { id: "c", text: "As comissões já adquiridas são canceladas." },
    ],
    correctOptionId: "b",
    explanation:
      "A Seção 11 estabelece que, sem registro objetivo, atualizado e suficiente no CRM, o cliente deixa automaticamente de possuir Responsável Comercial exclusivo e fica disponível para redistribuição, prospecção ou reativação. A reatribuição não afeta comissões já adquiridas.",
  },
  {
    id: "q-copia",
    reviewChapterId: "7-margem-oficial-matriz-de-comissao-precificacao-e-alcadas",
    prompt: "Cópias informais, planilhas locais ou mensagens substituem o cadastro oficial e a Matriz vigente?",
    options: [
      { id: "a", text: "Sim, se estiverem mais recentes que o sistema." },
      { id: "b", text: "Não. Cópias informais não substituem o cadastro oficial nem a versão vigente do Anexo I." },
      { id: "c", text: "Substituem somente para contas OEM." },
    ],
    correctOptionId: "b",
    explanation:
      "A Política diz que cópias informais, planilhas locais ou mensagens não substituem o cadastro oficial vigente, e que tabelas copiadas em mensagens, apresentações, planilhas particulares ou documentos antigos não substituem a versão vigente do Anexo I.",
  },
  {
    id: "q-sigilo",
    reviewChapterId: "23-confidencialidade-documento-controlado-e-uso-restrito",
    prompt: "A leitura e o aceite eletrônico desta Política autorizam a divulgação externa do documento?",
    options: [
      { id: "a", text: "Sim, para os clientes da própria carteira." },
      { id: "b", text: "Não. Sem autorização expressa, divulgar, reproduzir ou compartilhar o documento ou suas informações protegidas é vedado, e o aceite não autoriza distribuição externa." },
      { id: "c", text: "Sim, se for apenas um trecho ou uma foto da tela." },
    ],
    correctOptionId: "b",
    explanation:
      "A Seção 23 classifica o documento como controlado, de uso interno e restrito, veda a divulgação sem autorização expressa e afirma que a leitura, o acesso ou o aceite eletrônico não autorizam sua distribuição externa.",
  },
];

export function officialCommercialPolicyBody(): PolicyVersionBody {
  return {
    title: POL_COM_001_TITLE,
    content: officialPolicyPlainText(POL_COM_001_CHAPTERS),
    summaryRules: [...POL_COM_001_SUMMARY_RULES],
    declarations: [...POL_COM_001_DECLARATIONS],
    questions: POL_COM_001_QUESTIONS,
  };
}

export function officialCommercialPolicyHash(): string {
  return hashPolicyContent(officialCommercialPolicyBody());
}
