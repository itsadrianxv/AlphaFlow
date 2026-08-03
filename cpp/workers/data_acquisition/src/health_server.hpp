#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <thread>
#include <utility>

#include <boost/asio.hpp>

#include "config.hpp"

struct HealthState {
  std::atomic<std::int64_t> tick_ms{0};
  std::atomic<bool> postgres{false};
  std::atomic<bool> redis{true};
  std::atomic<bool> provider{false};
};

class HealthServer {
 public:
  HealthServer(const Config& config, const std::atomic<bool>& stopping, HealthState& state)
      : config_(config), stopping_(stopping), state_(state) {}
  void start();
  void stop();
  static std::int64_t now_ms();

 private:
  void loop();
  Config config_;
  const std::atomic<bool>& stopping_;
  HealthState& state_;
  std::unique_ptr<boost::asio::io_context> io_;
  std::thread thread_;
};
