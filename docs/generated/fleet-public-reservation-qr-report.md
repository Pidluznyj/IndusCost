# Fleet — Solicitação pública de reserva via QR Code

## Objetivo

Permitir que colaboradores solicitem reserva de veículo por página pública/mobile (QR Code), sem login no ERP. Identificação por **CPF**, vínculo com cadastro de **motorista** (`FleetDriver`), seleção obrigatória de veículo e período. A equipe de frota aprova ou rejeita internamente.

## Rota pública (frontend)

- `/public/fleet/reservation/:token`
- **Sem login** — rota registrada fora de `RequireAuth` no `App.tsx`.
- Primeira tela: **CPF** (wizard inicia em etapa CPF).

## Link compartilhável (rede interna / VPN)

Configure em **Frota → Configurações**:

| Setting | Exemplo |
|---------|---------|
| `publicReservationBaseUrl` | `http://192.168.100.5:3000` |
| `publicReservationEnabled` | `true` |
| `publicReservationToken` | (gerado no painel) |

**Link para enviar aos usuários:**

```
http://192.168.100.5:3000/public/fleet/reservation/<TOKEN>
```

- Funciona na rede interna ou VPN — o servidor não precisa de acesso externo.
- O painel **Reserva pública / QR Code** oferece: copiar link, abrir link, QR Code, regenerar token, ativar/desativar.
- **Não** usar `127.0.0.1` no link copiado: configure `publicReservationBaseUrl` com IP/DNS acessível pelos celulares.
- Se a base estiver vazia e o admin acessar por localhost, o painel avisa para configurar a URL.

## Token / QR Code

- Token em `FleetSettings.publicReservationToken` (64 hex).
- Base URL em `FleetSettings.publicReservationBaseUrl`.
- Regeneração: `POST /api/fleet/public-reservation/regenerate-token`.
- QR Code aponta para o **mesmo link completo** (URL codificada no serviço de imagem).
- Placas **não** expostas na API/tela pública.

## Solicitar vs consultar reservas

| Ação | Login |
|------|-------|
| Solicitar reserva (link/QR público) | **Não** — apenas token válido |
| Consultar/administrar solicitações | **Sim** — Frota → Solicitações QR (`fleet.reservations.*`) |

Não há consulta pública por CPF nesta fase.

## Fluxo do usuário (público)

### Etapa 1 — CPF (primeiro campo)

- Máscara `000.000.000-00`, validação de dígitos verificadores.
- `POST /identify` consulta `FleetDriver` por CPF normalizado (somente dígitos).
- CPF inválido → erro 400; não grava cadastro.

### Etapa 2 — Cadastro ou confirmação

**CPF encontrado:**

- Mensagem “Encontramos seu cadastro”.
- Exibe nome, telefone/e-mail (mínimo necessário).
- Se CNH cadastrada → status “CNH cadastrada” e segue.
- Se falta CNH → formulário mínimo (número, categoria, validade) via `POST /register`.

**CPF não encontrado:**

- “Vamos fazer seu cadastro rápido”.
- Cria registro em `FleetDriver` (status `PENDING`, nota `[Cadastro público QR]`).
- Campos: nome, telefone obrigatórios; CNH obrigatória; e-mail/setor opcionais.
- Não duplica CPF (validação `assertUniqueActiveDriverCpf`).

### Etapa 3 — Seleção do carro (obrigatória)

- `GET /vehicles` — marca, modelo, tipo/categoria; sem placa.

### Etapa 4 — Dia e período

- `GET /availability?vehicleId=&from=YYYY-MM-DD&days=7`
- Navegação por semanas; rótulos “Segunda, 10/06”.
- Slots de 3h: 06–09, 09–12, 12–15, 15–18, **17–20** (sem 18–21).
- Dia atual: oculta slots já passados.
- Status visual: disponível / indisponível / selecionado.

### Etapa 5 — Motivo e confirmação

- Motivo, destino, observações, passageiros opcional.
- Aceite de responsabilidade obrigatório.
- `POST /request` → código `FRQ-XXXXXXXX`; status inicial conforme cadastro do motorista (ver **Aprovação em duas etapas**).

## Regras de slots

