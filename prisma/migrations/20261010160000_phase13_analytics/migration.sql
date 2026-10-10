-- Phase 13 — Analytics

-- CreateTable: pharmacy_daily_stats
CREATE TABLE "pharmacy_daily_stats" (
    "id" TEXT NOT NULL,
    "pharmacy_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reservations_created" INTEGER NOT NULL DEFAULT 0,
    "reservations_served" INTEGER NOT NULL DEFAULT 0,
    "reservations_cancelled" INTEGER NOT NULL DEFAULT 0,
    "reservations_expired" INTEGER NOT NULL DEFAULT 0,
    "served_value_ngn" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unique_customers" INTEGER NOT NULL DEFAULT 0,
    "search_appearances" INTEGER NOT NULL DEFAULT 0,
    "ad_impressions" INTEGER NOT NULL DEFAULT 0,
    "ad_clicks" INTEGER NOT NULL DEFAULT 0,
    "drugs_added" INTEGER NOT NULL DEFAULT 0,
    "new_saves" INTEGER NOT NULL DEFAULT 0,
    "top_queries" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable: search_trends_daily
CREATE TABLE "search_trends_daily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "query" TEXT NOT NULL,
    "search_type" "SearchType" NOT NULL,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "zero_result_searches" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "search_trends_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable: platform_daily_stats
CREATE TABLE "platform_daily_stats" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "new_customers" INTEGER NOT NULL DEFAULT 0,
    "new_pharmacies" INTEGER NOT NULL DEFAULT 0,
    "active_pharmacies" INTEGER NOT NULL DEFAULT 0,
    "reservations_created" INTEGER NOT NULL DEFAULT 0,
    "reservations_served" INTEGER NOT NULL DEFAULT 0,
    "reservations_cancelled" INTEGER NOT NULL DEFAULT 0,
    "reservations_expired" INTEGER NOT NULL DEFAULT 0,
    "served_value_ngn" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "zero_result_searches" INTEGER NOT NULL DEFAULT 0,
    "ad_impressions" INTEGER NOT NULL DEFAULT 0,
    "ad_clicks" INTEGER NOT NULL DEFAULT 0,
    "subscription_revenue_ngn" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ad_revenue_ngn" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_daily_stats_pharmacy_id_date_key" ON "pharmacy_daily_stats"("pharmacy_id", "date");
CREATE INDEX "pharmacy_daily_stats_date_idx" ON "pharmacy_daily_stats"("date");
CREATE UNIQUE INDEX "search_trends_daily_date_query_search_type_key" ON "search_trends_daily"("date", "query", "search_type");
CREATE INDEX "search_trends_daily_date_searches_idx" ON "search_trends_daily"("date", "searches");
CREATE UNIQUE INDEX "platform_daily_stats_date_key" ON "platform_daily_stats"("date");

-- Supporting indexes for the daily aggregation queries
CREATE INDEX "reservations_created_at_idx" ON "reservations"("created_at");
CREATE INDEX "reservations_served_at_idx" ON "reservations"("served_at");
CREATE INDEX "reservations_cancelled_at_idx" ON "reservations"("cancelled_at");
CREATE INDEX "reservation_status_history_to_status_changed_at_idx" ON "reservation_status_history"("to_status", "changed_at");

-- AddForeignKey
ALTER TABLE "pharmacy_daily_stats" ADD CONSTRAINT "pharmacy_daily_stats_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
