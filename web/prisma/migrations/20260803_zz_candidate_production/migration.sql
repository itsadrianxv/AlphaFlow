DROP INDEX IF EXISTS "ResearchResourcePermit_active_task_pool_key";

INSERT INTO "ResearchResourcePool" (
    "id",
    "poolKey",
    "resourceKind",
    "hardConcurrency",
    "currentConcurrency"
) VALUES (
    'research-candidate-adjudication-pool-v1',
    'deepseek:candidate-adjudication',
    'LLM',
    4,
    2
)
ON CONFLICT ("poolKey") DO NOTHING;

INSERT INTO "ResearchResourcePool" (
    "id",
    "poolKey",
    "resourceKind",
    "hardConcurrency",
    "currentConcurrency"
) VALUES (
    'research-feishu-delivery-pool-v1',
    'feishu:research-delivery',
    'FEISHU',
    2,
    1
)
ON CONFLICT ("poolKey") DO NOTHING;
