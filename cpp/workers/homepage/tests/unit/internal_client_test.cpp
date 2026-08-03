#include <gtest/gtest.h>
#include "internal_client.hpp"
TEST(HomePageInternalClientTest, 解析生成结果){auto result=InternalClient::parse_response(R"({"kind":"generated","taskId":"task-1","manifestId":"manifest-1","activationSequence":"7","promotionMode":"PROMOTABLE","generationInputContractVersion":"1.0","generatorDefinitionVersion":"1.0","payloadSchemaVersion":"1.0","inputHash":"sha256:input","payloadHash":"sha256:payload","payload":{"heatmap":{}},"dataCoverage":[]})");EXPECT_EQ(result.activation_sequence,7);EXPECT_TRUE(result.payload.is_object());}
TEST(HomePageInternalClientTest, 拒绝无效响应){EXPECT_THROW(InternalClient::parse_response(R"({"payload":[]})"),WorkerError);}
TEST(HomePageInternalClientTest, 识别可重试状态){EXPECT_TRUE(InternalClient::retryable_http_status(502));EXPECT_FALSE(InternalClient::retryable_http_status(409));}
