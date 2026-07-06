-- Slug configurável para link curto da reserva pública (ex.: /reservar-carro)

INSERT INTO "FleetSettings" ("key", "value", "description") VALUES
('publicReservationSlug', 'reservar-carro', 'Slug do link curto da reserva pública (ex.: reservar-carro → http://<base>/reservar-carro)')
ON CONFLICT ("key") DO NOTHING;
