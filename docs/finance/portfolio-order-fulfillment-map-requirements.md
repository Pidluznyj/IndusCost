# Mapa de Atendimento do Pedido — Requisitos de Negócio

**Projeto:** IndusCost / My Industry  
**Módulo:** Financeiro → Conciliação de Carteira → **Central de Inteligência da Carteira**  
**Arquivo de service (preferência):** `src/lib/finance/portfolioOrderFulfillmentMap.ts`  
**Atualizado:** 2026-07-11  
**Escopo deste documento:** formalizar regra de negócio (read-only).  
**Não altera:** Fluxo de Caixa oficial, Contas a Receber oficial, Comissões, Relatório Presidencial.  
**Não faz:** mutation/write no banco, migration sem necessidade real, inventário de dados ausentes.

> Complementa: [`portfolio-intelligence-requirements.md`](./portfolio-intelligence-requirements.md), [`portfolio-intelligence-api.md`](./portfolio-intelligence-api.md), [`portfolio-reconciliation-architecture.md`](./portfolio-reconciliation-architecture.md).

---

## 1. Objetivo da nova lógica

Responder, de forma **visual e auditável**, às perguntas que a maturidade financeira sozinha não cobre:

1. **Todos os itens do pedido foram entregues?** (quantidade × produto)
2. A entrega pode ter ocorrido em **vários documentos de saída**?
3. Se documentos vinculados entregaram **mais** do que o pedido, **qual é o excesso**?
4. Se o documento tem itens que **não pertencem** ao pedido, isso precisa aparecer.
5. O **cabeçalho** da NF/documento **nunca** pode inflar o valor do pedido nem a carteira.

A lógica produz um **Order Fulfillment Map** por pedido, com quatro eixos de leitura:

| Eixo | Pergunta | Pode coexistir com os outros? |
|------|----------|-------------------------------|
| Status financeiro | Já virou CR / recebimento? | Sim |
| Status operacional | Itens do pedido foram atendidos? | Sim |
| Alertas técnicos | Há risco de interpretação do vínculo? | Sim — **não substitui** financeiro |
| Valor confirmado vs operacional | Quanto é caixa/CR vs quanto é atendimento pelo preço do pedido? | Sim — **não somar** os dois |

### Princípios-fonte (obrigatórios)

1. Pedido de venda = **promessa comercial**.
2. Documento de saída = **evidência operacional/fiscal**.
3. Contas a Receber = **evidência financeira**.
4. Baixa/recebimento = **caixa realizado**.
5. Pedido só é operacionalmente **totalmente atendido** quando **todos** os itens foram atendidos em quantidade.
6. Atendimento pode ocorrer em **múltiplos** documentos de saída.
7. Quantidade atendida válida de um item **nunca** passa da quantidade pedida.
8. Excesso de documento = registrado **separadamente**.
9. Excesso **nunca** aumenta valor do pedido, carteira, CR atribuído ou caixa.
10. Item no documento sem correspondente no pedido = **produto fora deste pedido**.
11. Cabeçalho de NF/documento = **referência de risco**, nunca valor automático do pedido.
12. A tela mostra quanto do documento foi **atribuído ao pedido** e quanto ficou **fora**.
13. Pedido pode ter **CR aberto** e, ao mesmo tempo, **alerta técnico**.
14. Alerta técnico **não substitui** status financeiro.
15. Financeiro, operacional e alertas são **eixos diferentes**.
16. Feature **read-only**.
17–20. Não alterar módulos oficiais listados no cabeçalho.
21. Sem write no banco.
22. Sem migration sem necessidade real.
23. Não inventar condição de pagamento, CR, NF, documento ou status.

---

## 2. Problema do layout / lógica atual (antes da formalização)

A Central de Inteligência classificava bem a **maturidade** (recebido / CR / faturado / carteira futura-presente-bloqueada), mas misturava na leitura do usuário:

