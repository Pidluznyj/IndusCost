# Roadmap de campos de banco — evolução comercial / CRM (IndusCost)

**Versão do documento:** 1.0  
**Última revisão:** 2026-04-11  
**Fonte de verdade do schema atual:** `prisma/schema.prisma` (PostgreSQL)

---

## 1. Objetivo do documento

Este arquivo é o **guia oficial e cumulativo** de campos de banco de dados relacionados à **evolução comercial, CRM operacional e inteligência de vendas** no IndusCost.

Ele serve para:

- Registrar **o que já existe** no schema e pode ser reaproveitado sem nova migration.
- Manter um **backlog estruturado** de campos e tabelas a criar, com rastreabilidade de fase e prioridade.
- Distinguir com clareza **persistido**, **calculado** e **derivado em aplicação**.
- Orientar **futuras migrations Prisma** e evitar decisões ad-hoc sem memória institucional.
- Funcionar como **memória técnica** alinhada ao código real (não substitui o `schema.prisma`; complementa a intenção de negócio).

**O que este documento não é:** não substitui migrations, não contém SQL executável, e não lista todos os campos não comerciais do sistema (ex.: engenharia, máquinas, materiais), exceto quando são referência para relacionamento (ex.: `Product` em itens de proposta).

---

## 2. Como este documento deve ser mantido

**Regra obrigatória:** sempre que surgir um requisito que **exija armazenar nova informação no banco** (ou mudar semântica de um campo existente), este arquivo deve ser **atualizado antes ou em conjunto** com a implementação.

**Fluxo sugerido:**

1. Identificar o domínio funcional (funil, cliente 360, follow-up, etc.).
2. Registrar o campo (ou tabela) na secção **5** e no **checklist 11**, com status adequado.
3. Após a migration, alterar o status do item para **já existe** e, se necessário, mover detalhes para a secção **4**.
4. Incrementar **Versão do documento** e **Última revisão** no cabeçalho.

**Responsabilidade:** qualquer desenvolvedor que abrir PR com alteração de `schema.prisma` no âmbito comercial deve verificar se o roadmap foi atualizado.

---

## 3. Convenções

| Termo | Significado |
|--------|-------------|
| **Persistido** | Valor armazenado em coluna/tabela no PostgreSQL, sob responsabilidade da aplicação ou default do banco. |
| **Calculado** | Obtido por query/agregação ou função no momento da leitura; não há coluna dedicada (ou não deveria haver duplicação sem política). |
| **Derivado (app)** | Regra de negócio em código (ex.: probabilidade heurística por status em `src/lib/salesFunnel.ts`). |
| **Proxy** | Aproximação aceita quando não existe entidade ideal (ex.: “última compra” = última proposta `APPROVED` até existir pedido fiscal). |
| **Fase 1 / 2 / 3** | Prioridade de introdução no produto; não confundir com versão deste documento. |

**Status de item (checklist e tabelas):**

| Status | Uso |
|--------|-----|
| `já existe` | Coluna/tabela já presente no `schema.prisma` atual. |
| `falta criar` | Acordado para migration futura. |
| `opcional futuro` | Desejável; depende de carga, produto ou integração. |
| `reavaliar` | Risco de duplicidade ou alternativa (calcular vs persistir). |

**Tipos sugeridos** usam vocabulário PostgreSQL/Prisma comum: `Uuid`, `String`, `Text`, `Int`, `Boolean`, `Decimal`, `DateTime`, `Json` (JsonB no PostgreSQL).

---

## 4. Campos já existentes que podem ser reaproveitados

Referência validada em `prisma/schema.prisma` (modelos comerciais centrais).

### 4.1 `Customer`

