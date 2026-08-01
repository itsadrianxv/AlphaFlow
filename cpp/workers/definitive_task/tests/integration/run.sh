#!/bin/sh
set -eu

compose="docker compose --profile definitive-task-worker-test -f docker-compose.yml"
cleanup() {
  code=$?
  if [ "$code" -ne 0 ]; then
    $compose logs worker-test mock-python || true
  fi
  $compose down --volumes --remove-orphans
  exit "$code"
}
trap cleanup EXIT

insert_execution() {
  execution_id=$1
  plan=$2
  $compose exec -T postgres-test psql -U postgres -d definitive_task_worker_test -v ON_ERROR_STOP=1 >/dev/null <<SQL
INSERT INTO "ScheduledTask" (id) VALUES ('task-$execution_id');
INSERT INTO "ScheduledTaskVersion" (id, "executionPlan")
VALUES ('version-$execution_id', '$plan'::jsonb);
INSERT INTO "ScheduledTaskExecution" (id, "taskId", "taskVersionId", "scheduledAt")
VALUES ('$execution_id', 'task-$execution_id', 'version-$execution_id', NOW());
SQL
}

publish() {
  execution_id=$1
  $compose exec -T redis-test redis-cli XADD definitive-task:runs '*' \
    schemaVersion 1 executionId "$execution_id" enqueuedAt 2026-07-29T00:00:00Z >/dev/null
}

status_of() {
  $compose exec -T postgres-test psql -U postgres -d definitive_task_worker_test -Atc \
    "SELECT status::text FROM \"ScheduledTaskExecution\" WHERE id='$1'"
}

wait_status() {
  execution_id=$1
  expected=$2
  limit=${3:-30}
  attempt=0
  actual=""
  while [ "$attempt" -lt "$limit" ]; do
    actual=$(status_of "$execution_id")
    [ "$actual" = "$expected" ] && return 0
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "$execution_id 未进入 $expected，最终状态: ${actual:-missing}" >&2
  return 1
}

base_plan='{"schemaVersion":1,"type":"deterministic_scoring"}'
$compose up --build --detach --wait

# 三字段消息完成结果事务；重复消息只能得到一份结果。
insert_execution execution-success "$base_plan"
publish execution-success
publish execution-success
wait_status execution-success SUCCEEDED
[ "$($compose exec -T postgres-test psql -U postgres -d definitive_task_worker_test -Atc \
  "SELECT COUNT(*) FROM \"ScheduledTaskScoreResult\" WHERE \"executionId\"='execution-success'")" = "2" ]
[ "$($compose exec -T postgres-test psql -U postgres -d definitive_task_worker_test -Atc \
  "SELECT result->>'type' FROM \"ScheduledTaskExecution\" WHERE id='execution-success'")" = "SCORING_REPORT" ]

# 非法协议消息会被清理，不留在 PEL。
$compose exec -T redis-test redis-cli XADD definitive-task:runs '*' schemaVersion 9 enqueuedAt bad >/dev/null
sleep 2
[ "$($compose exec -T redis-test redis-cli XPENDING definitive-task:runs definitive-task-worker | head -n 1)" = "0" ]

# 500 进入内存重试，替代消息成功后原消息才 ACK/XDEL。
insert_execution execution-retry '{"schemaVersion":1,"type":"deterministic_scoring","mockStatusSequence":[500,200]}'
publish execution-retry
wait_status execution-retry SUCCEEDED 25
[ "$($compose exec -T postgres-test psql -U postgres -d definitive_task_worker_test -Atc \
  "SELECT attempts FROM \"ScheduledTaskExecution\" WHERE id='execution-retry'")" = "2" ]

# kill -9 后由 PEL 与过期 lease 接管，fencing token 必须递增。
insert_execution execution-recovery '{"schemaVersion":1,"type":"deterministic_scoring","mockDelaySequenceMs":[5000,0]}'
publish execution-recovery
wait_status execution-recovery RUNNING 10
$compose kill --signal SIGKILL worker-test
$compose up --detach worker-test
wait_status execution-recovery SUCCEEDED 20
token=$($compose exec -T postgres-test psql -U postgres -d definitive_task_worker_test -Atc \
  "SELECT \"fencingToken\" FROM \"ScheduledTaskExecution\" WHERE id='execution-recovery'")
[ "$token" -ge 2 ]

# 所有可靠提交后的消息均已 ACK 并删除。
attempt=0
while [ "$attempt" -lt 10 ]; do
  [ "$($compose exec -T redis-test redis-cli XLEN definitive-task:runs)" = "0" ] && break
  attempt=$((attempt + 1))
  sleep 1
done
[ "$($compose exec -T redis-test redis-cli XLEN definitive-task:runs)" = "0" ]
[ "$($compose exec -T redis-test redis-cli XPENDING definitive-task:runs definitive-task-worker | head -n 1)" = "0" ]

echo "definitive-task-worker Docker 集成测试通过"
