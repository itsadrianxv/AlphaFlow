#pragma once

#include <atomic>
#include <cstdint>
#include <thread>

#include "config.hpp"

struct HealthState {
  std::atomic<bool> postgres{false};
  std::atomic<bool> redis{false};
  std::atomic<bool> web{false};
  std::atomic<std::int64_t> tick_ms{0};
};

class HealthServer {
 public:
  HealthServer(const Config& config, const std::atomic<bool>& stopping, const HealthState& state)
      : config_(config), stopping_(stopping), state_(state) {}
  ~HealthServer();

  void start();
  void stop();
  static std::int64_t now_ms();

 private:
  void run();
  bool live() const;
  bool ready() const;

  const Config& config_;
  const std::atomic<bool>& stopping_;
  const HealthState& state_;
  std::thread thread_;
};