| Campo | Tipo (Prisma) | Finalidade de negócio | Observação |
|-------|----------------|------------------------|------------|
| `id` | Uuid | Chave primária | — |
| `companyName` | String | Razão social | — |
| `tradeName` | String? | Nome fantasia | — |
| `taxId` | String @unique | CNPJ/CPF | — |
| `stateTaxId` | String? | IE | — |
| `contactName` | String? | Contato | — |
| `email` | String? | E-mail | — |
| `phone` | String? | Telefone | — |
| `address`, `city`, `state`, `zipCode` | String? | Endereço | — |
| `country` | String | País | Default `Brasil` |
| `segment` | String? | Segmentação livre (texto) | Não é enum formal de CRM |
| `notes` | String? | Observações gerais | Mistura cadastro/comercial se não houver campo dedicado |
| `status` | String | Situação cadastral | Default `ACTIVE`; não é “status de relacionamento comercial” |
| `createdAt`, `updatedAt` | DateTime | Auditoria cadastral | — |

**Relação:** `proposals` → `Proposal[]`.

### 4.2 `Proposal`

| Campo | Tipo (Prisma) | Finalidade de negócio | Observação |
|-------|----------------|------------------------|------------|
| `id` | Uuid | Identificador da proposta/negócio | — |
| `number` | Int @unique | Número sequencial | — |
| `title` | String? | Título | — |
| `customerId` | Uuid | Cliente | FK; índice `@@index([customerId])` |
| `status` | ProposalStatus | Etapa do fluxo comercial | Enum: DRAFT, ANALYSIS, SENT, APPROVED, REJECTED, EXPIRED, CANCELED |
| `responsible` | String? | Responsável comercial | Texto livre; sem FK para usuário do sistema |
| `companyIssuer` | String? | Emissor | — |
| `validityDays` | Int | Prazo de validade (dias) | Default 15 |
| `paymentTerms` | String? | Condições de pagamento | — |
| `paymentMethod` | String? | Meio de pagamento | — |
| `deliveryTimeDays` | Int? | Prazo de entrega | — |
| `freightCondition` | String? | Frete | Default CIF |
| `deliveryLocation` | String? | Local de entrega | — |
| `notes` | String? | Observações | — |
| `internalNotes` | String? | Notas internas | — |
| `totalItems` | Int | Quantidade de itens | — |
| `totalGrossValue` | Decimal | Valor bruto | — |
| `totalDiscount` | Decimal | Desconto | — |
| `totalNetValue` | Decimal | Valor líquido | Base para agregações e ABC |
| `totalCost` | Decimal | Custo total | — |
| `totalMarginValue` | Decimal | Margem R$ | — |
| `totalMarginPerc` | Decimal | Margem % | — |
| `totalTaxes` | Decimal | Impostos | — |
| `totalCommission` | Decimal | Comissão | — |
| `totalFreight` | Decimal | Frete | — |
| `createdAt` | DateTime | Data de criação (abertura do registro) | — |
| `updatedAt` | DateTime | Última atualização | Usado como “última movimentação” no registro |

**Não existe no schema:** origem da oportunidade, tipo de oportunidade, probabilidade editável, data prevista de fechamento, motivo estruturado de perda, prioridade, próxima ação, entidade “oportunidade” separada.

### 4.3 `ProposalItem`

| Campo | Tipo (Prisma) | Finalidade de negócio |
|-------|----------------|------------------------|
| `proposalId`, `productId` | Uuid | Vínculo proposta ↔ produto |
| `quantity`, preços, margens, impostos, frete linha | Decimal / String? | Mix, ticket, margem por SKU |
| `notes` | String? | Observação por linha |

### 4.4 `Product` (referência comercial)

Campos relevantes para mix/análise: `id`, `sku`, `name`, `type` (enum `ItemType`: PRODUCT, COMPONENT), `status`, etc.

### 4.5 O que já é calculado hoje na aplicação (sem coluna dedicada)

- **Probabilidade de fechamento** e **valor ponderado** por status: heurísticas em `src/lib/salesFunnel.ts` (derivado).
- **Health score, segmento comercial, ABC, janela de recompra:** em `src/lib/customerCommercialIntel.ts` e APIs que agregam propostas (calculado / derivado).
- **Curva ABC da carteira:** `groupBy` em propostas `APPROVED` no endpoint da visão comercial (calculado na leitura).

