#pragma once
#include <utility>
#include <vector>
#include "config.hpp"
#include "types.hpp"
class HomePageRepository {
 public:
  explicit HomePageRepository(const Config& config):config_(config){}
  ClaimResult claim(const StreamMessage&) const;
  std::vector<std::pair<std::string,std::int64_t>> heartbeat(const std::vector<std::pair<std::string,std::int64_t>>&) const;
  bool schedule_retry(const RunTask&,const WorkerError&,int) const;
  bool mark_failed(const RunTask&,const WorkerError&) const;
  void commit_result(const RunTask&,const HomePageGenerationResult&) const;
  bool ping() const;
 private: const Config& config_;
};
