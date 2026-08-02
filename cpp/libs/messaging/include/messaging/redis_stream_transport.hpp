#pragma once

#include <cstddef>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include <hiredis/hiredis.h>

#include "messaging/stream_transport.hpp"

namespace messaging {

struct RedisStreamSettings {
  std::string host;
  int port{6379};
  int database{0};
  std::string password;
  std::string stream;
  std::string group;
  std::string consumer;
  int block_ms{5000};
  int claim_idle_ms{120000};
  bool screening_protocol{false};
  bool llm_protocol{false};
};

class RedisStreamTransport final : public StreamTransport {
 public:
  explicit RedisStreamTransport(RedisStreamSettings settings);
  ~RedisStreamTransport() override;
  RedisStreamTransport(const RedisStreamTransport&) = delete;
  RedisStreamTransport& operator=(const RedisStreamTransport&) = delete;

  std::unique_ptr<StreamTransport> clone() const override;
  void ensure_group() override;
  std::vector<StreamMessage> read(std::size_t count) override;
  std::vector<StreamMessage> auto_claim(std::size_t count) override;
  std::string publish(const StreamMessage& message) override;
  void ack_delete(std::string_view message_id) override;
  bool ping() override;

 private:
  using ReplyPtr = std::unique_ptr<redisReply, decltype(&freeReplyObject)>;
  void connect();
  ReplyPtr command(const char* format, ...);
  std::vector<StreamMessage> parse_entries(const redisReply& entries);
  static std::string reply_string(const redisReply* reply);
  StreamMessage parse_message(const std::string& id, const redisReply& fields) const;

  RedisStreamSettings settings_;
  redisContext* context_{nullptr};
  std::string claim_cursor_{"0-0"};
};

}  // namespace messaging