---

## 5. Campos faltantes por domínio funcional

Para cada campo **ainda não existente** no `schema.prisma` atual, segue o formato padronizado solicitado.

**Legenda de colunas:** Domínio | Model/tabela sugerido | Nome do campo | Tipo sugerido | Obr.? | Default | Índice? | Origem | Finalidade | Persistido/calculado | Fase | Status |

---

### 5.1 Funil de vendas / pipeline

| Domínio | Model sugerido | Nome do campo | Tipo sugerido | Obr.? | Default | Índice? | Origem | Finalidade | Persistido/calculado | Fase | Status |
|---------|----------------|---------------|---------------|-------|---------|---------|--------|------------|----------------------|------|--------|
| Funil | `Proposal` | `probabilityPerc` | Decimal(5,2) ou Int | Não | NULL | Opcional (funil) | Usuário / regra | Probabilidade própria além da heurística fixa | Persistido | 2 | falta criar |
| Funil | `Proposal` | `expectedCloseDate` | DateTime | Não | NULL | Sim (intervalos) | Usuário | Previsão de fechamento | Persistido | 1 | falta criar |
| Funil | `Proposal` | `source` | String ou enum futuro | Não | NULL | Opcional | Usuário | Origem da oportunidade | Persistido | 1 | falta criar |
| Funil | `Proposal` | `opportunityType` | String ou enum futuro | Não | NULL | Opcional | Usuário | Tipo (nova carteira, renovação, amostra, etc.) | Persistido | 2 | falta criar |
| Funil | `Proposal` | `lossReason` | String ou FK p/ tabela `LossReason` | Não | NULL | Opcional | Usuário | Motivo estruturado quando perdida/cancelada | Persistido | 1 | falta criar |
| Funil | `Proposal` | `lossReasonDetail` | Text | Não | NULL | Não | Usuário | Detalhe textual do motivo | Persistido | 2 | falta criar |
| Funil | `Proposal` | `priority` | Int ou enum | Não | NULL | Opcional | Usuário | Prioridade da oportunidade | Persistido | 2 | falta criar |
| Funil | `Proposal` | `nextActionAt` | DateTime | Não | NULL | Sim | Usuário / workflow | Data da próxima ação planejada | Persistido | 2 | falta criar |
| Funil | `Proposal` | `nextActionNote` | Text | Não | NULL | Não | Usuário | Texto da próxima ação | Persistido | 2 | falta criar |
| Funil | `Proposal` | `isFrozen` | Boolean | Não | false | Opcional | Usuário | Congelamento explícito (diferente de só EXPIRED) | Persistido | 3 | opcional futuro |
| Funil | `Proposal` | `freezeReason` | Text | Não | NULL | Não | Usuário | Motivo do congelamento | Persistido | 3 | opcional futuro |
| Funil | `Proposal` | `weightedValueSnapshot` | Decimal | Não | NULL | Não | Sistema | Opcional: cache de valor ponderado para relatório | Persistido | 3 | reavaliar |
| Funil | `Opportunity` (novo) | *(vários)* | — | — | — | — | Ver secção 5.7 | Se o funil for desacoplado da proposta formal | Persistido | 3 | opcional futuro |

**Calculado (não é coluna):** valor ponderado a partir de `totalNetValue` × probabilidade — **calculado** na leitura, salvo decisão de cache (fase 3).

---

### 5.2 Customer 360 / visão comercial do cliente

