# Documentos do Projeto — auditoria (2026-10-15)

Escopo: os cinco documentos de Engenharia › Projetos › Projeto — Ficha rápida, Ficha completa, Planilha modelo, Relatório gerencial e Proposta Cliente.

Esta auditoria precede a correção aprovada em 2026-10-15. Nada aqui altera regras de custo ou de preço.

## 1. Cliente

- `Project` guarda só `customerName` (obrigatório) e `customerDocument` (opcional, texto livre). Não há vínculo com `Customer`.
- A busca oficial (`GET /api/projects/lookup/customers`) devolve `id`, mas o front descarta o id (`buildExistingCustomerPayload`). Cliente digitado manualmente grava `customerDocument = null`.
- `Customer.taxId` é `@unique` na string exata.
  - Nomus grava só dígitos; cadastro manual e importação gravam como digitado.
  - Comparações precisam normalizar para dígitos (`normalizeCnpj`, `src/lib/companyCnpjFormat.ts`).
- Precedente de "FK + snapshot da época":
  - `SatisfactionSurveyInvitation` (`customerId` + `customerNameSnapshot`/`customerTaxIdSnapshot`);
  - `CommissionReceiptLedgerLine`.
- `Proposal`/`SalesOrder` têm FK, mas leem o cliente vivo (sem snapshot).

## 2. Campos comerciais

- `Project` não tem validade, pagamento, entrega, frete, prazo desejado, prioridade nem aplicação.
- Tem uma única `notes`, interna, que hoje vaza para a Proposta Cliente (`resolveCommercialTerms`).
- O vocabulário de `Proposal` serve de referência:
  - `validityDays` (padrão 15), `paymentTerms` (texto livre), `deliveryTimeDays`, `freightCondition` (CIF/FOB), `deliveryLocation`;
  - `notes` (cliente) × `internalNotes`.
- Não existe tela de edição do cabeçalho do projeto. Só há o modal de criação e o PATCH de observações.

## 3. Custos e preços persistidos (semântica)

| Campo | Modelo | Semântica | Gravado quando |
|---|---|---|---|
| `unitCostSnapshot` / `totalCost` | ProjectStructureLine (por versão) | unitário da linha / total por 1 unidade do pai (qtd × unit × (1+perda)) | importação, edição de linha |
| `estimated/quotedUnitCost` | ProjectSimulatedItem (por versão) | unitário (outros custos: qtd × unit no JSON `notes`) | criação/edição; cópia de simulação com `sourceSimulation*` |
| `constructionCost` / linhas no `notes` | ProjectMold (por versão) | investimento total | edição do molde |
| `allocatedAmount`, `amortizationQuantity`, `unitAmortizedCost`, `finalUnitCostSnapshot` | ProjectCostAmortizationAllocation (por projeto) | total R$ / unidades / unitário | "Salvar amortização" (apaga e recria) |
| `costBaseUnitSnapshot`, `finalUnitCostSnapshot`, `taxPercentSnapshot`, `suggestedPrice(WithoutAmortization)`, `agreedCustomerPrice` | ProjectPricingItem (por projeto) | unitário / % | "Salvar precificação" (apaga e recria; `updatedAt` = data da última gravação) |
| `quantityPerSet` | ProjectClientProposalItem (por projeto) | peças por conjunto | "Salvar quantidades" |
| `expectedMonthlyVolume` | Project | unidades por **mês** | edição do projeto |
| `unitCost`, `suggestedPrice` | ProjectVersion | unitário, sem impostos e sem a amortização nova | todo recálculo |

`ProjectVersion` não confere com a aba de Precificação e não deve alimentar documentos.

Achados:
- **Só a versão atual tem dados completos.**
  - Precificação, amortização e quantidades são por projeto, sem `versionId`.
  - Nova versão (`copyVersionFromCurrent`) perde árvore, origem oficial e proveniência de simulação, e deixa a precificação órfã.
- **Os relatórios gerencial e da proposta recalculam preços ao gerar** (`computeLiveProjectPricingView`).
  - É a regra documentada em `projectsPricing.ts:365` ("relatórios … usam esta função, não snapshots persistidos").
  - O que é recalculado:
    - **imposto:** regra fiscal vigente; ignora `taxPercentSnapshot`, e regra inativada vira 0%;
    - **amortização:** total atual dos moldes e outros custos;
    - **SKU e nome:** produto vivo.
  - Os custos-base vêm de snapshots do próprio projeto, não do custo vivo de materiais.
