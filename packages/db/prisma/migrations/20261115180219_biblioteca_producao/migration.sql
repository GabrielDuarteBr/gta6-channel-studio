-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('IMAGE', 'AUDIO', 'VIDEO');

-- CreateEnum
CREATE TYPE "AssetOrigin" AS ENUM ('OFFICIAL_PRESS', 'PARTNER', 'IMAGE_PROVIDER', 'OWNER_UPLOAD', 'CHANNEL_OWN');

-- CreateEnum
CREATE TYPE "RightsStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "ProductionFormat" AS ENUM ('LONG', 'SHORT');

-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('DRAFT', 'QUEUED', 'SCRIPTING', 'ART', 'VOICE', 'RENDERING', 'REVIEWING', 'READY', 'NEEDS_ATTENTION', 'FAILED', 'CANCELED');

-- AlterTable
ALTER TABLE "CostLedger" ADD COLUMN     "productionId" TEXT;

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL DEFAULT 'IMAGE',
    "origin" "AssetOrigin" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER NOT NULL,
    "storyId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RightsManifest" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "origin" "AssetOrigin" NOT NULL,
    "sourceUrl" TEXT,
    "license" TEXT NOT NULL,
    "credit" TEXT,
    "proof" TEXT,
    "restrictions" JSONB,
    "provider" TEXT,
    "prompt" TEXT,
    "status" "RightsStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RightsManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Production" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "format" "ProductionFormat" NOT NULL,
    "status" "ProductionStatus" NOT NULL DEFAULT 'DRAFT',
    "step" TEXT,
    "title" TEXT,
    "script" JSONB,
    "plan" JSONB,
    "review" JSONB,
    "reviewRound" INTEGER NOT NULL DEFAULT 0,
    "outputs" JSONB,
    "renderReport" JSONB,
    "error" TEXT,
    "createdBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Production_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionAsset" (
    "productionId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "scene" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductionAsset_pkey" PRIMARY KEY ("productionId","assetId","role","scene")
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_storageKey_key" ON "Asset"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_sha256_key" ON "Asset"("sha256");

-- CreateIndex
CREATE INDEX "Asset_origin_idx" ON "Asset"("origin");

-- CreateIndex
CREATE INDEX "Asset_storyId_idx" ON "Asset"("storyId");

-- CreateIndex
CREATE UNIQUE INDEX "RightsManifest_assetId_key" ON "RightsManifest"("assetId");

-- CreateIndex
CREATE INDEX "Production_status_idx" ON "Production"("status");

-- CreateIndex
CREATE INDEX "Production_storyId_idx" ON "Production"("storyId");

-- CreateIndex
CREATE INDEX "Production_createdAt_idx" ON "Production"("createdAt");

-- CreateIndex
CREATE INDEX "ProductionAsset_assetId_idx" ON "ProductionAsset"("assetId");

-- CreateIndex
CREATE INDEX "CostLedger_productionId_idx" ON "CostLedger"("productionId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsManifest" ADD CONSTRAINT "RightsManifest_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAsset" ADD CONSTRAINT "ProductionAsset_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAsset" ADD CONSTRAINT "ProductionAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
