# POL-COM-001 v1.0 — prontidão de publicação e política comercial viva (2026-09-29)

Branch: `feat/commercial-policy-v1-publication` (base `ebe043e3`). **Nada publicado. Nada em main. Sem deploy, sem banco real, sem homologação e sem produção.**

> **Atualização 2026-09-30 — ver §7.** As seções 1 a 6 registram o diagnóstico de 29/09/2026 sobre o DOCX original e ficam preservadas como histórico. A candidata v1.0 foi depois alinhada ao IndusCost (o sistema é a fonte da verdade para regras que já existem nele): os três bloqueios descritos na §2 deixaram de existir.

## 1. Fonte oficial

Único documento normativo: `LK - Politica Comercial e Comissionamento V1.0 - USO RESTRITO.docx` — POL-COM-001, versão 1.0, POLÍTICA OFICIAL — USO INTERNO E RESTRITO, Koppetel Comercio de Plásticos LTDA, CNPJ 14.055.501/0001-80. Versões 5.x e outros chats foram ignorados.

O DOCX foi extraído integralmente (texto + 7 tabelas) e comparado linha a linha com a representação estruturada `src/lib/commercialPolicy/official/polCom001V1Document.ts` (33 capítulos, 421 linhas normalizadas): **421/421 linhas idênticas**, com uma única diferença deliberada (Anexo III, ver §3). O texto plano `officialPolicyPlainText()` continua sendo a fonte do hash SHA-256 da versão.

## 2. Diagnóstico — matriz de reconciliação

| Seção | Regra documental | Implementação real | Status | Severidade | Ação |
| --- | --- | --- | --- | --- | --- |
| Capa / Anexo III | Código POL-COM-001, versão 1.0 em todo o teor | Capa 1.0; Anexo III do DOCX dizia 2.0 → corrigido para 1.0 só na representação estruturada/PDF | ALINHADO | INFORMATIONAL (`DOCUMENT_INTERNAL_VERSION_MISMATCH`) | Registrar (feito aqui e no painel) |
| 5 | Cliente Comercial Comissionável × Conta Institucional Não Comissionável | `CommissionCustomerExclusionRule` (Exceções por cliente) | ALINHADO | INFORMATIONAL | — |
| 6 | Base por Item de Venda, valor líquido comissionável | Motor por item (`commissionOrderCalculation`) | PARCIAL | — | Conferir base exata na homologação |
| 7 / Anexo I | Matriz por Margem Oficial: <30% 1% (Diretoria); 30–34,99% 1% (Supervisor); 35–39,99% 2%; 40–49,99% 3%; **≥50% 4%** | `CommissionRule.ratePercent` por regra/faixa de tabela de preço (até 5%); sem faixa de margem, sem alçada | **DIVERGENTE** | **BLOCKING** (`COMMISSION_MATRIX_NOT_PARAMETERIZED`) | Parametrizar a matriz por margem no motor **ou** revisar formalmente o Anexo I. O 4% **não** foi alterado para 5%. |
| 8 / Anexo IV | Cobertura, venda iniciada × nova demanda, recorrentes/OEM, retorno, guarda-chuva, canais institucionais, SLA | Registro material no CRM; sem automação de atribuição | PROCESSO_MANUAL | INFORMATIONAL | — (documento não promete execução automática) |
| 9 / Anexo II | Campanha só com identificação, versão, vigência, escopo, alçada, comunicação prévia | Instância = referência controlada; regra geral = texto normativo | TEXTO_NORMATIVO | INFORMATIONAL | — |
| 10 | Carteira é ativo da empresa; Responsável Comercial é atribuição | `CrmCustomerCommercialOwner` separado do vendedor do pedido (`SALES_ORDER_NOMUS_SELLER`) | ALINHADO | — | — |
| 11 | 90 dias corridos sem novo **PV aprovado** → revisão; CRM material válido preserva; sem CRM, retirada automática | `customerCommercialOwnerInactivity` (desde 941ffedb): relógio = última **NF / Documento de Saída válido** (PV `SENT_TO_NOMUS` sem NF não reinicia; `NEVER_INVOICED` não remove), preservação por CRM estruturado, `INACTIVITY_90_DAYS`, histórico `CrmCustomerPortfolioReview` | **DIVERGENTE** | **BLOCKING** (`PORTFOLIO_INACTIVITY_MISMATCH`) | Republicar a Seção 11 em nova versão (relógio por NF/DS válido) **ou** alinhar a rotina ao texto; não marcar IN_SYNC |
| 14 | Supervisor recebe 33% das comissões elegíveis do time, parcela adicional, sem carteira própria | Não existe em `CommissionSettings`; sem vínculo vendedor → supervisor | **NÃO_IMPLEMENTADO** | **BLOCKING** (`SUPERVISOR_SHARE_NOT_PARAMETERIZED`) | Parametrizar antes de publicar; não fingir parametrização |
| 16 | Apuração mensal; liberação proporcional à liquidação | `CommissionSettings` `EACH_RECEIVABLE_PAID` + proporcional | ALINHADO (lido do snapshot) | INFORMATIONAL (`COMMISSION_RELEASE_ALIGNED`) | Se o sistema mudar: `_NOT_PROPORTIONAL` = WARNING, `_MISMATCH` = BLOCKING, sem snapshot = `_UNVERIFIED` WARNING |
| 2 | Abrangência: vendedores, executivos, consultores, equivalentes, supervisão | Gate eletrônico só para `SELLER` | PARCIAL | WARNING (`ELECTRONIC_GATE_AUDIENCE`) | Decisão explícita; não bloqueia; gate não foi ampliado |
| 22 | Condutas vedadas integrais | Texto integral (9 itens) no HTML, PDF e aceite; pergunta `q-vedadas` | TEXTO_NORMATIVO | — | — |
| 23 | Documento controlado, uso interno e restrito | Acesso autenticado; cópia controlada com marca d'água, destinatário e código; sem rota pública | ALINHADO | — | — |
| 25 | Revisão por nova versão, "o que mudou", vigência, comunicação | Versões imutáveis, snapshot + changeset com hash, rascunho único, `effectiveFrom` prospectivo, novo aceite | ALINHADO | — | — |

