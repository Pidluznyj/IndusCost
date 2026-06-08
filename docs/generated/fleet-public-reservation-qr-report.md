# Fleet — Solicitação pública de reserva via QR Code

## Objetivo

Permitir que colaboradores solicitem reserva de veículo por uma página pública/mobile (QR Code), sem login no ERP. A equipe de frota analisa, aprova ou rejeita no módulo interno.

## Rota pública (frontend)

- `/public/fleet/reservation/:token`

## Token / QR Code

- Token armazenado em `FleetSettings.publicReservationToken` (64 caracteres hex, `crypto.randomBytes(32)`).
- Ativação: `FleetSettings.publicReservationEnabled = true`.
- Regeneração: `POST /api/fleet/public-reservation/regenerate-token` (requer `fleet.settings.manage`).
- QR Code: imagem via `api.qrserver.com` (sem dependência npm adicional). Painel em **Frota → Configurações → Link público / QR Code**.
- Placas **não** são expostas nos endpoints públicos — apenas marca/modelo/tipo.

## Regras de slots

- Janela diária padrão: **06:00–20:00** (`publicReservationStartHour` / `publicReservationEndHour`).
- Duração padrão: **3 horas** (`publicReservationSlotMinutes = 180`).
- Slots fixos (padrão):
  - 06:00–09:00
  - 09:00–12:00
  - 12:00–15:00
  - 15:00–18:00
  - **17:00–20:00** (último slot termina às 20:00)
- **Não** existe slot 18:00–21:00.
- Na data atual, slots cujo horário de término já passou são ocultados.

## Conflito de agenda

Overlap: `existing.start < requested.end AND existing.end > requested.start`.

Considera:

- `FleetReservation` em `REQUESTED`, `PENDING_APPROVAL`, `APPROVED`, `IN_USE`
- `FleetPublicReservationRequest` em `PENDING`

Ignora `REJECTED`, `CANCELLED`, reservas finalizadas.

## Fluxo do usuário (público)

1. Escaneia QR / abre link
2. Onboarding em etapas (identificação → dados → horário → revisão)
3. `POST` cria solicitação com status **PENDING** e código `FRQ-XXXXXXXX`
4. Tela de sucesso com código de acompanhamento

## Fluxo de aprovação (interno)

- Aba **Frota → Solicitações QR**
- Aprovar: exige veículo + motorista; valida conflito; cria `FleetReservation` **APPROVED** e vincula `fleetReservationId`
- Rejeitar: exige motivo; status **REJECTED**

## Permissões

| Ação | Permissão |
|------|-----------|
| Ver solicitações / link | `fleet.reservations.view` (ou legado `fleet.view`) |
| Aprovar / rejeitar | `fleet.reservations.approve` |
| Configurar token / parâmetros | `fleet.settings.manage` |
| Página pública | Nenhuma (token válido + feature ativa) |

## Endpoints

### Públicos (sem login)

| Método | Rota |
|--------|------|
| GET | `/api/public/fleet/reservation/:token/config` |
| GET | `/api/public/fleet/reservation/:token/availability?date=YYYY-MM-DD&vehicleId=` |
| POST | `/api/public/fleet/reservation/:token/request` |

Token inválido ou desativado: **404** (inválido) ou **403** (desativado). POST com rate limit simples (10/min por IP).

### Internos (autenticados)

| Método | Rota |
|--------|------|
| GET | `/api/fleet/public-reservation/link` |
| POST | `/api/fleet/public-reservation/regenerate-token` |
| GET | `/api/fleet/public-reservation-requests` |
| GET | `/api/fleet/public-reservation-requests/:id` |
| PATCH | `/api/fleet/public-reservation-requests/:id/approve` |
| PATCH | `/api/fleet/public-reservation-requests/:id/reject` |

## Model / migration

- Migration: `20260609120000_add_fleet_public_reservation_requests`
- Model: `FleetPublicReservationRequest`
- Enum: `FleetPublicReservationRequestStatus` (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`)
- Settings seed: chaves `publicReservation*`

## Validação no servidor (`/opt/induscost`)

```bash
cd /opt/induscost
git pull origin main
npx prisma migrate deploy
npx prisma generate
npm run build
sudo systemctl restart induscost   # ou serviço equivalente
```

1. **Frota → Configurações**: gerar token, ativar `publicReservationEnabled`, salvar.
2. Copiar link / imprimir QR.
3. Abrir link no celular e enviar solicitação teste.
4. **Frota → Solicitações QR**: aprovar com veículo/motorista ou rejeitar com motivo.

## Limitações (fase A)

- Sem aprovação automática
- Sem notificação por e-mail/WhatsApp
- QR via serviço externo (requer internet para gerar imagem no painel)
- Rate limit em memória (single instance)
- Solicitante externo não acompanha status pelo código (apenas confirmação inicial)
