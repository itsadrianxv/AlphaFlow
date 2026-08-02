#!/bin/sh
set -eu

compose="docker compose --profile llm-scheduler-test -f docker-compose.yml"
cleanup() {
  code=$?
  if [ "$code" -ne 0 ]; then
    $compose logs worker-test mock-web || true
  fi
  $compose down --volumes --remove-orphans
  exit "$code"
}
trap cleanup EXIT

insert_task() {
  task_id=$1
  $compose exec -T postgres-test psql -U postgres -d llm_scheduler_worker_test -v ON_ERROR_STOP=1 -c \
    "INSERT INTO \"LlmTaskExecution\" (id, \"taskType\", \"idempotencyKey\", \"inputHash\", \"inputJson\") VALUES ('$task_id', 'EVENT_ADJUDICATION', '$task_id:v1', 'sha256:$task_id', '{}'::jsonb)" >/dev/null
}

publish() {
  task_id=$1
  $compose exec -T redis-test redis-cli XADD llm:tasks '*' \
    schemaVersion 1 taskId "$task_id" taskType EVENT_ADJUDICATION \
    idempotencyKey "$task_id:v1" inputHash "sha256:$task_id" createdAt 2026-08-02T00:00:00Z >/dev/null
}

status_of() {
  $compose exec -T postgres-test psql -U postgres -d llm_scheduler_worker_test -Atc \
    "SELECT status::text FROM \"LlmTaskExecution\" WHERE id='$1'"
}

wait_status() {
  task_id=$1
  expected=$2
  limit=${3:-30}
  attempt=0
  actual=""
  while [ "$attempt" -lt "$limit" ]; do
    actual=$(status_of "$task_id")
    [ "$actual" = "$expected" ] && return 0
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "$task_id 未进入 $expected，最终状态: ${actual:-missing}" >&2
  return 1
}

$compose up --build --detach --wait

# 成功、重复唤醒和幂等结果。
insert_task success-1
publish success-1
publish success-1
wait_status success-1 SUCCEEDED
[ "$($compose exec -T postgres-test psql -U postgres -d llm_scheduler_worker_test -Atc "SELECT result->'result'->>'decision' FROM \"LlmTaskExecution\" WHERE id='success-1'")" = "HOLD" ]

# 503 延迟重试保留原 PEL 消息，随后成功。
insert_task retry-1
publish retry-1
wait_status retry-1 SUCCEEDED 20
[ "$($compose exec -T postgres-test psql -U postgres -d llm_scheduler_worker_test -Atc "SELECT attempts FROM \"LlmTaskExecution\" WHERE id='retry-1'")" = "2" ]

# 422 结构化业务拒绝立即进入失败终态。
insert_task terminal-1
publish terminal-1
wait_status terminal-1 FAILED 10
[ "$($compose exec -T postgres-test psql -U postgres -d llm_scheduler_worker_test -Atc "SELECT attempts FROM \"LlmTaskExecution\" WHERE id='terminal-1'")" = "1" ]

# 进程强制退出后，过期 lease 与 PEL 接管，旧 fencing token 不可覆盖结果。
insert_task delay-1
publish delay-1
wait_status delay-1 RUNNING 10
$compose kill --signal SIGKILL worker-test
$compose up --detach worker-test
wait_status delay-1 SUCCEEDED 30
token=$($compose exec -T postgres-test psql -U postgres -d llm_scheduler_worker_test -Atc \
  "SELECT \"fencingToken\" FROM \"LlmTaskExecution\" WHERE id='delay-1'")
[ "$token" -ge 2 ]

# SIGTERM 能在 grace period 内停止进程；任务级取消和不 ACK 由生命周期单元测试覆盖。
$compose stop -t 10 worker-test
$compose up --detach worker-test
wait_status success-1 SUCCEEDED 5

echo "llm-scheduler Docker 集成测试通过"
