-- Upgrade an existing db-push installation without recreating unrelated tables.
ALTER TABLE "HermesMemory"
  ADD COLUMN IF NOT EXISTS "namespace" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS "trust" TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN IF NOT EXISTS "sourceUri" TEXT,
  ADD COLUMN IF NOT EXISTS "supersedesId" TEXT,
  ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "contentHash" TEXT;

ALTER TABLE "HermesMemory" DROP CONSTRAINT IF EXISTS "HermesMemory_pkey";
ALTER TABLE "HermesMemory" ADD CONSTRAINT "HermesMemory_pkey" PRIMARY KEY ("namespace", "id");

CREATE INDEX IF NOT EXISTS "HermesMemory_namespace_status_idx"
  ON "HermesMemory"("namespace", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "HermesMemory_namespace_path_key"
  ON "HermesMemory"("namespace", "path");