- **Status financeiro** com **atenção operacional** (ex.: PD 02339 lido como “problema de dinheiro” quando o núcleo era vínculo NF/doc > pedido).
- **Alertas técnicos** parecendo totalizadores financeiros ou “status principal”.
- Cabeçalho de NF sugerindo, visualmente, que o pedido “valia” o total das notas.
- Falta de resposta clara a: *quais linhas dos documentos atenderam quais itens?*

**Caso crítico:** PD 02339 / Britânia — valor do pedido **R$ 158.000,00**; NFs/documentos vinculados com **cabeçalho total maior** que o pedido.  
Regra: o valor oficial do pedido permanece R$ 158.000; o cabeçalho maior vira **alerta**, não carteira.

---

## 3. Regra de negócio item a item

### 3.1 Entradas (somente leitura)

Para cada pedido materializado na conciliação:

- Itens do pedido: produto (`externalProductId`), quantidade pedida, preço unitário / valor do item.
- Documentos de saída / NF vinculados (via fatos / links já materializados).
- Linhas dos documentos (quando houver itemização).
- Títulos CR agregados ao pedido (sem inventar rateio por linha se não existir).

### 3.2 Alocação

1. Agrupar itens do pedido por produto (e identidade de linha quando disponível).
2. Percorrer linhas de documentos de saída relacionados.
3. Comparar por **`externalProductId`** (e evidências já presentes nos fatos).
4. **Alocar** quantidade do documento contra o **saldo** do item do pedido.
5. **Limitar** atendimento ao saldo do pedido (nunca `atendida > pedida` no eixo válido).
6. O que sobrar no documento, após esgotar o saldo do produto no pedido → **excedente**.
7. Produto no documento sem item no pedido → **fora do pedido** (não aloca).

### 3.3 Métricas derivadas (por item e totais)

| Métrica | Definição |
|---------|-----------|
| Quantidade pedida | Soma das qtdes do pedido |
| Quantidade atendida | Soma alocada (limitada ao saldo) |
| Quantidade restante | `pedida − atendida` (≥ 0) |
| % atendimento item | `atendida / pedida` (null se pedida = 0) |
| % atendimento geral | idem no total |
| Valor atendido (preço do pedido) | `qtde atendida × preço unitário do pedido` |
| Valor dos documentos atribuído ao pedido | Soma do valor das linhas/qtdes **alocadas** (preferência: preço do pedido para valor operacional; cabeçalho não entra) |
| Valor de cabeçalho não atribuído | `soma cabeçalhos NF − valor atribuído` (quando cabeçalho conhecido); **risco**, não carteira |
| Divergência de preço | Sinal quando preço doc ≠ preço pedido (alerta) |

**Proibido:** somar pedido + NF + CR; usar total de cabeçalho como “pedido atendido”; inventar linhas ausentes.

---

## 4. Três eixos (e um quarto de valor)

### 4.1 Status financeiro

Eixo: **evidência de Contas a Receber / caixa**.

| Código | Significado |
|--------|-------------|
| `FIN_RECEBIDO` | Há CR e aberto ≈ 0 com recebimento > 0 |
| `FIN_CR_ABERTO` | Há CR com valor em aberto |
| `FIN_FATURADO_SEM_CR` | Há NF e/ou documento/alocação, **sem** CR |
| `FIN_SEM_CR` | Sem evidência de CR |

Não muda automaticamente por alerta técnico (ex.: divergência de preço).

### 4.2 Status operacional

Eixo: **atendimento dos itens do pedido por documento de saída**.

