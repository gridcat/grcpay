-- CreateIndex
CREATE INDEX `amount_status` ON `wallets`(`amount_recieved`, `status`);

-- CreateIndex
CREATE INDEX `status` ON `wallets`(`status`);
