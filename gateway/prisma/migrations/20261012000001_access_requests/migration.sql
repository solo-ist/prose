-- Request access (#1018): the sharing waitlist. Approved via npm run grant.

-- CreateTable
CREATE TABLE "access_requests" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedAt" TIMESTAMP(3),

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "access_requests_email_feature_key" ON "access_requests"("email", "feature");
