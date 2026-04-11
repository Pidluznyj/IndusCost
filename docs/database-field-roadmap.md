# Roadmap de campos de banco — IndusCost (comercial, CRM e referência técnica)

**Versão do documento:** 1.2  
**Última revisão:** 2026-04-10  
**Fonte de verdade do schema atual:** `prisma/schema.prisma` (PostgreSQL)

**Escopo cumulativo:** além do backlog comercial/CRM, este documento registra **alterações técnicas validadas no código** (motor de custo, API, UI, roteamento, **compras / solicitação**) com classificação explícita de **impacto em banco** vs **somente aplicação**. Problemas de ambiente local (ex.: `DATABASE_URL` ausente) **não** são tratados como exigência de migration.

---

## 1. Objetivo do documento

Este arquivo é o **guia oficial e cumulativo** de campos de banco de dados e de **decisões de persistência** relacionadas à evolução do IndusCost, com ênfase em **evolução comercial, CRM operacional e inteligência de vendas**, e referência cruzada a **engenharia/custeio** quando houver implicação de modelo ou tabelas existentes.

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
2. Registrar o campo (ou tabela) na secção **5** e no **checklist 12**, com status adequado.
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

### 4.6 `CostCalculationLog` (engenharia / custo — já no schema)

| Campo | Tipo (Prisma) | Finalidade | Observação validada no código |
|-------|----------------|------------|--------------------------------|
| `id` | Uuid | PK | — |
| `productId` | Uuid | Produto analisado | FK para `Product` |
| `calculatedAt` | DateTime? | Momento do registro | — |
| `versionTag` | String? | Versão/label | — |
| `totalCiu`, `totalCfc`, `totalCgt`, `suggestedPrice` | Decimal | Totais persistidos no log | — |
| `inputSnapshot` | String | Snapshot textual dos insumos | — |

**Uso atual no código:** referências a `prisma.costCalculationLog.deleteMany` em fluxos de exclusão de produto (`server.ts`); **não** foi identificado preenchimento desta tabela em cada chamada GET de cost-analysis no estado atual do repositório. A tabela é **reaproveitável** para auditoria/snapshot futuro de custo, com política de escrita a definir (fora do escopo deste documento até haver requisito de produto).

### 4.7 Compras — `CostCenter`, `PurchaseRequest`, `PurchaseRequestItem` (Bloco 1 — já no schema)

**Objetivo de negócio:** disciplinar **demanda de compra** (solicitação), com **centro de custo** obrigatório no cabeçalho, herança/sobrescrita por item, classificação **matéria-prima vs indireto**, vínculo opcional com `Material` apenas quando `lineType = MATERIA_PRIMA`. **Não** inclui pedido de compra, recebimento, estoque, financeiro nem atualização automática de `Material.currentCost`.

**Migration aplicável:** `prisma/migrations/20260410120000_purchases_block1/migration.sql` (adição de enums + tabelas; **não** altera tabelas de custo/BOM/proposta existentes além da FK opcional em `Material` → `PurchaseRequestItem`).

**Seed:** centro de custo fallback `code = A-CLASS`, `name = A classificar` (upsert em `prisma/seed.ts`) — uso **visível e rastreável**, não substitui definição real de CC.

#### `CostCenter`

| Campo | Tipo (Prisma) | Obr.? | Default | Finalidade |
|-------|----------------|-------|---------|------------|
| `id` | Uuid | Sim | `gen_random_uuid()` | PK |
| `code` | String @unique | Sim | — | Código curto (ex.: `A-CLASS`, `PROD-01`) |
| `name` | String | Sim | — | Nome |
| `description` | String? | Não | NULL | Detalhe opcional |
| `isActive` | Boolean | Sim | `true` | Permite inativar sem apagar histórico |
| `notes` | String? | Não | NULL | Observação interna |
| `createdAt`, `updatedAt` | DateTime | Sim | now / `@updatedAt` | Auditoria |

**Futuro (não neste bloco):** hierarquia, rateio, centro “virtual” — modelagem atual **não impede** (campos extras em migration futura).

#### `PurchaseRequest` (cabeçalho)