**O que bloqueia a publicação hoje (3 BLOCKING):** matriz do Anexo I não executada pelo motor; 33% do supervisor não parametrizado; relógio de inatividade por NF/DS válido enquanto o texto v1.0 fala em PV aprovado (divergência introduzida em origin/main 941ffedb, durante esta entrega). **1 WARNING:** abrangência do gate. **5 INFORMATIONAL.** Status da tela: *Aguardando compatibilização*; botão "Publicar versão 1.0" desabilitado.

## 3. Inconsistência documental tratada

`DOCUMENT_INTERNAL_VERSION_MISMATCH`: DOCX com capa 1.0 e Anexo III "versão 2.0". Autorizado no pedido, o Anexo III foi corrigido para **"versão 1.0"** apenas na representação estruturada (e, por consequência, no HTML, no PDF e no termo). O fato de origem fica registrado em `DOCUMENT_SOURCE_ANNEX_III_VERSION = "2.0"` e aparece como achado informativo no painel e na matriz. Nenhuma outra regra foi alterada. Um teor que ainda cite "versão 2.0" continua gerando `DECLARED_VERSION_MISMATCH` (BLOCKING).

## 4. O que foi implementado

- **Motor normativo** (`commercialPolicyNormative.ts`): achados com `category`, `policySection`, `severity` (BLOCKING/WARNING/INFORMATIONAL), `blocking` derivado, `document`, `system`, `action`; auditoria bidirecional (recebe o snapshot atual e compara a Seção 16 com `CommissionSettings`); `buildPolCom001ReconciliationMatrix`; seções corrigidas (`POLICY_SECTIONS`: supervisor 14, pagamento 16, CRM 20, campanhas 9, classificação 5, inatividade 11); `planPolicyRevision` agrega mudanças consecutivas no rascunho pendente; `compareDraftToCurrentNormativeState`; `nextRevisionLabel` "1.0"→"1.1".
- **Documento** (`polCom001V1Document.ts`): bloco `table` (capa, aprovação §28, Anexo I ×2, Anexo IV ×2) preservando o texto plano; Anexo III → 1.0.
- **Questionário/declarações** (`polCom001V1.ts`): +4 perguntas (`q-matriz` ≥50% = 4,00%, `q-supervisor`, `q-campanha`, `q-vedadas`); 10 declarações cobrindo leitura integral da versão 1.0, matriz, carteira, cobertura, inatividade 90 dias, condutas vedadas, confidencialidade, uso restrito e registro eletrônico — sem cláusula de renúncia.
- **Serviço**: publicação congela `normativeSnapshot`/hash (e changeset vazio na baseline) na versão; recusa rascunho com snapshot desatualizado (`DRAFT_SNAPSHOT_STALE`); vigência futura não aposenta a vigente (`settleScheduledVersions` na transição, novo método de store `retirePublishedEffectiveBefore` — memória e Prisma); `openNormativeRevision` reutiliza e agrega o rascunho pendente; `versionLabelOf`, `versionAdminView`, `findPendingRevisionDraft`.
- **Rotas**: `GET /api/admin/commercial-policy/integrity` devolve cartão do documento, `publicationStatus`, contagens, achados, matriz, snapshot atual, versão vigente, rascunho pendente (estado, seções afetadas, changeset, o que mudou), vigências futuras, aceites por versão; **novo** `GET /api/admin/commercial-policy/official/pol-com-001/document` (cópia controlada antes da publicação, SUPER_ADMIN, carimbo "PRÉVIA — VERSÃO AINDA NÃO PUBLICADA", auditada); publicação passa o snapshot atual e grava `POLICY_VERSION_PUBLISHED`; revisão normativa deriva o rótulo no servidor e audita `POLICY_CHANGESET_GENERATED` quando agrega.
- **PDF**: cabeçalho com versão dinâmica, quebra de linha por largura (texto integral, nunca truncado), glifos WinAnsi (— · ’ “ ” – × … § • º ª), código/empresa/CNPJ/classificação nas linhas do documento, comprovante com hashes de snapshot/changeset.
- **Leitor**: renderiza tabelas; modo `preview` (mesmo renderizador do vendedor, sem "Concluir leitura").
- **Painel admin**: cartão (código, título, versão 1.0, classificação, empresa/CNPJ, status, hash, integridade, achados, vigência, publicação); botões Visualizar / Gerar PDF / Ver divergências / Publicar (desabilitado com BLOCKING, com confirmação); tabela de achados + matriz de reconciliação; política viva (vigente, rascunho, changeset, o que mudou, snapshots, vigência futura, aceites por versão, cobertura); histórico; editor manual recolhido em "Criar nova versão manual"; estados de carregamento/erro.

