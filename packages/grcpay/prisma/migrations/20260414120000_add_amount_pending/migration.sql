-- Track unconfirmed inbound balance separately from the settled amount
-- so integrators can show a "waiting for N confirmations" state to the
-- user. Default 0 so existing rows don't break the NOT NULL constraint.
ALTER TABLE "wallets" ADD COLUMN "amount_pending" BIGINT NOT NULL DEFAULT 0;
