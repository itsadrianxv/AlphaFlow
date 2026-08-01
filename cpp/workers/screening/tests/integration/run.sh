#!/bin/sh
set -eu

compose="docker compose --profile screening-worker-test -f docker-compose.yml"
cleanup() {
  code=$?
  if [ "$code" -ne 0 ]; then
    $compose logs worker-test mock-python || true
  fi
  $compose down --volumes --remove-orphans
  exit "$code"
}
trap cleanup EXIT

insert_run() {
  run_id=$1
  config=$2
  $compose exec -T postgres-test psql -U postgres -d screening_worker_test -v ON_ERROR_STOP=1 -c \
    "INSERT INTO \"ScreeningRun\" (id, config) VALUES ('$run_id', '$config'::jsonb)" >/dev/null
}

publish() {
  event_id=$1
  run_id=$2
  $compose exec -T redis-test redis-cli XADD screening:runs '*' \
    schemaVersion 1 eventId "$event_id" runId "$run_id" createdAt 2026-07-29T00:00:00Z >/dev/null
}

status_of() {
  $compose exec -T postgres-test psql -U postgres -d screening_worker_test -Atc \
    "SELECT status::text FROM \"ScreeningRun\" WHERE id='$1'"
}

wait_status() {
  run_id=$1
  expected=$2
  limit=${3:-30}
  attempt=0
  actual=""
  while [ "$attempt" -lt "$limit" ]; do
    actual=$(status_of "$run_id")
    [ "$actual" = "$expected" ] && return 0
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "$run_id 未进入 $expected，最终状态: ${actual:-missing}" >&2
  $compose exec -T postgres-test psql -U postgres -d screening_worker_test -c \
    "SELECT status, attempts, \"errorCode\", \"errorMessage\" FROM \"ScreeningRun\" WHERE id='$run_id'" >&2
  return 1
}

wait_ready() {
  attempt=0
  while [ "$attempt" -lt 15 ]; do
    if $compose exec -T worker-test curl --fail --silent http://localhost:8030/health/ready >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "worker readiness 未恢复" >&2
  return 1
}

wait_not_ready() {
  attempt=0
  while [ "$attempt" -lt 10 ]; do
    if ! $compose exec -T worker-test curl --fail --silent http://localhost:8030/health/ready >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "依赖不可用时 worker readiness 仍为成功" >&2
  return 1
}

base_config='{"universe":{"type":"ALL_A_SHARES"},"indicatorIds":["income.total_revenue"],"formulas":[],"timeConfig":{"periodType":"ANNUAL","rangeMode":"PRESET","presetKey":"1Y"},"filterRules":[],"sortState":null}'

$compose up --build --detach --wait

# 基础执行、重复消息幂等与非法协议清理。
insert_run run-integration-1 "$base_config"
publish event-1 run-integration-1
publish event-duplicate run-integration-1
wait_status run-integration-1 SUCCEEDED
count=$($compose exec -T postgres-test psql -U postgres -d screening_worker_test -Atc \
  "SELECT COUNT(*) FROM \"ScreeningRunResult\" WHERE \"runId\"='run-integration-1'")
[ "$count" = "2" ]
$compose exec -T redis-test redis-cli XADD screening:runs '*' schemaVersion 9 eventId invalid-event >/dev/null
sleep 2
stream_length=$($compose exec -T redis-test redis-cli XLEN screening:runs)
[ "$stream_length" = "0" ]

# kill -9 后通过 PEL 与到期 lease 接管，旧 fencing token 不能写入。
insert_run run-recovery-1 '{"delayMs":3000}'
publish recovery-event run-recovery-1
wait_status run-recovery-1 RUNNING 10
$compose kill --signal SIGKILL worker-test
$compose up --detach worker-test
wait_status run-recovery-1 SUCCEEDED 30
token=$($compose exec -T postgres-test psql -U postgres -d screening_worker_test -Atc \
  "SELECT \"fencingToken\" FROM \"ScreeningRun\" WHERE id='run-recovery-1'")
[ "$token" -ge 2 ]
stale_write=$($compose exec -T postgres-test psql -U postgres -d screening_worker_test -Atc \
  "WITH changed AS (UPDATE \"ScreeningRun\" SET \"heartbeatAt\"=NOW() WHERE id='run-recovery-1' AND status='RUNNING' AND \"fencingToken\"=1 RETURNING 1) SELECT COUNT(*) FROM changed")
[ "$stale_write" = "0" ]

# 500 与 429 会重试，400 立即进入终态失败。
insert_run run-http-500 '{"mockStatusSequence":[500,200]}'
publish http-500-event run-http-500
wait_status run-http-500 SUCCEEDED 25
[ "$($compose exec -T postgres-test psql -U postgres -d screening_worker_test -Atc "SELECT attempts FROM \"ScreeningRun\" WHERE id='run-http-500'")" = "2" ]

insert_run run-http-429 '{"mockStatusSequence":[429,200]}'
publish http-429-event run-http-429
wait_status run-http-429 SUCCEEDED 25
[ "$($compose exec -T postgres-test psql -U postgres -d screening_worker_test -Atc "SELECT attempts FROM \"ScreeningRun\" WHERE id='run-http-429'")" = "2" ]