| Domínio | Model sugerido | Nome do campo | Tipo sugerido | Obr.? | Default | Índice? | Origem | Finalidade | Persistido/calculado | Fase | Status |
|---------|----------------|---------------|---------------|-------|---------|---------|--------|------------|----------------------|------|--------|
| CRM | `Customer` ou `CustomerCommercialProfile` | `accountOwnerUserId` | Uuid nullable | Não | NULL | Sim | RH/Admin | Dono da conta (FK futura p/ usuário) | Persistido | 2 | falta criar |
| CRM | `Customer` ou perfil | `accountOwner` | String | Não | NULL | Não | Usuário | Alternativa sem tabela de usuários (como `responsible`) | Persistido | 2 | reavaliar |
| CRM | `Customer` ou perfil | `commercialNotes` | Text | Não | NULL | Não | Comercial | Contexto só comercial, separado de `notes` | Persistido | 2 | falta criar |
| CRM | `Customer` ou perfil | `relationshipStatus` | Enum ou String | Não | NULL | Opcional | Comercial / regra | Status de relacionamento (ativo, em risco, etc.) | Persistido | 2 | falta criar |
| CRM | — | *(KPIs agregados)* | — | — | — | — | Agregação `Proposal` | RFV, ticket, pipeline — ver secção 6 | Calculado | 1 | já existe (via dados) |

**Persistido opcional (cache):** `lastApprovedProposalAt`, `lifetimeApprovedNet` em perfil — **reavaliar** para evitar dessincronização; preferir job de atualização se adotado.

---

### 5.3 Health score / saúde comercial

| Domínio | Model sugerido | Nome do campo | Tipo sugerido | Obr.? | Default | Índice? | Origem | Finalidade | Persistido/calculado | Fase | Status |
|---------|----------------|---------------|---------------|-------|---------|---------|--------|------------|----------------------|------|--------|
| Health | `CustomerCommercialProfile` ou snapshot | `healthScore` | Int | Não | NULL | Opcional | Job / cálculo | Score 0–100 materializado | Persistido | 2 | falta criar |
| Health | idem | `healthBand` | Enum | Não | NULL | Opcional | Derivado de score | Faixa (saudável, atenção, risco, inativo) | Persistido | 2 | falta criar |
| Health | idem | `healthComputedAt` | DateTime | Não | NULL | Sim | Sistema | Quando o score foi calculado | Persistido | 2 | falta criar |
| Health | idem | `healthFactorsJson` | Json | Não | NULL | Não | Sistema | Fatores explicativos (auditável) | Persistido | 2 | falta criar |
| Health | idem | `healthIsOverride` | Boolean | Não | false | Não | Usuário | Override manual | Persistido | 3 | opcional futuro |
| Health | idem | `healthOverrideBy` | Uuid ou String | Não | NULL | Não | Usuário | Quem sobrescreveu | Persistido | 3 | opcional futuro |
| Health | idem | `healthNotes` | Text | Não | NULL | Não | Comercial | Observação junto ao score | Persistido | 3 | opcional futuro |

**Calculado hoje:** score e faixa em `computeCommercialPhase2` — **calculado/derivado** sem tabela.

---

### 5.4 Recompra / frequência / recência

| Domínio | Model sugerido | Nome do campo | Tipo sugerido | Obr.? | Default | Índice? | Origem | Finalidade | Persistido/calculado | Fase | Status |
|---------|----------------|---------------|---------------|-------|---------|---------|--------|------------|----------------------|------|--------|
| Recompra | — | médiana/média intervalos | — | — | — | — | `Proposal` APPROVED | Estimativa de recompra | Calculado | 1 | já existe (via app) |
| Recompra | Perfil cliente | `medianRepurchaseDays` | Int | Não | NULL | Não | Job | Cache para dashboard | Persistido | 3 | opcional futuro |
| Recompra | Perfil cliente | `nextRepurchaseEta` | DateTime | Não | NULL | Não | Job | Data prevista (proxy) | Persistido | 3 | opcional futuro |
| Recompra | `Order` futuro | `orderedAt` / `invoicedAt` | DateTime | — | — | Sim | ERP/integração | **Última compra real** quando existir módulo | Persistido | 3 | opcional futuro |

---

### 5.5 Follow-up / ações comerciais / interações

**Não há tabela dedicada no schema atual.** Modelo sugerido: `CommercialActivity` (nome ilustrativo).

