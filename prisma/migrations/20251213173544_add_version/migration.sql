/*
  Warnings:

  - Added the required column `version` to the `Seat` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Seat" ADD COLUMN     "version" INTEGER NOT NULL;
