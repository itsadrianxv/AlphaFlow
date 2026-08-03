#include "provider_client.hpp"

#include <gtest/gtest.h>

TEST(ProviderClientTest, 只解析外层版本信封) {
  auto result = ProviderClient::parse_response(
      R"({"contractVersion":"1.0","datasetKey":"fixture","providerKey":"test","resultStatus":"success","qualityStatus":"normal","coverage":{"requestedScope":{},"coveredScope":{},"missingScope":{}},"observations":[{"supplierField":"opaque"}],"sourceAssertions":[],"resultHash":"sha256:abc"})");
  EXPECT_EQ(result.result_status, "success");
  EXPECT_EQ(result.result_hash, "sha256:abc");
  EXPECT_TRUE(result.envelope["observations"][0].contains("supplierField"));
}

TEST(ProviderClientTest, 拒绝不兼容主版本和未知状态) {
  EXPECT_THROW(ProviderClient::parse_response(R"({"contractVersion":"2.0","resultStatus":"success"})"),
               WorkerError);
  EXPECT_THROW(ProviderClient::parse_response(R"({"contractVersion":"1.0","resultStatus":"weird"})"),
               WorkerError);
}

TEST(ProviderClientTest, 错误信封按统一重试分类) {
  auto retryable = ProviderClient::parse_response(
      R"({"contractVersion":"1.0","resultStatus":"error","qualityStatus":"isolated","errors":[{"errorClass":"timeout","retryability":"retryable","message":"超时"}]})");
  EXPECT_EQ(retryable.result_status, "error");
  auto http = ProviderClient::classify_http_failure(429, R"({"code":"rate_limited","message":"限流","retryable":true})");
  EXPECT_TRUE(std::holds_alternative<task_lifecycle::RetryableFailure>(http));
  EXPECT_TRUE(ProviderClient::retryable_http_status(502));
  EXPECT_FALSE(ProviderClient::retryable_http_status(400));
}
