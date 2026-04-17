-- CreateTable
CREATE TABLE "wallets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "address" TEXT NOT NULL,
    "recipient" TEXT,
    "amount_required" BIGINT NOT NULL,
    "amount_recieved" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "tx_out" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "db_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "wallet_id" INTEGER NOT NULL,
    "action" TEXT,
    "old_status" TEXT,
    "new_status" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "wallet_address" ON "wallets"("address");

-- CreateIndex
CREATE INDEX "amount_status" ON "wallets"("amount_recieved", "status");

-- CreateIndex
CREATE INDEX "created_status" ON "wallets"("created_at", "status");

-- CreateIndex
CREATE INDEX "status" ON "wallets"("status");
