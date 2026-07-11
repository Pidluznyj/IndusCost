# Funil Pedido → Caixa — Requisitos de Negócio e Arquitetura

**Subtítulo:** Modelo industrial para acompanhar o caminho do **Pedido de Venda** até Documento de Saída, NF, Contas a Receber e Baixa.

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Módulo** | Dashboard Gerencial → aba **Funil de Venda** (conceito oficial: **Funil Pedido → Caixa** / Funil de Receita Industrial) |
| **Tipo** | Requisitos oficiais (negócio + arquitetura + visual) |
| **Data** | 2026-07-11 |
| **Estado** | Documento de requisitos — **antes** de código novo desta evolução |
| **Preferência de cálculo** | Fatos e tabelas já materializados (sem migration) |
| **Escrita neste prompt** | Somente documentação — **sem** alterar UI, backend ou migration |

> Documentos relacionados:  
> [`../finance/portfolio-cash-forecast-audit-requirements.md`](../finance/portfolio-cash-forecast-audit-requirements.md) ·  
> [`../finance/portfolio-order-fulfillment-map-requirements.md`](../finance/portfolio-order-fulfillment-map-requirements.md) ·  
> [`../finance/portfolio-intelligence-requirements.md`](../finance/portfolio-intelligence-requirements.md)

---

## Sumário

