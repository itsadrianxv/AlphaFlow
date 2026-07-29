#include <gtest/gtest.h>

#include "python_client.hpp"

TEST(PythonResponseTest, 接受连续排名的合法响应) {
  const auto result = PythonClient::parse_response(
      R"({"executionId":"run-1","status":"SUCCEEDED","asOfDate":"2026-07-29","universeCount":2,"evaluatedCount":2,"selectedCount":1,"rules":[],"results":[{"stockCode":"000001","stockName":"平安银行","rank":1,"selected":true,"evaluationStatus":"FULL","score":10,"maxScore":10,"ruleResults":{}},{"stockCode":"600519","stockName":"贵州茅台","rank":2,"selected":false,"evaluationStatus":"FULL","score":0,"maxScore":10,"ruleResults":{}}],"warnings":[],"diagnostics":{}})",
      "run-1");
  EXPECT_EQ(result.results.size(), 2U);
}

TEST(PythonResponseTest, 拒绝重复股票和断裂排名) {
  EXPECT_THROW(PythonClient::parse_response(
                   R"({"executionId":"run-1","status":"SUCCEEDED","asOfDate":"2026-07-29","universeCount":2,"evaluatedCount":2,"selectedCount":0,"rules":[],"results":[{"stockCode":"000001","stockName":"平安银行","rank":1,"selected":false,"evaluationStatus":"FULL","score":0,"maxScore":10,"ruleResults":{}},{"stockCode":"000001","stockName":"平安银行","rank":3,"selected":false,"evaluationStatus":"FULL","score":0,"maxScore":10,"ruleResults":{}}],"warnings":[],"diagnostics":{}})",
                   "run-1"),
               WorkerError);
}

TEST(PythonResponseTest, HTTP重试分类符合协议) {
  EXPECT_TRUE(PythonClient::retryable_http_status(408));
  EXPECT_TRUE(PythonClient::retryable_http_status(429));
  EXPECT_TRUE(PythonClient::retryable_http_status(503));
  EXPECT_FALSE(PythonClient::retryable_http_status(400));
}

