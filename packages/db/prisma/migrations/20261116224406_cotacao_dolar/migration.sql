-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_day_key" ON "FxRate"("day");