- Janela: **06:00–20:00**; duração **180 min**.
- Último slot: **17:00–20:00**.
- Conflito por veículo: overlap `existing.start < requested.end AND existing.end > requested.start`.
- Bloqueadores: reservas `REQUESTED|PENDING_APPROVAL|APPROVED|IN_USE` e solicitações `PENDING_DRIVER_APPROVAL|PENDING_RESERVATION_APPROVAL|PENDING` (legado).

## Segurança

- Todos os endpoints exigem token público válido e feature ativa.
- CPF armazenado normalizado (11 dígitos).
- Resposta de `/identify` mínima (sem dados de terceiros).
- Rate limit em POST (identify, register, request): 15/min por IP.
- Sanitização de textos; validação de slot na grade permitida e revalidação no POST final.

## Aprovação em duas etapas

Quando o motorista precisa de validação interna, a solicitação **não** vai direto para aprovação do veículo.

### Quando exige aprovação do motorista (`PENDING_DRIVER_APPROVAL`)

- Motorista recém-cadastrado pelo fluxo público (`FleetDriver.status = PENDING`, `createdFromPublicReservation = true`).
- Motorista existente com `status` diferente de `AUTHORIZED`.
- CNH ausente, incompleta ou vencida.

### Quando vai direto para aprovação da reserva (`PENDING_RESERVATION_APPROVAL`)

- CPF já cadastrado, motorista `AUTHORIZED`, CNH válida.

### Status da solicitação (`FleetPublicReservationRequestStatus`)

| Status | Significado |
|--------|-------------|
| `PENDING_DRIVER_APPROVAL` | Aguardando validação do cadastro/CNH do motorista |
| `PENDING_RESERVATION_APPROVAL` | Motorista ok; aguardando aprovação do veículo/período |
| `PENDING` | Legado — migrado para `PENDING_RESERVATION_APPROVAL` |
| `APPROVED` | Reserva criada (`FleetReservation`) |
| `REJECTED` | Rejeitada (motorista ou reserva) |
| `CANCELLED` | Cancelada |

### Status do motorista (`FleetDriver`)

Reutiliza `FleetDriver.status` (`PENDING` / `AUTHORIZED` / `BLOCKED`). Campos adicionais:

- `createdFromPublicReservation` — `true` para cadastro via QR público
- `publicRegistrationReviewedAt`, `publicRegistrationReviewedByUserId`, `publicRegistrationRejectionReason`

Motoristas existentes antes da migration permanecem como estavam (em geral `AUTHORIZED`); `createdFromPublicReservation` default `false`.

### Fluxo de aprovação (interno)

1. **Etapa 1 — Motorista** (somente se `PENDING_DRIVER_APPROVAL`):
   - `POST /api/fleet/public-reservation-requests/:id/approve-driver` → motorista `AUTHORIZED`, solicitação → `PENDING_RESERVATION_APPROVAL`
   - `POST /api/fleet/public-reservation-requests/:id/reject-driver` (motivo obrigatório) → motorista `BLOCKED`, solicitação → `REJECTED`
2. **Etapa 2 — Reserva** (se `PENDING_RESERVATION_APPROVAL`):
   - `PATCH .../approve` — valida motorista aprovado, conflito de agenda; cria `FleetReservation` **APPROVED**
   - `PATCH .../reject` — motivo obrigatório

Tentar aprovar reserva com motorista pendente retorna **409** com mensagem: *"Aprove o cadastro do motorista antes de aprovar a reserva."*

### Mensagens no fluxo público

- Motorista recém-cadastrado / pendente: *"Primeiro validaremos seu cadastro de motorista e depois a reserva do veículo."*
- Motorista já aprovado: *"Sua solicitação foi enviada e será analisada pela equipe responsável."*

## Fluxo de aprovação (interno) — UI

- Aba **Frota → Solicitações QR**
- Badge **Aguardando aprovação do motorista** ou **Aguardando aprovação da reserva**
- Exibe: CPF, nome, telefone/e-mail, CNH, veículo, dia/período, motivo, destino
- Etapa 1: botões **Aprovar motorista** / **Rejeitar motorista**
- Etapa 2: **Aprovar reserva** / **Rejeitar reserva** (desabilitado enquanto motorista pendente)

## Permissões internas

| Ação | Permissão |
|------|-----------|
| Ver solicitações / link | `fleet.reservations.view` |
| Aprovar / rejeitar motorista e reserva | `fleet.reservations.approve` |
| Token / parâmetros | `fleet.settings.manage` |

## Endpoints internos (aprovação)