| Campo | Tipo (Prisma) | Obr.? | Finalidade |
|-------|----------------|-------|------------|
| `id` | Uuid | Sim | PK |
| `number` | Int @unique | Sim | Número sequencial legível (`autoincrement`) |
| `requester` | String | Sim | Solicitante (texto) |
| `department` | String | Sim | Área/departamento |
| `requestCategory` | String? | Não | Tipo/categoria livre opcional |
| `priority` | `PurchasePriority` | Sim | BAIXA, NORMAL, ALTA, URGENTE |
| `status` | `PurchaseRequestStatus` | Sim | RASCUNHO, ABERTA, CANCELADA, ENCERRADA |
| `justification` | Text | Sim | Justificativa |
| `defaultCostCenterId` | Uuid | Sim | CC padrão do cabeçalho (FK `CostCenter`, `onDelete: Restrict`) |
| `notes` | Text? | Não | Observações gerais |
| `createdAt`, `updatedAt` | DateTime | Sim | Auditoria |

#### `PurchaseRequestItem`

| Campo | Tipo (Prisma) | Obr.? | Finalidade |
|-------|----------------|-------|------------|
| `id` | Uuid | Sim | PK |
| `purchaseRequestId` | Uuid | Sim | FK solicitação (`Cascade` delete) |
| `lineType` | `PurchaseLineType` | Sim | `MATERIA_PRIMA` ou `INDIRETO` |
| `materialId` | Uuid? | Condicional | Obrigatório na API quando MP; `null` quando indireto |
| `description` | String | Sim | Texto da linha |
| `quantity` | Decimal(20,6) | Sim | Quantidade |
| `unit` | String | Sim | Unidade |
| `costCenterId` | Uuid? | Não | Sobrescreve CC do cabeçalho; `null` = herdar |
| `desiredDate` | DateTime? | Não | Data desejada |
| `priority` | `PurchasePriority?` | Não | Prioridade da linha (opcional) |
| `notes` | String? | Não | Observação do item |
| `suggestedSupplier` | String? | Não | Fornecedor sugerido (texto) |
| `lineStatus` | `PurchaseItemLineStatus` | Sim | ABERTA, CANCELADA |

**Relação existente:** `Material` passa a ter `PurchaseRequestItem[]` (FK opcional; **sem** alteração de custo do material pela solicitação).

**API (implementada):** `GET/POST/PATCH` em `/api/cost-centers`; `GET/POST/PUT` em `/api/purchase-requests` e `GET` por id — validação: MP exige `materialId`; itens indiretos não enviam `materialId`; cabeçalho exige CC ativo; mínimo um item por solicitação.

**UI (implementada):** módulo `/purchases` — lista, criar, editar, visualizar; `SearchableSelect` para materiais e CC; link operacional para **Nova matéria-prima** (`/materials`).

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

### 5.9 Compras — evoluções futuras (fora do Bloco 1; **planejado** / **reavaliar**)

| Domínio | Artefato sugerido | Status doc | Observação |
|---------|-------------------|--------------|------------|
| Compras | `PurchaseOrder` + linhas | planejado | Transformar solicitação aprovada em pedido; FK a fornecedor formal |
| Compras | Cotação / comparação de preços | planejado | Tabelas próprias ou vínculo a documento externo |
| Compras | Recebimento (NF, conferência) | planejado | Estoque e rastreabilidade lotes |
| Compras | Atualização de `Material.currentCost` a partir de compra | reavaliar | Política explícita; não automático na solicitação (Bloco 1) |
| Compras | Aprovação multinível | planejado | Workflow / papéis; sem alteração no Bloco 1 |
| Compras | Contas a pagar / integração financeira | planejado | Fora do escopo solicitação |
| Compras | Rateio de `CostCenter` | planejado | Modelagem atual não bloqueia colunas de rateio futuras |

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

## 7. Fase 1 — prioridade (campos / temas comerciais)

> **Nota:** esta “Fase 1” refere-se ao **roadmap de dados comercial/CRM** (secções 5–6). É independente da **Fase 1 de navegação SPA** (rotas principais no frontend), já implementada no código e **sem impacto em banco** — ver secção 11.

**Objetivo:** suportar funil e CRM sem multiplicar entidades.

