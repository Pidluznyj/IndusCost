import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchProposalPptxData } from "./clientProposalPptxData.js";
import { createTheme } from "./clientProposalPptxTheme.js";
import { generateClientProposalPptx } from "./clientProposalPptx.server.js";
import { prisma } from "../prisma.js";

describe("Client Proposal PPTX Generator", () => {
  it("carrega proposta e gera arquivo PPTX válido", async () => {
    const mockProposal: any = {
      id: "mock-proposal-id",
      number: 99999,
      title: "Projeto PPTX Automação",
      createdAt: new Date().toISOString(),
      notes: `
# Resumo Executivo
* Objetivo: Desenvolver a linha de montagem automatizada.
* Solucao: Fornecimento de injetores industriais.
* Investimento: R$ 50.000,00
* Beneficio: Redução do ciclo de injeção em 20%.

# Contexto
O cliente necessita otimizar sua produção para atender a demanda contratual crescente.

# Solucao Proposta
* Produto: Injetor de 250 toneladas.
* Ferramental: Molde de 4 cavidades.
* Fornecimento: Turn-key.
* Suporte: Assistência 24/7.

# Escopo Comercial
Incluso:
- Transporte e comissionamento.
- Treinamento operacional.
Nao Incluso:
- Obras civis.
Premissas:
- Pé direito mínimo de 6 metros.

# Condicoes Comerciais
* Validade: 60 dias.
* Prazo: 30 dias úteis.
* Pagamento: 50% entrada, 50% entrega.
* Amortizacao: N/A.
* Exclusividade: Território nacional.

# Beneficios
- Economia de energia.
- Menor setup.

# Proximos Passos
* Assinatura do contrato (Semana 1)
* Desenho técnico (Semana 2)
      `,
      totalItems: 1,
      totalGrossValue: 50000,
      totalDiscount: 0,
      totalNetValue: 50000,
      totalCost: 35000,
      totalMarginValue: 15000,
      totalMarginPerc: 30,
      totalTaxes: 5000,
      totalCommission: 1500,
      totalFreight: 500,
      responsible: "Auditor Técnico",
      companyIssuer: "IndusCost",
      validityDays: 30,
      deliveryTimeDays: 15,
      freightCondition: "CIF",
      deliveryLocation: "São Paulo/SP",
      Customer: {
        companyName: "Empresa de Teste Ltda",
        taxId: "12345678000199",
      },
      items: [
        {
          quantity: 1,
          unit: "UN",
          unitCost: 35000,
          negotiatedPrice: 50000,
          Product: {
            sku: "PROD-TEST-PPT",
            name: "Equipamento Injetor Industrial",
          }
        }
      ]
    };

    // Mock prisma findUnique method
    prisma.proposal.findUnique = async () => mockProposal;

    // 1. Fetch and parse data
    const data = await fetchProposalPptxData("mock-proposal-id");
    assert.ok(data);
    assert.equal(data.clientName, "Empresa de Teste Ltda");
    assert.equal(data.resumoObj, "Desenvolver a linha de montagem automatizada.");
    assert.equal(data.resumoSol, "Fornecimento de injetores industriais.");
    assert.equal(data.escopoIncluso.length, 2);
    assert.equal(data.escopoIncluso[0], "Transporte e comissionamento.");
    assert.equal(data.escopoNaoIncluso[0], "Obras civis.");
    assert.equal(data.proximosPassos[0].step, "Assinatura do contrato");

    // 2. Generate theme
    const theme = createTheme({
      companyName: "IndusCost Test",
      primaryColor: "#059669",
      secondaryColor: "#10B981",
      logoBase64: null,
    });
    assert.equal(theme.primaryColor, "059669");

    // 3. Generate PPTX buffer
    const buffer = await generateClientProposalPptx(data, theme);
    assert.ok(buffer);
    assert.ok(buffer.length > 1000); // Verify it's not an empty buffer
  });
});
