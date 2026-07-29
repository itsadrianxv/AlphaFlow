#include <gtest/gtest.h>

#include "retry_coordinator.hpp"

TEST(RetryCoordinatorTest, 退避序列为十秒三十秒九十秒) {
  EXPECT_EQ(RetryCoordinator::delay_for_attempt(1), 10);
  EXPECT_EQ(RetryCoordinator::delay_for_attempt(2), 30);
  EXPECT_EQ(RetryCoordinator::delay_for_attempt(3), 90);
  EXPECT_EQ(RetryCoordinator::delay_for_attempt(4), 90);
}