| Código | Significado |
|--------|-------------|
| `OP_TOTALMENTE_ATENDIDO` | Todos os itens atendidos em quantidade; sem excedente relevante a destacar no status |
| `OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE` | Todos os itens atendidos **e** há quantidade/produto excedente nos documentos |
| `OP_PARCIALMENTE_ATENDIDO` | Parte dos itens/qtdes atendida; saldo > 0 |
| `OP_NAO_ATENDIDO` | Nenhuma quantidade alocada aos itens |
| `OP_DOCUMENTO_SEM_ITEMIZACAO` | Há documento, sem linhas usáveis para alocar |
| `OP_VINCULO_APENAS_CABECALHO` | Só vínculo de cabeçalho NF (sem itemização) |

**Nota de contrato:** `OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE` é status operacional **oficial deste documento**. A emissão no service pode ser refinada na entrega de implementação seguinte; até lá, o excedente já deve aparecer em alertas/`surplusItems` mesmo se o status ainda for `OP_TOTALMENTE_ATENDIDO`.

### 4.3 Alertas técnicos

Eixo: **qualidade / risco de interpretação**. Podem coexistir com qualquer financeiro. **Não somam carteira.**

| Código | Significado |
|--------|-------------|
| `NF_CABECALHO_MAIOR_PEDIDO` | Soma dos cabeçalhos de NF > valor do pedido |
| `DIVERGENCIA_PRECO` | Preço do documento diverge do preço do pedido |
| `QUANTIDADE_EXCEDENTE_DOCUMENTO` | Documento tem qtde além do saldo do pedido |
| `PRODUTO_FORA_DO_PEDIDO` | Linha de documento sem produto no pedido |
| `ITEM_DO_PEDIDO_NAO_ATENDIDO` | Item do pedido com saldo > 0 (útil em parciais / auditoria) |
| `DOCUMENTO_SEM_CR` | Há doc/alocação sem CR |
| `CR_SEM_RATEIO_SEGURO` | CR existe, mas sem rateio itemizado seguro ao pedido |
| `VINCULO_INCOMPLETO` | Vínculo parcial / só cabeçalho / ambíguo |
| `SEM_CONDICAO_PAGAMENTO` | Condição de pagamento ausente na importação |

Tags auxiliares já usadas na inteligência (`DIVERGENCIA_TECNICA`, `NF_SEM_DOCUMENTO`, `PEDIDO_ANTIGO_SEM_EVOLUCAO`) podem coexistir; **não** viram valor financeiro.

### 4.4 Valor financeiro confirmado vs valor operacional do pedido

| Conceito | Fonte | Uso na UI |
|----------|-------|-----------|
| Valor do pedido | Pedido oficial | Sempre o âncora da carteira comercial |
| Valor operacional atendido | Qtde alocada × preço do pedido | Mostra “quanto do pedido foi coberto por saída” |
| Valor CR / recebido / aberto | Títulos vinculados | Mostra “quanto já é financeiro” |
| Cabeçalho NF | Soma de cabeçalhos | Só risco / comparação — **nunca** substitui pedido |

**Regra de ouro:** cards de alerta ≠ totalizadores de dinheiro. Texto discreto obrigatório:  
*“Alertas técnicos podem coexistir com um status financeiro. Eles não somam carteira.”*

---

## 5. Regras de excesso

1. Após alocar até o saldo do item, qualquer quantidade adicional do mesmo produto no documento = **excedente**.
2. Excedente entra em `surplusItems` / alerta `QUANTIDADE_EXCEDENTE_DOCUMENTO`.
3. Excedente **não** aumenta: valor do pedido, carteira, CR atribuído, caixa, % de atendimento válido.
4. Se o pedido estiver 100% atendido **e** houver excedente → preferir `OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE` (contrato) + alertas.
5. Excesso de **cabeçalho** (NF total > pedido) é `NF_CABECALHO_MAIOR_PEDIDO`, distinto de excesso de **quantidade de linha**.

---

## 6. Regras de produto fora do pedido

1. Linha de documento cujo `externalProductId` **não** existe nos itens do pedido → `PRODUTO_FORA_DO_PEDIDO`.
2. Não aloca quantidade nem valor ao pedido.
3. Aparece em `unmatchedItems` / grid de documentos.
4. Não “completa” atendimento de outros itens.