### 4.1 Guia de publicação e CRUD do conteúdo (complemento, mesmo dia)

- **"O que falta para publicar"** no cartão e na prévia administrativa: cada bloqueio com *o documento diz / o sistema faz / quem resolve (SISTEMA · DOCUMENTO · DECISÃO) / onde / como resolver* (`PrePublishFinding.resolution`). Nada é marcado à mão: a tela reconfere documento × sistema a cada abertura.
- **Conteúdo da política**: tabela de versões (rótulo, situação, título, vigência, publicação, contagens) com *Visualizar*, *Editar* (rascunho), *Publicar*, *Descartar*, *Duplicar como rascunho* (publicada/aposentada) e *Cópia controlada*; botões *Novo rascunho a partir da POL-COM-001* e *Novo rascunho em branco*.
- **Editor estruturado** (`CommercialPolicyVersionEditor`): capítulos (adicionar/remover/reordenar), blocos parágrafo/subtítulo/tópico/termo/tabela, regras-resumo, declarações, perguntas (alternativas, correta, explicação, capítulo a reler) e vigência; *Visualizar como o vendedor* renderiza o rascunho não salvo no mesmo leitor.
- **Formato**: o `content` da versão passa a ser uma marcação leve (`policyDocumentFormat.ts`: `# capítulo`, `## subtítulo`, `- tópico`, `> termo :: definição`, `| célula | célula |`), com roundtrip exato dos 33 capítulos oficiais; ids = slug do título (as perguntas continuam endereçáveis); o PDF converte para texto plano. O hash oficial mudou (nenhuma versão publicada, nada afetado).
- **Rotas**: `POST /versions/from-official`, `POST /versions/:id/duplicate`, `GET/PUT/DELETE /versions/:id` (PUT/DELETE só em DRAFT → 409 `VERSION_IMMUTABLE`). Qualquer rascunho que ainda se apresente como POL-COM-001 continua sujeito à auditoria documento × sistema ao publicar.
- O leitor do vendedor (`CommercialPolicyAcceptancePage`) renderiza qualquer versão (oficial ou editada) no leitor estruturado.