- Fichas usam outro cálculo (`computeCostBreakdownForVersion`). Hoje há duas fontes de custo divergentes.
- Linhas de produto oficial copiam o CIU vivo na importação. Não há data-base, versão de tabela nem hash.
  - Existem tabelas publicadas (`ProductionCostTableVersion`), não usadas por Projetos.

## 4. PDF e impressão (sem dependência nova)

| Mecanismo | Multipágina | Acentos | Fonte embutida | Imagem/logo | Tabelas | Nº de página |
|---|---|---|---|---|---|---|
| `minimalPdfWriter` (PDF atual da Proposta) | não (corta em y<50) | não (remove) | não | não | não | não |
| `commercialPolicyControlledCopyPdf` (POL-COM-001) | sim | sim (WinAnsi + métricas AFM) | não (Helvetica) | não | sim (cabeçalho repete) | sim ("Página X de Y") |
| `proposalInternalManagementPdfLayout` | sim | sim (Latin-1) | não | não | perde linhas que transbordam | sim |
| `onePagePrint` (html-to-image) | sim | sim | n/a (imagem) | sim | sim | não |
| Impressão do navegador (`PrintHeader`, `print-document.css`) | sim | sim | sim | sim | sim (`thead` repete) | manual |

Conclusão: o motor da Política Comercial atende multipágina, acentos pt-BR, tabelas e paginação.
- Falta imagem. O logo pode entrar como JPEG (`/DCTDecode`, já usado em `onePagePrint.ts`) ou como PNG via `zlib` nativo, **sem biblioteca nova**.
- Limitação: só caracteres WinAnsi (cobre o português). Não há fonte TTF no repositório.

## 5. Emissão controlada

Precedente: `CommercialPolicyControlledCopy`.
- Uma linha imutável por emissão: `generatedByUserId`, `generatedAt`, `documentDigest`, `copyDigest` (sha256).
- Auditoria `writeSecurityAuditLog`.
- Helpers `sha256Hex`/`stableStringify`.
- Não existe numeração global de documentos. O padrão é código + versão.

## 6. Emitente

`BrandingSettings` tem:
- razão social, nome fantasia, CNPJ (`document`), endereço, telefone, e-mail, site;
- rodapé de proposta, contato comercial e logos (data URLs).

A leitura exige `admin.settings.branding`, então os documentos precisam montar o emitente no servidor. `printBranding.ts` ainda tem um `PRINT_COMPANY_DOC_FALLBACK` fixo.

## 7. Etapas 1 e 2 — implementação (2026-10-15)

**Vínculo Projeto → Cliente** (migration `20261009120000_project_customer_link_commercial_terms`, aditiva):
- `Project.customerId` (FK `Customer`, `ON DELETE SET NULL`), `customerLinkedAt`, `customerLinkSource` (`LOOKUP` | `CNPJ_RECONCILIATION`, CHECK).
- `customerName`/`customerDocument` seguem como snapshot histórico. Com vínculo, o servidor grava o snapshot a partir do cadastro (`resolveProjectCustomerLink`); o texto enviado pelo navegador é ignorado. Só cliente `ACTIVE` pode ser vinculado.
- PATCH: `customerId: null` desvincula e mantém o snapshot; editar nome/documento de projeto vinculado → 409 `CUSTOMER_LINKED`.
- Projetos antigos: `scripts/projectCustomerLinkReconcile.ts`. Dry-run por padrão; compara **só dígitos de CNPJ/CPF** (nunca nome); conflitos `NO_DOCUMENT`, `INVALID_DOCUMENT`, `NOT_FOUND`, `AMBIGUOUS`, `INACTIVE_CUSTOMER`; nome divergente só é sinalizado. `--apply` exige o token (sha256 do plano) impresso no dry-run; gravação condicional (`customerId IS NULL`) e sem tocar no snapshot.

