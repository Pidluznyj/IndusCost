-- Reservas públicas da frota: slots de 1 hora (antes 3 horas / 180 min).
UPDATE "FleetSettings"
SET
  "value" = '60',
  "description" = 'Duração de cada slot em minutos (padrão 1 hora)'
WHERE "key" = 'publicReservationSlotMinutes';