| Método | Rota |
|--------|------|
| POST | `/api/fleet/public-reservation-requests/:id/approve-driver` |
| POST | `/api/fleet/public-reservation-requests/:id/reject-driver` |
| PATCH | `/api/fleet/public-reservation-requests/:id/approve` |
| PATCH | `/api/fleet/public-reservation-requests/:id/reject` |

## Endpoints públicos

| Método | Rota |
|--------|------|
| GET | `/api/public/fleet/reservation/:token/config` |
| POST | `/api/public/fleet/reservation/:token/identify` |
| POST | `/api/public/fleet/reservation/:token/register` |
| GET | `/api/public/fleet/reservation/:token/vehicles` |
| GET | `/api/public/fleet/reservation/:token/availability?vehicleId=&from=&days=7` |
| POST | `/api/public/fleet/reservation/:token/request` |

## Models / migrations

- `FleetPublicReservationRequest` + `requesterCpf`, `driverId` → `FleetDriver`
- Migrations: `20260609120000_*`, `20260610120000_fleet_public_reservation_cpf_driver`, `20260612120000_fleet_public_driver_approval`
- Reutiliza **`FleetDriver`** — sem model duplicado de condutor.

## Validação no servidor

```bash
cd /opt/induscost
git pull origin main
npx prisma migrate deploy
npx prisma generate
npm run test:fleet
npm run build
sudo systemctl restart induscost
```

1. **Frota → Configurações**: `publicReservationBaseUrl = http://192.168.100.5:3000` (ou IP/DNS real).
2. Gerar token, ativar `publicReservationEnabled`, salvar.
3. Copiar link do painel e abrir no celular (mesma rede/VPN).
4. Confirmar tela de CPF sem login.
5. Enviar solicitação teste; aprovar em **Solicitações QR**.

## Correção de data local e elegibilidade de veículos

### Causa do bug 08/06 → 07/06

- Coluna `requestedDate` (`@db.Date`) é lida pelo Prisma como `Date` em **meia-noite UTC** (ex.: `2026-06-08T00:00:00.000Z`).
- A tela interna formatava com `new Date(iso).toLocaleDateString("pt-BR")`, que em fuso Brasil (UTC−3) exibe **07/06**.
- Persistência antiga usava meia-noite **local** do servidor, instável entre ambientes.

### Regra final de data local

| Uso | Helper |
|-----|--------|
| Persistir dia escolhido (`DATE`) | `parseLocalDateOnly("YYYY-MM-DD")` — meio-dia UTC estável |
| Ler dia do banco | `dateOnlyToYmd(date)` — componentes UTC |
| Montar `DateTime` da reserva | `buildFleetReservationLocalDateTime(date, "HH:mm")` — parede de relógio local |
| Exibir na UI/API | `formatFleetLocalDate` → `DD/MM/YYYY` sem deslocar |
| Tráfego API | `requestedDate: "2026-06-08"` (string), não ISO UTC do frontend |

**Proibido** para regra de dia: `new Date("YYYY-MM-DD")` no frontend/backend para exibição ou gravação de calendário.

### Veículos que não aparecem no fluxo público

Somente `FleetVehicle.status = AVAILABLE` na listagem pública. Excluídos (via `isVehicleReservable` / `isPublicReservationVehicleEligible`):

`BLOCKED`, `MAINTENANCE`, `IN_USE`, `INACTIVE`, `RETURNED`, `SOLD`, `CLAIMED`, `RESERVED`

### Validações no backend

- `GET /vehicles` — só `AVAILABLE`
- `GET /availability` — `assertPublicReservationVehicleOrThrow`
- `POST /request` — revalida elegibilidade (422 se bloqueado/inativo)
- `PATCH .../approve` — revalida antes de criar `FleetReservation` (422 se indisponível)

### Como testar no servidor

1. Solicitar reserva para **08/06** no link público → em **Solicitações QR** deve aparecer **08/06/2026** (não 07/06).
2. Veículo `BLOCKED` ou `INACTIVE` não deve listar no público.
3. `POST /request` com `vehicleId` bloqueado → 422.
4. Aprovar solicitação após bloquear veículo → 422 com mensagem clara.

## Limitações

- Cadastro público cria motorista `PENDING` (validação interna posterior).
- Sem notificação automática ao solicitante.
- Rate limit em memória (instância única).