---

## 7. Regras de cabeçalho de NF

1. Cabeçalho é **referência de risco**.
2. **Não** usar total de cabeçalho para dizer que o pedido foi atendido.
3. Se só existir cabeçalho (sem itemização) → `OP_VINCULO_APENAS_CABECALHO` + `VINCULO_INCOMPLETO`.
4. Se `Σ cabeçalhos > valor do pedido` → `NF_CABECALHO_MAIOR_PEDIDO`; campos `nfeHeaderTotal`, `nfeHeaderNotAttributed`, `hasHeaderInflationRisk`.
5. UI deve mostrar: valor atribuído ao pedido **vs** valor fora do pedido **por documento**.

---

## 8. Regras de CR / recebimento

1. CR/recebido/aberto vêm dos fatos / títulos já vinculados — **sem inventar** títulos.
2. Agregados no nível do pedido são válidos; rateio por linha só se houver evidência segura.
3. Sem rateio seguro → alerta `CR_SEM_RATEIO_SEGURO`; `attributionStatus` pode ser `ORDER_AGGREGATE`, `TITLE_IDS_ONLY` ou `UNAVAILABLE`.
4. Status financeiro usa CR/recebimento; **não** usa cabeçalho NF.
5. CR aberto + alerta técnico = `FIN_CR_ABERTO` + tags — eixos separados.
6. Pedido antigo sem NF/doc/CR: financeiro `FIN_SEM_CR`, operacional `OP_NAO_ATENDIDO`, maturidade de carteira (ex. vencida bloqueada) conforme classificador existente.

---

## 9. Campos esperados no backend

Endpoint de detalhe (já existente / a manter):

`GET /api/finance/portfolio-reconciliation/intelligence/orders/:salesOrderId`

Seção **`fulfillmentMap`**:

```ts
{
  financialStatus: PortfolioFinancialStatus;
  operationalStatus: PortfolioOperationalStatus;
  technicalAlerts: PortfolioTechnicalAlert[];
  fulfillmentSummary: {
    orderValue: number;
    attributedOrderValue: number;
    totalOrderQuantity: number;
    attendedQuantity: number;
    remainingQuantity: number;
    fulfillmentPercent: number | null;
    receivableTotal: number;
    receivedValue: number;
    openReceivableValue: number;
    nfeHeaderTotal: number;
    nfeHeaderNotAttributed: number;
    isFullyFulfilledByItems: boolean;
    hasHeaderInflationRisk: boolean;
  };
  orderItemsCoverage: Array<{
    productExternalId: number | null;
    productCode: string | null;
    description: string | null;
    orderedQuantity: number;
    attendedQuantity: number;
    remainingQuantity: number;
    fulfillmentPercent: number | null;
    orderUnitValue: number;
    orderItemValue: number;
    attendedValueByOrderPrice: number;
    documentsUsed: Array<{ /* NF/doc + qtde alocada */ }>;
    alerts: string[];
  }>;
  stockDocumentsCoverage: Array<{
    nfeNumber: string | null;
    nfeExternalId: number | null;
    stockDocumentExternalId: number | null;
    date: string | null;
    nfeHeaderValue: number | null;
    valueAttributedToOrder: number;
    valueNotAttributedToOrder: number;
    matchedItems: Array<...>;
    unmatchedItems: Array<...>;
    surplusItems: Array<...>;
    alerts: string[];
  }>;
  receivablesCoverage: Array<{
    receivableId: number | null;
    dueDate: string | null;
    settlementDate: string | null;
    totalValue: number | null;
    receivedValue: number | null;
    openValue: number | null;
    sourceNfe: number | null;
    attributionStatus: "ORDER_AGGREGATE" | "TITLE_IDS_ONLY" | "UNAVAILABLE";
  }>;
  executiveConclusion: string;
}
```

