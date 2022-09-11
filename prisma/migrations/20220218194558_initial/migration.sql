-- CreateTable
CREATE TABLE `wallets` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `address` VARCHAR(36) NOT NULL,
    `recipient` VARCHAR(36) NULL,
    `amount_required` FLOAT NOT NULL,
    `amount_recieved` FLOAT NOT NULL,
    `status` ENUM('new', 'funded', 'error', 'processed', 'refunded') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `wallet_address`(`address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