- `Proposal.expectedCloseDate` (opcional).
- `Proposal.source` (opcional).
- `Proposal.lossReason` (+ opcional `lossReasonDetail`) para perdas documentadas.
- Manter KPIs como **calculados**; não obrigar cache em `Customer`.

**Status:** itens marcados `falta criar` nas secções 5.1 e checklist 12.

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
- **Motor de custo / tooltips:** evoluções recentes **não** alteraram colunas de `Product`, `ProductBOM`, `Material` nem `Proposal`; metadados de explicação são **transitórios na API** salvo decisão futura de auditoria (ver changelog, secção 11, e priorização secção 13).

---

## 11. Changelog técnico-funcional

Registros padronizados a partir da **validação do código** (`server.ts`, `src/`, `prisma/schema.prisma`). Legenda de status de item: **implementado** | **planejado** | **analisado** | **não requer banco** | **reavaliar**. Legenda impacto RN: **nenhum** | **indireto** | **reavaliar**. Legenda impacto DB: **nenhum** | **reutiliza existentes** | **precisa novos campos** | **precisa tabela nova**.

### 11.1 Itens já implementados e validados

| Título | Status | Módulos / arquivos | Resumo técnico | Impacto RN | Impacto DB | Campos / tabelas | Fase | Observações |
|--------|--------|---------------------|----------------|------------|------------|------------------|------|-------------|
| Motor de custo — proteção a ciclo na BOM | implementado | `server.ts` (`getProductCostAnalysis`, `pathStack` / `Set`) | Reentrância no mesmo `productId` retorna erro `BOM_CYCLE` em vez de recursão infinita | nenhum | nenhum | — | técnica | Sem migration |
| Motor de custo — falha do componente filho | implementado | `server.ts` | `childProductId` com análise inválida retorna `CHILD_COST_FAILED` com `cause`; não há custo zero silencioso | nenhum | nenhum | — | técnica | — |
| Motor de custo — linha BOM incompleta | implementado | `server.ts` | Linha sem material nem filho: `BOM_LINE_INCOMPLETE` | nenhum | nenhum | — | técnica | — |
| Motor de custo — cache detalhes BOM | implementado | `server.ts` | `bomLineChildAnalysisCache`; miss → `INTERNAL_BOM_CACHE_MISS` | nenhum | nenhum | — | técnica | — |
| Warnings — custo zero / suspeito | implementado | `server.ts` | `CostAnalysisWarning`, merge de warnings de filhos; códigos ex.: material landed inválido, filho CIU ≤ 0 | nenhum | nenhum | — | técnica | — |
| API cost-analysis — payload | implementado | `server.ts` GET `/api/products/:id/cost-analysis` | Resposta inclui `warnings`, `warningCount`, `calculationExplainability` (textos derivados do mesmo cálculo) | nenhum | nenhum | — | técnica | Explicações não persistem em tabela |
| API pricing-snapshot — metadados | implementado | `server.ts` GET `/api/products/:id/pricing-snapshot` | `calculationExplainability` para `unitCost` e `suggestedPrice` (markup divisor) | nenhum | nenhum | — | técnica | — |
| Consolidação PRODUCT — UX e warning divergência | implementado | `server.ts`, `ProductModule.tsx` | `ProductBOM` com `orderBy: { id: "asc" }`; warning `BOM_DETAIL_TOTAL_DIVERGENCE` se soma do detalhe ≠ total; rótulos “estrutura (BOM)” | nenhum | nenhum | — | técnica | Sem mudança de fórmula de negócio |
| Transparência de cálculo — UI | implementado | `src/lib/calculationExplainability.ts`, `src/types/calculation.ts`, `CalculatedValue.tsx`, `ProductModule.tsx`, `ProposalModule.tsx` | Tooltips com metadados; margem de linha explicada em `proposalLineExplain.ts` (alinhado ao cálculo em tela) | nenhum | nenhum | — | técnica | `ProposalItem.calculationExplainability` só em memória ao adicionar item |
| Navegação SPA — Fase 1 (módulos principais) | implementado | `main.tsx`, `App.tsx`, `Layout.tsx`, `Sidebar.tsx`, `src/lib/mainNavigation.ts` | `react-router-dom`: rotas `/:segmento` alinhados ao menu; `/` e `*` → `/dashboard`; funil: `navigate("/proposals")` no evento existente | nenhum | nenhum | — | técnica | Histórico do browser entre módulos |
| Compras — Bloco 1 (centro de custo + solicitação) | implementado | `prisma/schema.prisma`, `prisma/migrations/20260410120000_purchases_block1/migration.sql`, `prisma/seed.ts`, `server.ts`, `src/components/PurchaseModule.tsx`, `src/types/purchase.ts`, `App.tsx`, `Sidebar.tsx`, `mainNavigation.ts` | Novos models `CostCenter`, `PurchaseRequest`, `PurchaseRequestItem` + enums; API REST; UI lista/criar/editar/ver; vínculo opcional `Material`↔item MP; CC fallback `A-CLASS` no seed; **sem** alteração de custo de material nem fluxos existentes de custo/preço/BOM | nenhum | precisa tabela nova | Ver secção **4.7** | Bloco 1 | Contratos de API existentes fora `/api/cost-centers` e `/api/purchase-requests` inalterados |