Service: `buildPortfolioOrderFulfillmentMap(...)` em `portfolioOrderFulfillmentMap.ts` — **puro / read-only** sobre fatos materializados.

---

## 10. Campos esperados no drawer

### Topo (três cards pequenos)

1. **Financeiro** — rótulo de `financialStatus` (+ recebido parcial se houver).
2. **Atendimento do pedido** — `operationalStatus` + % de itens.
3. **Alertas técnicos** — lista curta (não totalizadores).

### Aba 1 — “Mapa de atendimento”

1. **Resumo visual:** Pedido · Atendido · Restante · CR · Recebido · Aberto · Alerta cabeçalho NF.
2. **Grid itens:** produto, qtde pedida/atendida/saldo, %, valor item, docs/NFs, alertas.
3. **Grid documentos:** NF/doc, data, cabeçalho, valor atribuído, valor fora, casados, excedentes.
4. **Grid CR:** título, vencimento, baixa, valor, recebido, aberto, fonte.

Demais abas (Pedido, Itens, NF, CR, Pagamento, Histórico) permanecem; **proibido** JSON cru.

### Cards principais da tela (blocos)

1. **Financeiro confirmado** — Já recebido · CR aberto · Faturado sem CR.
2. **Carteira operacional** — Futuro · Presente · Vencida bloqueada (+ total analisada quando aplicável).
3. **Alertas técnicos** — visual distinto; aviso de coexistência / não somam carteira.

---

## 11. Validações obrigatórias — PD 02339 / Britânia

Script: `tmp-audits/validate-pd02339-fulfillment-map.ts`  
Valor âncora do pedido: **R$ 158.000,00**.

| # | Critério |
|---|----------|
| 1 | PD 02339 encontrado |
| 2 | Valor do pedido = 158.000 (não o cabeçalho NF) |
| 3 | NFs/documentos vinculados listados |
| 4 | Cabeçalho total de NF **não** usado como valor do pedido |
| 5 | Itens do pedido individuais com qtde pedida, atendida e saldo |
| 6 | CR vinculado aparece quando existir na materialização |
| 7 | Recebido/aberto refletem dados atuais pós-sync (quando DB disponível) |
| 8 | Alertas técnicos separados do status financeiro |
| 9 | Se todos os itens atendidos em qtde → operacional total (com ou sem excedente) |
| 10 | Produto fora / excedente marcados quando presentes no fixture |
| 11 | `NF_CABECALHO_MAIOR_PEDIDO` quando cabeçalho > pedido |
| 12 | Pedido antigo sem NF/doc/CR continua carteira vencida bloqueada (classificador) |
| 13 | Alertas não duplicam valor nos cards principais |
| 14 | Drawer não exibe JSON cru |

Testes unitários do map: `portfolioOrderFulfillmentMap.test.ts`.

---

## 12. Definition of Ready (DoR)

- [x] Caso PD 02339 / Britânia descrito com valor oficial do pedido.
- [x] Três eixos + valor confirmado vs operacional formalizados.
- [x] Regras de alocação, excesso, fora do pedido e cabeçalho escritas.
- [x] Lista de status financeiros / operacionais / alertas acordada neste doc.
- [x] Contrato de `fulfillmentMap` descrito.
- [x] Restrições: read-only; sem alterar módulos oficiais; sem inventar dados.
- [ ] (Entrega seguinte) Emissão completa de `OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE` e `ITEM_DO_PEDIDO_NAO_ATENDIDO` se ainda stub no service.
- [ ] (Entrega seguinte) UX leiga revisada com usuário de negócio no drawer PD 02339 com DB.

---

## 13. Definition of Done (DoD)

### Deste prompt (documentação / contrato)

- [x] Documento `docs/finance/portfolio-order-fulfillment-map-requirements.md` publicado.
- [x] Contrato TS alinhado aos códigos sugeridos (tipos/rótulos), **sem** mudar módulos oficiais.
- [x] Checks: `check:server-imports`, `check:frontend-server-imports`, `npm test`, `build`, `check:browser-bundle`.
- [x] Commit + push + hash.

