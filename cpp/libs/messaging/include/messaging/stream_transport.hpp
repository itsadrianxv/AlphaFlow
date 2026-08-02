#pragma once

#include <cstddef>
#include <string>
#include <string_view>
#include <vector>
#include <memory>

namespace messaging {

struct StreamMessage {
  std::string message_id;
  std::string event_id;
  std::string run_id;
  std::string created_at;
  std::string schema_version{"1"};
  // 后台 LLM 任务使用这些字段把消息身份与数据库任务绑定起来。
  // 其他 Stream 协议可以继续只填写前五个字段。
  std::string task_type;
  std::string idempotency_key;
  std::string input_hash;
};

class StreamTransport {
 public:
  virtual ~StreamTransport() = default;
  virtual std::unique_ptr<StreamTransport> clone() const = 0;
  virtual void ensure_group() = 0;
  virtual std::vector<StreamMessage> read(std::size_t count) = 0;
  virtual std::vector<StreamMessage> auto_claim(std::size_t count) = 0;
  virtual std::string publish(const StreamMessage&) = 0;
  virtual void ack_delete(std::string_view message_id) = 0;
  virtual bool ping() = 0;
};

}  // namespace messaging