**Condições comerciais** (mesma migration, todas opcionais, sem valor padrão):
- `proposalValidityDays`, `paymentTerms`, `deliveryTimeDays`, `deliveryLocation`, `freightCondition` (CIF/FOB, CHECK), `desiredDeadline`, `priority` (LOW/MEDIUM/HIGH/URGENT, CHECK), `application`, `clientNotes`.
- Regras puras em `src/lib/projectsCommercialTerms.ts`. Não definido → "A definir".
- `notes` = **observações internas** (Histórico); `clientNotes` = observações ao cliente. A Proposta Cliente deixou de usar `notes` e passou a calcular "válida até" = emissão + validade.
- UI: painel "Cliente e condições comerciais" na aba Início. Na edição, só uma escolha explícita na busca troca o cliente (`commitDraftOnBlur={false}`).
- Alterar só cliente/condições não recalcula custos da versão.

**Validação**
- Testes novos: `projectsCustomerLink.test.ts`, `projectsCommercialTerms.test.ts`, mais um caso em `projectsClientReport.test.ts`.
- `test:projects`: 352/353. A falha restante (`projectsCommercialOwnerLookup`, `PROJECTS_LOOKUP_PERMISSIONS`) já existia e o arquivo não foi tocado.
- Dois asserts desatualizados corrigidos nos arquivos tocados:
  - guarda `requireResource` desde a P19;
  - rótulo "% amort.".
- Typecheck: 1370 erros, igual à base.
- PostgreSQL descartável (PGlite):
  - migration sobre a DDL da base, preservando projeto antigo;
  - CHECKs e FK recusam valores inválidos;
  - cliente excluído → vínculo NULL e snapshot mantido;
  - `migrate diff` vazio.
- Rotas reais + Prisma real: 23/23 cenários, incluindo:
  - snapshot do cadastro;
  - cliente inativo → 400;
  - 409;
  - desvincular;
  - proposta sem observação interna;
  - conciliação com dry-run, aplicação e troca do token.
- Harness visual (Vite + Chrome headless):
  - painel sem vínculo, edição, vínculo e salvar;
  - leitor sem botão Editar;
  - 390 px sem overflow;
  - sem erros de console.

## 8. Etapas 3 a 6 — implementação (2026-10-15)

**Decisão aprovada:**
- Os documentos usam a **precificação salva**, com o imposto gravado.
- Quando custos ou amortização mudaram depois da gravação, há alerta ou bloqueio.
- A emissão é congelada com número, revisão e hash.
- Custo final = unitário × quantidade por conjunto.

**Fonte de valores** (`src/lib/projectsDocumentValues.ts`):
- Os itens vêm de `ProjectPricingItem` (snapshots).
- A engine viva (`computeLiveProjectPricingView`) só **compara**. Divergências apontadas:
  - custo base;
  - amortização;
  - percentual da regra fiscal;
  - preço;
  - item sem precificação;
  - item removido.
- `buildProjectCostSnapshot` usa `detail.documentValueSource` quando presente. A tela continua com o motor vivo.
- Única derivação: separar o preço do produto do adicional de amortização no preço final, com a fórmula oficial (`calculateSalePriceFromCost`) sobre os insumos gravados.

**Bloco documental e emissão** (`projectsDocumentHeader.ts`, `projectsDocuments.server.ts`):
- O cabeçalho comum traz:
  - emitente das Configurações de Marca (sem valores fixos);
  - cliente (cadastro);
  - projeto e versão;
  - número/revisão;
  - emissão (data e usuário);
  - origem dos valores e divergências (só nos documentos internos).
- Tabela `ProjectIssuedDocument` (mesma migration `20261009120000`):
  - conteúdo JSON congelado + `payloadSha256`;
  - revisão sequencial por tipo; número `PRJ-xxxxx-{FR|FC|PL|RG|PC}-Rnn`;
  - trigger bloqueia UPDATE/DELETE (exceto `projectId → NULL` na exclusão do projeto).
- Rotas:
  - `GET /documents/:tipo/preview`
  - `POST /documents/:tipo/issue` (manage)
  - `GET /documents/issued[?type=]`
  - `GET /documents/issued/:id` (confere o hash)
  - `GET /documents/issued/:id/proposal.pdf|pptx`
- A **proposta só é emitida** com precificação salva, atual e completa. Documentos internos emitem com os avisos impressos.

**Correções por documento:**

