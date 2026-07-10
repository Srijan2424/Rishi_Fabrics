/*
  Warnings:

  - Added the required column `reason` to the `ReworkTicket` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ReworkTicket" ADD COLUMN     "reason" TEXT NOT NULL;
