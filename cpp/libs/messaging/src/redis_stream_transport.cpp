#include "messaging/redis_stream_transport.hpp"

#include <cstdarg>
#include <iostream>
#include <stdexcept>
#include <unordered_map>

namespace messaging {

std::string RedisStreamTransport::reply_string(const redisReply* reply) {
  return reply && reply->str ? std::string(reply->str, reply->len) : std::string();
}

RedisStreamTransport::RedisStreamTransport(RedisStreamSettings settings) : settings_(std::move(settings)) { connect(); }
RedisStreamTransport::~RedisStreamTransport() { if (context_) redisFree(context_); }
std::unique_ptr<StreamTransport> RedisStreamTransport::clone() const { return std::make_unique<RedisStreamTransport>(settings_); }

void RedisStreamTransport::connect() {
  if (context_) redisFree(context_);
  const timeval timeout{1, 0};
  context_ = redisConnectWithTimeout(settings_.host.c_str(), settings_.port, timeout);
  if (!context_ || context_->err) throw std::runtime_error(context_ ? context_->errstr : "无法创建 Redis 连接");
  if (!settings_.password.empty()) {
    auto reply = command("AUTH %s", settings_.password.c_str());
    if (reply->type == REDIS_REPLY_ERROR) throw std::runtime_error(reply_string(reply.get()));
  }
  if (settings_.database != 0) {
    auto reply = command("SELECT %d", settings_.database);
    if (reply->type == REDIS_REPLY_ERROR) throw std::runtime_error(reply_string(reply.get()));
  }
}

RedisStreamTransport::ReplyPtr RedisStreamTransport::command(const char* format, ...) {
  va_list args;
  va_start(args, format);
  va_list retry_args;
  va_copy(retry_args, args);
  auto* raw = static_cast<redisReply*>(redisvCommand(context_, format, args));
  va_end(args);
  if (!raw) {
    try {
      connect();
      raw = static_cast<redisReply*>(redisvCommand(context_, format, retry_args));
    } catch (...) {
      va_end(retry_args);
      throw;
    }
  }
  va_end(retry_args);
  if (!raw) throw std::runtime_error(context_ ? context_->errstr : "Redis 命令失败");
  return ReplyPtr(raw, &freeReplyObject);
}

void RedisStreamTransport::ensure_group() {
  auto reply = command("XGROUP CREATE %s %s 0 MKSTREAM", settings_.stream.c_str(), settings_.group.c_str());
  if (reply->type == REDIS_REPLY_ERROR && reply_string(reply.get()).find("BUSYGROUP") == std::string::npos) throw std::runtime_error(reply_string(reply.get()));
}

StreamMessage RedisStreamTransport::parse_message(const std::string& id, const redisReply& fields) const {
  if (fields.type != REDIS_REPLY_ARRAY || fields.elements % 2 != 0) throw std::runtime_error("Stream 消息字段不是键值数组");
  std::unordered_map<std::string, std::string> values;
  for (std::size_t i = 0; i < fields.elements; i += 2) values.emplace(reply_string(fields.element[i]), reply_string(fields.element[i + 1]));
  StreamMessage message;
  message.message_id = id;
  if (settings_.screening_protocol) {
    message.event_id = values["eventId"];
    message.run_id = values["runId"];
    message.created_at = values["createdAt"];
  } else if (settings_.llm_protocol) {
    message.run_id = values["taskId"];
    message.task_type = values["taskType"];
    message.idempotency_key = values["idempotencyKey"];
    message.input_hash = values["inputHash"];
    message.created_at = values["createdAt"];
  } else {
    message.run_id = values["executionId"];
    message.created_at = values["enqueuedAt"];
  }
  message.schema_version = values["schemaVersion"];
  if (message.schema_version != "1" || message.run_id.empty() || message.created_at.empty() ||
      (settings_.screening_protocol && message.event_id.empty()) ||
      (settings_.llm_protocol &&
       (message.task_type.empty() || message.idempotency_key.empty() || message.input_hash.empty()))) {
    throw std::runtime_error("Stream 消息缺少字段或 schemaVersion 不受支持");
  }
  return message;
}

std::vector<StreamMessage> RedisStreamTransport::parse_entries(const redisReply& entries) {
  std::vector<StreamMessage> result;
  if (entries.type != REDIS_REPLY_ARRAY) return result;
  for (std::size_t i = 0; i < entries.elements; ++i) {
    const auto* entry = entries.element[i];
    if (!entry || entry->type != REDIS_REPLY_ARRAY || entry->elements != 2) continue;
    const auto id = reply_string(entry->element[0]);
    try { result.push_back(parse_message(id, *entry->element[1])); }
    catch (const std::runtime_error& error) { std::cerr << "丢弃非法 Stream 消息 " << id << ": " << error.what() << '\n'; ack_delete(id); }
  }
  return result;
}

std::vector<StreamMessage> RedisStreamTransport::read(std::size_t count) {
  auto reply = command("XREADGROUP GROUP %s %s COUNT %d BLOCK %d STREAMS %s >", settings_.group.c_str(), settings_.consumer.c_str(), static_cast<int>(count), settings_.block_ms, settings_.stream.c_str());
  if (reply->type == REDIS_REPLY_NIL) return {};
  if (reply->type == REDIS_REPLY_ERROR) throw std::runtime_error(reply_string(reply.get()));
  if (reply->type != REDIS_REPLY_ARRAY || reply->elements == 0) return {};
  const auto* stream = reply->element[0];
  if (!stream || stream->type != REDIS_REPLY_ARRAY || stream->elements != 2) return {};
  return parse_entries(*stream->element[1]);
}

std::vector<StreamMessage> RedisStreamTransport::auto_claim(std::size_t count) {
  auto reply = command("XAUTOCLAIM %s %s %s %d %s COUNT %d", settings_.stream.c_str(), settings_.group.c_str(), settings_.consumer.c_str(), settings_.claim_idle_ms, claim_cursor_.c_str(), static_cast<int>(count));
  if (reply->type == REDIS_REPLY_ERROR) throw std::runtime_error(reply_string(reply.get()));
  if (reply->type != REDIS_REPLY_ARRAY || reply->elements < 2) return {};
  claim_cursor_ = reply_string(reply->element[0]);
  return parse_entries(*reply->element[1]);
}

std::string RedisStreamTransport::publish(const StreamMessage& message) {
  ReplyPtr reply(nullptr, &freeReplyObject);
  if (settings_.screening_protocol) reply = command("XADD %s * schemaVersion %s eventId %s runId %s createdAt %s", settings_.stream.c_str(), message.schema_version.c_str(), message.event_id.c_str(), message.run_id.c_str(), message.created_at.c_str());
  else if (settings_.llm_protocol) reply = command("XADD %s * schemaVersion %s taskId %s taskType %s idempotencyKey %s inputHash %s createdAt %s", settings_.stream.c_str(), message.schema_version.c_str(), message.run_id.c_str(), message.task_type.c_str(), message.idempotency_key.c_str(), message.input_hash.c_str(), message.created_at.c_str());
  else reply = command("XADD %s * schemaVersion %s executionId %s enqueuedAt %s", settings_.stream.c_str(), message.schema_version.c_str(), message.run_id.c_str(), message.created_at.c_str());
  if (reply->type == REDIS_REPLY_ERROR) throw std::runtime_error(reply_string(reply.get()));
  return reply_string(reply.get());
}

void RedisStreamTransport::ack_delete(std::string_view id) {
  auto ack = command("XACK %s %s %s", settings_.stream.c_str(), settings_.group.c_str(), std::string(id).c_str());
  if (ack->type == REDIS_REPLY_ERROR) throw std::runtime_error(reply_string(ack.get()));
  auto remove = command("XDEL %s %s", settings_.stream.c_str(), std::string(id).c_str());
  if (remove->type == REDIS_REPLY_ERROR) throw std::runtime_error(reply_string(remove.get()));
}

bool RedisStreamTransport::ping() {
  try { auto reply = command("PING"); return reply->type == REDIS_REPLY_STATUS && reply_string(reply.get()) == "PONG"; }
  catch (...) { return false; }
}

}  // namespace messaging
