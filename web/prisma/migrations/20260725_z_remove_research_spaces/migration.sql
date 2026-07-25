DELETE FROM "ResearchNote" WHERE "targetType" = 'space';
DELETE FROM "FinancialSnapshot" WHERE "targetType" = 'space';
DELETE FROM "ResearchArtifact" WHERE "targetType" = 'space';

DROP TABLE "ResearchSpaceStockLink";
DROP TABLE "ResearchSpaceWatchListLink";
DROP TABLE "ResearchSpaceRunLink";
DROP TABLE "ResearchSpace";
