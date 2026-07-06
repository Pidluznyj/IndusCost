import pptxgen from "pptxgenjs";
import { ParsedProposalData } from "./clientProposalPptxData.js";
import { PPTXTheme, applyStandardSlideTemplate } from "./clientProposalPptxTheme.js";

export async function generateClientProposalPptx(data: ParsedProposalData, theme: PPTXTheme): Promise<Buffer> {
  const pptx = new ((pptxgen as any).default || pptxgen)();
  
  // Set Presentation to 16:9 widescreen
  pptx.layout = "LAYOUT_16x9";

  // Slide Numbering global config
  pptx.slideNumber = { x: 9.3, y: 5.15, fontSize: 8, color: "64748B" };

  // ==========================================
  // SLIDE 1: CAPA PREMIUM
  // ==========================================
  const slide1 = pptx.addSlide();
  slide1.background = { fill: theme.bgFill };

  // Top-left Logo or Text Fallback
  if (theme.logoBase64) {
    slide1.addImage({
      data: theme.logoBase64,
      x: 0.8,
      y: 0.6,
      w: 1.8,
      h: 0.7,
      sizing: { type: "contain" }
    });
  } else {
    slide1.addText(theme.companyName, {
      x: 0.8,
      y: 0.6,
      w: 4.0,
      h: 0.7,
      fontSize: 24,
      fontFace: "Inter",
      color: theme.primaryColor,
      bold: true,
      valign: "middle"
    });
  }

  // Strong title "Proposta Comercial"
  slide1.addText("Proposta Comercial", {
    x: 0.8,
    y: 1.7,
    w: 8.4,
    h: 0.6,
    fontSize: 38,
    fontFace: "Inter",
    color: theme.primaryColor,
    bold: true
  });

  // Project description / name
  slide1.addText(data.projectName || "Solução sob medida", {
    x: 0.8,
    y: 2.3,
    w: 8.4,
    h: 0.4,
    fontSize: 16,
    fontFace: "Inter",
    color: "475569"
  });

  // Elegant divider line
  slide1.addShape("line", {
    x: 0.8,
    y: 2.9,
    w: 8.4,
    h: 0,
    line: { color: theme.secondaryColor, width: 2 }
  });

  // Info Block (Client, Project Code, Date)
  slide1.addText("CLIENTE", {
    x: 0.8,
    y: 3.2,
    w: 4.0,
    h: 0.2,
    fontSize: 9,
    fontFace: "Inter",
    color: "64748B",
    bold: true
  });
  slide1.addText(data.clientName, {
    x: 0.8,
    y: 3.45,
    w: 4.0,
    h: 0.3,
    fontSize: 14,
    fontFace: "Inter",
    color: theme.textColor,
    bold: true
  });

  slide1.addText("PROJETO", {
    x: 5.2,
    y: 3.2,
    w: 2.0,
    h: 0.2,
    fontSize: 9,
    fontFace: "Inter",
    color: "64748B",
    bold: true
  });
  slide1.addText(data.projectCode, {
    x: 5.2,
    y: 3.45,
    w: 2.0,
    h: 0.3,
    fontSize: 14,
    fontFace: "Inter",
    color: theme.textColor,
    bold: true
  });

  slide1.addText("DATA", {
    x: 7.5,
    y: 3.2,
    w: 1.7,
    h: 0.2,
    fontSize: 9,
    fontFace: "Inter",
    color: "64748B",
    bold: true
  });
  slide1.addText(data.date, {
    x: 7.5,
    y: 3.45,
    w: 1.7,
    h: 0.3,
    fontSize: 14,
    fontFace: "Inter",
    color: theme.textColor,
    bold: true
  });

  // Bottom subtitle / issuer
  slide1.addText(`Elaborado por: ${data.responsible || "Equipe Comercial"} | ${data.companyIssuer}`, {
    x: 0.8,
    y: 4.8,
    w: 8.4,
    h: 0.3,
    fontSize: 9,
    fontFace: "Inter",
    color: "64748B"
  });

  // ==========================================
  // SLIDE 2: RESUMO EXECUTIVO (4 columns)
  // ==========================================
  const slide2 = pptx.addSlide();
  applyStandardSlideTemplate(slide2, theme, "Resumo Executivo", data.projectCode, data.clientName);

  const colW = 1.95;
  const colGap = 0.2;
  const startX = 0.8;
  const cardY = 1.5;
  const cardH = 3.2;

  const resumoCards = [
    { title: "OBJETIVO", text: data.resumoObj, color: theme.primaryColor },
    { title: "SOLUÇÃO", text: data.resumoSol, color: theme.secondaryColor },
    { title: "INVESTIMENTO", text: data.resumoInv, color: theme.accentColor, isHighlight: true },
    { title: "BENEFÍCIO", text: data.resumoBen, color: theme.successColor }
  ];

  resumoCards.forEach((c, idx) => {
    const x = startX + idx * (colW + colGap);
    
    // Draw background card
    slide2.addShape("rect", {
      x,
      y: cardY,
      w: colW,
      h: cardH,
      fill: { color: "FFFFFF" },
      line: { color: "E2E8F0", width: 1 }
    });

    // Card Top highlight border
    slide2.addShape("rect", {
      x,
      y: cardY,
      w: colW,
      h: 0.15,
      fill: { color: c.color }
    });

    // Title
    slide2.addText(c.title, {
      x: x + 0.15,
      y: cardY + 0.3,
      w: colW - 0.3,
      h: 0.25,
      fontSize: 10,
      fontFace: "Inter",
      color: c.color,
      bold: true
    });

    // Content text
    if (c.isHighlight) {
      slide2.addText(c.text, {
        x: x + 0.15,
        y: cardY + 0.65,
        w: colW - 0.3,
        h: 2.2,
        fontSize: 15,
        fontFace: "Inter",
        color: "D97706",
        bold: true,
        valign: "top"
      });
    } else {
      slide2.addText(c.text, {
        x: x + 0.15,
        y: cardY + 0.65,
        w: colW - 0.3,
        h: 2.2,
        fontSize: 10,
        fontFace: "Inter",
        color: "334155",
        valign: "top"
      });
    }
  });

  // ==========================================
  // SLIDE 3: CONTEXTO E OPORTUNIDADE (Asymmetrical 2 Columns)
  // ==========================================
  const slide3 = pptx.addSlide();
  applyStandardSlideTemplate(slide3, theme, "Contexto e Necessidade", data.projectCode, data.clientName);

  // Left column: Problem definition
  slide3.addText("OPORTUNIDADE DETECTADA", {
    x: 0.8,
    y: 1.4,
    w: 5.2,
    h: 0.3,
    fontSize: 12,
    fontFace: "Inter",
    color: theme.secondaryColor,
    bold: true
  });

  slide3.addText(data.contexto, {
    x: 0.8,
    y: 1.8,
    w: 5.2,
    h: 2.8,
    fontSize: 13,
    fontFace: "Inter",
    color: "334155",
    valign: "top"
  });

  // Right column: Highlight box
  slide3.addShape("rect", {
    x: 6.5,
    y: 1.4,
    w: 2.7,
    h: 3.2,
    fill: { color: "F0FDF4" }, // very light green
    line: { color: "DCFCE7", width: 1 }
  });

  // Card Top highlight line
  slide3.addShape("rect", {
    x: 6.5,
    y: 1.4,
    w: 2.7,
    h: 0.15,
    fill: { color: theme.successColor }
  });

  slide3.addText("GANHOS ESPERADOS", {
    x: 6.7,
    y: 1.7,
    w: 2.3,
    h: 0.3,
    fontSize: 11,
    fontFace: "Inter",
    color: theme.successColor,
    bold: true
  });

  const ganhosList = data.beneficios.slice(0, 3);
  let ganhoY = 2.1;
  ganhosList.forEach(g => {
    // Green check indicator block
    slide3.addShape("rect", {
      x: 6.7,
      y: ganhoY + 0.05,
      w: 0.12,
      h: 0.12,
      fill: { color: theme.successColor }
    });

    slide3.addText(g, {
      x: 6.9,
      y: ganhoY,
      w: 2.1,
      h: 0.7,
      fontSize: 10,
      fontFace: "Inter",
      color: "1F2937",
      valign: "top"
    });
    ganhoY += 0.8;
  });

  // ==========================================
  // SLIDE 4: SOLUÇÃO PROPOSTA (2x2 Grid)
  // ==========================================
  const slide4 = pptx.addSlide();
  applyStandardSlideTemplate(slide4, theme, "Solução Proposta", data.projectCode, data.clientName);

  const solCards = [
    { label: "PRODUTO", val: data.solucaoProd, desc: "Escopo técnico e equipamentos ofertados" },
    { label: "FERRAMENTAL", val: data.solucaoFerr, desc: "Dispositivos e customizações técnicas" },
    { label: "FORNECIMENTO", val: data.solucaoForn, desc: "Logística, instalação e ativação" },
    { label: "SUPORTE TÉCNICO", val: data.solucaoSup, desc: "Garantias, SLA e pós-venda" }
  ];

  const solX1 = 0.8;
  const solX2 = 5.2;
  const solY1 = 1.4;
  const solY2 = 3.2;
  const solW = 4.0;
  const solH = 1.4;

  solCards.forEach((sc, idx) => {
    const x = idx % 2 === 0 ? solX1 : solX2;
    const y = idx < 2 ? solY1 : solY2;

    // Card background
    slide4.addShape("rect", {
      x,
      y,
      w: solW,
      h: solH,
      fill: { color: "FFFFFF" },
      line: { color: "E2E8F0", width: 1 }
    });

    // Solid accent line on the left border of the card
    slide4.addShape("rect", {
      x,
      y,
      w: 0.1,
      h: solH,
      fill: { color: theme.primaryColor }
    });

    // Card label
    slide4.addText(sc.label, {
      x: x + 0.25,
      y: y + 0.15,
      w: solW - 0.4,
      h: 0.2,
      fontSize: 10,
      fontFace: "Inter",
      color: theme.secondaryColor,
      bold: true
    });

    // Card value
    slide4.addText(sc.val, {
      x: x + 0.25,
      y: y + 0.4,
      w: solW - 0.4,
      h: 0.4,
      fontSize: 12,
      fontFace: "Inter",
      color: theme.textColor,
      bold: true,
      valign: "top"
    });

    // Card sub-description
    slide4.addText(sc.desc, {
      x: x + 0.25,
      y: y + 0.85,
      w: solW - 0.4,
      h: 0.4,
      fontSize: 9,
      fontFace: "Inter",
      color: "64748B",
      valign: "top"
    });
  });

  // ==========================================
  // SLIDE 5: ESCOPO COMERCIAL (2 Columns)
  // ==========================================
  const slide5 = pptx.addSlide();
  applyStandardSlideTemplate(slide5, theme, "Escopo Comercial", data.projectCode, data.clientName);

  // Left column: Incluso
  slide5.addText("ITENS INCLUSOS E SERVIÇOS", {
    x: 0.8,
    y: 1.4,
    w: 4.0,
    h: 0.3,
    fontSize: 12,
    fontFace: "Inter",
    color: theme.successColor,
    bold: true
  });

  let incY = 1.8;
  data.escopoIncluso.slice(0, 5).forEach(item => {
    slide5.addShape("rect", {
      x: 0.8,
      y: incY + 0.05,
      w: 0.08,
      h: 0.08,
      fill: { color: theme.successColor }
    });
    slide5.addText(item, {
      x: 1.0,
      y: incY,
      w: 3.8,
      h: 0.5,
      fontSize: 10,
      fontFace: "Inter",
      color: "334155",
      valign: "top"
    });
    incY += 0.55;
  });

  // Right column: Não incluso
  slide5.addText("NÃO INCLUSO / RESPONSABILIDADES DO CLIENTE", {
    x: 5.2,
    y: 1.4,
    w: 4.0,
    h: 0.3,
    fontSize: 12,
    fontFace: "Inter",
    color: "E11D48", // red
    bold: true
  });

  let excY = 1.8;
  data.escopoNaoIncluso.slice(0, 5).forEach(item => {
    slide5.addShape("rect", {
      x: 5.2,
      y: excY + 0.05,
      w: 0.08,
      h: 0.08,
      fill: { color: "E11D48" }
    });
    slide5.addText(item, {
      x: 5.4,
      y: excY,
      w: 3.8,
      h: 0.5,
      fontSize: 10,
      fontFace: "Inter",
      color: "334155",
      valign: "top"
    });
    excY += 0.55;
  });

  // Premissas bottom callout
  if (data.escopoPremissas.length > 0) {
    slide5.addShape("rect", {
      x: 0.8,
      y: 4.5,
      w: 8.4,
      h: 0.5,
      fill: { color: "FFFBEB" },
      line: { color: "FEF3C7", width: 1 }
    });
    slide5.addText(`* Premissa técnica: ${data.escopoPremissas.join(" | ")}`, {
      x: 1.0,
      y: 4.5,
      w: 8.0,
      h: 0.5,
      fontSize: 9,
      fontFace: "Inter",
      color: "B45309",
      valign: "middle"
    });
  }

  // ==========================================
  // SLIDE 6: COMPOSIÇÃO DE INVESTIMENTO (Table with breathing room)
  // ==========================================
  const slide6 = pptx.addSlide();
  applyStandardSlideTemplate(slide6, theme, "Composição de Investimento", data.projectCode, data.clientName);

  // Table rows structure
  const tableHeaders = [
    { text: "Item", options: { bold: true, color: "FFFFFF", fill: theme.primaryColor, align: "center" } },
    { text: "Descrição do Equipamento / Serviço", options: { bold: true, color: "FFFFFF", fill: theme.primaryColor } },
    { text: "Qtd", options: { bold: true, color: "FFFFFF", fill: theme.primaryColor, align: "center" } },
    { text: "Unitário", options: { bold: true, color: "FFFFFF", fill: theme.primaryColor, align: "right" } },
    { text: "Total", options: { bold: true, color: "FFFFFF", fill: theme.primaryColor, align: "right" } }
  ];

  const tableRows = [tableHeaders];
  data.items.slice(0, 5).forEach((it, idx) => {
    tableRows.push([
      { text: String(idx + 1), options: { align: "center" } },
      { text: `${it.name} (${it.sku})`, options: {} },
      { text: `${it.quantity} ${it.unit}`, options: { align: "center" } },
      { text: it.negotiatedPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), options: { align: "right" } },
      { text: it.totalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), options: { align: "right" } }
    ] as any);
  });

  // Render Table
  slide6.addTable(tableRows, {
    x: 0.8,
    y: 1.3,
    w: 8.4,
    colWidths: [0.6, 4.0, 0.8, 1.5, 1.5],
    fontSize: 10,
    fontFace: "Inter",
    border: { type: "none" },
    fill: { color: "FFFFFF" },
    color: "334155",
    rowH: 0.35,
    valign: "middle"
  });

  // Total summary card on the bottom right
  const summaryY = 3.6;
  slide6.addShape("rect", {
    x: 5.5,
    y: summaryY,
    w: 3.7,
    h: 1.3,
    fill: { color: "F1F5F9" },
    line: { color: "E2E8F0", width: 1 }
  });

  slide6.addText("Subtotal:", {
    x: 5.7,
    y: summaryY + 0.15,
    w: 1.5,
    h: 0.25,
    fontSize: 10,
    fontFace: "Inter",
    color: "64748B",
    bold: true
  });
  slide6.addText(data.totalGrossValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), {
    x: 7.3,
    y: summaryY + 0.15,
    w: 1.7,
    h: 0.25,
    fontSize: 10,
    fontFace: "Inter",
    color: "334155",
    align: "right"
  });

  if (data.totalDiscount > 0) {
    slide6.addText("Desconto comercial:", {
      x: 5.7,
      y: summaryY + 0.4,
      w: 1.5,
      h: 0.25,
      fontSize: 10,
      fontFace: "Inter",
      color: theme.successColor,
      bold: true
    });
    slide6.addText(`- ${data.totalDiscount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`, {
      x: 7.3,
      y: summaryY + 0.4,
      w: 1.7,
      h: 0.25,
      fontSize: 10,
      fontFace: "Inter",
      color: theme.successColor,
      align: "right"
    });
  }

  slide6.addText("VALOR TOTAL:", {
    x: 5.7,
    y: summaryY + 0.75,
    w: 1.5,
    h: 0.35,
    fontSize: 12,
    fontFace: "Inter",
    color: theme.primaryColor,
    bold: true
  });
  slide6.addText(data.totalNetValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), {
    x: 7.1,
    y: summaryY + 0.75,
    w: 1.9,
    h: 0.35,
    fontSize: 15,
    fontFace: "Inter",
    color: theme.primaryColor,
    bold: true,
    align: "right"
  });

  // bottom disclaimer
  slide6.addText("* Impostos inclusos conforme regras tributárias vigentes. Condição de Frete: " + data.freightCondition, {
    x: 0.8,
    y: 4.8,
    w: 4.5,
    h: 0.25,
    fontSize: 8,
    fontFace: "Inter",
    color: "64748B"
  });

  // ==========================================
  // SLIDE 7: CONDIÇÕES COMERCIAIS (3x2 Grid)
  // ==========================================
  const slide7 = pptx.addSlide();
  applyStandardSlideTemplate(slide7, theme, "Condições Comerciais", data.projectCode, data.clientName);

  const condCards = [
    { label: "VALIDADE DA PROPOSTA", val: data.condicoesValidade, desc: "Manutenção das condições comerciais" },
    { label: "PRAZO DE ENTREGA", val: data.condicoesPrazo, desc: "A contar da aprovação/início" },
    { label: "CONDIÇÕES DE PAGAMENTO", val: data.condicoesPagamento, desc: "Termos e parcelamento" },
    { label: "AMORTIZAÇÃO DO INVESTIMENTO", val: data.condicoesAmortizacao, desc: "Políticas de repasse/ferramental" },
    { label: "EXCLUSIVIDADE", val: data.condicoesExclusividade, desc: "Fronteiras e restrições acordadas" },
    { label: "PREMISSAS GERAIS", val: data.condicoesPremissas, desc: "Premissas operacionais necessárias" }
  ];

  const condX1 = 0.8;
  const condX2 = 3.7;
  const condX3 = 6.6;
  const condY1 = 1.4;
  const condY2 = 3.2;
  const condW = 2.6;
  const condH = 1.5;

  condCards.forEach((cc, idx) => {
    const x = idx % 3 === 0 ? condX1 : idx % 3 === 1 ? condX2 : condX3;
    const y = idx < 3 ? condY1 : condY2;

    slide7.addShape("rect", {
      x,
      y,
      w: condW,
      h: condH,
      fill: { color: "FFFFFF" },
      line: { color: "E2E8F0", width: 1 }
    });

    // Top color bar
    slide7.addShape("rect", {
      x,
      y,
      w: condW,
      h: 0.1,
      fill: { color: theme.secondaryColor }
    });

    slide7.addText(cc.label, {
      x: x + 0.15,
      y: y + 0.18,
      w: condW - 0.3,
      h: 0.25,
      fontSize: 8,
      fontFace: "Inter",
      color: theme.primaryColor,
      bold: true
    });

    slide7.addText(cc.val, {
      x: x + 0.15,
      y: y + 0.45,
      w: condW - 0.3,
      h: 0.45,
      fontSize: 11,
      fontFace: "Inter",
      color: theme.textColor,
      bold: true,
      valign: "top"
    });

    slide7.addText(cc.desc, {
      x: x + 0.15,
      y: y + 0.95,
      w: condW - 0.3,
      h: 0.45,
      fontSize: 8,
      fontFace: "Inter",
      color: "64748B",
      valign: "top"
    });
  });

  // ==========================================
  // SLIDE 8: BENEFÍCIOS PARA O CLIENTE (5 columns)
  // ==========================================
  const slide8 = pptx.addSlide();
  applyStandardSlideTemplate(slide8, theme, "Benefícios para o Cliente", data.projectCode, data.clientName);

  const benColW = 1.5;
  const benGap = 0.22;
  const benStartX = 0.8;
  const benY = 1.6;
  const benH = 3.1;

  const benCards = [
    { title: "OTIMIZAÇÃO CAPEX", text: "Menor investimento inicial garantindo melhor taxa de retorno." },
    { title: "PREVISIBILIDADE", text: "Custos conhecidos de manutenção e amortização." },
    { title: "SEGURANÇA", text: "Redução do risco operacional por equipamentos homologados." },
    { title: "PARCERIA TÉCNICA", text: "Engenharia dedicada no pós-venda para melhorias contínuas." },
    { title: "EFICIÊNCIA", text: "Aumento real de produtividade no processo industrial." }
  ];

  benCards.forEach((bc, idx) => {
    const x = benStartX + idx * (benColW + benGap);

    slide8.addShape("rect", {
      x,
      y: benY,
      w: benColW,
      h: benH,
      fill: { color: "FFFFFF" },
      line: { color: "E2E8F0", width: 1 }
    });

    // Check icon highlight
    slide8.addShape("rect", {
      x: x + 0.15,
      y: benY + 0.2,
      w: 0.15,
      h: 0.15,
      fill: { color: theme.successColor }
    });

    slide8.addText(bc.title, {
      x: x + 0.15,
      y: benY + 0.45,
      w: benColW - 0.3,
      h: 0.4,
      fontSize: 10,
      fontFace: "Inter",
      color: theme.primaryColor,
      bold: true,
      valign: "top"
    });

    slide8.addText(bc.text, {
      x: x + 0.15,
      y: benY + 0.95,
      w: benColW - 0.3,
      h: 2.0,
      fontSize: 9,
      fontFace: "Inter",
      color: "475569",
      valign: "top"
    });
  });

  // ==========================================
  // SLIDE 9: PRÓXIMOS PASSOS (Horizontal timeline)
  // ==========================================
  const slide9 = pptx.addSlide();
  applyStandardSlideTemplate(slide9, theme, "Próximos Passos", data.projectCode, data.clientName);

  // Timeline base line
  slide9.addShape("line", {
    x: 1.0,
    y: 2.6,
    w: 8.0,
    h: 0,
    line: { color: theme.secondaryColor, width: 2 }
  });

  const stepsCount = data.proximosPassos.length;
  const stepGap = 8.0 / (stepsCount - 1 || 1);

  data.proximosPassos.forEach((step, idx) => {
    const x = 1.0 + idx * stepGap;

    // Timeline Node Circle
    slide9.addShape("oval", {
      x: x - 0.12,
      y: 2.6 - 0.12,
      w: 0.24,
      h: 0.24,
      fill: { color: theme.primaryColor },
      line: { color: "FFFFFF", width: 2 }
    });

    // Time detail above node
    slide9.addText(step.detail, {
      x: x - 1.0,
      y: 2.0,
      w: 2.0,
      h: 0.4,
      fontSize: 10,
      fontFace: "Inter",
      color: theme.accentColor,
      bold: true,
      align: "center",
      valign: "bottom"
    });

    // Step description below node
    slide9.addText(step.step, {
      x: x - 0.9,
      y: 2.9,
      w: 1.8,
      h: 1.2,
      fontSize: 10,
      fontFace: "Inter",
      color: theme.textColor,
      bold: true,
      align: "center",
      valign: "top"
    });
  });

  // ==========================================
  // SLIDE 10: ENCERRAMENTO
  // ==========================================
  const slide10 = pptx.addSlide();
  slide10.background = { fill: theme.bgFill };

  // Left Side: Bold Statement
  slide10.addText("Agradecemos a oportunidade.", {
    x: 0.8,
    y: 1.8,
    w: 4.5,
    h: 0.6,
    fontSize: 28,
    fontFace: "Inter",
    color: theme.primaryColor,
    bold: true
  });

  slide10.addText("Estamos à disposição para esclarecer eventuais dúvidas e iniciar a parceria técnica.", {
    x: 0.8,
    y: 2.5,
    w: 4.5,
    h: 1.2,
    fontSize: 14,
    fontFace: "Inter",
    color: "475569"
  });

  // Right Side: Contact Card Box
  const contactX = 5.8;
  const contactY = 1.3;
  const contactW = 3.4;
  const contactH = 3.2;

  slide10.addShape("rect", {
    x: contactX,
    y: contactY,
    w: contactW,
    h: contactH,
    fill: { color: "FFFFFF" },
    line: { color: "E2E8F0", width: 1 }
  });

  // Top header color band
  slide10.addShape("rect", {
    x: contactX,
    y: contactY,
    w: contactW,
    h: 0.15,
    fill: { color: theme.primaryColor }
  });

  // Contact details
  slide10.addText("CONTATO COMERCIAL", {
    x: contactX + 0.3,
    y: contactY + 0.3,
    w: contactW - 0.6,
    h: 0.25,
    fontSize: 9,
    fontFace: "Inter",
    color: "64748B",
    bold: true
  });

  slide10.addText(data.responsible || "Equipe Comercial", {
    x: contactX + 0.3,
    y: contactY + 0.6,
    w: contactW - 0.6,
    h: 0.3,
    fontSize: 14,
    fontFace: "Inter",
    color: theme.textColor,
    bold: true
  });

  // Phone / Email / Company
  let contactDetails = `Empresa: ${theme.companyName}\n`;
  if (data.companyIssuer && data.companyIssuer !== theme.companyName) {
    contactDetails += `Emissor: ${data.companyIssuer}\n`;
  }
  contactDetails += `Telefone: ${data.paymentTerms ? "Ver condições comerciais" : "A definir"}\n`;
  contactDetails += `E-mail: comercial@${theme.companyName.toLowerCase().replace(/[^a-z0-9]/g, "") || "empresa"}.com.br`;

  slide10.addText(contactDetails, {
    x: contactX + 0.3,
    y: contactY + 1.0,
    w: contactW - 0.6,
    h: 1.5,
    fontSize: 10,
    fontFace: "Inter",
    color: "334155",
    valign: "top"
  });

  // Web link fallback
  slide10.addText(`www.${theme.companyName.toLowerCase().replace(/[^a-z0-9]/g, "") || "empresa"}.com.br`, {
    x: contactX + 0.3,
    y: contactY + 2.7,
    w: contactW - 0.6,
    h: 0.3,
    fontSize: 9,
    fontFace: "Inter",
    color: theme.secondaryColor,
    bold: true
  });

  // Bottom footer on slide 10 too
  slide10.addShape("line", {
    x: 0.8,
    y: 5.1,
    w: 8.4,
    h: 0,
    line: { color: "E2E8F0", width: 1 }
  });

  slide10.addText(theme.companyName + " © " + new Date().getFullYear(), {
    x: 0.8,
    y: 5.15,
    w: 4.0,
    h: 0.35,
    fontSize: 8,
    fontFace: "Inter",
    color: "64748B",
    valign: "middle"
  });

  // Generate Buffer
  const buffer = await pptx.write("nodebuffer");
  return buffer as Buffer;
}
