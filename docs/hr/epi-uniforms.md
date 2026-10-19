# EPIs e Uniformes — catálogo, entregas, fichas e vencimentos

| | |
|---|---|
| Data | 2026-10-16 |
| Escopo | RH › Colaboradores › Editar › EPI / Uniformes; Dashboard de Pessoas › Controle de EPIs e Uniformes |
| Regras puras | `src/lib/epi/epiRules.ts` (+ `epiRules.test.ts`), `src/lib/epi/epiForm.ts` (+ `epiForm.test.ts`) |
| Catálogo | `src/lib/epi/epiCatalog.server.ts`, rotas `src/lib/epi/epiRoutes.ts` |
| Entregas | `createEpiDeliveryEvent` / `createEpiDelivery` / `updateEpiDelivery` / `updateEpiDeliveryEvent` / `setEpiDeliveryStatus` em `src/lib/peopleProfileMutations.server.ts` |
| Fichas e comprovantes | `src/lib/epi/epiForms.server.ts`, PDF `src/lib/epi/epiDeliveryFormPdf.ts`, QR `src/lib/epi/epiQr.server.ts` |
| Vencimentos e CSV | `src/lib/epi/epiReplacements.server.ts`, rotas em `src/lib/employeesDashboardRoutes.ts` |
| Migration | `20261020120000_hr_epi_catalog_deliveries` (aditiva) |

Recurso de RH enxuto. Não é estoque nem almoxarifado: o Inventário tem a categoria `PPE`, mas sem vínculo com colaborador, e isso não muda. Tamanhos preferidos continuam no cadastro (`Employee.*Size`, ver `employee-epi-admin-notes.md`).

## Conceitos (NR-6)

| Conceito | No sistema |
|----------|-----------|
| **CA** (Certificado de Aprovação) | `HrEpiItem.caNumber`: identifica o EPI aprovado. **Não** é validade nem vida útil. Opcional (uniforme comum não tem). |
| **Prazo de troca** | `HrEpiItem.replacementDays`: periodicidade definida **pela empresa**. Não é imposição legal. Vazio = sem troca programada. |
| Vida útil / conservação real | Fora do sistema: o RH ajusta a data prevista de um item, com justificativa, quando a condição real exigir. |
| **Entrega** | Uma ocasião (data, responsável, observações) com **um ou mais itens** (`HrEpiDeliveryEvent` + `HrEpiDelivery`). |
| Registro de entrega | Lançamento administrativo do RH (quem registrou, quando, o quê). |
| **Comprovação de recebimento** | A **Ficha de entrega** da ocasião, emitida pelo sistema, **assinada**, digitalizada e anexada (`HrEpiDeliveryReceipt`). Emitir a ficha não comprova; anexar não valida (a conferência é uma etapa própria). O lançamento sozinho não é prova de recebimento. |

## Catálogo (`HrEpiItem`)

Global (toda a empresa). É aberto pelo botão **Gerenciar EPIs / Uniformes** da guia, sem sair da edição do colaborador.

- **Código** automático e imutável. EPI-0001 para EPI, UNI-0001 para uniforme; o número vem de uma sequência global (`number`, SERIAL).
  - É reservado com `nextval` na mesma transação da criação.
  - Um trigger impede mudar `code`/`number`.
  - Por isso o **tipo não muda** depois de criado: cadastre outro item.
- Campos: descrição (obrigatória), tipo (`EPI`/`UNIFORM`), CA, unidade (`UNIT`/`PAIR`/`KIT`), prazo de troca em dias (opcional, 1–3650), observações, ativo. Também guarda autoria e data de criação e de atualização.
- **Duplicação acidental**: índice único em (tipo, descrição sem caixa/espaços, CA) → 409 `DUPLICATE_EPI_ITEM`. A mesma descrição com outro CA é outro modelo e é permitida.
- **Excluir**: só item nunca entregue. A checagem roda na transação e a FK `HrEpiDelivery.itemId → HrEpiItem` (`ON DELETE RESTRICT`) protege contra corrida; item usado → 409 `EPI_ITEM_IN_USE`.
- **Inativar**: some da seleção de novas entregas. Histórico, relatórios e trocas vigentes continuam (o item inativo segue aparecendo no controle de vencimentos).
- Editar o cadastro **não** altera entregas feitas: cada item entregue guarda o retrato do cadastro.

## Entregas (`HrEpiDeliveryEvent` + `HrEpiDelivery`)

