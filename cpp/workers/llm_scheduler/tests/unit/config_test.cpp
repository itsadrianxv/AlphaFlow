#include "config.hpp"

#include <gtest/gtest.h>

TEST(LlmSchedulerConfigTest, ParsesPositiveRetryDelays) {
  EXPECT_EQ(parse_retry_delays("10, 30, 90"),
            (std::vector<std::chrono::seconds>{std::chrono::seconds(10), std::chrono::seconds(30),
                                                std::chrono::seconds(90)}));
}

TEST(LlmSchedulerConfigTest, RejectsMalformedRetryDelays) {
  EXPECT_THROW(parse_retry_delays("10,0,90"), std::invalid_argument);
  EXPECT_THROW(parse_retry_delays("10,nope"), std::invalid_argument);
  EXPECT_THROW(parse_retry_delays(""), std::invalid_argument);
}

TEST(LlmSchedulerConfigTest, RejectsHeartbeatNotShorterThanLease) {
  Config config;
  config.lease_seconds = 30;
  config.heartbeat_seconds = 30;
  EXPECT_THROW(validate_config(config), std::invalid_argument);
}

TEST(LlmSchedulerConfigTest, RejectsZeroConcurrencyAndQueueCapacity) {
  Config config;
  config.worker_threads = 0;
  EXPECT_THROW(validate_config(config), std::invalid_argument);
  config.worker_threads = 2;
  config.queue_capacity = 0;
  EXPECT_THROW(validate_config(config), std::invalid_argument);
}