| Domínio | Model sugerido | Nome do campo | Tipo sugerido | Obr.? | Default | Índice? | Origem | Finalidade | Persistido/calculado | Fase | Status |
|---------|----------------|---------------|---------------|-------|---------|---------|--------|------------|----------------------|------|--------|
| Ação | `CommercialActivity` | `id` | Uuid | Sim | gen_random_uuid | PK | Sistema | Identificador | Persistido | 2 | falta criar |
| Ação | idem | `customerId` | Uuid | Sim | — | Sim | Sistema | Conta | Persistido | 2 | falta criar |
| Ação | idem | `proposalId` | Uuid nullable | Não | NULL | Sim | Sistema | Vínculo opcional | Persistido | 2 | falta criar |
| Ação | idem | `activityType` | Enum | Sim | — | Opcional | Usuário | CALL, VISIT, TASK, NOTE, … | Persistido | 2 | falta criar |
| Ação | idem | `subject` | String | Não | NULL | Não | Usuário | Título | Persistido | 2 | falta criar |
| Ação | idem | `description` | Text | Não | NULL | Não | Usuário | Detalhe | Persistido | 2 | falta criar |
| Ação | idem | `scheduledAt` | DateTime | Não | NULL | Sim | Usuário | Próxima ação / lembrete | Persistido | 2 | falta criar |
| Ação | idem | `completedAt` | DateTime | Não | NULL | Não | Usuário | Conclusão | Persistido | 2 | falta criar |
| Ação | idem | `status` | Enum | Sim | OPEN | Opcional | Usuário | OPEN/DONE/CANCELLED | Persistido | 2 | falta criar |
| Ação | idem | `priority` | Int ou enum | Não | NULL | Não | Usuário | Prioridade | Persistido | 2 | falta criar |
| Ação | idem | `assignedTo` | String ou Uuid | Não | NULL | Opcional | Usuário | Responsável | Persistido | 2 | falta criar |
| Ação | idem | `reminderAt` | DateTime | Não | NULL | Sim | Sistema | Lembrete | Persistido | 3 | opcional futuro |
| Ação | idem | `followUpMode` | Enum | Não | MANUAL | Não | Sistema | Manual vs regra automática | Persistido | 3 | opcional futuro |
| Ação | idem | `closeReason` | String | Não | NULL | Não | Usuário | Motivo de encerramento | Persistido | 2 | falta criar |

---

### 5.6 Classificação comercial / segmentação / curva ABC

| Domínio | Model sugerido | Nome do campo | Tipo sugerido | Obr.? | Default | Índice? | Origem | Finalidade | Persistido/calculado | Fase | Status |
|---------|----------------|---------------|---------------|-------|---------|---------|--------|------------|----------------------|------|--------|
| ABC | Perfil ou `Customer` | `abcClass` | Char(1) ou enum A/B/C | Não | NULL | Opcional | Job agregação carteira | Materializar classe | Persistido | 3 | opcional futuro |
| ABC | idem | `abcComputedAt` | DateTime | Não | NULL | Não | Job | Freshness | Persistido | 3 | opcional futuro |
| Segmento | idem | `commercialSegment` | Enum | Não | NULL | Opcional | Regra / manual | Estratégico, recorrente, etc. | Persistido | 2 | falta criar |
| Segmento | idem | `segmentationSource` | Enum AUTO/MANUAL | Não | AUTO | Não | Sistema / usuário | Rastrear origem da classificação | Persistido | 2 | falta criar |
| Segmento | `Customer` | `segment` | String? | Não | — | Não | Usuário | **Já existe** — segmento livre | Persistido | — | já existe |
| Potencial | Perfil | `commercialPotential` | Int ou enum | Não | NULL | Não | Comercial | Potencial estimado | Persistido | 3 | opcional futuro |

**Calculado hoje:** ABC e segmento em intel de tela — **calculado** na leitura.

---

### 5.7 Oportunidades / negócios

**Estado atual:** `Proposal` concentra documento comercial e funil via `ProposalStatus`.

**Decisão de produto:**  
- **Fase 1–2:** evoluir campos em `Proposal` (secção 5.1) evita nova entidade.  
- **Fase 3:** criar `Opportunity` se houver **várias propostas** por negócio ou funil **desacoplado** do documento.

