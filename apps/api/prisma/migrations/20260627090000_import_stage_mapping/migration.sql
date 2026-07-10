CREATE TABLE "ImportStageMapping" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "importType" TEXT NOT NULL,
    "sourceColumn" TEXT NOT NULL,
    "targetStageKey" TEXT NOT NULL,
    "quantityType" TEXT NOT NULL,
    "applyMode" TEXT NOT NULL DEFAULT 'snapshot',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportStageMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportStageMapping_factoryId_importType_sourceColumn_key" ON "ImportStageMapping"("factoryId", "importType", "sourceColumn");

ALTER TABLE "ImportStageMapping" ADD CONSTRAINT "ImportStageMapping_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
