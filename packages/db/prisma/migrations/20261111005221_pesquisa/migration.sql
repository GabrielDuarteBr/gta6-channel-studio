-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('RSS', 'PAGE', 'YOUTUBE_CHANNEL', 'YOUTUBE_SEARCH');

-- CreateEnum
CREATE TYPE "SourceTier" AS ENUM ('OFFICIAL', 'PRESS', 'COMMUNITY');

-- CreateEnum
CREATE TYPE "StoryStatus" AS ENUM ('NEW', 'QUEUED_LONG', 'QUEUED_SHORT', 'QUEUED_COMPILATION', 'DISMISSED');

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "tier" "SourceTier" NOT NULL,
    "url" TEXT NOT NULL,
    "config" JSONB,
    "language" TEXT NOT NULL DEFAULT 'en',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "resolved" JSONB,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "lastItemCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "normalizedTitle" TEXT NOT NULL,
    "metrics" JSONB,
    "flags" JSONB,
    "isRumor" BOOLEAN NOT NULL DEFAULT false,
    "storyId" TEXT,

    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titlePt" TEXT,
    "summaryPt" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scoreBreakdown" JSONB,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "independentSources" INTEGER NOT NULL DEFAULT 0,
    "officialCount" INTEGER NOT NULL DEFAULT 0,
    "isRumor" BOOLEAN NOT NULL DEFAULT false,
    "flags" JSONB,
    "kind" TEXT,
    "newsworthiness" DOUBLE PRECISION,
    "triagedAt" TIMESTAMP(3),
    "status" "StoryStatus" NOT NULL DEFAULT 'NEW',
    "statusChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_key_key" ON "Source"("key");

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_url_key" ON "NewsItem"("url");

-- CreateIndex
CREATE INDEX "NewsItem_storyId_idx" ON "NewsItem"("storyId");

-- CreateIndex
CREATE INDEX "NewsItem_publishedAt_idx" ON "NewsItem"("publishedAt");

-- CreateIndex
CREATE INDEX "Story_score_idx" ON "Story"("score");

-- CreateIndex
CREATE INDEX "Story_lastSeenAt_idx" ON "Story"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Story_status_idx" ON "Story"("status");

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;
