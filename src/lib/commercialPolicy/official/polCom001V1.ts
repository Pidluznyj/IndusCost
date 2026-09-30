/**
 * Pacote publicável da POL-COM-001 versão 1.0.
 * O texto normativo vem do documento oficial (candidata v1.0 alinhada ao
 * IndusCost). Perguntas e declarações apontam para esse texto e não criam
 * regra comercial nova.
 */
import { hashPolicyContent, type PolicyQuestion, type PolicyVersionBody } from "../commercialPolicyRules.js";
import { POL_COM_001_TITLE, officialCommercialPolicyContent } from "./polCom001V1View.js";

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
  officialCommercialPolicyContent,
} from "./polCom001V1View.js";

export const POL_COM_001_SUMMARY_RULES = [
  "clientes, leads, oportunidades, propostas, preços, históricos, cadastros, canais e informações comerciais são ativos da empresa;",
  "a atribuição de cliente ou carteira representa responsabilidade comercial e não propriedade pessoal do cliente;",
  "a comissão será determinada pela operação específica, pela classificação do cliente, pelo preço efetivamente praticado, pela Matriz de Referência vigente e pela efetiva atuação comercial registrada;",
  "A interpolação é feita pelo preço praticado, e não pela margem: a margem de referência é atributo de cada nível comercial e serve para formar o seu preço de referência.",
  "a cobertura de ausência tem finalidade de continuidade do atendimento e não constitui, por si só, transferência definitiva de carteira ou penalidade;",
  "vendas específicas materialmente iniciadas antes de uma cobertura devem ser preservadas, enquanto novas demandas surgidas durante a cobertura seguem as regras da Seção 8;",
  "Cópias informais, planilhas locais ou mensagens não substituem o cadastro oficial vigente.",
  "Completados 90 dias corridos sem novo Faturamento Válido, o cliente entra automaticamente em revisão de carteira, para verificação da condição de Responsável Comercial.",
  "A apuração da parcela do Supervisor Comercial é realizada por procedimento administrativo próprio, com base nas comissões apuradas para os Vendedores do time, e não integra o cálculo automático de comissões do sistema.",
  "A leitura, o acesso ou o aceite eletrônico desta Política não autorizam sua distribuição externa.",
];