Uma **entrega** é a ocasião: data, responsável (usuário autenticado), observações e autoria (`HrEpiDeliveryEvent`). Cada **item** entregue nela é uma linha de `HrEpiDelivery` (`eventId` obrigatório) com quantidade, tamanho, prazo, próxima troca, situação e substituição **próprios**.

Entregas antigas (texto livre, sem `itemId`) foram preservadas. A migration criou **um evento por entrega antiga, com o mesmo id, data, responsável e autor**, então cada uma virou uma entrega de 1 item e nada mudou de significado. As devolvidas (`returnedAt`) passaram a **Encerrado** e as demais ficaram **Vigente**. A antiga "Validade" (`validUntil`) é mostrada como "Validade (legado)" e não gera alerta.

- **Nova entrega** (`POST /api/employees/:id/epi-events`, botão **Nova entrega**): de 1 a 30 itens do catálogo (só ativos), data não futura, observações da ocasião.
  - Tudo ou nada: um item inválido recusa a entrega inteira, com a mensagem "Item N (descrição): …". Nada é gravado.
  - Por item: quantidade inteira > 0; tamanho; prazo (padrão = cadastro); data prevista. Prazo ou data diferente do cadastro exige justificativa (`replacementAdjustReason`, mín. 10).
  - Retrato gravado por item: `item`, `itemCode`, `itemType`, `itemCaNumber`, `itemUnit` e `replacementDays`.
  - **Próxima troca** = data da entrega + prazo, em data de calendário (`replacementDueDate` é `DATE`; a entrega é gravada ao meio-dia UTC, então não "volta um dia"). Exemplo: 16/10/2026 + 180 dias → 14/04/2027. Prazo vazio = "Sem troca programada".
  - Colaborador desligado não recebe entrega (409 `EMPLOYEE_TERMINATED`).
  - O histórico funcional ganha um evento `EPI_DELIVERY` **por item**; a auditoria registra `employee.epi.event.create` e um `employee.epi.delivery` por item.
- **Substituir** um item (`replacesDeliveryId`, botão **Substituir** na linha): gera uma nova entrega de 1 item (`POST /api/employees/:id/epi-deliveries`, que é um atalho para um evento de 1 item). Numa única transação:
  1. Grava a nova entrega.
  2. Marca o item anterior como **Substituído**, com `replacedByDeliveryId` (único) e motivo automático, por um `UPDATE … WHERE status='ACTIVE'`.
  3. Se outra operação chegou antes, retorna 409 `EPI_NOT_ACTIVE` e desfaz tudo.

  Os outros itens da entrega original **não mudam** (mesmo vencimento, mesma situação), e a ficha original continua como foi assinada. Não há substituição automática por item: cada item vigente é um ciclo, e o RH escolhe qual substituir.
- **Corrigir item** (só itens do catálogo, não cancelados): quantidade, tamanho, observações, prazo ou data prevista.
  - Prazo ou data prevista só com justificativa; um ajuste já justificado continua valendo.
  - O item não muda (400 `EPI_ITEM_IMMUTABLE`): cancele e registre outra entrega.
  - A data só é corrigida pelo item quando a entrega tem 1 item (senão 400 `EPI_EVENT_DATE`: use **Corrigir entrega**).
  - A auditoria guarda autor, data/hora, campos e valores anteriores.
- **Corrigir entrega** (`PATCH /api/employees/:id/epi-events/:eventId`): data e observações da ocasião. A data vale para todos os itens. Os vencimentos automáticos são recalculados; os ajustados com justificativa são mantidos (e precisam continuar depois da nova data). O histórico funcional acompanha. Auditoria `employee.epi.event.update`.
- **Cancelar** (lançamento incorreto) e **Encerrar** (ciclo finalizado sem nova entrega), por item: só a partir de Vigente e com motivo (mín. 10).
  - Cancelar uma substituição devolve o item anterior a Vigente.
  - O evento do histórico do colaborador recebe "— cancelada: motivo".
- **Sem exclusão física**: `DELETE /api/employees/:id/epi-deliveries/:recordId` → 405 `EPI_DELETE_NOT_ALLOWED`. FKs com `RESTRICT` também impedem apagar uma entrega com itens, fichas ou comprovantes, ou um item que substituiu outro.

Situações do item: Vigente (`ACTIVE`), Substituído (`REPLACED`), Encerrado (`CLOSED`), Cancelado (`CANCELLED`). A situação só muda por operação do usuário: vencer a data **não** muda a situação, e o vencimento é calculado à parte.

