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
