#pragma once
#include <utility>
#include <vector>
#include "config.hpp"
#include "types.hpp"
class HomePageRepository {
 public:
  explicit HomePageRepository(const Config& config):config_(config){}
  HomePageClaimResult claim(const task_lifecycle::StreamMessage&) const;
  std::vector<task_lifecycle::Lease> renew(const std::vector<task_lifecycle::Lease>&) const;
  void settle(const HomePageTask&,HomePageSettlement) const;
  bool ping() const;
 private: const Config& config_;
};
