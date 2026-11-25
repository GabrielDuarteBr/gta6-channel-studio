-- CreateEnum
CREATE TYPE "CharacterArtStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "CharacterArt" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "CharacterArtStatus" NOT NULL DEFAULT 'DRAFT',
    "artist" TEXT NOT NULL,
    "rightsProof" TEXT NOT NULL,
    "proofKey" TEXT,
    "proofMime" TEXT,
    "canvasWidth" INTEGER NOT NULL,
    "canvasHeight" INTEGER NOT NULL,
    "files" JSONB NOT NULL,
    "pivots" JSONB NOT NULL,
    "warnings" TEXT[],
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "CharacterArt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CharacterArt_version_key" ON "CharacterArt"("version");

-- CreateIndex
CREATE INDEX "CharacterArt_status_idx" ON "CharacterArt"("status");
