-- AlterTable
ALTER TABLE `wallets` MODIFY `status` ENUM('new', 'funded', 'error', 'expired', 'processed', 'refunded', 'norefund') NOT NULL;
