-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_wallets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "address" TEXT NOT NULL,
    "recipient" TEXT,
    "amount_required" BIGINT NOT NULL,
    "amount_recieved" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "tx_out" TEXT,
    "refund_tx" TEXT,
    "refund_amount" BIGINT,
    "mode" TEXT NOT NULL DEFAULT 'checkout',
    "lifespan_seconds" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_wallets" ("address", "amount_recieved", "amount_required", "created_at", "id", "recipient", "refund_amount", "refund_tx", "status", "tx_out", "updated_at") SELECT "address", "amount_recieved", "amount_required", "created_at", "id", "recipient", "refund_amount", "refund_tx", "status", "tx_out", "updated_at" FROM "wallets";
DROP TABLE "wallets";
ALTER TABLE "new_wallets" RENAME TO "wallets";
CREATE INDEX "wallet_address" ON "wallets"("address");
CREATE INDEX "amount_status" ON "wallets"("amount_recieved", "status");
CREATE INDEX "created_status" ON "wallets"("created_at", "status");
CREATE INDEX "status" ON "wallets"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
