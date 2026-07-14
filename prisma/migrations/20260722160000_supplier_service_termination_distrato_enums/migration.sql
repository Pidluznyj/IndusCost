-- Novos valores de status e enums do distrato.
-- ADD VALUE não pode rodar na mesma transação que usa o valor novo.

ALTER TYPE "SupplierServiceTerminationStatus" ADD VALUE IF NOT EXISTS 'AWAITING_SIGNATURE';
ALTER TYPE "SupplierServiceTerminationStatus" ADD VALUE IF NOT EXISTS 'SIGNED_AWAITING_PAYMENT';
ALTER TYPE "SupplierServiceTerminationStatus" ADD VALUE IF NOT EXISTS 'PAID_AND_SETTLED';

DO $$ BEGIN
  CREATE TYPE "SupplierServiceTerminationModality" AS ENUM (
    'MUTUAL_AGREEMENT',
    'CONTRACTOR_INITIATIVE',
    'CONTRACTED_INITIATIVE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SupplierServiceTerminationCommissionTreatment" AS ENUM (
    'NONE_PENDING',
    'HAS_PENDING',
    'NEGOTIATED_INCLUDED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SupplierServiceTerminationNoticeOrigin" AS ENUM (
    'CONTRACT_CLAUSE',
    'AGREEMENT',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