1. [Decisão conceitual](#1-decisão-conceitual)  
2. [Problema que queremos resolver](#2-problema-que-queremos-resolver)  
3. [Paradigma oficial](#3-paradigma-oficial)  
4. [Etapas oficiais do funil](#4-etapas-oficiais-do-funil)  
5. [Três eixos](#5-três-eixos)  
6. [Regra de temperatura](#6-regra-de-temperatura)  
7. [Regras de evidência](#7-regras-de-evidência)  
8. [Regras de Ordem de Produção](#8-regras-de-ordem-de-produção)  
9. [KPIs da tela](#9-kpis-da-tela)  
10. [Layout esperado](#10-layout-esperado)  
11. [Cores oficiais](#11-cores-oficiais)  
12. [Tipografia](#12-tipografia)  
13. [Definition of Ready (DoR)](#13-definition-of-ready-dor)  
14. [Definition of Done (DoD)](#14-definition-of-done-dod)  
15. [Casos obrigatórios](#15-casos-obrigatórios)  
16. [Arquitetura esperada (orientação)](#16-arquitetura-esperada-orientação)  
17. [Glossário](#17-glossário)

---

## 1. Decisão conceitual

### 1.1 O que o funil oficial **é**

O funil oficial do IndusCost para a aba de Funil de Venda passa a ser o **Funil Pedido → Caixa** (também chamado **Funil de Receita Industrial**).

| Decisão | Conteúdo |
|---------|----------|
| **Fonte oficial** | **Pedido de Venda** (`SalesOrder` / Nomus) |
| **Unidade mínima** | Pedido (e, no detalhe, item do pedido) |
| **Caminho** | Cliente → Pedido → Documento de saída → NF → Contas a Receber → Baixa |
| **Tipo** | Funil **industrial / order-to-cash**, read-only, analítico e de auditoria |

### 1.2 O que o funil oficial **não é**

| Não é | Por quê |
|-------|---------|
| Funil de **oportunidade** | Indústria vende e entrega sobre pedido, não sobre lead |
| Funil mandado por **proposta/cotação** | Proposta não formaliza caixa, CR, faturamento nem comissão |
| Substituição do **Fluxo de Caixa oficial** | Forecast/auditoria da tela é paralelo |
| Substituição do **Contas a Receber oficial** | CR na tela é evidência de conciliação/auditoria |
| Fonte de **comissões** | Remuneração continua no módulo de Comissões |

### 1.3 Proposta / cotação

Proposta/cotação pode aparecer **apenas como histórico comercial opcional**, quando existir na importação:

- ajuda a explicar origem comercial do pedido;  
- **não** manda em financeiro, fluxo de caixa, comissões, faturamento, atendimento, status de pedido, receita, CR ou baixa;  
- se ausente: **“Informação não disponível na importação atual.”**

### 1.4 Renomeação conceitual

| Nome legado (UI atual / conversa) | Nome conceitual oficial |
|-----------------------------------|-------------------------|
| Funil de Venda / Funil de Vendas | **Funil Pedido → Caixa** |
| Alternativa de comunicação | **Funil de Receita Industrial** |

A troca de rótulo na UI fica para entrega futura — **este documento não altera código**.

---

## 2. Problema que queremos resolver

A tela deve responder, de forma auditável:

| # | Pergunta |
|---|----------|
| 1 | Quais pedidos estão **saudáveis**? |
| 2 | Quais pedidos estão **antigos / parados**? |
| 3 | Quais pedidos **não viraram documento de saída**? |
| 4 | Quais pedidos viraram documento **parcial**? |
| 5 | Quais pedidos viraram **NF**? |
| 6 | Quais pedidos viraram **CR**? |
| 7 | Quais pedidos viraram **caixa** (baixa)? |
| 8 | Onde o processo comercial-industrial **travou**? |
| 9 | O que está **inflando forecast** (cabeçalho, excesso, pedido sem evidência)? |
| 10 | Qual **vendedor / cliente** concentra pedido parado? |
| 11 | Qual pedido precisa ação do **comercial, PCP, faturamento ou financeiro**? |

**Regra-mãe:**  
planejar pelo **pedido** → confirmar pela **entrega / documento** → formalizar pelo **CR** → realizar pela **baixa**.

---

## 3. Paradigma oficial

### 3.1 Cadeia obrigatória

```text
Cliente
  → Pedido de Venda
    → Documento de Saída
      → NF
        → Contas a Receber (CR)
          → Baixa
```

### 3.2 Produção / Ordem de Produção (opcional)

```text
Cliente
  → Pedido de Venda
    → [Ordem de Produção, se API/dado confiável existir]
      → Documento de Saída
        → NF → CR → Baixa
```

Se **não** houver API/dado confiável de OP:

- o funil **continua funcionando** sem essa etapa;  
- não bloquear métricas;  
- exibir “Informação não disponível na importação atual.” quando o usuário pedir detalhe de OP.

### 3.3 O que não se faz

- Não usar **cabeçalho de NF** como valor automático do pedido.  
- Não **somar** Pedido + Documento + NF + CR.  
- Não tratar pedido antigo aberto como “lead quente”.  
- Não alterar módulos oficiais (Fluxo de Caixa, AR, Comissões, Presidencial, Precificação, BOM, Suprimentos).  
- Não fazer write/migration sem autorização.

---

## 4. Etapas oficiais do funil

Cada pedido tem **um estágio principal** no funil (não duplicar valor entre estágios exclusivos). Alertas técnicos (excesso, produto fora, NF > pedido) **coexistem** e **não somam** carteira.

| Código | Nome exibido | Regra (resumo) | Fonte | Confiança típica | Ação recomendada | Responsável sugerido |
|--------|--------------|----------------|-------|------------------|------------------|----------------------|
| `CLIENTE_COM_HISTORICO` | Cliente com histórico | Cliente já tem pedidos/importação; estágio de contexto (não soma valor de carteira sozinho) | `Customer` + pedidos | — | Usar como filtro/contexto | Comercial |
| `PEDIDO_EMITIDO` | Pedido emitido | Pedido existe e é a âncora comercial; ainda sem classificação fina de maturidade | `SalesOrder` | Média/baixa | Classificar maturidade / evidências | Comercial |
| `PEDIDO_FUTURO_SAUDAVEL` | Pedido futuro saudável | Previsão à frente, evidência mínima ok, sem bloqueio | Pedido + datas + flags | ~65 | Acompanhar PCP/faturamento | Comercial / PCP |
| `PEDIDO_PROXIMO_ATENCAO` | Pedido próximo / atenção | Janela próxima da entrega/faturamento; só pedido ou evidência fraca | Pedido + previsão | ~50 | Priorizar faturamento/documento | Comercial / Faturamento |
| `PEDIDO_ATRASADO_SEM_DOCUMENTO` | Atrasado sem documento | Prazo passou e **não** há documento de saída | Pedido + doc ausência | Baixa | Gerar saída ou revisar pedido | PCP / Comercial |
| `PEDIDO_PARCIALMENTE_ATENDIDO` | Parcialmente atendido | Cobertura de itens parcial no mapa de atendimento | Fulfillment map | Média | Completar remessa | PCP / Logística |
| `PEDIDO_TOTALMENTE_ATENDIDO` | Totalmente atendido | Itens do pedido cobertos (cap ≤ pedido), sem excedente relevante | Fulfillment map | Média/alta | Formalizar NF/CR se faltar | Faturamento |
| `PEDIDO_ATENDIDO_COM_EXCEDENTE` | Atendido com excedente | Atendimento total **e** excesso no documento | Fulfillment + alerta | Média | Revisar vínculo/quantidade | Faturamento / Comercial |
| `DOCUMENTO_SEM_NF` | Documento sem NF | Há documento de saída, ainda sem NF vinculada | Stock doc / links | Média | Emitir/vincular NF | Faturamento |
| `NF_SEM_CR` | NF sem CR | Há NF/doc fiscal, ainda sem Contas a Receber | NF + ausência CR | ~75 | Gerar/vincular título | Financeiro / Faturamento |
| `CR_ABERTO` | CR aberto | Direito financeiro formalizado, sem baixa total | `NomusAccountsReceivable` / fatos | ~90 | Cobrar / acompanhar vencimento | Financeiro |
| `RECEBIDO` | Recebido / caixa | Baixa materializada | Baixa / received | ~100 | Nenhuma (caixa confirmado) | Financeiro |
| `BLOQUEADO_REVISAO` | Bloqueado / revisão | Antigo ou vencido sem evolução suficiente (sem NF/doc/CR) | Maturity / evidências | Muito baixa | Validar, cancelar ou empurrar | Comercial / Diretoria |
| `CANCELADO` | Cancelado | Pedido cancelado na origem | Status do pedido | — | Não tratar como carteira | Comercial |
| `SEM_EVIDENCIA` | Sem evidência suficiente | Falta informação mínima na importação para classificar | Gaps de sync | Muito baixa | Revisar importação Nomus | TI / Comercial |

### 4.1 Notas de classificação

- Um pedido **não** pode estar em dois estágios principais que somem carteira ao mesmo tempo.  
- Alertas (`QUANTIDADE_EXCEDENTE`, `PRODUTO_FORA_DO_PEDIDO`, `NF_CABECALHO_MAIOR_PEDIDO`, etc.) são **paralelos**.  
- Reutilizar, sempre que possível, motores já existentes da Conciliação de Carteira (`portfolioMaturity*`, `portfolioOrderFulfillmentMap`) em vez de reinventar regras.

---

## 5. Três eixos

O funil **separa** visualmente e analiticamente:

| Eixo | O que mostra | Exemplos |
|------|--------------|----------|
| **Comercial** | Pedido emitido, cliente, vendedor, valor oficial, previsão | Emitidos, futuro, atenção, bloqueado |
| **Operacional** | Atendimento por item / documento | Parcial, total, excedente, sem documento, produto fora |
| **Financeiro** | CR, vencimento, baixa | NF sem CR, CR aberto, recebido |

Não misturar “pedido aberto” com “caixa” nem “alerta de NF” com “mais receita”.

---

## 6. Regra de temperatura

| Temperatura | Definição | Interpretação |
|-------------|-----------|---------------|
| **QUENTE** | Pedido recente/futuro, prazo válido, valor relevante, cliente ativo, sem desvio material | Prioridade saudável de receita planejada |
| **MORNO** | Ainda plausível, mas próximo da entrega ou com pouca evidência | Precisa empurrão operacional/financeiro |
| **FRIO** | Cliente/pedido sem movimento recente, sem próxima ação clara | Risco de inércia |
| **CONGELADO** | Pedido antigo, vencido, **sem documento, sem NF e sem CR** | **Risco / bloqueio de carteira** — não é lead quente |

**Importante:**  
Pedido antigo aberto **não** é lead quente.  
Pedido antigo aberto é **risco/bloqueio** de carteira (`BLOQUEADO_REVISAO` / temperatura CONGELADO).

---

## 7. Regras de evidência

Hierarquia (a evidência superior **substitui** a inferior no forecast e na leitura de maturidade):

```text
Baixa  >  CR  >  NF / Documento  >  Pedido futuro  >  Pedido em atenção  >  Pedido bloqueado
```

| Quando aparece… | O funil / forecast… |
|-----------------|---------------------|
| **Baixa** | Caixa realizado — confiança máxima |
| **CR** | Direito formalizado — substitui previsão do pedido |
| **NF / Documento** | Evidência operacional/fiscal — ainda pode faltar CR |
| **Pedido futuro** | Planejamento |
| **Pedido em atenção** | Janela próxima |
| **Pedido bloqueado** | Risco — **não** tratar como caixa confiável |

Toda métrica deve expor: **fonte**, **evidência**, **confiança**, **explicação** (“?”).

---

## 8. Regras de Ordem de Produção

| Regra | Conteúdo |
|-------|----------|
| Obrigatoriedade | **Opcional** |
| Se dado/API confiável existir | Enriquecer funil (ex.: “com OP”, “OP atrasada”) |
| Se não existir | Funil funciona só com pedido, documento, NF, CR e baixa |
| UI | Não inventar OP; usar “Informação não disponível na importação atual.” |
| Persistência | Preferir leitura de raw Nomus / flags já existentes — **sem migration** sem autorização |

Fonte atual conhecida no código (orientação): OP embutida em `SalesOrder.nomusRawResponse` / helpers de lifecycle — **não** há tabela Prisma dedicada de OP comercial.

---

## 9. KPIs da tela

Cada KPI: valor + quantidade (quando couber) + “?” (o que significa / como calculamos / como interpretar).

### 9.1 Comerciais

- Valor de pedidos emitidos  
- Quantidade de pedidos  
- Pedidos por vendedor (vendedor **comercial do pedido**, não comissionável)  
- Pedidos por cliente  
- Pedidos por idade  

### 9.2 Operacionais

- Pedidos sem documento  
- Pedidos parcialmente atendidos  
- Pedidos totalmente atendidos  
- Pedidos com excedente  
- Pedidos com produto fora do pedido  
- Tempo pedido → documento  

### 9.3 Financeiros

- NF sem CR  
- CR aberto  
- Recebido  
- Tempo documento/NF → CR  
- Tempo CR → baixa  

### 9.4 Risco

- Valor bloqueado para revisão  
- Pedidos antigos sem evolução  
- Forecast em risco  
- Top clientes com pedido travado  
- Top vendedores com pedido travado  

**Alertas técnicos não somam** valor de carteira.

---

## 10. Layout esperado

```text
┌─────────────────────────────────────────────────────────────┐
│  Cabeçalho: Funil Pedido → Caixa + subtítulo + aviso        │
│  (Pedido ≠ caixa até CR/baixa)                              │
├─────────────────────────────────────────────────────────────┤
│  Filtros (cliente, vendedor, empresa, período, eixo data,   │
│  estágio, temperatura, confiança…) + chips + Limpar         │
├─────────────────────────────────────────────────────────────┤
│  Cards executivos (3 eixos: comercial / operacional / fin.) │
├─────────────────────────────────────────────────────────────┤
│  Funil visual horizontal (estágios oficiais)                │
├─────────────────────────────────────────────────────────────┤
│  Kanban ou tabela por estágio                               │
├─────────────────────────────────────────────────────────────┤
│  Grid de pedidos (clique → drawer)                          │
└─────────────────────────────────────────────────────────────┘
```

**Drawer de detalhe** (orientação): reutilizar padrão da Central de Auditoria — mapa de atendimento, itens, documentos, NF, CR, frescor, conclusão; sem JSON cru.

---

## 11. Cores oficiais

| Uso | Fundo | Borda / destaque | Texto |
|-----|-------|------------------|-------|
| Financeiro / recebido | `#ECFDF3` | `#ABEFC6` | `#067647` |
| Futuro saudável | `#EFF8FF` | `#B2DDFF` | `#175CD3` |
| Atenção | `#FFFAEB` | `#FEDF89` | `#B54708` |
| Bloqueado | `#FEF3F2` | `#FECDCA` | `#B42318` |
| Alerta técnico | `#FFF6ED` | `#FDBA74` | `#C2410C` |
| Neutro | `#F9FAFB` | `#EAECF0` | `#344054` |

Preferir **borda lateral 4px** + fundo branco/muito claro — sem fundo forte.

---

## 12. Tipografia

| Elemento | Tamanho | Peso |
|----------|---------|------|
| Título | 24px | 700 |
| Subtítulo | 14px | 400 |
| Card title | 12px uppercase | 600 |
| Card value | 24–28px | 700 |
| Texto auxiliar | 12–13px | 400 |

---

## 13. Definition of Ready (DoR)

### Negócio

- [ ] Paradigma Pedido → Caixa aprovado (sem oportunidade como fonte oficial).  
- [ ] Estágios e temperatura acordados.  
- [ ] Papéis (comercial / PCP / faturamento / financeiro) claros.  

### Dados

- [ ] Pedidos, NF links, documentos, CR/baixas disponíveis na importação ou fatos de portfolio.  
- [ ] OP tratada como opcional.  
- [ ] Sem dependência de migration nova.  

### Técnico

- [ ] Services puros identificados (reuso maturity/fulfillment quando possível).  
- [ ] Endpoint read-only e permissões existentes (`dashboard.view` / `sales_orders.view`).  
- [ ] UI não calcula regra crítica.  

### Visual

- [ ] Layout, cores e tipografia deste documento.  
- [ ] Empty states e “Informação não disponível…”.  

---

## 14. Definition of Done (DoD)

### Negócio

- [ ] Tela responde às perguntas da seção 2.  
- [ ] Pedido antigo não aparece como “quente”.  
- [ ] Alertas não somam carteira.  

### Cálculo

- [ ] Um estágio principal por pedido (sem duplicar valor).  
- [ ] Cap de quantidade / excesso / produto fora / cabeçalho alinhados ao mapa de atendimento.  
- [ ] Hierarquia Baixa > CR > NF/doc > Pedido.  

### Técnico

- [ ] Testes unitários das regras.  
- [ ] Gates: `check:server-imports`, `check:frontend-server-imports`, `npm test`, `build`, `check:browser-bundle`.  
- [ ] Scripts de validação quando aplicável (Britânia, PD 02339).  

### Visual

- [ ] Cards, funil, grid, drawer sem JSON cru / stack / Prisma.  

### Não regressão

- [ ] Fluxo de Caixa, AR oficial, Comissões, Presidencial, Precificação, BOM, Suprimentos **intactos**.  
- [ ] Funil de propostas (`/proposals/indicators`) permanece separado e não manda no funil oficial.

---

## 15. Casos obrigatórios

| Caso | Expectativa |
|------|-------------|
| Pedido antigo sem NF/doc/CR | `BLOQUEADO_REVISAO` / CONGELADO — risco, não quente |
| Pedido futuro saudável | `PEDIDO_FUTURO_SAUDAVEL` / QUENTE ou MORNO |
| Pedido parcialmente atendido | `PEDIDO_PARCIALMENTE_ATENDIDO` + % atendimento |
| Pedido com CR aberto | `CR_ABERTO` — direito, não caixa |
| Pedido recebido | `RECEBIDO` — caixa |
| Pedido com documento sem CR | `DOCUMENTO_SEM_NF` ou `NF_SEM_CR` conforme evidência |
| Quantidade excedente | Alerta técnico — **não** soma carteira |
| Produto fora do pedido | Alerta técnico — **não** soma carteira |
| **Britânia** | Totais de carteira / bloqueado / futuro-presente coerentes com Central de Auditoria |
| **PD 02339** | Pedido R$ 158.000; cabeçalho NF maior **não** infla; atendimento/excesso/CR interpretáveis |

---

## 16. Arquitetura esperada (orientação)

Orientação para entregas futuras (não implementado neste documento):

| Camada | Direção |
|--------|---------|
| Motor puro | `src/lib/sales` e/ou `src/lib/finance` — reusar `portfolioMaturity*`, `portfolioOrderFulfillmentMap`, `salesOrderMetricsEngine` quando aderente |
| API | Endpoint read-only (evoluir `executive-summary` / funil ou endpoint dedicado) |
| UI | `DashboardModule` aba funil — só consome payload |
| Testes | Unitários de estágio, temperatura, não-duplicação, alertas |
| Scripts | `tmp-audits` para Britânia / PD 02339 quando a regra estiver em código |

Estado atual conhecido (baseline):

- Aba: `SalesFunnelPanel` via `GET /api/dashboard/executive-summary`.  
- Funil atual já usa **Pedido**, mas para em NF/atraso — **não** cobre Doc → CR → Baixa como funil oficial deste documento.  
- Propostas: `/proposals/indicators` — permanece histórico/opcional, fora do funil oficial.

---

## 17. Glossário

| Termo | Significado |
|-------|-------------|
| Pedido de Venda | Compromisso comercial oficial — âncora do funil |
| Documento de saída | Evidência operacional de entrega/estoque |
| NF | Evidência fiscal |
| CR | Contas a Receber — direito financeiro |
| Baixa | Caixa realizado |
| OP | Ordem de Produção — camada **opcional** |
| Temperatura | Quente / Morno / Frio / Congelado — qualidade da carteira, não “score de lead” |
| Alerta técnico | Desvio (excesso, fora, cabeçalho) — **não soma** carteira |

---

## Status deste documento

**Requisitos oficiais publicados.**  
Nenhuma alteração de UI, backend ou migration neste prompt.  
Próximos prompts: motor puro → API → UI, nesta ordem.
