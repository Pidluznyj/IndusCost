-- Turnos de configuração na associação departamento × competência.
-- Aditivo. Não cria posto, não grava turno em Employee e não gera nível ou avaliação.
-- shiftCode é só 1, 2 ou 3. Não há cadastro oficial de turno do colaborador para reutilizar.

ALTER TABLE "HrDepartmentCompetency" ADD COLUMN "appliesToAllShifts" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "HrDepartmentCompetencyShift" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "departmentCompetencyId" UUID NOT NULL,
    "shiftCode" TEXT NOT NULL,

    CONSTRAINT "HrDepartmentCompetencyShift_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HrDepartmentCompetencyShift_shiftCode_check" CHECK ("shiftCode" IN ('1', '2', '3'))
);

CREATE UNIQUE INDEX "HrDepartmentCompetencyShift_departmentCompetencyId_shiftCode_key" ON "HrDepartmentCompetencyShift"("departmentCompetencyId", "shiftCode");
CREATE INDEX "HrDepartmentCompetencyShift_shiftCode_idx" ON "HrDepartmentCompetencyShift"("shiftCode");

ALTER TABLE "HrDepartmentCompetencyShift" ADD CONSTRAINT "HrDepartmentCompetencyShift_departmentCompetencyId_fkey" FOREIGN KEY ("departmentCompetencyId") REFERENCES "HrDepartmentCompetency"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
