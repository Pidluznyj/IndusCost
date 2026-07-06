import { prisma } from "../prisma.js";

export interface ParsedProposalData {
  id: string;
  number: number;
  title: string;
  clientName: string;
  clientTaxId: string;
  projectCode: string;
  projectName: string;
  date: string;
  responsible: string;
  companyIssuer: string;
  validityDays: number;
  paymentTerms: string;
  paymentMethod: string;
  deliveryTimeDays: number;
  freightCondition: string;
  deliveryLocation: string;
  notes: string;
  
  // Totals
  totalItems: number;
  totalGrossValue: number;
  totalDiscount: number;
  totalNetValue: number;
  totalCost: number;
  totalMarginValue: number;
  totalMarginPerc: number;
  totalTaxes: number;
  totalCommission: number;
  totalFreight: number;

  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    unit: string;
    unitCost: number;
    negotiatedPrice: number;
    totalValue: number;
    notes?: string;
  }>;

  // Custom parsed sections
  resumoObj: string;
  resumoSol: string;
  resumoInv: string;
  resumoBen: string;
  
  contexto: string;
  
  solucaoProd: string;
  solucaoFerr: string;
  solucaoForn: string;
  solucaoSup: string;

  escopoIncluso: string[];
  escopoNaoIncluso: string[];
  escopoPremissas: string[];

  condicoesValidade: string;
  condicoesPrazo: string;
  condicoesPagamento: string;
  condicoesAmortizacao: string;
  condicoesExclusividade: string;
  condicoesPremissas: string;
  condicoesObs: string;

  beneficios: string[];
  proximosPassos: Array<{ step: string; detail: string }>;
}

