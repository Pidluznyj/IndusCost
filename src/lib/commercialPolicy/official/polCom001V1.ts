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

/**
 * Perguntas em linguagem simples, por situação do dia a dia: quem responde é
 * o vendedor, não um leitor de norma. Cada explicação aponta a regra da
 * Política; o texto normativo continua sendo o documento.
 */
export const POL_COM_001_QUESTIONS: PolicyQuestion[] = [
  {
    id: "q-carteira",
    reviewChapterId: "10-responsabilidade-comercial-e-carteira",
    prompt: "Os clientes da sua carteira são seus ou da empresa?",
    options: [
      { id: "a", text: "São meus: o cliente pertence ao vendedor que o atende." },
      { id: "b", text: "São da empresa. Eu sou o responsável por atender, mas o cliente não é meu." },
      { id: "c", text: "Passam a ser meus depois de 90 dias sem compra." },
    ],
    correctOptionId: "b",
    explanation:
      "Clientes, contatos e oportunidades são da empresa. Ter um cliente na carteira significa ser o responsável por atendê-lo, não ser dono dele (Seção 10).",
  },
  {
    id: "q-registro",
    reviewChapterId: "4-definicoes",
    prompt: "O que vale como prova de que você trabalhou uma venda?",
    options: [
      { id: "a", text: "Minhas anotações pessoais, fora dos sistemas da empresa." },
      { id: "b", text: "O que fica registrado e pode ser conferido: CRM, e-mail, proposta, cotação, WhatsApp corporativo ou pedido do cliente." },
      { id: "c", text: "Só o pedido, depois de faturado." },
    ],
    correctOptionId: "b",
    explanation:
      "A Política chama isso de Registro Material: CRM, e-mail, proposta, cotação, WhatsApp corporativo, documento do cliente, ordem de compra ou outro registro feito na hora e que possa ser conferido (Seção 4).",
  },
  {
    id: "q-historico",
    reviewChapterId: "8-vendas-recorrentes-oem-cobertura-e-canais-de-entrada",
    prompt: "Você atende um cliente há anos. Isso já garante a sua comissão em toda nova venda para ele?",
    options: [
      { id: "a", text: "Sim. Toda venda futura desse cliente é minha." },
      { id: "b", text: "Não. O histórico sozinho não garante: é preciso ter atuado naquela venda, com registro." },
      { id: "c", text: "Sim, se o cliente for OEM ou comprar sempre." },
    ],
    correctOptionId: "b",
    explanation:
      "Ter histórico com o cliente, compras anteriores ou o cliente na carteira não bastam sozinhos. O que conta é a negociação daquela venda, iniciada e registrada. Isso vale também para cliente recorrente ou OEM (Seção 8).",
  },
  {
    id: "q-iniciada",
    reviewChapterId: "8-vendas-recorrentes-oem-cobertura-e-canais-de-entrada",
    prompt: "Você começou uma negociação, deixou tudo registrado e saiu de férias. Um colega fechou o pedido. De quem é a venda?",
    options: [
      { id: "a", text: "Do colega, porque foi ele quem fechou o pedido." },
      { id: "b", text: "Minha, porque a negociação já estava iniciada e registrada antes da minha ausência." },
      { id: "c", text: "De ninguém: a venda fica sem comissão." },
    ],
    correctOptionId: "b",
    explanation:
      "A venda continua com o Responsável Comercial original quando a negociação já estava iniciada e pode ser comprovada antes da ausência (Seção 8.3).",
  },
  {
    id: "q-cobertura",
    reviewChapterId: "8-vendas-recorrentes-oem-cobertura-e-canais-de-entrada",
    prompt: "Durante as suas férias, o cliente pede algo novo, que você não tinha começado a negociar. O colega que está cobrindo atende e fecha. De quem é a venda?",
    options: [
      { id: "a", text: "Minha, porque o cliente é da minha carteira." },
      { id: "b", text: "Do colega que cobriu, porque foi ele quem assumiu, conduziu e fechou a venda." },
      { id: "c", text: "De ninguém, até eu voltar." },
    ],
    correctOptionId: "b",
    explanation:
      "Pedido novo, sem negociação iniciada antes da ausência, é de quem cobriu: o Vendedor de Cobertura que assumiu, conduziu e concluiu a venda recebe a comissão dela (Seção 8.4).",
  },
  {
    id: "q-noventa",
    reviewChapterId: "11-inatividade-de-cliente-e-revisao-de-carteira",
    prompt: "Um cliente seu ficou 90 dias sem nenhuma venda faturada e não há registro válido no CRM. O que acontece?",
    options: [
      { id: "a", text: "Nada, até o Supervisor decidir." },
      { id: "b", text: "O cliente sai automaticamente da minha carteira e pode ser passado a outro vendedor." },
      { id: "c", text: "Perco as comissões que já tinha ganho com ele." },
    ],
    correctOptionId: "b",
    explanation:
      "Depois de 90 dias corridos sem venda faturada e sem registro válido no CRM, o cliente deixa automaticamente de ter Responsável Comercial exclusivo e fica disponível para outro vendedor. As comissões que você já ganhou não são afetadas (Seção 11).",
  },
  {
    id: "q-faturamento",
    reviewChapterId: "11-inatividade-de-cliente-e-revisao-de-carteira",
    prompt: "O que faz a contagem dos 90 dias começar de novo?",
    options: [
      { id: "a", text: "Um pedido aprovado, mesmo sem nota fiscal." },
      { id: "b", text: "Somente uma venda faturada: nota fiscal ou Documento de Saída válido." },
      { id: "c", text: "Um orçamento ou uma proposta enviada ao cliente." },
    ],
    correctOptionId: "b",
    explanation:
      "Só a venda faturada (nota fiscal ou Documento de Saída válido) reinicia a contagem. Pedido ainda não faturado, orçamento, proposta e nota cancelada não reiniciam (Seção 11).",
  },
  {
    id: "q-preservacao",
    reviewChapterId: "11-inatividade-de-cliente-e-revisao-de-carteira",
    prompt: "Passaram 90 dias sem venda faturada para um cliente. O que mantém esse cliente na sua carteira?",
    options: [
      { id: "a", text: "Qualquer anotação no CRM, feita só para segurar o cliente." },
      { id: "b", text: "Um registro real no CRM: proposta ou negociação em andamento com próximo passo marcado, ou aviso do cliente de que parou e quando volta a comprar." },
      { id: "c", text: "Atualizar o cadastro ou mexer em uma proposta antiga." },
    ],
    correctOptionId: "b",
    explanation:
      "O registro precisa mostrar um fato comercial de verdade e estar atualizado. Anotação genérica, registro antigo ou simples atualização de cadastro ou proposta não seguram o cliente — e inventar registro para isso é conduta proibida (Seções 11 e 22).",
  },
  {
    id: "q-matriz",
    reviewChapterId: "anexo-i-matriz-de-referencia-de-formacao-de-preco-comissao-e-alcada",
    prompt: "Você vendeu por um preço que ficou entre dois níveis da tabela (por exemplo, entre Atacado e Varejo 1). Qual é a sua comissão?",
    options: [
      { id: "a", text: "Sempre a do nível mais baixo." },
      { id: "b", text: "Um percentual entre as comissões dos dois níveis, calculado pelo sistema: quanto mais perto do preço do nível de cima, maior a comissão." },
      { id: "c", text: "Depende da margem do item, e não do preço que eu vendi." },
    ],
    correctOptionId: "b",
    explanation:
      "Atacado, Varejo 1, Varejo 2 e Varejo 3 são pontos de referência. Entre dois níveis, o sistema calcula a comissão proporcionalmente ao preço vendido. Exemplo: na metade do caminho entre um nível que paga 1% e outro que paga 2%, a comissão é 1,5% (Seção 7 e Anexo I).",
  },
  {
    id: "q-limites",
    reviewChapterId: "7-margem-oficial-matriz-de-comissao-precificacao-e-alcadas",
    prompt: "E se o preço vendido ficar abaixo do Atacado, ou acima do Varejo 3?",
    options: [
      { id: "a", text: "Abaixo do Atacado não tem comissão; acima do Varejo 3 ela continua subindo sem limite." },
      { id: "b", text: "Abaixo do Atacado vale a comissão mínima indicada no Anexo I; do Varejo 3 para cima vale a comissão do Varejo 3, que é a máxima." },
      { id: "c", text: "Nos dois casos quem decide a comissão é o Supervisor." },
    ],
    correctOptionId: "b",
    explanation:
      "Preço abaixo do Atacado recebe o percentual que o Anexo I indica para preço abaixo da tabela. Do preço do Varejo 3 para cima, a comissão é a do Varejo 3: ela é o teto e não sobe mais (Seção 7).",
  },
  {
    id: "q-supervisor",
    reviewChapterId: "14-comissao-do-supervisor-comercial",
    prompt: "De onde vem a comissão do Supervisor Comercial?",
    options: [
      { id: "a", text: "É descontada da comissão dos vendedores do time." },
      { id: "b", text: "É um valor a mais, pago pela empresa: 33% das comissões dos vendedores do time. Não tira nada do vendedor." },
      { id: "c", text: "Ele tem carteira própria e recebe a comissão inteira das vendas em que ajuda." },
    ],
    correctOptionId: "b",
    explanation:
      "O Supervisor recebe o equivalente a 33% das comissões dos vendedores do seu time. É uma parcela adicional paga pela empresa, que não reduz a comissão de ninguém, e ele não tem carteira própria (Seção 14).",
  },
  {
    id: "q-campanha",
    reviewChapterId: "9-campanhas-e-condicoes-comerciais-especificas",
    prompt: "Um colega comenta sobre uma campanha com comissão maior, mas ela não foi comunicada oficialmente. Você pode usar?",
    options: [
      { id: "a", text: "Sim, basta citar a campanha na proposta." },
      { id: "b", text: "Não. Só vale campanha oficial: com nome, prazo de validade, regras definidas e comunicada antes." },
      { id: "c", text: "Sim, se a comissão for maior que a da tabela." },
    ],
    correctOptionId: "b",
    explanation:
      "Toda campanha precisa ter identificação, versão, prazo de validade, regras e comunicação prévia. Usar campanha que não existe, que já venceu ou que não se aplica ao caso é conduta proibida (Seções 9 e 22).",
  },
  {
    id: "q-vedadas",
    reviewChapterId: "22-condutas-vedadas",
    prompt: "Qual destas atitudes é proibida pela Política?",
    options: [
      { id: "a", text: "Registrar no CRM um contato que realmente aconteceu." },
      { id: "b", text: "Inventar um registro no CRM só para não perder o cliente ou para ficar com uma venda." },
      { id: "c", text: "Avisar o Supervisor quando há dúvida sobre de quem é a venda." },
    ],
    correctOptionId: "b",
    explanation:
      "A Seção 22 proíbe criar registros artificiais para impedir a revisão da carteira ou mudar de quem é a venda. Também proíbe alterar ou simular preço, custo, margem, data, cliente ou campanha, e combinar divisão de comissão por fora.",
  },
  {
    id: "q-copia",
    reviewChapterId: "7-margem-oficial-matriz-de-comissao-precificacao-e-alcadas",
    prompt: "Você tem uma planilha ou uma mensagem com percentuais diferentes dos que estão no sistema. O que vale?",
    options: [
      { id: "a", text: "A planilha, se ela for mais nova." },
      { id: "b", text: "O que está no sistema e na versão atual do Anexo I. Planilhas e mensagens não valem." },
      { id: "c", text: "A planilha, mas só para clientes OEM." },
    ],
    correctOptionId: "b",
    explanation:
      "Vale sempre o cadastro oficial e a versão vigente do Anexo I. Tabelas copiadas em mensagens, apresentações, planilhas pessoais ou documentos antigos não substituem a versão oficial (Seção 7).",
  },
  {
    id: "q-sigilo",
    reviewChapterId: "23-confidencialidade-documento-controlado-e-uso-restrito",
    prompt: "Você pode mostrar ou enviar esta Política para alguém de fora da empresa?",
    options: [
      { id: "a", text: "Sim, para os clientes da minha carteira." },
      { id: "b", text: "Não. O documento é interno: não pode ser enviado, copiado ou fotografado para terceiros sem autorização." },
      { id: "c", text: "Sim, se for só um trecho ou uma foto da tela." },
    ],
    correctOptionId: "b",
    explanation:
      "A Política é documento controlado, de uso interno e restrito. Ler ou aceitar não autoriza divulgar: sem autorização expressa, não pode ser compartilhada nem em parte (Seção 23).",
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