insert_run run-http-400 '{"mockStatusSequence":[400]}'
publish http-400-event run-http-400
wait_status run-http-400 FAILED 10
[ "$($compose exec -T postgres-test psql -U postgres -d screening_worker_test -Atc "SELECT attempts FROM \"ScreeningRun\" WHERE id='run-http-400'")" = "1" ]

# 首次请求超时，原消息保留在 PEL 并在数据库退避到期后成功。
insert_run run-timeout '{"mockDelaySequenceMs":[6000,0]}'
publish timeout-event run-timeout
wait_status run-timeout SUCCEEDED 30
[ "$($compose exec -T postgres-test psql -U postgres -d screening_worker_test -Atc "SELECT attempts FROM \"ScreeningRun\" WHERE id='run-timeout'")" = "2" ]

# retry 期间不发布替代消息，原消息始终留在 PEL。
insert_run run-pel-retry '{"mockStatusSequence":[500,200]}'
publish pel-retry-event run-pel-retry
wait_status run-pel-retry RETRYING 10
[ "$($compose exec -T redis-test redis-cli XLEN screening:runs)" = "1" ]
pending=$($compose exec -T redis-test redis-cli XPENDING screening:runs screening-worker | awk 'NR==1 {print $1}')
[ "$pending" = "1" ]
sleep 3
[ "$(status_of run-pel-retry)" = "RETRYING" ]
wait_status run-pel-retry SUCCEEDED 25

# Redis 在事务提交后不可用：结果已经完整提交，重启后终态消息只做 ACK/XDEL。
insert_run run-ack-recovery '{"delayMs":3000}'
publish ack-recovery-event run-ack-recovery
wait_status run-ack-recovery RUNNING 10
$compose stop redis-test
wait_not_ready
sleep 4
[ "$(status_of run-ack-recovery)" = "SUCCEEDED" ]
[ "$($compose exec -T postgres-test psql -U postgres -d screening_worker_test -Atc "SELECT COUNT(*) FROM \"ScreeningRunResult\" WHERE \"runId\"='run-ack-recovery'")" = "2" ]
$compose kill --signal SIGKILL worker-test
$compose start redis-test
$compose up --detach worker-test
wait_ready
attempt=0
while [ "$attempt" -lt 20 ]; do
  [ "$($compose exec -T redis-test redis-cli XLEN screening:runs)" = "0" ] && break
  attempt=$((attempt + 1))
  sleep 1
done
[ "$($compose exec -T redis-test redis-cli XLEN screening:runs)" = "0" ]

# PostgreSQL 在提交阶段不可用时不能半写；恢复后由 lease/PEL 接管。
insert_run run-pg-recovery '{"delayMs":3000}'
publish pg-recovery-event run-pg-recovery
wait_status run-pg-recovery RUNNING 10
$compose stop postgres-test
wait_not_ready
sleep 4
$compose start postgres-test
wait_ready
partial_count=$($compose exec -T postgres-test psql -U postgres -d screening_worker_test -Atc \
  "SELECT COUNT(*) FROM \"ScreeningRunResult\" WHERE \"runId\"='run-pg-recovery'")
[ "$partial_count" = "0" ] || [ "$partial_count" = "2" ]
wait_status run-pg-recovery SUCCEEDED 35

# 两个执行线程加两个排队槽位时，第五个任务仍保持 PENDING。
for index in 1 2 3 4 5; do
  insert_run "run-capacity-$index" '{"delayMs":4000}'
done
for index in 1 2 3 4 5; do
  publish "capacity-event-$index" "run-capacity-$index"
done
attempt=0
running_count=0
while [ "$attempt" -lt 20 ]; do
  running_count=$($compose exec -T postgres-test psql -U postgres -d screening_worker_test -Atc \
    "SELECT COUNT(*) FROM \"ScreeningRun\" WHERE id LIKE 'run-capacity-%' AND status='RUNNING'")
  [ "$running_count" = "4" ] && break
  attempt=$((attempt + 1))
  sleep 0.1
done
pending_count=$($compose exec -T postgres-test psql -U postgres -d screening_worker_test -Atc \
  "SELECT COUNT(*) FROM \"ScreeningRun\" WHERE id LIKE 'run-capacity-%' AND status='PENDING'")
[ "$running_count" = "4" ]
[ "$pending_count" -ge 1 ]
for index in 1 2 3 4 5; do
  wait_status "run-capacity-$index" SUCCEEDED 30
done

# Python 依赖单独下线时 readiness 失败，恢复后重新就绪。
$compose stop mock-python
wait_not_ready
$compose start mock-python
wait_ready

# SIGTERM 会中断 curl 并在 30 秒内退出，未 ACK 的任务随后可恢复。
insert_run run-sigterm '{"mockDelaySequenceMs":[15000,0]}'
publish sigterm-event run-sigterm
wait_status run-sigterm RUNNING 10
started_at=$(date +%s)
$compose stop -t 30 worker-test
elapsed=$(( $(date +%s) - started_at ))
[ "$elapsed" -lt 30 ]
[ "$(status_of run-sigterm)" = "RUNNING" ]
$compose up --detach worker-test
wait_status run-sigterm SUCCEEDED 30

echo "screening-worker Docker 集成测试通过"