### Entrega de implementação completa (referência futura)

- [ ] Service emite todos os status/alertas deste contrato conforme regras.
- [ ] Drawer e cards refletem os quatro eixos sem misturar alertas com dinheiro.
- [ ] Script PD 02339 PASS (DB ou fixture documentado).
- [ ] Britânia maturity script continua PASS (status de carteira preservado).

---

## 14. Riscos conhecidos

| Risco | Mitigação |
|-------|-----------|
| Usuário ler cabeçalho NF como “valor do pedido” | UI + alerta `NF_CABECALHO_MAIOR_PEDIDO`; copy leiga |
| Somar pedido + NF + CR | Proibido no backend e nos cards |
| Inventar rateio de CR por item | `CR_SEM_RATEIO_SEGURO` / `TITLE_IDS_ONLY` |
| Documento sem itemização | `OP_DOCUMENTO_SEM_ITEMIZACAO` / vínculo só cabeçalho |
| Alertas parecerem KPI financeiro | Bloco visual distinto + `isAlertCard` |
| Status operacional “total” esconder excedente | Status `…_COM_EXCEDENTE` + `surplusItems` |
| DB offline em auditoria | Scripts com fallback fixture **sem maquiar** números |
| Confundir maturidade (`CARTEIRA_*`) com `FIN_*` / `OP_*` | Manter classificador de maturidade; fulfillment map é eixo paralelo |

---

## 15. Como interpretar (usuário leigo)

| Termo | Significado |
|-------|-------------|
| **Atendido** | Os itens do pedido foram encontrados em documentos de saída, respeitando **quantidade** e **produto**. |
| **Excedente** | Quantidade/documento **acima** do que aquele pedido comporta. Não é dinheiro a mais na carteira. |
| **Fora do pedido** | Produto no documento que **não existe** nos itens daquele pedido. |
| **Financeiro confirmado** | Já virou Contas a Receber ou recebimento (caixa/CR). |
| **Alerta técnico** | **Não é dinheiro novo**; é risco de interpretação do vínculo/documento. Pode coexistir com CR aberto ou recebido. |
| **Pedido** | Promessa comercial (valor oficial). |
| **Documento de saída / NF** | Evidência de que algo saiu; o que importa para atendimento são as **linhas**, não só o total do cabeçalho. |

### Exemplos de leitura

- **PD 02339:** Financeiro conforme CR (ou faturado sem CR, se ainda não houver título); operacional conforme itens alocados; alertas: NF maior que pedido / preço / excedente / produto fora — **sem** trocar o valor do pedido para a soma das NFs.
- **Pedido antigo sem NF/doc/CR:** Financeiro `FIN_SEM_CR`; operacional `OP_NAO_ATENDIDO`; carteira vencida/bloqueada no eixo de maturidade.
- **CR aberto + divergência:** Financeiro `FIN_CR_ABERTO`; operacional pelo atendimento; alertas técnicos ao lado.

---

## Referência rápida de arquivos

| Peça | Caminho |
|------|---------|
| Service map | `src/lib/finance/portfolioOrderFulfillmentMap.ts` |
| Testes map | `src/lib/finance/portfolioOrderFulfillmentMap.test.ts` |
| API detalhe | `src/lib/finance/portfolioMaturityIntelligenceApi.ts` |
| Drawer | `src/components/finance/portfolio-reconciliation/PortfolioIntelligenceOrderDrawer.tsx` |
| Cards | `src/components/finance/portfolio-reconciliation/PortfolioIntelligenceCards.tsx` |
| Audit PD 02339 | `tmp-audits/validate-pd02339-fulfillment-map.ts` |
| Audit Britânia | `tmp-audits/validate-portfolio-intelligence-britania.ts` |