Integridade no banco:
- Status enumerado; Substituído exige `replacedByDeliveryId`; Encerrado/Cancelado exigem motivo; Vigente não aponta substituta.
- Prazos > 0; tipo do retrato enumerado.
- FK composta `(eventId, employeeId) → HrEpiDeliveryEvent(id, employeeId)`: um item nunca entra na entrega de outro colaborador.

## Controle de vencimentos (Dashboard de Pessoas)

`GET /api/employees/epi-replacements`, com o mesmo acesso do dashboard. Uma consulta, sem job em background e sem N+1 (índice `status, replacementDueDate`).

- Entram itens **vigentes** com data prevista até hoje + 60 dias, de colaboradores **não desligados**.
- Não entram: substituídos, encerrados, cancelados, itens sem troca programada e colaboradores desligados.
- Faixas mutuamente exclusivas (`epiDueBand`): **Vencidos** (antes de hoje), **até 30 dias** (0–30, inclusive), **31 a 60 dias**.
- **Contagem = pendências (itens)**, não pessoas: um colaborador com dois EPIs vencidos conta duas. O subtítulo informa também quantos colaboradores distintos há.
- Ordem: mais atrasados primeiro, depois os vencimentos mais próximos.
- Grid: colaborador, setor, item, última entrega, próxima troca, dias restantes e situação, com filtros por faixa e por departamento (sem departamento estruturado, vale o setor em texto). A linha abre a edição do colaborador já na guia EPI (`/employees?edit=<id>&tab=epi`).
- **Exportar entregas (CSV)**: `GET /api/employees/epi-deliveries/export?from=&to=` (data da entrega). Separador `;` com BOM para Excel pt-BR. Uma linha por item, em todas as situações, com o retrato do item, a ficha vigente da entrega e a situação documental.
- **Anexar fichas assinadas em lote**: ver abaixo (só para quem gerencia EPI).

## Ficha de entrega (PDF com identificador único)

Fluxo: registrar a entrega → **Emitir ficha de entrega** → imprimir → colher as assinaturas → digitalizar → **Anexar ficha assinada** (na entrega, pelo código, ou em lote) → **Conferir** (aprovar ou rejeitar).

**Uma ficha por entrega (ocasião), com todos os itens não cancelados.** Não há uma ficha por item.

O que foi reaproveitado do IndusCost:

| Peça | Origem |
|------|--------|
| PDF no servidor | Motor institucional da Política Comercial / Projetos (`commercialPolicyControlledCopyPdf.ts`: Helvetica/WinAnsi, tabelas com cabeçalho repetido a cada página, "Página X de Y"). Única extensão: `boldColumns` opcional na tabela, compatível com os usos existentes. |
| Cabeçalho e rodapé | Mesmo layout dos documentos emitidos de Projetos: logo e emitente das Configurações de Marca (`buildIssuerFromBranding`), número do documento à direita, rodapé com emissão e verificação SHA-256 |
| Emissão congelada | Padrão `ProjectIssuedDocument`: `payload` + `payloadSha256` (`sha256Hex(stableStringify())`), número único, revisão por conteúdo, conferência do hash ao regerar o PDF |
| QR Code | Padrão opaco da avaliação de experiência (`INDUSCOST-HR-EVAL:…`): `INDUSCOST-HR-EPI:{número}:{id}`, gerado no servidor com o `qrcode.react` já instalado (sem dependência nova) |
| Arquivo assinado | `saveEmployeeDocument` (Documentos do colaborador, armazenamento privado oficial, evento `DOCUMENT_ADDED` no histórico), download pela rota de documentos (permissão `canViewDocuments`). Não há gestão documental paralela: `HrEpiDeliveryReceipt` só liga o documento à entrega e guarda a conferência. |
| Leitura de QR em imagem | `BarcodeDetector` nativo do navegador, o mesmo do Coletor de inventário (`CollectorQrScanner`), sem biblioteca nova |

**Identificador** (`HrEpiDeliveryForm`, ligado ao evento):
- `formCode` = FE-{ano}-{00001}. É a ficha da entrega: sequência anual, a maior do ano + 1, com retentativa em conflito e índice único na 1ª revisão.
- `documentNumber` = FE-{ano}-{00001}-R{01}. Cada revisão emitida tem o seu, único no banco.
- Triggers, CHECKs e FKs garantem:
  - número = código + revisão;
  - colaborador da ficha = o da entrega (FK composta `(eventId, employeeId)`);
  - revisões seguintes repetem o código da primeira;
  - no máximo uma revisão vigente por entrega;
  - conteúdo emitido imutável (só a contagem de impressões e a passagem para SUBSTITUÍDA mudam);
  - revisão substituída não volta a vigente.

