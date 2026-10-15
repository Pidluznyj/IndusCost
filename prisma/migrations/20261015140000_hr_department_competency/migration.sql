-- Associação departamento oficial × competência.
-- Aditiva: não altera HrWorkPosition, requisitos, níveis, avaliações nem o cadastro de Employee/HrDepartment.
-- Não há nível mínimo: a linha só indica que a competência é pertinente ao departamento.

CREATE TABLE "HrDepartmentCompetency" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "departmentId" UUID NOT NULL,
    "competencyId" UUID NOT NULL,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrDepartmentCompetency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HrDepartmentCompetency_departmentId_competencyId_key" ON "HrDepartmentCompetency"("departmentId", "competencyId");
CREATE INDEX "HrDepartmentCompetency_competencyId_idx" ON "HrDepartmentCompetency"("competencyId");

ALTER TABLE "HrDepartmentCompetency" ADD CONSTRAINT "HrDepartmentCompetency_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "HrDepartment"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "HrDepartmentCompetency" ADD CONSTRAINT "HrDepartmentCompetency_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "HrCompetency"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
