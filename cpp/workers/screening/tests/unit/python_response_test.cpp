#include <gtest/gtest.h>

#include "python_client.hpp"

TEST(PythonResponseTest, 接受连续排名的合法响应) {
  const auto result = PythonClient::parse_response(
      R"({"runId":"run-1","status":"SUCCEEDED","universeCount":2,"totalCount":2,"results":[{"stockCode":"000001","rank":1},{"stockCode":"600519","rank":2}],"warnings":[],"diagnostics":{}})",
      "run-1");
  EXPECT_EQ(result.results.size(), 2U);
}

TEST(PythonResponseTest, 拒绝重复股票和断裂排名) {
  EXPECT_THROW(PythonClient::parse_response(
                   R"({"runId":"run-1","status":"SUCCEEDED","universeCount":2,"totalCount":2,"results":[{"stockCode":"000001","rank":1},{"stockCode":"000001","rank":3}],"warnings":[],"diagnostics":{}})",
                   "run-1"),
               task_lifecycle::ExecutionError);
}

TEST(PythonResponseTest, HTTP重试分类符合协议) {
  EXPECT_TRUE(PythonClient::retryable_http_status(408));
  EXPECT_TRUE(PythonClient::retryable_http_status(429));
  EXPECT_TRUE(PythonClient::retryable_http_status(503));
  EXPECT_FALSE(PythonClient::retryable_http_status(400));
}
