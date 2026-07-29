#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <thread>

#include "blocking_queue.hpp"

TEST(BlockingQueueTest, 满载时阻塞并在弹出后唤醒) {
  BlockingQueue<int> queue(1);
  ASSERT_TRUE(queue.push(1));
  std::atomic<bool> pushed{false};
  std::thread producer([&] { pushed.store(queue.push(2)); });
  std::this_thread::sleep_for(std::chrono::milliseconds(30));
  EXPECT_FALSE(pushed.load());
  EXPECT_EQ(queue.pop(), 1);
  producer.join();
  EXPECT_TRUE(pushed.load());
  EXPECT_EQ(queue.pop(), 2);
}

TEST(BlockingQueueTest, 普通关闭会排空已有任务) {
  BlockingQueue<int> queue(2);
  queue.push(1);
  queue.close();
  EXPECT_EQ(queue.pop(), 1);
  EXPECT_FALSE(queue.pop().has_value());
  EXPECT_FALSE(queue.push(2));
}

TEST(BlockingQueueTest, 停机关闭可丢弃尚未启动任务) {
  BlockingQueue<int> queue(2);
  queue.push(1);
  queue.close(true);
  EXPECT_FALSE(queue.pop().has_value());
}