Campos ideais para **`Opportunity`** (quando existir):

| Domínio | Model | Nome | Tipo | Obr.? | Índice? | Finalidade | Fase | Status |
|---------|-------|------|------|-------|---------|------------|------|--------|
| Opp | `Opportunity` | `id` | Uuid | Sim | PK | PK | 3 | opcional futuro |
| Opp | idem | `customerId` | Uuid | Sim | Sim | Cliente | 3 | opcional futuro |
| Opp | idem | `title`, `description` | String/Text | Sim/Não | — | Narrativa | 3 | opcional futuro |
| Opp | idem | `stage`, `probability`, `estimatedValue`, `expectedCloseDate` | vários | — | Sim data | Funil próprio | 3 | opcional futuro |
| Opp | idem | `source`, `opportunityType`, `status` | vários | — | Opcional | Classificação | 3 | opcional futuro |
| Opp | idem | `ownerUserId` / `owner` | Uuid/String | Não | — | Dono | 3 | opcional futuro |
| Opp | `Proposal` | `opportunityId` | Uuid nullable | Não | Sim | FK opcional | Vínculo proposta ↔ oportunidade | 3 | falta criar (se Opportunity existir) |

**Produto na oportunidade:** preferir linhas (`OpportunityLine`) ou continuar via `ProposalItem`; `linkedProductId` único é insuficiente para B2B típico.

---

### 5.8 Histórico / auditoria comercial

| Domínio | Model sugerido | Nome do campo | Tipo sugerido | Obr.? | Índice? | Finalidade | Persistido/calculado | Fase | Status |
|---------|----------------|---------------|---------------|-------|---------|------------|----------------------|------|--------|
| Auditoria | `CommercialAuditLog` | `id` | Uuid | Sim | PK | Evento | Persistido | 2 | falta criar |
| Auditoria | idem | `entityType` | Enum/String | Sim | Sim | CUSTOMER, PROPOSAL, … | Persistido | 2 | falta criar |
| Auditoria | idem | `entityId` | Uuid | Sim | Sim | Alvo | Persistido | 2 | falta criar |
| Auditoria | idem | `action` | Enum | Sim | Não | CREATE, UPDATE, STAGE_CHANGE, … | Persistido | 2 | falta criar |
| Auditoria | idem | `fieldName` | String | Não | Não | Campo alterado | Persistido | 2 | falta criar |
| Auditoria | idem | `oldValue`, `newValue` | Text ou Json | Não | Não | Diff | Persistido | 2 | falta criar |
| Auditoria | idem | `performedAt` | DateTime | Sim | Sim | Quando | Persistido | 2 | falta criar |
| Auditoria | idem | `performedBy` | Uuid ou String | Não | Não | Quem | Persistido | 2 | falta criar |

**Histórico de interações:** preferir registros em `CommercialActivity` (secção 5.5), não só audit log.

---

## 6. Persistido vs calculado (resumo)

| Necessidade | Recomendação |
|-------------|--------------|
| Totais e linhas de proposta | **Persistidos** (já existem em `Proposal` / `ProposalItem`). |
| KPIs agregados por cliente (RFV, ticket, margem acumulada) | **Calculados** por query; cache opcional com política de atualização. |
| Probabilidade fixa por status | **Derivado** em app (`salesFunnel`); coluna `probabilityPerc` se negócio exigir override. |
| Health, ABC, segmento | **Calculados** em app hoje; **persistir** se precisar histórico, override ou relatório SQL massivo. |
| Última compra real | **Calculado** a partir de futuro `Order`; até lá, **proxy** por `APPROVED`. |
| Auditoria de mudanças | **Persistido** em tabela de eventos (não existe ainda). |

---

## 7. Fase 1 — prioridade (campos / temas)

**Objetivo:** suportar funil e CRM sem multiplicar entidades.

