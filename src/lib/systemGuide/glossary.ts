import type { WikiGlossaryTerm } from "@/src/lib/systemGuide/types";

export const SYSTEM_WIKI_GLOSSARY: WikiGlossaryTerm[] = [
  {
    term: "BOM",
    definition:
      "Lista de materiais (Bill of Materials): estrutura que define quais matérias-primas e componentes entram na fabricação de um produto.",
    relatedAnchors: ["engenharia-produto", "analise-custo-ciu"],
  },
  {
    term: "CIU",
    definition:
      "Custo Industrial Unitário: soma de matéria-prima (MP), mão de obra (HH) e máquina (HM) para produzir uma unidade. É a base do custo antes de OPEX e impostos na formação de preço.",
    relatedAnchors: ["analise-custo-ciu"],
  },
  {
    term: "MP",
    definition: "Matéria-prima: insumos comprados ou estocados usados diretamente na estrutura do produto.",
    relatedAnchors: ["cad-suprimentos", "analise-custo-ciu"],
  },
  {
    term: "HH",
    definition: "Hora-homem: custo de mão de obra direta aplicado no roteiro de processo do produto.",
    relatedAnchors: ["cad-colaboradores", "analise-custo-ciu"],
  },
  {
    term: "HM",
    definition: "Hora-máquina: custo de uso de equipamento/centro de trabalho no processo produtivo.",
    relatedAnchors: ["cad-maquinas", "analise-custo-ciu"],
  },
  {
    term: "Conversão",
    definition:
      "No contexto de custo, refere-se à parcela de HH + HM (mão de obra e máquina) necessária para fabricar o produto ou componente.",
    relatedAnchors: ["analise-custo-ciu"],
  },
  {
    term: "Nomus",
    definition:
      "Sistema externo de gestão integrado ao IndusCost para sincronizar clientes, produtos, propostas, pedidos e dados financeiros.",
    relatedAnchors: ["integracao-nomus", "manutencao-nomus"],
  },
  {
    term: "Preview",
    definition: "Visualização prévia de uma operação antes de confirmar alterações definitivas.",
    relatedAnchors: ["integracao-nomus"],
  },
  {
    term: "Apply",
    definition:
      "Aplicação efetiva de uma sincronização ou plano de engenharia — grava alterações após validação.",
    relatedAnchors: ["integracao-nomus", "manutencao-nomus-bom"],
  },
  {
    term: "Dry-run",
    definition:
      "Execução em modo de simulação: mostra o que seria alterado sem gravar no banco de dados.",
    relatedAnchors: ["integracao-nomus"],
  },
  {
    term: "ProductBOM",
    definition: "Estrutura de produto cadastrada no IndusCost, linha a linha, com quantidades e custos.",
    relatedAnchors: ["engenharia-produto"],
  },
  {
    term: "Material",
    definition: "Item de suprimento cadastrado no módulo Suprimentos, usado como matéria-prima na BOM.",
    relatedAnchors: ["cad-suprimentos"],
  },
  {
    term: "Produto filho",
    definition:
      "Componente fabricado que entra na estrutura de um produto pai. Pode ter processo e custo próprios.",
    relatedAnchors: ["analise-custo-ciu"],
  },
  {
    term: "Componente fabricado",
    definition:
      "Produto intermediário produzido internamente e usado como item na BOM de outro produto. Na linha da BOM pode aparecer com CIU completo; nos cards de custo, MP e conversão são separados — não é duplicidade.",
    relatedAnchors: ["analise-custo-ciu"],
  },
  {
    term: "Contas a Receber",
    definition: "Títulos a receber de clientes, sincronizados do Nomus e exibidos no módulo Financeiro.",
    relatedAnchors: ["financeiro-receber"],
  },
  {
    term: "Contas a Pagar",
    definition: "Obrigações com fornecedores, sincronizadas do Nomus e exibidas no módulo Financeiro.",
    relatedAnchors: ["financeiro-pagar"],
  },
  {
    term: "Check-in",
    definition: "Registro de retirada do veículo com checklist e odômetro, geralmente via QR fixo do veículo.",
    relatedAnchors: ["frota-checklist-qr"],
  },
  {
    term: "Check-out",
    definition: "Registro de devolução do veículo com checklist e odômetro ao final da reserva.",
    relatedAnchors: ["frota-checklist-qr"],
  },
  {
    term: "Auto check-out",
    definition:
      "Devolução registrada automaticamente quando um novo check-in é feito no mesmo veículo sem check-out anterior.",
    relatedAnchors: ["frota-checklist-qr"],
  },
  {
    term: "QR público",
    definition: "Código QR ou link que permite acesso a formulários públicos (reserva de veículo ou checklist) sem login.",
    relatedAnchors: ["frota-reserva-publica", "frota-checklist-qr"],
  },
  {
    term: "Token",
    definition:
      "Código secreto embutido no link público que identifica o formulário de reserva ou o veículo no checklist. Não deve ser divulgado amplamente.",
    relatedAnchors: ["frota-configuracoes"],
  },
  {
    term: "Reserva aprovada",
    definition: "Solicitação de uso de veículo aceita pela gestão; aguarda check-in na data prevista.",
    relatedAnchors: ["frota-reservas"],
  },
  {
    term: "Reserva em uso",
    definition: "Veículo retirado e em utilização pelo motorista autorizado.",
    relatedAnchors: ["frota-reservas"],
  },
  {
    term: "Avaria",
    definition: "Item do checklist marcado com dano ou problema no veículo. Gera alerta para a gestão.",
    relatedAnchors: ["frota-checklists"],
  },
  {
    term: "CNH",
    definition:
      "Carteira Nacional de Habilitação do motorista. O sistema acompanha validade e pode bloquear retirada se vencida, conforme parâmetros.",
    relatedAnchors: ["frota-motoristas"],
  },
  {
    term: "OPEX",
    definition: "Despesas operacionais indiretas rateadas no custeio, cadastradas em Custos Indiretos.",
    relatedAnchors: ["custos-indiretos-opex"],
  },
  {
    term: "CIF",
    definition: "Custo indireto de fabricação. Entra na análise de custo mas não compõe o CIU (MP+HH+HM).",
    relatedAnchors: ["analise-custo-ciu"],
  },
];
