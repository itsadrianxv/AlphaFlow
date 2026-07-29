#include "redis_stream.hpp"

#include <cstdarg>
#include <iostream>
#include <stdexcept>
#include <unordered_map>

namespace {
std::string reply_string(const redisReply* reply) {
  return reply && reply->str ? std::string(reply->str, reply->len) : std::string();
}
}  // namespace

RedisStream::RedisStream(const Config& config) : config_(config) { connect(); }

RedisStream::~RedisStream() {
  if (context_) redisFree(context_);
}

void RedisStream::connect() {
  if (context_) redisFree(context_);
  context_ = redisConnect(config_.redis.host.c_str(), config_.redis.port);
  if (!context_ || context_->err) {
    const std::string message = context_ ? context_->errstr : "无法创建 Redis 连接";
    throw std::runtime_error(message);
  }
  if (!config_.redis.password.empty()) {
    auto reply = command("AUTH %s", config_.redis.password.c_str());
    if (reply->type == REDIS_REPLY_ERROR) throw std::runtime_error(reply_string(reply.get()));
  }
  if (config_.redis.database != 0) {
    auto reply = command("SELECT %d", config_.redis.database);
    if (reply->type == REDIS_REPLY_ERROR) throw std::runtime_error(reply_string(reply.get()));
  }
}

RedisStream::ReplyPtr RedisStream::command(const char* format, ...) {
  va_list arguments;
  va_start(arguments, format);
  auto* raw = static_cast<redisReply*>(redisvCommand(context_, format, arguments));
  va_end(arguments);
  if (!raw) {
    const std::string message = context_ ? context_->errstr : "Redis 命令失败";
    throw std::runtime_error(message);
  }
  return ReplyPtr(raw, &freeReplyObject);
}

void RedisStream::ensure_group() {
  auto reply = command("XGROUP CREATE %s %s 0 MKSTREAM", config_.stream.c_str(), config_.group.c_str());
  if (reply->type == REDIS_REPLY_ERROR && reply_string(reply.get()).find("BUSYGROUP") == std::string::npos) {
    throw std::runtime_error(reply_string(reply.get()));
  }
}

StreamMessage RedisStream::parse_message(const std::string& message_id, const redisReply& fields) {
  if (fields.type != REDIS_REPLY_ARRAY || fields.elements % 2 != 0) {
    throw WorkerError("INVALID_STREAM_MESSAGE", "Stream 消息字段不是键值数组", false);
  }
  std::unordered_map<std::string, std::string> values;
  for (std::size_t index = 0; index < fields.elements; index += 2) {
    values.emplace(reply_string(fields.element[index]), reply_string(fields.element[index + 1]));
  }
  StreamMessage message{message_id, values["executionId"], values["enqueuedAt"], values["schemaVersion"]};
  if (message.schema_version != "1" || message.run_id.empty() || message.created_at.empty()) {
    throw WorkerError("INVALID_STREAM_MESSAGE", "Stream 消息缺少字段或 schemaVersion 不受支持", false);
  }
  return message;
}

std::vector<StreamMessage> RedisStream::parse_entries(const redisReply& entries) {
  std::vector<StreamMessage> result;
  if (entries.type != REDIS_REPLY_ARRAY) return result;
  result.reserve(entries.elements);
  for (std::size_t index = 0; index < entries.elements; ++index) {
    const auto* entry = entries.element[index];
    if (!entry || entry->type != REDIS_REPLY_ARRAY || entry->elements != 2) continue;
    const auto message_id = reply_string(entry->element[0]);
    try {
      result.push_back(parse_message(message_id, *entry->element[1]));
    } catch (const WorkerError& error) {
      std::cerr << "丢弃非法 Stream 消息 " << message_id << ": " << error.what() << '\n';
      ack_delete(message_id);
    }
  }
  return result;
}

std::vector<StreamMessage> RedisStream::read(std::size_t count) {
  auto reply = command("XREADGROUP GROUP %s %s COUNT %d BLOCK %d STREAMS %s >", config_.group.c_str(),
                       config_.consumer.c_str(), static_cast<int>(count), config_.stream_block_ms, config_.stream.c_str());
  if (reply->type == REDIS_REPLY_NIL) return {};
  if (reply->type == REDIS_REPLY_ERROR) throw std::runtime_error(reply_string(reply.get()));
  if (reply->type != REDIS_REPLY_ARRAY || reply->elements == 0) return {};
  const auto* stream = reply->element[0];
  if (!stream || stream->type != REDIS_REPLY_ARRAY || stream->elements != 2) return {};
  return parse_entries(*stream->element[1]);
}

std::vector<StreamMessage> RedisStream::auto_claim(std::size_t count) {
  auto reply = command("XAUTOCLAIM %s %s %s %d %s COUNT %d", config_.stream.c_str(), config_.group.c_str(),
                       config_.consumer.c_str(), config_.claim_idle_ms, claim_cursor_.c_str(), static_cast<int>(count));
  if (reply->type == REDIS_REPLY_ERROR) throw std::runtime_error(reply_string(reply.get()));
  if (reply->type != REDIS_REPLY_ARRAY || reply->elements < 2) return {};
  claim_cursor_ = reply_string(reply->element[0]);
  return parse_entries(*reply->element[1]);
}

std::string RedisStream::publish(const StreamMessage& message) {
  auto reply = command("XADD %s * schemaVersion %s executionId %s enqueuedAt %s", config_.stream.c_str(),
                       message.schema_version.c_str(), message.run_id.c_str(), message.created_at.c_str());
  if (reply->type == REDIS_REPLY_ERROR) throw std::runtime_error(reply_string(reply.get()));
  return reply_string(reply.get());
}

void RedisStream::ack_delete(const std::string& message_id) {
  auto ack = command("XACK %s %s %s", config_.stream.c_str(), config_.group.c_str(), message_id.c_str());
  if (ack->type == REDIS_REPLY_ERROR) throw std::runtime_error(reply_string(ack.get()));
  auto remove = command("XDEL %s %s", config_.stream.c_str(), message_id.c_str());
  if (remove->type == REDIS_REPLY_ERROR) throw std::runtime_error(reply_string(remove.get()));
}

bool RedisStream::ping() {
  try {
    auto reply = command("PING");
    return reply->type == REDIS_REPLY_STATUS && reply_string(reply.get()) == "PONG";
  } catch (...) {
    return false;
  }
}