**Reemissão**:
- Conteúdo igual (colaborador + itens não cancelados + declaração, `contentSha256`) → a mesma ficha (mesmo número) e `printCount` + 1. Alterar o catálogo não muda a ficha (os itens guardam o retrato). Substituir um item também não muda: o item substituído foi entregue e continua na ficha.
- Conteúdo diferente (item corrigido ou cancelado, data da entrega corrigida, setor ou cargo do colaborador mudou) → nova revisão R02 com o mesmo código; a anterior fica **SUBSTITUÍDA**, nunca sobrescrita. O PDF dela continua disponível com a marca "REVISÃO SUBSTITUÍDA".
- Entrega com todos os itens cancelados não emite ficha (409 `EPI_CANCELLED`).

**Conteúdo do PDF** (A4 retrato; 1 página até cerca de 8 itens; acima disso, páginas extras com o cabeçalho da tabela repetido, e o bloco de assinaturas nunca é quebrado):
- Cabeçalho institucional, título, número, data e hora de emissão e emissor, QR com o número.
- Colaborador e entrega, em tabela compacta: nome completo, data da entrega, cargo, departamento, matrícula (código interno) e responsável.
- **Itens entregues (N)**: Código, Descrição (com tamanho), Tipo, Qtd., Unidade, CA e Próxima troca. Tudo vem do **retrato gravado em cada item**.
- Observações da entrega; nota de que a próxima troca é política da empresa e de que o CA não é validade.
- Declaração, exatamente: "Declaro que recebi os equipamentos e/ou uniformes relacionados neste documento, nas quantidades indicadas, nesta data." Nenhuma frase presume treinamento ou orientação não registrados.
- Assinaturas do colaborador e do responsável, e a data do recebimento.

## Comprovantes (ficha assinada)

`HrEpiDeliveryReceipt`, um por arquivo anexado:
- Ligações: entrega (`eventId`), colaborador, ficha (`formId`; vazio quando a entrega não tinha ficha emitida) e documento (`documentId` em `HrEmployeeDocument`).
- Dados do arquivo: `fileSha256`, nome original, tipo, tamanho, quem e quando anexou, `batchId` (envio em lote).
- Situação **CURRENT** (vigente) ou **SUPERSEDED** (substituído, com data).
- Conferência: resultado (`APPROVED`/`REJECTED`), validador, data/hora e observação.

Integridade no banco:
- FKs compostas: o documento é do mesmo colaborador `(documentId, employeeId)`; a ficha é da mesma entrega `(formId, eventId)`; a entrega é do mesmo colaborador. Não há como ligar o arquivo de um colaborador à entrega de outro.
- No máximo um comprovante vigente por entrega (índice único parcial).
- SHA-256 em hexadecimal; tamanho > 0; conferência consistente (resultado ⇔ data); rejeição exige observação.
- Trigger `HrEpiDeliveryReceipt_guard`: arquivo, vínculos, autoria e lote não mudam; substituído não volta a vigente.
- Documento que é comprovante não pode ser excluído (FK `RESTRICT` + 409 `DOCUMENT_IN_USE`).

**Anexar** (`POST /api/employees/:id/epi-events/:eventId/receipt`, multipart `file` + `reference`):
- Com ficha emitida, o número é obrigatório (400 `FORM_REFERENCE_REQUIRED`). Ele precisa ser a revisão **vigente** desta entrega deste colaborador.
- Recusas:
  - outro colaborador: 409 `FORM_OTHER_EMPLOYEE`;
  - outra entrega: 409 `FORM_OTHER_DELIVERY`;
  - revisão substituída: 409 `FORM_SUPERSEDED`;
  - QR com id de outra ficha: 409 `FORM_ID_MISMATCH`;
  - formato inválido: 400 `INVALID_FORM_CODE`;
  - número inexistente: 404.
