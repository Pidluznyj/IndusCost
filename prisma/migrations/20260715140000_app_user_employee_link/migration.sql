-- Vincula AppUser ao cadastro de Pessoas / RH (Employee).
-- Novos usuários do sistema devem nascer a partir de um Employee.
ALTER TABLE "AppUser"
ADD COLUMN "employeeId" UUID;

CREATE UNIQUE INDEX "AppUser_employeeId_key" ON "AppUser"("employeeId");

CREATE INDEX "AppUser_employeeId_idx" ON "AppUser"("employeeId");

ALTER TABLE "AppUser"
ADD CONSTRAINT "AppUser_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
ON DELETE RESTRICT ON UPDATE NO ACTION;
