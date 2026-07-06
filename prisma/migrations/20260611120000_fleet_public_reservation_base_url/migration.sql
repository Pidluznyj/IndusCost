-- Base URL configurável para link/QR de reserva pública (rede interna).

INSERT INTO "FleetSettings" ("key", "value", "description") VALUES
('publicReservationBaseUrl', 'http://192.168.100.5:3000', 'URL base para link e QR Code de reserva pública (IP/DNS acessível na rede interna ou VPN)')
ON CONFLICT ("key") DO NOTHING;