- Arquivo (`checkEpiReceiptFile`):
  - só PDF, JPG ou PNG, conferidos pelo **conteúdo** (assinatura binária), não só pela extensão. Extensão e tipo precisam bater com o conteúdo (400 `FILE_TYPE`);
  - vazio → 400 `FILE_EMPTY`; acima de 10 MB → 400 `FILE_TOO_LARGE`;
  - truncado (PDF sem `%%EOF`, JPEG sem `FFD9`, PNG sem `IEND`) → 400 `FILE_CORRUPTED`.

  As validações vêm antes de gravar: uma recusa não grava nada.
- **Mesmo arquivo** (SHA-256 igual) na mesma entrega: nada é duplicado (200 `duplicate: true`). O mesmo arquivo já usado em **outra** entrega: 409 `DUPLICATE_FILE`.
- Novo arquivo substitui o vigente: o anterior passa a SUBSTITUÍDO, com data, e continua em Documentos e no **Histórico documental** da entrega. A auditoria registra o comprovante anterior e o SHA-256.
- Entrega sem ficha emitida (por exemplo, papel antigo): o arquivo pode ser anexado direto, como comprovante sem identificador.
- **Anexar ficha pelo código** (botão da guia): localiza a ficha pelo número ou QR (`GET /api/hr/epi-forms/lookup?reference=`) e mostra a entrega e os itens antes do upload. A busca respeita o escopo do colaborador: sem acesso, 404.

**Conferir** (`POST /api/employees/:id/epi-events/:eventId/receipt/validate` `{result, note}`): o RH abre o comprovante e confere número, itens, assinaturas e data.
- **Aprovar** (observação opcional) → Validado.
- **Rejeitar** exige motivo (mín. 5) → a entrega volta para Aguardando assinatura, com o motivo à vista; anexe um novo arquivo.
- Conferência registrada não é refeita (409 `RECEIPT_ALREADY_VALIDATED`): para mudar, anexe outro arquivo.
- Comprovante de revisão anterior não é conferido (409 `RECEIPT_OUTDATED`); sem comprovante → 409 `RECEIPT_REQUIRED`.

**Situação documental** da entrega (`deriveEpiDocumentStatus`):

| Situação | Quando |
|----------|--------|
| Ficha não emitida | sem ficha e sem comprovante |
| Aguardando assinatura | ficha vigente sem comprovante; ou comprovante rejeitado; ou comprovante de uma revisão anterior (sinalizado) |
| Documento anexado | comprovante vigente ainda não conferido (ou anexado sem ficha emitida) |
| Validado | comprovante vigente aprovado |

## Anexar fichas assinadas em lote

Dashboard de Pessoas › Controle de EPIs e Uniformes › **Anexar fichas assinadas em lote** (só quem gerencia EPI).

1. Selecione até 30 arquivos (PDF/JPG/PNG, até 10 MB cada). **Cada arquivo é uma ficha.**
2. O navegador calcula o SHA-256 e procura o número da ficha:
   - no **nome do arquivo** (`FE-2026-00012-R01 assinada.pdf`). Só vale quando há exatamente um número no nome; dois números distintos vão para revisão;
   - no **QR Code** de imagens JPG/PNG, com o `BarcodeDetector` do navegador, quando ele existe. Só aceita um QR do IndusCost na imagem;
   - senão, a linha fica para **digitação**.
3. O servidor monta o plano (`POST /api/hr/epi-receipts/batch/plan`) e mostra a tabela de revisão:

   | Situação | Significado |
   |----------|-------------|
   | Pronto | número da ficha vigente, colaborador e entrega encontrados |
   | Revisar | sem número no nome/QR, ou número ambíguo: digite o número |
   | Inválido | número inexistente, sem acesso ou de revisão substituída |
   | Duplicado no lote | a mesma ficha ou o mesmo arquivo aparece mais de uma vez: nenhuma das linhas é anexada |
   | Já anexado | o arquivo já é o comprovante vigente desta entrega (ignorado) |
   | Conflito | o arquivo já é o comprovante de outra entrega |

   Ao digitar um número, o envio fica bloqueado até **Conferir novamente**.
4. **Anexar** (`POST /api/hr/epi-receipts/batch`, multipart `files` + `manifest`): o servidor **recalcula o SHA-256 e refaz o plano** com os arquivos recebidos (não confia no navegador). Só as linhas Pronto são anexadas, uma a uma, pelo mesmo caminho do anexo individual, com o mesmo `batchId`. Resultado por arquivo: Anexado / Ignorado / Não anexado / Falhou. Nada ambíguo é vinculado. Uma falha num arquivo não desfaz os outros. Auditoria `employee.epi.receipt.batch` com os totais.

## Permissões