## 5. Política viva — como funciona

- **Baseline**: ao publicar a 1.0, o snapshot normativo atual (liberação, carteira, classificação, atribuição; matriz/supervisor explicitamente `parameterized: false`) é congelado na versão com hash; conteúdo, regras, declarações, perguntas, changeset e vigência ficam imutáveis (`VERSION_IMMUTABLE`; `attachNormative`/`saveDraft` recusam versão publicada).
- **Abre revisão** (`POLICY_VERSION_REQUIRED`): `pricing.methodology`, `commission.matrix/band/releaseRule/supervisorShare`, `portfolio.inactivityDays/crmPreservation`, `crm.requiredRule`, `campaign.generalRule`. **Não abre**: `pricing.skuPrice`, `customer.responsible`, `crm.contact`, `salesOrder.*` (OPERATIONAL_DATA); `customer.institutionalMembership`, `campaign.instance` (CONTROLLED_REFERENCE_CHANGED); cobertura/SLA (TEXTUAL_NORMATIVE_RULE).
- **Armazenamento**: `CommercialPolicyVersion.normativeSnapshot/Hash`, `changeSet/Hash`, `previousVersionId` (colunas já existentes da migração `20260929120000` — **nenhuma migração nova**); aceite guarda `normativeSnapshotHash`/`changeSetHash` na evidência.
- **Rascunho único**: eventos consecutivos são agregados no mesmo DRAFT (mesma dependência substitui, dependência nova acrescenta); duplicata exata é ignorada; o rascunho carrega o texto oficial integral e as seções afetadas para a revisão assistida; publica só sem BLOCKING e com snapshot igual ao estado atual.
- **Nova versão → novo aceite**: aceite é por versão (`@@unique policyVersionId,userId`); o anterior é preservado; vigência futura respeitada (a 1.0 continua vigente até `effectiveFrom`; na transição a anterior vira RETIRED, não é apagada).
- **Não conectado automaticamente**: as fontes operacionais ainda não chamam `openNormativeRevision` (só `commissionSettings.server.ts` bloqueia com `PENDING_POLICY_PUBLICATION`); a revisão assistida do texto (edição guiada por seção) é apresentada, não editável; matriz e supervisor precisam existir no motor antes de qualquer snapshot os descrever.

## 6. Validação executada

- `commercialPolicy.test.ts`, `official/polCom001V1.test.ts`, `commercialPolicyNormative.test.ts`, novo `commercialPolicyPublication.test.ts` (testes 1–20 + complementares 1–15): **70/70**.
- Regressão por grafo de importação: 343 arquivos, 4281 testes na branch × 4257 na base `ebe043e3`; **0 regressões**; 49 falhas pré-existentes idênticas nos dois lados.
- `tsc --noEmit`: 1332 erros = baseline (nenhum nos arquivos tocados; único delta vs. baseline antiga é o TS2345 pré-existente de `salesOrderItemFlowEngine.ts`). Foi necessário `prisma generate` offline (cliente estava defasado para `CrmCustomerPortfolioReview`).
- `npm run build`: OK.
- Tela verificada em harness Vite + Chrome headless (cenários bloqueado, divergências, prévia capa/Anexo I/Anexo III, publicada com rascunho 1.1, 768px).

