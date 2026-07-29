#pragma once

#include <cstddef>
#include <memory>
#include <string>
#include <vector>

#include <hiredis/hiredis.h>

#include "config.hpp"
#include "types.hpp"

class RedisStream {
 public:
  explicit RedisStream(const Config& config);
  ~RedisStream();

  RedisStream(const RedisStream&) = delete;
  RedisStream& operator=(const RedisStream&) = delete;

  void ensure_group();
  std::vector<StreamMessage> read(std::size_t count);
  std::vector<StreamMessage> auto_claim(std::size_t count);
  std::string publish(const StreamMessage& message);
  void ack_delete(const std::string& message_id);
  bool ping();

  static StreamMessage parse_message(const std::string& message_id, const redisReply& fields);

 private:
  using ReplyPtr = std::unique_ptr<redisReply, decltype(&freeReplyObject)>;

  void connect();
  ReplyPtr command(const char* format, ...);
  std::vector<StreamMessage> parse_entries(const redisReply& entries);

  const Config& config_;
  redisContext* context_{nullptr};
  std::string claim_cursor_{"0-0"};
};

