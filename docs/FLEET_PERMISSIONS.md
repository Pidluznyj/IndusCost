# Gestão de Frota — matriz de permissões

Todas as rotas `/api/fleet/*` exigem autenticação (`requireAppAuth`). Sem sessão válida: **401**.

Sem a permissão exigida: **403** (`FORBIDDEN`, mensagem amigável).

Valores financeiros em respostas de leitura são mascarados (`maskFinancialData`) quando o usuário não tem `fleet.financial.view` nem `fleet.manage`.

| Permissão | O que permite | Rotas / escopo API | Ações UI |
|-----------|---------------|-------------------|----------|
| `fleet.view` | Consultar frota (listagens, fichas, dashboard, relatórios, alertas) | `GET /api/fleet/*` de leitura (exceto import) | Abas de visualização; valores financeiros mascarados |
| `fleet.manage` | Administração completa da frota | Todas as rotas mutáveis; import CSV; ciclo de vida de veículos | Botões administrativos; importação; financeiro sem máscara |
| `fleet.vehicles.edit` | Cadastro e edição de veículos, contratos e documentos | `POST/PUT/PATCH` veículos, contratos, documentos | Novo veículo; ficha do veículo (edição) |
| `fleet.reservations.create` | Criar/editar reservas, checkout/checkin, checklists | Reservas, checklists, uso em campo | Agenda; uso em campo |
| `fleet.reservations.approve` | Aprovar/rejeitar reservas | `PATCH .../approve`, `PATCH .../reject` | Botões Aprovar / Rejeitar |
| `fleet.maintenance.manage` | Manutenções (CRUD e fluxo) | `/api/fleet/maintenances*` mutáveis | Aba Manutenções (edição) |
| `fleet.financial.view` | Ver e lançar custos, multas, abastecimentos, ocorrências | `/api/fleet/costs`, `fuelings`, `fines`, `incidents` (leitura sem máscara; escrita) | Abas Custos / Ocorrências; valores visíveis |
| `fleet.settings.manage` | Parâmetros operacionais da frota | `PUT /api/fleet/settings` | Salvar configurações na aba Configurações |

Implementação: `src/lib/fleetRouteGuards.ts`, `src/lib/fleetAuth.ts`, middleware `createAuthGuards` em `src/lib/appAuthMiddleware.ts`.
