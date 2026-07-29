#include <curl/curl.h>

#include <atomic>
#include <csignal>
#include <exception>
#include <iostream>
#include <thread>

#include "config.hpp"
#include "worker_runtime.hpp"

namespace {
std::atomic<bool> signal_received{false};
void handle_signal(int) { signal_received.store(true); }
}  // namespace

int main() {
  std::signal(SIGTERM, handle_signal);
  std::signal(SIGINT, handle_signal);
  curl_global_init(CURL_GLOBAL_DEFAULT);
  try {
    WorkerRuntime runtime(Config::from_environment());
    std::thread signal_watcher([&runtime] {
      while (!signal_received.load() && !runtime.stopping()) std::this_thread::sleep_for(std::chrono::milliseconds(100));
      if (signal_received.load()) runtime.request_stop();
    });
    runtime.run();
    signal_watcher.join();
  } catch (const std::exception& error) {
    std::cerr << "screening-worker 启动失败: " << error.what() << '\n';
    curl_global_cleanup();
    return 1;
  }
  curl_global_cleanup();
  return 0;
}
