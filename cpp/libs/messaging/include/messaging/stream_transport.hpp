#pragma once

#include <cstddef>
#include <string>
#include <string_view>
#include <vector>
#include <memory>

#include "task_runtime/types.hpp"

namespace messaging {

class StreamTransport {
 public:
  virtual ~StreamTransport() = default;
  virtual std::unique_ptr<StreamTransport> clone() const = 0;
  virtual void ensure_group() = 0;
  virtual std::vector<task_runtime::StreamMessage> read(std::size_t count) = 0;
  virtual std::vector<task_runtime::StreamMessage> auto_claim(std::size_t count) = 0;
  virtual std::string publish(const task_runtime::StreamMessage&) = 0;
  virtual void ack_delete(std::string_view message_id) = 0;
  virtual bool ping() = 0;
};

}  // namespace messaging