## 7. Alinhamento da candidata v1.0 ao IndusCost (2026-09-30)

Branch: `feat/commercial-policy-v1-system-aligned` (base `0ac0ff10`). **Nada publicado. Sem deploy, sem banco real, sem homologação e sem produção.** Nenhuma versão da política havia sido publicada: o texto abaixo **consolida a v1.0** antes da primeira publicação (não é v1.1).

Regra mestra: para regras que já existem no IndusCost, **o sistema é a fonte da verdade** e a política descreve o comportamento real. O DOCX original (`LK - Politica Comercial e Comissionamento V1.0`) divergia do sistema em três pontos; o registro dessas divergências fica nas seções 1–6 deste documento e em `DOCUMENT_ANNEX_I_BANDS` (matriz em degraus do DOCX, mantida só como histórico).

### 7.1 Decisões

| Tema | DOCX original | Sistema (fonte da verdade) | Candidata v1.0 | Achado |
| --- | --- | --- | --- | --- |
| Matriz de comissão (Seção 7 / Anexo I) | Degraus por faixa de Margem Oficial (<30% 1%; 30–34,99% 1%; 35–39,99% 2%; 40–49,99% 3%; ≥50% 4%) | `resolveCommercialPriceTier` + `interpolateCommercialCommissionRate`: quatro níveis publicados na Formação de Preço (Atacado, Varejo 1, Varejo 2, Varejo 3); preço igual ao do nível → percentual do nível; entre dois níveis → interpolação linear **pelo preço** praticado; abaixo do Atacado → percentual fixo de preço abaixo da tabela (`OUT_OF_TABLE_COMMISSION_PERCENT`); a partir do Varejo 3 → teto; 4 casas decimais; data de referência = faturamento (NF) ou, na falta, o Pedido | Seção 7 reescrita; Anexo I = "Matriz de Referência de Formação de Preço, Comissão e Alçada", tabela *Nível comercial · Margem de referência · Comissão de referência* **preenchida na exibição com `normativeSnapshot.commissionMatrix` da versão** (nenhum percentual fixo no texto) | `COMMISSION_MATRIX_ALIGNED` (INFORMATIONAL) quando o texto descreve níveis + interpolação pelo preço e a Formação de Preço tem as quatro tabelas publicadas com regra "Faixa comercial" ativa |
| Supervisor 33% (Seção 14) | 33% das comissões elegíveis do time, parcela adicional | Não existe no motor nem em `CommissionSettings` | Texto mantido + "apuração por procedimento administrativo próprio, não integra o cálculo automático do sistema" | `SUPERVISOR_SHARE_MANUAL_PROCESS` (INFORMATIONAL, não bloqueia, responsável PROCESSO); snapshot `{ parameterized: false, calculationMode: "MANUAL_EXTERNAL_PROCESS", documentedShare: 0.33 }`. **O supervisor não foi implementado no motor.** |
| Carteira / 90 dias (Seção 11) | 90 dias corridos sem novo **Pedido de Venda aprovado** | `customerCommercialOwnerInactivity`: 90 dias corridos desde a última **NF / Documento de Saída válido**; PV sem NF, proposta e recebimento não reiniciam; faturamento parcial reinicia; CRM estruturado válido preserva; `NEVER_INVOICED` não remove | Seção 11 reescrita com "Faturamento Válido" (termo novo na Seção 4), exemplos de registro válido no CRM, revisão no mês seguinte quando preservado e a regra de cliente sem histórico de faturamento | `PORTFOLIO_INACTIVITY_ALIGNED` (INFORMATIONAL) |

As alçadas de aprovação do Anexo I continuam no documento como **procedimento administrativo** (`APPROVAL_AUTHORITY_MANUAL_PROCESS`, WARNING, não bloqueia).

### 7.2 Como a auditoria decide (nada é marcado à mão)