- `Proposal.expectedCloseDate` (opcional).
- `Proposal.source` (opcional).
- `Proposal.lossReason` (+ opcional `lossReasonDetail`) para perdas documentadas.
- Manter KPIs como **calculados**; não obrigar cache em `Customer`.

**Status:** itens marcados `falta criar` nas secções 5.1 e checklist 11.

---

## 8. Fase 2 — prioridade

- Dono de conta e notas comerciais (`accountOwner*` / `commercialNotes` / `relationshipStatus`) em `Customer` ou `CustomerCommercialProfile`.
- `Proposal.probabilityPerc`, `priority`, `nextActionAt` / `nextActionNote`.
- Tabela `CommercialActivity` (mínimo viável para follow-up).
- Tabela `CommercialAuditLog` para mudanças críticas de proposta (status, valor, responsável).
- Opcional: health persistido (perfil + `healthComputedAt`).

---

## 9. Fase 3 — desejável / condicional

- Entidade `Opportunity` + `Proposal.opportunityId` se o modelo mental for “oportunidade com várias propostas”.
- Campos de congelamento explícito, snapshot de valor ponderado, regras de lembrete automático.
- Cache agregado de recompra e ABC no perfil do cliente.
- Integração com **pedido faturado** (novo modelo) para sair do proxy de compra.
- Tabelas de domínio normalizado (`LeadSource`, `LossReason`).

---

## 10. Riscos / duplicidade / observações

- **Duplicar KPIs em `Customer`** sem job de reconciliação gera dados stale; preferir `*_computedAt` e responsável pelo refresh.
- **`Customer.segment` já existe:** novos enums devem conviver sem sobrecarga semântica (renomear conceitos ou usar campo novo `commercialSegment`).
- **`responsible` em texto:** alinhar futuro com usuários (FK) para auditoria e permissões.
- **Proposal como único núcleo:** evitar criar `Opportunity` até haver requisito claro de multi-proposta ou funil desacoplado.

---

## 11. Checklist incremental de campos futuros

Usar esta lista como índice rápido; detalhes nas secções 4–5. Marcar no PR: `[roadmap]` quando item for implementado.

| # | Domínio | Campo / tabela | Fase | Status |
|---|---------|----------------|------|--------|
| 1 | Funil | `Proposal.expectedCloseDate` | 1 | falta criar |
| 2 | Funil | `Proposal.source` | 1 | falta criar |
| 3 | Funil | `Proposal.lossReason` | 1 | falta criar |
| 4 | Funil | `Proposal.lossReasonDetail` | 2 | falta criar |
| 5 | Funil | `Proposal.probabilityPerc` | 2 | falta criar |
| 6 | Funil | `Proposal.priority` | 2 | falta criar |
| 7 | Funil | `Proposal.nextActionAt` / `nextActionNote` | 2 | falta criar |
| 8 | Funil | `Proposal.opportunityType` | 2 | falta criar |
| 9 | Funil | `Proposal.isFrozen` / `freezeReason` | 3 | opcional futuro |
| 10 | CRM | `accountOwnerUserId` ou `accountOwner` | 2 | reavaliar |
| 11 | CRM | `commercialNotes` | 2 | falta criar |
| 12 | CRM | `relationshipStatus` | 2 | falta criar |
| 13 | Health | Snapshot / perfil (`healthScore`, `healthBand`, …) | 2–3 | opcional futuro |
| 14 | Recompra | Cache `medianRepurchaseDays` / ETA | 3 | opcional futuro |
| 15 | Ações | Tabela `CommercialActivity` | 2 | falta criar |
| 16 | Auditoria | Tabela `CommercialAuditLog` | 2 | falta criar |
| 17 | ABC/Segmento | Cache `abcClass` / `commercialSegment` persistidos | 3 | opcional futuro |
| 18 | Oportunidade | Modelo `Opportunity` + FK em `Proposal` | 3 | opcional futuro |
| 19 | Pedido real | Modelo futuro `Order` / datas fiscais | 3 | opcional futuro |

---

*Fim do documento. Atualizar versão e data ao editar.*
