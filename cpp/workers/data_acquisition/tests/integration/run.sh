#!/bin/sh
set -eu

compose="docker compose -f docker-compose.yml"
cleanup() {
  code=$?
  if [ "$code" -ne 0 ]; then $compose logs worker-test mock-provider || true; fi
  $compose down --volumes --remove-orphans
  exit "$code"
}
trap cleanup EXIT

insert_attempt() {
  id=$1
  required=${2:-true}
  empty_policy=${3:-REQUIRE_NON_EMPTY}
  $compose exec -T postgres-test psql -U postgres -d acquisition_worker_test -v ON_ERROR_STOP=1 -c "
    INSERT INTO \"HomepageDataManifest\"(id,\"manifestKey\",\"canonicalizationVersion\",scope,\"definitionVersion\",\"targetContextKey\",\"targetContextJson\")
    VALUES ('manifest-$id','manifest-$id','jcs-1','BASELINE','definition-v1','ctx','{}'::jsonb);
    INSERT INTO \"HomepageDataManifestItem\"(id,\"manifestId\",\"itemKey\",\"canonicalizationVersion\",\"datasetKey\",\"factScopeKey\",\"factScopeJson\",\"requirementVersion\",required,\"emptyPolicy\",\"targetDataCutoffKey\",\"targetDataCutoffJson\")
    VALUES ('item-$id','manifest-$id','item-$id','jcs-1','fixture','scope','{\"tradeDate\":\"2026-08-01\"}'::jsonb,'requirements-v1',$required,'$empty_policy','trade_date','{\"key\":\"trade_date\",\"value\":\"2026-08-01\"}'::jsonb);
    INSERT INTO \"HomepageDataManifestItemAttempt\"(id,\"manifestItemId\",\"attemptNo\",\"idempotencyKey\",\"providerKey\",\"providerContractVersion\",\"normalizationRulesVersion\",\"requestFingerprint\")
    VALUES ('$id','item-$id',1,'idem-$id','test','1.0','1.0','sha256:request');
  " >/dev/null
}
publish() {
  $compose exec -T redis-test redis-cli XADD homepage:data-acquisition-test '*' schemaVersion 1 executionId "$1" enqueuedAt 2026-08-01T00:00:00Z >/dev/null
}
status_of() {
  $compose exec -T postgres-test psql -U postgres -d acquisition_worker_test -Atc "SELECT status FROM \"HomepageDataManifestItemAttempt\" WHERE id='$1'"
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

insert_attempt success
publish success
publish success
wait_status success SUCCEEDED
[ "$($compose exec -T postgres-test psql -U postgres -d acquisition_worker_test -Atc "SELECT COUNT(*) FROM \"HomepageDataManifestItemSettlement\" WHERE \"settledAttemptId\"='success'")" = "1" ]

insert_attempt retry-then-success
publish retry-then-success
wait_status retry-then-success RETRY_WAIT
$compose exec -T postgres-test psql -U postgres -d acquisition_worker_test -c "UPDATE \"HomepageDataManifestItemAttempt\" SET \"nextAttemptAt\"=NOW() WHERE id='retry-then-success'" >/dev/null
wait_status retry-then-success SUCCEEDED
[ "$($compose exec -T postgres-test psql -U postgres -d acquisition_worker_test -Atc "SELECT attempts FROM \"HomepageDataManifestItemAttempt\" WHERE id='retry-then-success'")" = "2" ]

insert_attempt terminal-error
publish terminal-error
wait_status terminal-error FAILED
[ "$($compose exec -T postgres-test psql -U postgres -d acquisition_worker_test -Atc "SELECT \"errorClass\" FROM \"HomepageDataManifestItemSettlement\" WHERE \"settledAttemptId\"='terminal-error'")" = "contract_incompatible" ]

insert_attempt delay
publish delay
wait_status delay RUNNING 10
$compose kill --signal SIGKILL worker-test
$compose up --detach worker-test
wait_status delay SUCCEEDED 25
[ "$($compose exec -T postgres-test psql -U postgres -d acquisition_worker_test -Atc "SELECT \"fencingToken\" FROM \"HomepageDataManifestItemAttempt\" WHERE id='delay'")" -ge "2" ]

echo "data-acquisition-worker Docker 集成测试通过"
