-- RH: vínculo opcional Diretoria → Diretoria (hierarquia entre diretorias)
ALTER TABLE "HrDirectorate" ADD COLUMN IF NOT EXISTS "parentDirectorateId" UUID;

CREATE INDEX IF NOT EXISTS "HrDirectorate_parentDirectorateId_idx"
  ON "HrDirectorate"("parentDirectorateId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HrDirectorate_parentDirectorateId_fkey'
  ) THEN
    ALTER TABLE "HrDirectorate"
      ADD CONSTRAINT "HrDirectorate_parentDirectorateId_fkey"
      FOREIGN KEY ("parentDirectorateId") REFERENCES "HrDirectorate"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