export async function fetchProposalPptxData(proposalId: string): Promise<ParsedProposalData | null> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: {
      Customer: true,
      items: {
        include: {
          Product: true
        }
      }
    }
  });

  if (!proposal) return null;

  // Date formatted as dd/mm/aaaa
  const dateFormatted = new Date(proposal.createdAt).toLocaleDateString("pt-BR");

  // Parse notes to extract sections
  const sections = parseNotesSections(proposal.notes || "");

  // Helper to get nested value or fallback
  const getVal = (secKey: string, key: string, fallback: string) => {
    const secContent = sections[secKey];
    if (!secContent) return fallback;
    // Look for lines like "Key: Value" or "Key - Value"
    const lines = secContent.split("\n");
    for (const line of lines) {
      const match = line.match(new RegExp(`^\\*?\\*?\\s*${key}\\s*\\*?\\*?\\s*[:\\-–—]\\s*(.+)$`, "i"));
      if (match) return match[1].trim();
    }
    return fallback;
  };

  // 1. Resumo Executivo
  const resumoObj = getVal("resumo executivo", "objetivo", "Desenvolvimento e fornecimento de soluções sob demanda");
  const resumoSol = getVal("resumo executivo", "solucao", `Fornecimento de ${proposal.items.map(i => i.Product?.name).filter(Boolean).join(", ") || "soluções de engenharia"}`);
  const netValueStr = Number(proposal.totalNetValue).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const resumoInv = getVal("resumo executivo", "investimento", netValueStr);
  const resumoBen = getVal("resumo executivo", "beneficio", "Ganhos em eficiência e produtividade");

  // 2. Contexto e oportunidade
  let contexto = sections["contexto"] || sections["contexto e oportunidade"] || sections["oportunidade"] || "";
  // Strip markdown headers from contexto if it was parsed as header
  contexto = contexto.replace(/^#+\s*.+$/gm, "").trim();
  if (!contexto) {
    contexto = proposal.notes || "O cliente identificou a necessidade de melhoria em seus processos industriais, demandando o desenvolvimento de soluções personalizadas para aumento da produtividade e redução de custos.";
  }

  // 3. Solução Proposta
  const solucaoProd = getVal("solucao proposta", "produto", proposal.items.map(i => i.Product?.name).filter(Boolean).join(", ") || "Equipamento Industrial");
  const solucaoFerr = getVal("solucao proposta", "ferramental", "Ferramental padrão");
  const solucaoForn = getVal("solucao proposta", "fornecimento", "Conforme especificações comerciais");
  const solucaoSup = getVal("solucao proposta", "suporte", "Suporte técnico padrão");

  // 4. Escopo Comercial
  const escopoSec = sections["escopo comercial"] || sections["escopo"];
  let escopoIncluso: string[] = [];
  let escopoNaoIncluso: string[] = [];
  let escopoPremissas: string[] = [];

  if (escopoSec) {
    let mode: "incluso" | "naoincluso" | "premissas" | null = null;
    const lines = escopoSec.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.match(/incluso/i) && !trimmed.match(/nao\s+incluso/i)) {
        mode = "incluso";
        continue;
      } else if (trimmed.match(/nao\s+incluso/i)) {
        mode = "naoincluso";
        continue;
      } else if (trimmed.match(/premissas/i)) {
        mode = "premissas";
        continue;
      }
      
      const itemMatch = trimmed.match(/^[-*•+]\s*(.+)$/) || trimmed.match(/^\d+\.\s*(.+)$/);
      if (itemMatch && mode) {
        if (mode === "incluso") escopoIncluso.push(itemMatch[1].trim());
        else if (mode === "naoincluso") escopoNaoIncluso.push(itemMatch[1].trim());
        else if (mode === "premissas") escopoPremissas.push(itemMatch[1].trim());
      }
    }
  }

  if (escopoIncluso.length === 0) {
    escopoIncluso = proposal.items.map(i => `${Number(i.quantity)}x ${i.Product?.name || "Item"} (${i.Product?.sku || ""})`);
  }
  if (escopoNaoIncluso.length === 0) {
    escopoNaoIncluso = ["Instalação civil e adequações no local", "Infraestrutura de energia e pneumática", "Itens não expressamente descritos"];
  }

  // 5. Condições comerciais
  const condicoesSec = sections["condicoes comerciais"] || sections["condicoes"] || sections["comercial"];
  const getCondVal = (key: string, fallback: string) => {
    if (!condicoesSec) return fallback;
    const lines = condicoesSec.split("\n");
    for (const line of lines) {
      const match = line.match(new RegExp(`^\\*?\\*?\\s*${key}\\s*\\*?\\*?\\s*[:\\-–—]\\s*(.+)$`, "i"));
      if (match) return match[1].trim();
    }
    return fallback;
  };

  const condValidade = getCondVal("validade", `${proposal.validityDays} dias`);
  const condPrazo = getCondVal("prazo", proposal.deliveryTimeDays ? `${proposal.deliveryTimeDays} dias` : "A definir");
  const condPagamento = getCondVal("pagamento", proposal.paymentTerms ? `${proposal.paymentTerms} (${proposal.paymentMethod || ""})` : "Conforme política comercial");
  const condAmortizacao = getCondVal("amortizacao", "A definir");
  const condExclusividade = getCondVal("exclusividade", "A definir");
  const condPremissas = getCondVal("premissas", "A definir");
  const condObs = proposal.notes ? "Ver observações adicionais" : "Nenhuma observação cadastrada";

  // 6. Benefícios
  const beneficiosSec = sections["beneficios"] || sections["beneficios para o cliente"];
  let beneficios: string[] = [];
  if (beneficiosSec) {
    const lines = beneficiosSec.split("\n");
    for (const line of lines) {
      const itemMatch = line.trim().match(/^[-*•+]\s*(.+)$/) || line.trim().match(/^\d+\.\s*(.+)$/);
      if (itemMatch) beneficios.push(itemMatch[1].trim());
    }
  }
  if (beneficios.length === 0) {
    beneficios = [
      "Menor investimento inicial e otimização do capex",
      "Previsibilidade de custos operacionais",
      "Redução de riscos e garantia estendida",
      "Parceria técnica com suporte local",
      "Ganho operacional e aumento da eficiência"
    ];
  }

  // 7. Próximos passos
  const passosSec = sections["proximos passos"] || sections["passos"];
  let proximosPassos: Array<{ step: string; detail: string }> = [];
  if (passosSec) {
    const lines = passosSec.split("\n");
    for (const line of lines) {
      const match = line.trim().match(/^[-*•+\d\.]*\s*\*?\*?(.+?)\*?\*?\s*[:\-\(](.+)$/) || line.trim().match(/^[-*•+\d\.]*\s*(.+)$/);
      if (match) {
        const step = match[1].trim();
        const detail = match[2] ? match[2].replace(/[\(\)]/g, "").trim() : "Semana 1";
        proximosPassos.push({ step, detail });
      }
    }
  }
  if (proximosPassos.length === 0) {
    proximosPassos = [
      { step: "Aprovação comercial", detail: "Semana 1" },
      { step: "Desenvolvimento técnico", detail: "Semana 2-3" },
      { step: "Apresentação de amostras", detail: "Semana 4" },
      { step: "Validação do processo", detail: "Semana 5" },
      { step: "Início de fornecimento", detail: "Semana 6" }
    ];
  }

  // Formatted items
  const items = proposal.items.map(item => {
    const qty = Number(item.quantity);
    const unitPrice = Number(item.negotiatedPrice);
    const totalValue = qty * unitPrice;
    return {
      sku: item.Product?.sku || "N/A",
      name: item.Product?.name || "Item de Proposta",
      quantity: qty,
      unit: item.unit || "UN",
      unitCost: Number(item.unitCost),
      negotiatedPrice: unitPrice,
      totalValue,
      notes: item.notes || undefined
    };
  });

  return {
    id: proposal.id,
    number: proposal.number,
    title: proposal.title || "Sem título",
    clientName: proposal.Customer?.companyName || "Cliente",
    clientTaxId: proposal.Customer?.taxId || "",
    projectCode: `PRJ-${String(proposal.number).padStart(5, "0")}`,
    projectName: proposal.title || "Projeto Comercial",
    date: dateFormatted,
    responsible: proposal.responsible || "A definir",
    companyIssuer: proposal.companyIssuer || "IndusCost",
    validityDays: proposal.validityDays,
    paymentTerms: proposal.paymentTerms || "A definir",
    paymentMethod: proposal.paymentMethod || "A definir",
    deliveryTimeDays: proposal.deliveryTimeDays || 0,
    freightCondition: proposal.freightCondition || "CIF",
    deliveryLocation: proposal.deliveryLocation || "A definir",
    notes: proposal.notes || "",
    
    totalItems: proposal.totalItems,
    totalGrossValue: Number(proposal.totalGrossValue),
    totalDiscount: Number(proposal.totalDiscount),
    totalNetValue: Number(proposal.totalNetValue),
    totalCost: Number(proposal.totalCost),
    totalMarginValue: Number(proposal.totalMarginValue),
    totalMarginPerc: Number(proposal.totalMarginPerc),
    totalTaxes: Number(proposal.totalTaxes),
    totalCommission: Number(proposal.totalCommission),
    totalFreight: Number(proposal.totalFreight),

    items,

    resumoObj,
    resumoSol,
    resumoInv,
    resumoBen,
    
    contexto,
    
    solucaoProd,
    solucaoFerr,
    solucaoForn,
    solucaoSup,

    escopoIncluso,
    escopoNaoIncluso,
    escopoPremissas,

    condicoesValidade: condValidade,
    condicoesPrazo: condPrazo,
    condicoesPagamento: condPagamento,
    condicoesAmortizacao: condAmortizacao,
    condicoesExclusividade: condExclusividade,
    condicoesPremissas: condPremissas,
    condicoesObs: condObs,

    beneficios,
    proximosPassos
  };
}

function parseNotesSections(notes: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = notes.split(/\r?\n/);
  let currentSection = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for markdown headers
    const headerMatch = trimmed.match(/^#+\s*(.+)$/);
    if (headerMatch) {
      if (currentSection) {
        sections[currentSection] = currentContent.join("\n").trim();
      }
      currentSection = headerMatch[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      currentContent = [];
      continue;
    }

    // Check for bold headers at start of line (e.g., **Resumo Executivo**)
    const boldHeaderMatch = trimmed.match(/^\*\*(.+?)\*\*$/);
    if (boldHeaderMatch) {
      if (currentSection) {
        sections[currentSection] = currentContent.join("\n").trim();
      }
      currentSection = boldHeaderMatch[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      currentContent = [];
      continue;
    }

    currentContent.push(line);
  }

  if (currentSection) {
    sections[currentSection] = currentContent.join("\n").trim();
  }

  return sections;
}
