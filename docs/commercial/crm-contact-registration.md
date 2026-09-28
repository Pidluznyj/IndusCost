# CRM Comercial — Registro de contato estruturado

**Fluxo:** Comercial → CRM Comercial → Carteira de Clientes → Registrar contato
(o mesmo modal abre em Relatórios).
**Tabela:** `CommercialActivity` (não há modelo paralelo nem segunda agenda).
**Catálogo único:** `src/lib/commercial/crmContactCatalog.ts` — códigos em inglês
persistidos, rótulos pt-BR, resultados e próximas ações por motivo e a validação
canônica (servidor e tela usam a mesma função).

## O que o usuário informa × o que o sistema preenche

| Campo | Origem | Coluna |
|---|---|---|
| Data do contato | usuário | `contactDate` |
| Canal | usuário (lista) | `channel` |
| Motivo | usuário (lista) | `reason` (e `activityType`) |
| Responsável comercial | **servidor**: dono manual ativo do cliente (`CrmCustomerCommercialOwner`, via `resolveCommercialResponsibleForCustomer`) — bloqueado | `assignedTo` (nome), `commercialOwnerIdentityKey`, `commercialOwnerExternalSellerId` |
| Registrado por | **servidor**: usuário autenticado — bloqueado | `createdByUserId`, `createdByName` |
| Telefone utilizado | cadastro do cliente, editável só para o contato | `createdByPhone` |
| E-mail utilizado | cadastro do cliente, editável só para o contato | `createdByEmail` |
| Resultado do contato | usuário (lista do motivo) | `outcome` (código) |
| Resumo da conversa | usuário, obrigatório | `description` |
| Próxima ação | usuário (lista do motivo), obrigatória | `nextActionType` |
| Data/hora da próxima ação | obrigatória se a ação é real; vazia em "Nenhuma ação necessária" | `nextActionAt` |
| Detalhamento | obrigatório se a ação é real | `nextActionDescription` |
| Status | **servidor**: ação real = `OPEN` (Aberto), nenhuma = `DONE` (Concluído) | `status` |

Responsável comercial ≠ vendedor comissionável: nunca vem do pedido de venda nem
de comissão. Cliente sem responsável: o modal mostra "Cliente sem responsável
comercial" e o contato grava vazio. Payload com `assignedTo`, `createdByUserId`,
`createdByName`, `status` etc. é ignorado. Telefone/e-mail do contato nunca
alteram o cadastro do cliente.

## Histórico

O contato é fato histórico: responsável (nome + identidade), usuário (id +
nome), telefone e e-mail ficam gravados como estavam no momento do registro.
Trocar o responsável da carteira ou o nome do usuário não reescreve contatos
antigos, e o `PATCH /api/commercial-activities/:id` recusa alterar `assignedTo`.
Contatos anteriores a esta mudança não têm `nextActionType` nem os ids (NULL) e
aparecem como estavam (resultado em texto livre, próxima ação só com data e
descrição).

## Status

`status` continua sendo o estado do follow-up que carteira, cockpit, Gestão
Geral e Cliente 360 usam para "vencido"/"próximo". Antes, o modal mandava
`DONE` por padrão e escondia a próxima ação dos alertas; agora ele é derivado da
próxima ação (mesma regra padrão que a API já tinha) e aparece bloqueado no
modal. "Marcar como concluído" continua igual.

## API

- `GET /api/customers/:customerId/commercial-activities/context` —
  `commercial.crm.activities:create`. Devolve cliente (nome, documento, telefone,
  e-mail), responsável comercial atual (ou `null`) e usuário autenticado.
- `POST /api/customers/:customerId/commercial-activities` —
  `commercial.crm.activities:create`. Corpo: `contactDate`, `channel`, `reason`,
  `result`, `summary`, `nextActionType`, `nextActionAt`, `nextActionDescription`,
  `phoneUsed`, `emailUsed` (+ `salesOrderId`/`proposalId` opcionais). Erro de
  validação: `400 { error, fieldErrors }`, nada gravado. Uma única escrita.

## Regras de validação

- Obrigatórios: data, canal, motivo, resultado, resumo e próxima ação.
- Resultado e próxima ação precisam pertencer ao motivo.
- Próxima ação real: data/hora (não anterior ao contato) e detalhamento.
- "Nenhuma ação necessária": sem data (enviar data é erro); detalhamento opcional.
- Telefone/e-mail opcionais.

## Migration

`20260927120000_commercial_activity_structured_contact` — só colunas novas e
anuláveis em `CommercialActivity`: `nextActionType TEXT`, `createdByUserId UUID`,
`commercialOwnerIdentityKey TEXT`, `commercialOwnerExternalSellerId INTEGER`.
Sem default, sem backfill, sem índice. Rollback (depois de voltar o código):

```sql
ALTER TABLE "CommercialActivity"
  DROP COLUMN "nextActionType",
  DROP COLUMN "createdByUserId",
  DROP COLUMN "commercialOwnerIdentityKey",
  DROP COLUMN "commercialOwnerExternalSellerId";
DELETE FROM "_prisma_migrations"
 WHERE migration_name = '20260927120000_commercial_activity_structured_contact';
```

## Motivos não incluídos neste incremento

"Cobrança / Financeiro" e "Suporte / Problema" não entraram: não há matriz de
resultados para eles; Reclamação (encaminhar para financeiro/suporte) e Outros
cobrem os casos. Incluir depois é só configuração no catálogo (sem migration).
