-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ProductionKind" AS ENUM ('NEWS', 'REACT');

-- CreateEnum
CREATE TYPE "PartnerStage" AS ENUM ('CANDIDATE', 'CONTACTED', 'PARTNER', 'DISMISSED');

-- CreateEnum
CREATE TYPE "PermissionType" AS ENUM ('REACT_CLIPS');

-- CreateEnum
CREATE TYPE "ProofKind" AS ENUM ('EMAIL', 'DIRECT_MESSAGE', 'CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "PermissionStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('QUEUED', 'DOWNLOADING', 'PROCESSING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "analysis" JSONB,
ADD COLUMN     "analysisError" TEXT,
ADD COLUMN     "analysisStatus" "AnalysisStatus",
ADD COLUMN     "audioCleared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "durationSec" DOUBLE PRECISION,
ADD COLUMN     "originalName" TEXT,
ADD COLUMN     "partnerId" TEXT;

-- AlterTable
ALTER TABLE "Production" ADD COLUMN     "kind" "ProductionKind" NOT NULL DEFAULT 'NEWS',
ADD COLUMN     "partnerId" TEXT,
ADD COLUMN     "sourceAssetId" TEXT,
ALTER COLUMN "storyId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RightsManifest" ADD COLUMN     "permissionId" TEXT;

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channelId" TEXT,
    "handle" TEXT,
    "channelUrl" TEXT NOT NULL,
    "description" TEXT,
    "country" TEXT,
    "subscribers" INTEGER,
    "videoCount" INTEGER,
    "stage" "PartnerStage" NOT NULL DEFAULT 'CANDIDATE',
    "evidence" JSONB,
    "fitScore" DOUBLE PRECISION,
    "fitReason" TEXT,
    "draftMessage" TEXT,
    "discoveredBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPermission" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "type" "PermissionType" NOT NULL,
    "proofKind" "ProofKind" NOT NULL,
    "proof" TEXT NOT NULL,
    "proofFileKey" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "conditions" JSONB NOT NULL,
    "status" "PermissionStatus" NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerImport" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT,
    "incomingKey" TEXT,
    "originalName" TEXT,
    "title" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'QUEUED',
    "step" TEXT,
    "error" TEXT,
    "assetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_channelId_key" ON "Partner"("channelId");

-- CreateIndex
CREATE INDEX "Partner_stage_idx" ON "Partner"("stage");

-- CreateIndex
CREATE INDEX "PartnerPermission_partnerId_idx" ON "PartnerPermission"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerPermission_status_idx" ON "PartnerPermission"("status");

-- CreateIndex
CREATE INDEX "PartnerImport_partnerId_idx" ON "PartnerImport"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerImport_status_idx" ON "PartnerImport"("status");

-- CreateIndex
CREATE INDEX "Asset_partnerId_idx" ON "Asset"("partnerId");

-- CreateIndex
CREATE INDEX "Production_partnerId_idx" ON "Production"("partnerId");

-- CreateIndex
CREATE INDEX "RightsManifest_permissionId_idx" ON "RightsManifest"("permissionId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsManifest" ADD CONSTRAINT "RightsManifest_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "PartnerPermission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPermission" ADD CONSTRAINT "PartnerPermission_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerImport" ADD CONSTRAINT "PartnerImport_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerImport" ADD CONSTRAINT "PartnerImport_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "PartnerPermission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
