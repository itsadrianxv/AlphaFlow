CREATE UNIQUE INDEX IF NOT EXISTS "HomepageCurrentSnapshotProjection_baseline_unique"
  ON "HomepageCurrentSnapshotProjection" ("scope")
  WHERE "userId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "HomepageCurrentSnapshotProjection_personalized_unique"
  ON "HomepageCurrentSnapshotProjection" ("scope", "userId")
  WHERE "userId" IS NOT NULL;
