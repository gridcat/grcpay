-- AlterTable
ALTER TABLE `wallets` MODIFY `status` ENUM('new', 'funded', 'error', 'expired', 'processed', 'refunded') NOT NULL;
