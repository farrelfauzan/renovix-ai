-- RX-10: daily free-tier counters per hashed client IP and globally.
-- Additive only; rollback: DROP TABLE "anonymous_usage_counters".

-- CreateTable
CREATE TABLE "anonymous_usage_counters" (
    "bucket" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "anonymous_usage_counters_pkey" PRIMARY KEY ("bucket","day")
);