- `readDocumentCommissionMatrix` classifica o Anexo I em `SNAPSHOT` (linha em branco preenchida pelo snapshot), `LEVELS` (níveis escritos por extenso) ou `STEP_BANDS` (tabela antiga por faixa de margem). `STEP_BANDS`, ou texto que não descreva interpolação pelo preço, continua gerando `COMMISSION_MATRIX_INTERPOLATED` (BLOCKING); níveis escritos diferentes dos publicados geram `COMMISSION_MATRIX_MISMATCH`; sem as quatro tabelas publicadas, `COMMISSION_MATRIX_NOT_PARAMETERIZED`; sem regra "Faixa comercial" ativa, `COMMISSION_MATRIX_ENGINE_RULE_INACTIVE`.
- `readDocumentInactivityRule` lê da Seção 11 o prazo, o relógio (faturamento válido × PV aprovado), a preservação por CRM e a regra do nunca faturado; qualquer diferença em relação à rotina gera `PORTFOLIO_INACTIVITY_MISMATCH` (BLOCKING). O texto do DOCX continuaria bloqueando.
- Publicação com as tabelas da Formação de Preço publicadas: **0 BLOCKING, 2 WARNING** (alçadas manuais; abrangência do gate eletrônico), **8 INFORMATIONAL**. Sem as quatro tabelas publicadas, resta 1 BLOCKING (`COMMISSION_MATRIX_NOT_PARAMETERIZED`) — é condição de dados da Formação de Preço no ambiente, não de texto.

### 7.3 Snapshot, exibição e versões

- A matriz exibida (leitor do vendedor, prévia do admin, cópia controlada em PDF) vem de `policyCommissionMatrixFromSnapshot(version.normativeSnapshot)`; antes de publicar, a prévia usa a Formação de Preço atual. Mudar as tabelas depois da publicação muda o hash do snapshot atual (`POLICY_UPDATE_REQUIRED`) e **não** altera o que a versão publicada mostra.
- `portfolio` no snapshot ganhou `inactivityClock: "LAST_VALID_INVOICE"` e `neverInvoicedRemoved: false`. *(Histórico de 29–30/09. Desde 02/10/2026: `LAST_VALID_INVOICE_OR_ASSIGNMENT_START` e `neverInvoicedRemoved: true` — cliente nunca faturado conta 90 dias do início da atribuição do responsável atual; ver `docs/commercial/POL-COM-001-portfolio-inactivity-homologation.md`.)*
- Mudar o percentual do supervisor (`commission.supervisorShare`) continua exigindo nova versão da política.

### 7.4 Questionário, declarações e resumo

15 perguntas (novas: `q-faturamento`, `q-preservacao`, `q-limites`; reescritas: `q-matriz` — interpolação pelo preço —, `q-noventa`, explicação de `q-supervisor`), declarações da matriz e da inatividade atualizadas, 10 regras-resumo — todas frases literais do documento.

### 7.5 O que não mudou

Motor de comissão, `customerCommercialOwnerInactivity` (só a descrição do job em `brentCommodityJob.ts` foi corrigida para "desde a última NF / Documento de Saída válido"), fechamento, percentuais, migrations, banco.

### 7.6 Validação (2026-09-30)

- `src/lib/commercialPolicy/**/*.test.ts`: **111/111**.
- `customerCommercialOwnerInactivity` (+ server), `commission-commercial-tier`, `commercialMarginCore`: **96/96**.
- `npm run test:commissions`: 730 testes, 725 passam, 5 falhas conhecidas (idênticas à baseline).
- `tsc --noEmit`: nenhum erro novo nos arquivos desta entrega (total 1509; os 3 acima da baseline anterior de 1506 estão em `legalExposure`, fora desta entrega).
- `npm run build`: OK.
- Painel verificado em harness Vite: "Pronta para publicação", 0 bloqueante(s), nota "Processo manual / externo ao motor — não bloqueia a publicação" com "33% Supervisor", Anexo I renderizado com os níveis do snapshot.
