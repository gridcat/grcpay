/*
  Warnings:

  - You are about to drop the column `txOut` on the `wallets` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `wallets` DROP COLUMN `txOut`,
    ADD COLUMN `tx_out` VARCHAR(64) NULL;
