-- AlterTable
ALTER TABLE `wallets` MODIFY `amount_required` BIGINT UNSIGNED NOT NULL,
    MODIFY `amount_recieved` BIGINT UNSIGNED NOT NULL;
