-- Fatores editáveis: dias médios/mês e horas/dia (base do valor-dia e valor-hora)

ALTER TABLE "SupplierServiceTermination"
  ADD COLUMN "averageWorkedDaysPerMonth" DECIMAL(8,2) NOT NULL DEFAULT 30,
  ADD COLUMN "hoursPerDay" DECIMAL(8,2) NOT NULL DEFAULT 8;
