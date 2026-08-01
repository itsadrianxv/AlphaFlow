#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <thread>

#include "concurrency/blocking_queue.hpp"
#include "concurrency/thread_pool.hpp"

namespace concurrency {

TEST(BlockingQueueTest, CloseDiscardWakesWaitingConsumer) {
  BlockingQueue<int> queue(1);
  queue.push(1);
  queue.close(true);
  EXPECT_FALSE(queue.pop().has_value());
}

TEST(ThreadPoolTest, IsolatesHandlerExceptions) {
  BlockingQueue<int> queue(4);
  std::atomic<int> handled{0};
  ThreadPool<int> pool(2, queue, [&handled](int value) {
    ++handled;
    if (value == 1) throw std::runtime_error("expected");
  });
  pool.start();
  queue.push(1);
  queue.push(2);
  while (handled.load() < 2) std::this_thread::sleep_for(std::chrono::milliseconds(1));
  queue.close();
  pool.join();
  EXPECT_EQ(handled.load(), 2);
}

}  // namespace concurrency
