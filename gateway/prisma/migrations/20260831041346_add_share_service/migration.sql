-- CreateTable
CREATE TABLE "publications" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publishRev" TEXT NOT NULL,
    "revCount" INTEGER NOT NULL DEFAULT 1,
    "storage" TEXT NOT NULL DEFAULT 'db',
    "r2Key" TEXT,
    "artifactHtml" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "atprotoAtUri" TEXT,
    "atprotoBskyPostUri" TEXT,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_comments" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "markedText" TEXT NOT NULL,
    "occurrenceIndex" INTEGER NOT NULL DEFAULT 0,
    "commentText" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT,
    "parentId" TEXT,
    "publishRev" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "publications_tokenHash_key" ON "publications"("tokenHash");

-- CreateIndex
CREATE INDEX "publications_authorId_idx" ON "publications"("authorId");

-- CreateIndex
CREATE INDEX "share_comments_publicationId_createdAt_idx" ON "share_comments"("publicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_comments" ADD CONSTRAINT "share_comments_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_comments" ADD CONSTRAINT "share_comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "share_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