| Documento | Antes | Agora |
|---|---|---|
| Ficha completa | código da BOM = id interno (UUID) | SKU / código do material / código provisório |
| Ficha completa | "Mão de obra direta (HH)" = R$ | horas das linhas em hora + custo em R$ em campo separado |
| Ficha completa | dados do cliente vazios | cadastro (razão, CNPJ, IE, contato, e-mail, telefone, endereço, cidade/UF) |
| Ficha completa | "Empresa do grupo" por regex em observações | emitente das Configurações de Marca |
| Ficha completa | condições comerciais vazias | campos estruturados; custo e preço do conjunto da precificação salva |
| Ficha rápida | prioridade/prazo/aplicação vazios; qtd. prevista "1" fixo | campos do projeto; qtd. por conjunto salva (vazio se não salva); produtos oficiais com SKU |
| Fichas / planilha / proposta | `notes` técnicos (`guided-simulation-id:<uuid>`) impressos | `documentUserNotes` (só texto do usuário) |
| Relatório gerencial | custo dos itens = soma de unitários | Σ unitário × qtd./conjunto; colunas por conjunto e por volume |
| Relatório gerencial | "Elaborado/Revisado" = responsáveis do projeto | elaborado = emissor; revisão/aprovação em branco para assinatura |
| Planilha | linhas de exemplo nas abas de dados; nome fixo; sem projeto | dados reais; exemplo só em `99_Exemplo`; aba `00_Documento`; nome = número |
| Proposta | emitente "IndusCost"; validade nula; observação interna | emitente da marca; validade = emissão + dias; só observações ao cliente |
| Proposta | "Valor total estimado" = preço × volume mensal (ou o preço sem volume) | "Valor mensal estimado"; sem volume não aparece |
| Proposta (PPTX) | card "Amortização" mostrava a condição de pagamento | "Pagamento"/"Entrega" com "A definir" |

**PDF:**
- Mesmo motor da Política Comercial (`commercialPolicyControlledCopyPdf.ts`); só foram exportadas as primitivas. A saída da Política foi comparada byte a byte antes/depois e é **idêntica** (127 testes da Política passando).
- Logo das Configurações de Marca via `src/lib/pdf/pdfImage.ts` (JPEG `DCTDecode`; PNG com `zlib` nativo e alfa em `/SMask`). **Sem dependência nova.**
- Recursos: multipágina, acentos WinAnsi, tabelas com cabeçalho repetido, "Página X de Y", número/revisão, emissor e código de verificação.
- O botão "Exportar PDF Cliente" foi mantido: exporta a revisão **emitida**. A exportação sem emissão (rota antiga) sai como **PRÉVIA** com marca d'água.

**Validação:**
- Testes novos `projectsDocuments.test.ts` (20), além dos das etapas 1–2.
- Lista unitária + `test:projects` (423 arquivos): base c508cd3e tem 5274 testes / 7 falhas; agora 5319 / 5, **0 regressões**. 2 falhas antigas foram corrigidas: asserts desatualizados em arquivos tocados.
- Typecheck: 1370 erros, igual à base. Build OK.
- PostgreSQL descartável (PGlite) com rotas reais e Prisma real: 31/31 cenários.
  - Precificação, prévia, bloqueios e emissão R01/R02.
  - Preço histórico preservado após mudança de custo; R01 intacta após R02.
  - Trigger bloqueia UPDATE/DELETE; exclusão do projeto preserva as emissões.
  - PDF, PPTX e planilha gerados.
  - `migrate diff` vazio.
- Validação visual (Vite + Chrome headless, envelopes reais gerados no Postgres): os 4 documentos HTML em prévia e emitidos, impressão, aba Documentos e PDF com logo.
  - Sem UUID visível.
  - Sem observação interna na proposta.
  - Sem overflow.

**Pendências / observações:**
- "Custo total do projeto" no relatório gerencial continua com o critério da tela Custos do Projeto: custo unitário atual + investimentos. Não foi alterado (regra de custo).
- Precificação, amortização e quantidades continuam por projeto, não por versão. A emissão registra a versão atual.
- Ordem de implantação:
  1. Migration `20261009120000` antes do código.
  2. Conciliação de clientes: rodar o dry-run e só depois aplicar com o token.
  3. Projetos com documentos: salvar a precificação para habilitar a emissão da proposta.
