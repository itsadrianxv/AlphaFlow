#include "internal_client.hpp"

#include <gtest/gtest.h>

namespace {

LlmTask task() {
  LlmTask value;
  value.message.message_id = "9-0";
  value.message.run_id = "llm-task-1";
  value.message.task_type = "EVENT_ADJUDICATION";
  value.message.idempotency_key = "event-1:input-1";
  value.message.input_hash = "sha256:input-1";
  value.input.task_type = value.message.task_type;
  value.input.idempotency_key = value.message.idempotency_key;
  value.input.input_hash = value.message.input_hash;
  value.input.payload = nlohmann::json{{"candidateClusterId", "cluster-1"}};
  value.attempt = 2;
  value.fencing_token = 7;
  return value;
}

TEST(LlmInternalClientTest, ParsesAndVerifiesIdempotentCompletedResponse) {
  const auto parsed = InternalClient::parse_response(
      R"({"status":"COMPLETED","taskId":"llm-task-1","taskType":"EVENT_ADJUDICATION","idempotencyKey":"event-1:input-1","inputHash":"sha256:input-1","result":{"decision":"HOLD"},"metadata":{"model":"deepseek-v4-flash"}})",
      task());

  EXPECT_EQ(parsed.task_id, "llm-task-1");
  EXPECT_EQ(parsed.idempotency_key, "event-1:input-1");
  EXPECT_EQ(parsed.input_hash, "sha256:input-1");
  EXPECT_EQ(parsed.result.at("decision"), "HOLD");
  EXPECT_EQ(parsed.metadata.at("model"), "deepseek-v4-flash");
}

TEST(LlmInternalClientTest, RejectsMismatchedInputHashAsTerminalContractFailure) {
  EXPECT_THROW(
      InternalClient::parse_response(
          R"({"status":"COMPLETED","taskId":"llm-task-1","taskType":"EVENT_ADJUDICATION","idempotencyKey":"event-1:input-1","inputHash":"sha256:other","result":{}})",
          task()),
      WorkerError);
}

TEST(LlmInternalClientTest, ClassifiesHttpFailuresByRetryability) {
  const auto retry = InternalClient::classify_http_failure(503, R"({"code":"UPSTREAM_BUSY","message":"busy"})");
  ASSERT_TRUE(std::holds_alternative<task_lifecycle::RetryableFailure>(retry));
  EXPECT_EQ(std::get<task_lifecycle::RetryableFailure>(retry).failure.code, "UPSTREAM_BUSY");

  const auto terminal = InternalClient::classify_http_failure(422, R"({"code":"INVALID_EVIDENCE","message":"rejected","retryable":false})");
  ASSERT_TRUE(std::holds_alternative<task_lifecycle::TerminalFailure>(terminal));
  EXPECT_EQ(std::get<task_lifecycle::TerminalFailure>(terminal).failure.code, "INVALID_EVIDENCE");

  const auto obsolete = InternalClient::classify_http_failure(409, R"({"code":"TASK_OBSOLETE","obsolete":true})");
  EXPECT_TRUE(std::holds_alternative<task_lifecycle::Obsolete>(obsolete));
}

TEST(LlmInternalClientTest, BuildsSmallRequestEnvelopeWithoutRepeatingEvidencePayload) {
  const auto body = InternalClient::request_payload(task()).dump();
  const auto json = nlohmann::json::parse(body);
  EXPECT_EQ(json.at("schemaVersion"), 1);
  EXPECT_EQ(json.at("taskId"), "llm-task-1");
  EXPECT_EQ(json.at("taskType"), "EVENT_ADJUDICATION");
  EXPECT_EQ(json.at("idempotencyKey"), "event-1:input-1");
  EXPECT_EQ(json.at("inputHash"), "sha256:input-1");
  EXPECT_EQ(json.at("attempt"), 2);
  EXPECT_FALSE(json.contains("candidateClusterId"));
}

}  // namespace