| Ação | Regra |
|------|-------|
| Ver guia, histórico e catálogo | `employees.epi.view` / `employees.view` / `employees.edit` / `employees.epi.manage` (igual à guia EPI) |
| Cadastrar/editar/inativar/excluir item; registrar, substituir, corrigir, cancelar e encerrar entrega | `employees.epi.manage` ou `employees.edit` (`canManageEmployeeEpi`) |
| Ver/baixar o PDF da ficha; localizar ficha pelo código | quem vê EPI do colaborador (escopo da ficha) |
| Emitir/reimprimir ficha; anexar e conferir comprovante | `employees.epi.manage` ou `employees.edit`, no escopo do colaborador |
| Lote (plano e envio) | `employees.epi.manage` ou `employees.edit`; cada linha é conferida no escopo do colaborador da ficha (sem acesso = Inválido) |
| Ver o arquivo do comprovante | regra de Documentos (`canViewDocuments`) |
| Controle de vencimentos e CSV (com nº da ficha e situação documental) | acesso ao Dashboard de Pessoas |

Auditoria (`logEmployeeHrAudit`):
- `employee.epi.event.create` e `.update`;
- `employee.epi.form.issue` e `.reprint`, com número, revisão e número anterior; `employee.epi.form.download`;
- `employee.epi.receipt.attach`, com documento, ficha, SHA-256, comprovante anterior e lote;
- `employee.epi.receipt.validate`, com o resultado; `employee.epi.receipt.batch`, com os totais.

Desligar o colaborador, inativar o item ou substituir um item não apaga fichas nem comprovantes (FKs `RESTRICT`); eles continuam acessíveis para leitura.

## Limitações conhecidas

- **Não há assinatura eletrônica nem OCR.** A ficha é assinada no papel e associada pelo número (nome do arquivo, digitação, leitor de código) ou pelo QR lido no navegador, sempre conferido no servidor.
- **Leitura do QR em imagem depende do navegador.** O `BarcodeDetector` existe no Chrome/Edge de Android e macOS, mas não no Chrome de Windows nem no Firefox. Sem ele, vale o nome do arquivo ou a digitação. No ambiente de teste (Chrome headless no Windows) ele não existe, então a leitura automática do QR **não foi validada**.
- **PDF não é lido**: o QR de um PDF digitalizado não é decodificado (não há decodificador de PDF no sistema). Para PDF valem o nome do arquivo ou a digitação.
- **Um PDF com várias fichas não é separado.** Cada arquivo é tratado como uma ficha. Separar páginas exigiria identificação confiável por página (OCR/QR em PDF), que a infraestrutura atual não tem. Digitalize uma ficha por arquivo.
- A "Matrícula" impressa é o código interno do colaborador no IndusCost: não há outro campo de matrícula no cadastro.
- **Não há estoque, lote de fabricação nem fornecedor.** O CA é informativo: o sistema não consulta a validade do CA no MTE.
- A troca programada é a política da empresa. Inspeção de conservação e a troca antecipada por dano são registradas pelo RH (substituição ou ajuste justificado).
- Itens com prazo em meses ou anos são informados em dias.

## Implantação e reversão

Rode a migration **antes** do código (o código lê as tabelas novas). Ela é aditiva e não apaga dados: cria o catálogo, as entregas (eventos) com backfill de 1 evento por entrega antiga, as fichas e os comprovantes.

Antes de implantar, em homologação:
- conferir que `SELECT count(*) FROM "HrEpiDelivery" WHERE "eventId" IS NULL` = 0 e que há um evento por entrega antiga;
- emitir uma ficha de teste com vários itens e anexar um arquivo de teste.

Reversão manual, só se nenhuma entrega, ficha ou comprovante novo tiver sido gravado:
1. `DROP TABLE "HrEpiDeliveryReceipt"` e `DROP TABLE "HrEpiDeliveryForm"`.
2. `ALTER TABLE "HrEpiDelivery" DROP COLUMN …` das colunas novas (incluindo `eventId`) e das constraints `HrEpiDelivery_*_check`/`_fkey`.
3. `DROP TABLE "HrEpiDeliveryEvent"` e `DROP TABLE "HrEpiItem"`; `DROP INDEX "HrEmployeeDocument_id_employeeId_key"`.
4. `DROP FUNCTION "HrEpiItem_code_immutable"`, `"HrEpiDeliveryForm_guard"` e `"HrEpiDeliveryReceipt_guard"`.
