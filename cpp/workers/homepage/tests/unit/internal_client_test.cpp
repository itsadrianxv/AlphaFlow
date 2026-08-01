#include <gtest/gtest.h>
#include "internal_client.hpp"
TEST(HomePageInternalClientTest, 解析生成结果){auto result=InternalClient::parse_response(R"({"payload":{"heatmap":{}},"dataAsOf":"20260801"})");EXPECT_EQ(result.data_as_of,"20260801");EXPECT_TRUE(result.payload.is_object());}
TEST(HomePageInternalClientTest, 拒绝无效响应){EXPECT_THROW(InternalClient::parse_response(R"({"payload":[]})"),WorkerError);}
TEST(HomePageInternalClientTest, 识别可重试状态){EXPECT_TRUE(InternalClient::retryable_http_status(502));EXPECT_FALSE(InternalClient::retryable_http_status(409));}
