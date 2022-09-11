-- CreateTable
CREATE TABLE `logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `wallet_id` BIGINT UNSIGNED NOT NULL,
    `action` VARCHAR(64) NULL,
    `old_status` VARCHAR(64) NULL,
    `new_status` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
