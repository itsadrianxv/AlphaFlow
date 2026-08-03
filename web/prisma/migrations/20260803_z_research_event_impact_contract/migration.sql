ALTER TABLE "ResearchEventImpact"
DROP CONSTRAINT "ResearchEventImpact_materiality_check";

ALTER TABLE "ResearchEventImpact"
ADD CONSTRAINT "ResearchEventImpact_impact_type_check"
CHECK ("impactType" IN ('DIRECT', 'INDIRECT')),
ADD CONSTRAINT "ResearchEventImpact_materiality_check"
CHECK ("materiality" IN ('LOW', 'MEDIUM', 'HIGH'));