### 11.2 Itens analisados / planejados (backlog comercial — não implementados como migration neste ciclo)

| Título | Status | Onde está planejado | Resumo | Impacto RN | Impacto DB | Campos / tabelas | Fase doc | Observações |
|--------|--------|---------------------|--------|------------|------------|------------------|----------|-------------|
| Funil — datas, origem, motivo perda, próxima ação | planejado | Sec. 5.1, 7, checklist 12 | Campos em `Proposal` ou entidade futura | indireto | precisa novos campos | Ver tabela checklist | 1–2 | Detalhado nas linhas 1–9 do checklist |
| Customer 360 — perfil comercial, dono, notas | planejado | Sec. 5.2 | Perfil / campos em `Customer` | indireto | precisa novos campos | Sec. 5.2 | 2 | — |
| Health score persistido | reavaliar | Sec. 5.3 | Hoje calculado em app; persistir se precisar histórico/override | indireto | precisa novos campos ou tabela | Sec. 5.3 | 2–3 | — |
| Follow-up — `CommercialActivity` | planejado | Sec. 5.5 | Tabela nova | indireto | precisa tabela nova | Sec. 5.5 | 2 | — |
| Auditoria comercial — `CommercialAuditLog` | planejado | Sec. 5.8 | Tabela nova | indireto | precisa tabela nova | Sec. 5.8 | 2 | — |
| Oportunidade desacoplada | planejado | Sec. 5.7 | `Opportunity` + opcional FK em `Proposal` | indireto | precisa tabela nova | Sec. 5.7 | 3 | Condicional a produto |
| Snapshot de custo em log por execução | reavaliar | Sec. 4.6 | `CostCalculationLog` existe; política de escrita não ligada ao GET atual | indireto | reutiliza existentes | `CostCalculationLog` | técnica | Definir se/gravar ao calcular |

### 11.3 Itens sem impacto em banco (apenas código / UX / contrato JSON)

| Título | Status | Módulos / arquivos | Resumo |
|--------|--------|---------------------|--------|
| `SearchableSelect` | não requer banco | `src/components/shared/SearchableSelect.tsx` | Componente de UI; opções vindas de APIs/cadastros; sem alteração de schema neste changelog |
| Preferências de usuário / favoritos de rota | analisado | — | Não implementado; seria tabela ou storage futuro — **fora** deste ciclo |
| Relatórios — layout / impressão | analisado | `reports-print.css`, `ReportsModule` | Questões de CSS/print **não** exigem campo novo por si |
| Ambiente — `DATABASE_URL` | analisado | Prisma / deploy | Configuração de ambiente; não é “campo novo” de negócio |

### 11.4 Itens que exigirão novos campos ou tabelas (futuro)

Referência cruzada: **secção 5** (domínios), **secção 12** (checklist numerada), **secção 13** (priorização). **Compras Bloco 1** (secção **4.7**) foi migrado na revisão **1.2**; itens comerciais/CRM listados abaixo no checklist **permanecem** como `falta criar` salvo onde indicado.

---

### 11.5 Changelog estruturado — entrega **Compras Bloco 1** (2026-04-10)

