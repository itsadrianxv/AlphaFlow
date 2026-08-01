#include <gtest/gtest.h>

#include "config.hpp"

TEST(ConfigTest, 解析带密码和数据库编号的Redis地址) {
  const auto endpoint = parse_redis_url("redis://:secret@cache:6380/3");
  EXPECT_EQ(endpoint.host, "cache");
  EXPECT_EQ(endpoint.port, 6380);
  EXPECT_EQ(endpoint.password, "secret");
  EXPECT_EQ(endpoint.database, 3);
}

TEST(ConfigTest, 拒绝非Redis协议) {
  EXPECT_THROW(parse_redis_url("http://localhost:6379"), std::runtime_error);
}

