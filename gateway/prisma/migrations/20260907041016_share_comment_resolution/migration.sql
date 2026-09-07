-- AlterTable
ALTER TABLE "share_comments" ADD COLUMN     "fromAuthor" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resolvedAt" TIMESTAMP(3);