export const POL_COM_001_DECLARATIONS = [
  "Declaro que tive acesso integral e li a Política Comercial e de Comissionamento POL-COM-001, versão 1.0, incluindo seus Anexos I a IV.",
  "Declaro que li e compreendi as regras comerciais aplicáveis às minhas atividades comerciais.",
  "Declaro que compreendi a Matriz de Referência do Anexo I (níveis comerciais, margens e percentuais de referência, interpolação pelo preço praticado e alçadas) e que somente a versão vigente do Anexo I se aplica.",
  "Declaro que compreendi que clientes, carteira e informações comerciais são ativos da empresa e que a atribuição de Responsável Comercial representa responsabilidade, não propriedade pessoal do cliente.",
  "Declaro que compreendi as regras de cobertura de ausência (Seção 8) e de inatividade e revisão de carteira em 90 dias corridos sem novo Faturamento Válido (Seção 11).",
  "Declaro que compreendi as regras relativas a CRM, registros comerciais, precificação, margem, comissionamento e demais procedimentos descritos na Política, e as condutas vedadas da Seção 22.",
  "Comprometo-me a observar as regras e procedimentos oficiais aplicáveis durante minhas atividades.",
  "Declaro estar ciente de que este documento possui classificação de USO INTERNO E RESTRITO e é documento controlado (Seção 23).",
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
    prompt: "Ao final de 90 dias corridos sem novo Faturamento Válido e sem registro válido no CRM, o que a Política prevê?",
    options: [
      { id: "a", text: "Nada muda até o Supervisor decidir." },
      { id: "b", text: "O cliente deixa automaticamente de possuir Responsável Comercial exclusivo e fica disponível para redistribuição, prospecção ou reativação." },
      { id: "c", text: "As comissões já adquiridas são canceladas." },
    ],
    correctOptionId: "b",
    explanation:
      "A Seção 11 conta o prazo do último Faturamento Válido e estabelece que, sem registro objetivo, atualizado e suficiente no CRM, o cliente deixa automaticamente de possuir Responsável Comercial exclusivo e fica disponível para redistribuição, prospecção ou reativação. A reatribuição é prospectiva e não afeta comissões já adquiridas.",
  },
  {
    id: "q-faturamento",
    reviewChapterId: "11-inatividade-de-cliente-e-revisao-de-carteira",
    prompt: "Um Pedido de Venda ainda não faturado reinicia a contagem dos 90 dias de inatividade do cliente?",
    options: [
      { id: "a", text: "Sim. Basta existir um Pedido de Venda aprovado." },
      { id: "b", text: "Não. Só nota fiscal ou Documento de Saída válido reinicia a contagem; pedido sem faturamento, orçamento, proposta e faturamento cancelado não reiniciam." },
      { id: "c", text: "Sim, desde que o cliente já tenha pago a parcela anterior." },
    ],
    correctOptionId: "b",
    explanation:
      "A Seção 11 conta o prazo a partir do último Faturamento Válido: somente nota fiscal ou Documento de Saída válido reinicia a contagem. Pedido de Venda ainda não faturado, orçamento, proposta e faturamento cancelado não reiniciam, e o recebimento financeiro não é a referência do prazo.",
  },
  {
    id: "q-preservacao",
    reviewChapterId: "11-inatividade-de-cliente-e-revisao-de-carteira",
    prompt: "Depois de 90 dias sem Faturamento Válido, o que pode preservar o Responsável Comercial do cliente?",
    options: [
      { id: "a", text: "Qualquer anotação recente no CRM, mesmo genérica, feita para manter a carteira." },
      { id: "b", text: "Registro válido no CRM que demonstre fato comercial concreto, como proposta ou negociação em andamento com próximo passo definido, ou paralisação informada pelo cliente com data de retomada." },
      { id: "c", text: "A simples atualização do cadastro ou de uma proposta antiga." },
    ],
    correctOptionId: "b",
    explanation:
      "A Seção 11 exige registro objetivo, atualizado e suficiente. Registros genéricos, desatualizados ou artificiais e a simples atualização técnica de uma proposta ou de um cadastro não impedem a aplicação da regra de 90 dias; criar registro artificial para impedir a revisão é conduta vedada pela Seção 22.",
  },
  {
    id: "q-matriz",
    reviewChapterId: "anexo-i-matriz-de-referencia-de-formacao-de-preco-comissao-e-alcada",
    prompt: "O preço efetivamente praticado de um Item de Venda ficou entre os preços de referência de dois níveis comerciais consecutivos. Como é determinada a comissão?",
    options: [
      { id: "a", text: "Aplica-se sempre o percentual do nível inferior, em degrau." },
      { id: "b", text: "Por interpolação linear, feita pelo IndusCost, entre os percentuais dos dois níveis, conforme a posição do preço praticado entre os dois preços de referência." },
      { id: "c", text: "Pela margem do item: cada faixa de margem tem um percentual fixo." },
    ],
    correctOptionId: "b",
    explanation:
      "A Seção 7 e o Anexo I estabelecem que os níveis comerciais (Atacado, Varejo 1, Varejo 2 e Varejo 3) são pontos de referência. Entre os preços de referência de dois níveis consecutivos, o percentual é obtido por interpolação linear entre os percentuais desses níveis, pelo preço praticado — e não pela margem. No preço de referência de um nível, aplica-se o percentual desse nível.",
  },
  {
    id: "q-limites",
    reviewChapterId: "7-margem-oficial-matriz-de-comissao-precificacao-e-alcadas",
    prompt: "O que acontece quando o preço praticado fica abaixo do preço de referência do Atacado, ou igual ou acima do preço de referência do Varejo 3?",
    options: [
      { id: "a", text: "Abaixo do Atacado não há comissão; acima do Varejo 3 o percentual continua subindo sem limite." },
      { id: "b", text: "Abaixo do Atacado aplica-se o percentual indicado no Anexo I para preço abaixo da tabela; a partir do Varejo 3 aplica-se o percentual do Varejo 3, que é o teto da Matriz." },
      { id: "c", text: "Nos dois casos a comissão é definida livremente pelo Supervisor Comercial." },
    ],
    correctOptionId: "b",
    explanation:
      "A Seção 7 fixa os limites: preço abaixo do preço de referência do Atacado recebe o percentual indicado no Anexo I para preço abaixo da tabela; preço igual ou superior ao preço de referência do Varejo 3 recebe o percentual do Varejo 3, que é o teto da Matriz.",
  },
  {
    id: "q-supervisor",
    reviewChapterId: "14-comissao-do-supervisor-comercial",
    prompt: "Como a Política trata a remuneração variável do Supervisor Comercial?",
    options: [
      { id: "a", text: "É descontada da comissão dos Vendedores do time." },
      { id: "b", text: "Equivale a 33% das comissões elegíveis apuradas para os Vendedores do seu time, é parcela adicional suportada pela empresa e não reduz a comissão do Vendedor." },
      { id: "c", text: "O Supervisor tem carteira própria e recebe comissão integral das vendas em que participa." },
    ],
    correctOptionId: "b",
    explanation:
      "A Seção 14 fixa 33% do valor das comissões elegíveis dos Vendedores vinculados ao time, como parcela adicional suportada pela empresa, e afirma que o Supervisor não possui carteira própria para comissão individual. A apuração dessa parcela é feita por procedimento administrativo próprio, fora do cálculo automático do sistema.",
  },
  {
    id: "q-campanha",
    reviewChapterId: "9-campanhas-e-condicoes-comerciais-especificas",
    prompt: "Uma campanha comercial pode ser aplicada sem identificação, versão, vigência, escopo e comunicação prévia?",
    options: [
      { id: "a", text: "Sim, se o Vendedor a mencionar na proposta." },
      { id: "b", text: "Não. Toda campanha deve possuir identificação, versão, vigência, escopo, percentual ou fórmula, condições, alçadas, regra de cumulatividade e comunicação prévia; aplicar campanha inexistente, vencida ou fora do escopo é conduta vedada." },
      { id: "c", text: "Sim, desde que o percentual seja maior que o da Matriz." },
    ],
    correctOptionId: "b",
    explanation:
      "A Seção 9 exige identificação, versão, vigência, escopo, percentual ou fórmula, condições, alçadas, regra de cumulatividade e comunicação prévia (Anexo II), e a Seção 22 veda aplicar campanha inexistente, vencida ou fora do escopo.",
  },
  {
    id: "q-vedadas",
    reviewChapterId: "22-condutas-vedadas",
    prompt: "Qual das condutas abaixo é vedada pela Seção 22 da Política?",
    options: [
      { id: "a", text: "Registrar no CRM, de forma contemporânea, um contato real com o cliente." },
      { id: "b", text: "Criar registros artificiais para impedir a revisão de inatividade ou alterar a atribuição de uma operação." },
      { id: "c", text: "Escalar ao Supervisor uma divergência de atribuição de venda." },
    ],
    correctOptionId: "b",
    explanation:
      "A Seção 22 veda, entre outras condutas, criar registros artificiais para impedir revisão de inatividade ou alterar a atribuição de uma operação, alterar ou simular preço, custo, margem, data, cliente ou campanha, e combinar divisão informal de comissão sem registro e aprovação.",
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
    content: officialCommercialPolicyContent(),
    summaryRules: [...POL_COM_001_SUMMARY_RULES],
    declarations: [...POL_COM_001_DECLARATIONS],
    questions: POL_COM_001_QUESTIONS,
  };
}

export function officialCommercialPolicyHash(): string {
  return hashPolicyContent(officialCommercialPolicyBody());
}
