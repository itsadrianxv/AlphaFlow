#include "health_server.hpp"

#include <chrono>
#include <sstream>

using boost::asio::ip::tcp;

std::int64_t HealthServer::now_ms() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::system_clock::now().time_since_epoch())
      .count();
}

void HealthServer::start() {
  io_ = std::make_unique<boost::asio::io_context>();
  thread_ = std::thread([this] { loop(); });
}

void HealthServer::stop() {
  if (io_) io_->stop();
  if (thread_.joinable()) thread_.join();
}

void HealthServer::loop() {
  tcp::acceptor acceptor(*io_, tcp::endpoint(tcp::v4(), config_.health_port));
  while (!stopping_.load()) {
    boost::system::error_code error;
    tcp::socket socket(*io_);
    acceptor.accept(socket, error);
    if (error) continue;
    boost::asio::streambuf buffer;
    boost::asio::read_until(socket, buffer, "\r\n\r\n", error);
    const bool ready = state_.postgres.load() && state_.redis.load() && state_.provider.load();
    const std::string body = ready ? R"({"status":"ready"})" : R"({"status":"not_ready"})";
    std::ostringstream response;
    response << "HTTP/1.1 " << (ready ? "200 OK" : "503 Service Unavailable") << "\r\n"
             << "Content-Type: application/json\r\nContent-Length: " << body.size()
             << "\r\nConnection: close\r\n\r\n"
             << body;
    boost::asio::write(socket, boost::asio::buffer(response.str()), error);
  }
}
