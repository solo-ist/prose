-- Grant by email (#965): invites claimed into "entitlements" on first use.

-- CreateTable
CREATE TABLE "entitlement_invites" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedByUserId" TEXT,

    CONSTRAINT "entitlement_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entitlement_invites_email_feature_key" ON "entitlement_invites"("email", "feature");