| Campo do changelog | Conteúdo |
|--------------------|----------|
| **Funcionalidade implementada** | Cadastro mínimo de **centro de custo**; **solicitação de compra** com cabeçalho e itens; tipos **MATERIA_PRIMA** (material obrigatório via API) e **INDIRETO** (descrição livre, sem material); CC no cabeçalho com herança por item (`costCenterId` null) ou sobrescrita; fallback rastreável **A-CLASS** / “A classificar”; telas lista / criar / editar / visualizar em `/purchases`; pesquisa de material com `SearchableSelect`; atalho **Nova matéria-prima** para `/materials`. |
| **Módulos / arquivos alterados** | `server.ts`; `prisma/schema.prisma`; `prisma/migrations/20260410120000_purchases_block1/migration.sql`; `prisma/seed.ts`; `src/App.tsx`; `src/components/layout/Sidebar.tsx`; `src/lib/mainNavigation.ts`; `src/components/PurchaseModule.tsx` (novo); `src/types/purchase.ts` (novo); `docs/database-field-roadmap.md` (este arquivo). |
| **Impacto técnico** | Novas rotas Express prefixadas `/api/cost-centers` e `/api/purchase-requests`; frontend rota `/purchases` e item de menu `purchases`; sem mudança em contratos de APIs de produtos, materiais (exceto relação Prisma reversa), propostas ou pricing. |
| **Impacto em banco** | **Migration aditiva:** enums `PurchaseRequestStatus`, `PurchasePriority`, `PurchaseLineType`, `PurchaseItemLineStatus`; tabelas `CostCenter`, `PurchaseRequest`, `PurchaseRequestItem`; relação `Material.purchaseRequestItems` (FK opcional em item). **Nenhuma** migration destrutiva em tabelas de custo/BOM/proposta. |
| **Tabelas / models criados** | `CostCenter`, `PurchaseRequest`, `PurchaseRequestItem` (detalhe de campos: secção **4.7**). |
| **Campos criados ou planejados** | **Criados e persistidos:** conforme tabelas na **4.7**. **Planejados (sem banco nesta entrega):** pedido de compra, cotação, recebimento, aprovação multinível, atualização automática de custo de MP, rateio de CC (ver **5.9**). |
| **Status por tema** | Centro de custo e solicitação: **implementado** (persistido). Pedido/recebimento/financeiro: **planejado**. UI de atalhos e labels: **não requer banco**. Política futura de escrita de custo a partir de compra: **reavaliar**. |

---

## 12. Checklist incremental de campos futuros

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
| 20 | Compras | `PurchaseOrder` + linhas (pós-solicitação) | 3 | falta criar |
| 21 | Compras | Cotação / comparativo de ofertas | 3 | falta criar |
| 22 | Compras | Recebimento mercadoria / NF | 3 | falta criar |
| 23 | Compras | Workflow aprovação solicitação | 3 | falta criar |
| 24 | Compras | Rateio multi-centro por linha | 3 | opcional futuro |

---

## 13. Próximas alterações de banco sugeridas (priorização)

Ordem sugerida para **quando** houver decisão de produto de persistir além do que já está no schema. Itens **já listados** nas secções 5–6 e 12; aqui só a prioridade macro.

1. **Funil (Proposal):** `expectedCloseDate`, `source`, `lossReason` (+ detalhe) — maior aderência a CRM operacional sem nova entidade.
2. **Follow-up:** tabela `CommercialActivity` (mínimo viável) — base para próximas ações e histórico de contato.
3. **Auditoria:** `CommercialAuditLog` ou política equivalente — rastrear mudanças de status/valor/responsável.
4. **Perfil comercial (Customer):** notas comerciais separadas, relacionamento, dono (texto ou FK futura).
5. **Health / ABC / recompra:** persistir **apenas** se houver requisito de relatório SQL massivo, override manual ou histórico temporal; caso contrário manter **calculado** (secção 6).
6. **Custeio:** avaliar uso de `CostCalculationLog` para gravar snapshots sob regra (ex.: ao fechar custo, ao publicar preço), com retenção e versão — **reavaliar** antes de migration adicional de colunas.

**Não sugerido como prioridade de banco:** preferências de UI do usuário, estado de rota interna (abas, modais), metadados de tooltip JSON retornados pela API (salvo produto exija auditoria desses textos).

---

*Fim do documento. Atualizar versão e data ao editar.*
