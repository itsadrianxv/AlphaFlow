#!/bin/sh
set -eu

compose="docker compose -f docker-compose.yml"
cleanup() {
  code=$?
  if [ "$code" -ne 0 ]; then $compose logs worker-test mock-web || true; fi
  $compose down --volumes --remove-orphans
  exit "$code"
}
trap cleanup EXIT

insert_task() {
  id=$1
  scope=${2:-DEFAULT}
  fingerprint=${3:-NULL}
  $compose exec -T postgres-test psql -U postgres -d homepage_worker_test -v ON_ERROR_STOP=1 -c \
    "INSERT INTO \"HomePageGenerationTask\"(id,\"generationKey\",scope,\"preferenceFingerprint\") VALUES('$id','$id','$scope',$fingerprint)" >/dev/null
}
publish() {
  $compose exec -T redis-test redis-cli XADD homepage:generation '*' schemaVersion 1 executionId "$1" enqueuedAt 2026-08-01T00:00:00Z >/dev/null
}
status_of() {
  $compose exec -T postgres-test psql -U postgres -d homepage_worker_test -Atc "SELECT status::text FROM \"HomePageGenerationTask\" WHERE id='$1'"
}
wait_status() {
  id=$1 expected=$2 limit=${3:-25} attempt=0
  while [ "$attempt" -lt "$limit" ]; do
    [ "$(status_of "$id")" = "$expected" ] && return 0
    attempt=$((attempt + 1)); sleep 1
  done
  echo "$id 未进入 $expected" >&2; return 1
}

$compose up --build --detach --wait

insert_task homepage-success
publish homepage-success
publish homepage-success
wait_status homepage-success SUCCEEDED
[ "$($compose exec -T postgres-test psql -U postgres -d homepage_worker_test -Atc "SELECT COUNT(*) FROM \"HomePageSnapshot\" WHERE \"generationTaskId\"='homepage-success'")" = "1" ]

insert_task homepage-retry
publish homepage-retry
wait_status homepage-retry RETRY_WAIT
[ "$($compose exec -T redis-test redis-cli XPENDING homepage:generation homepage-worker | head -n 1)" -ge "1" ]
$compose exec -T postgres-test psql -U postgres -d homepage_worker_test -c "UPDATE \"HomePageGenerationTask\" SET \"nextAttemptAt\"=NOW() WHERE id='homepage-retry'" >/dev/null
wait_status homepage-retry SUCCEEDED

insert_task homepage-obsolete PERSONALIZED "'old-fingerprint'"
publish homepage-obsolete
wait_status homepage-obsolete CANCELLED

insert_task homepage-delay
publish homepage-delay
wait_status homepage-delay RUNNING 10
$compose kill --signal SIGKILL worker-test
$compose up --detach worker-test
wait_status homepage-delay SUCCEEDED 20
[ "$($compose exec -T postgres-test psql -U postgres -d homepage_worker_test -Atc "SELECT \"fencingToken\" FROM \"HomePageGenerationTask\" WHERE id='homepage-delay'")" -ge "2" ]

insert_task homepage-redis-delay-window
publish homepage-redis-delay-window
wait_status homepage-redis-delay-window RUNNING 10
$compose stop redis-test
wait_status homepage-redis-delay-window SUCCEEDED 10
$compose start redis-test
attempt=0
while [ "$attempt" -lt 10 ]; do
  [ "$($compose exec -T redis-test redis-cli XPENDING homepage:generation homepage-worker | head -n 1)" = "0" ] && break
  attempt=$((attempt + 1)); sleep 1
done
[ "$($compose exec -T redis-test redis-cli XPENDING homepage:generation homepage-worker | head -n 1)" = "0" ]

insert_task homepage-postgres-delay-window
publish homepage-postgres-delay-window
wait_status homepage-postgres-delay-window RUNNING 10
$compose stop postgres-test
sleep 2
$compose start postgres-test
wait_status homepage-postgres-delay-window SUCCEEDED 20

echo "homepage-worker Docker 集成测试通过"
