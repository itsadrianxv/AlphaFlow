#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <thread>

#include "thread_pool.hpp"

TEST(ThreadPoolTest, 并发数不超过固定线程数且异常被隔离) {
  BlockingQueue<RunTask> queue(8);
  std::atomic<int> active{0};
  std::atomic<int> maximum{0};
  std::atomic<int> completed{0};
  ThreadPool pool(2, queue, [&](RunTask task) {
    const int current = active.fetch_add(1) + 1;
    maximum.store(std::max(maximum.load(), current));
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
    active.fetch_sub(1);
    completed.fetch_add(1);
    if (task.attempt == 2) throw std::runtime_error("测试异常");
  });
  pool.start();
  for (int attempt = 1; attempt <= 4; ++attempt) {
    RunTask task;
    task.attempt = attempt;
    queue.push(std::move(task));
  }
  queue.close();
  pool.join();
  EXPECT_EQ(completed.load(), 4);
  EXPECT_LE(maximum.load(), 2);
}
