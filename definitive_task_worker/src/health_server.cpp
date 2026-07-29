#include "health_server.hpp"

#include <utility>
#include <boost/asio.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>

#include <chrono>
#include <algorithm>
#include <iostream>
#include <thread>

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace http = beast::http;
using tcp = asio::ip::tcp;

HealthServer::~HealthServer() { stop(); }

std::int64_t HealthServer::now_ms() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

bool HealthServer::live() const {
  const auto now = now_ms();
  const auto threshold = std::max(15000, config_.heartbeat_seconds * 3000);
  return !stopping_.load() && now - state_.main_loop_ms.load() < threshold &&
         now - state_.reader_ms.load() < std::max(threshold, config_.stream_block_ms * 3) &&
         now - state_.heartbeat_ms.load() < threshold && now - state_.pool_ms.load() < threshold;
}

bool HealthServer::ready() const {
  return live() && state_.postgres.load() && state_.redis.load() && state_.python.load();
}

void HealthServer::start() {
  if (!thread_.joinable()) thread_ = std::thread([this] { run(); });
}

void HealthServer::stop() {
  if (thread_.joinable()) thread_.join();
}

void HealthServer::run() {
  try {
    asio::io_context context;
    tcp::acceptor acceptor(context, tcp::endpoint(tcp::v4(), static_cast<unsigned short>(config_.health_port)));
    acceptor.non_blocking(true);
    while (!stopping_.load()) {
      beast::error_code error;
      tcp::socket socket(context);
      acceptor.accept(socket, error);
      if (error == asio::error::would_block || error == asio::error::try_again) {
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        continue;
      }
      if (error) continue;
      beast::flat_buffer buffer;
      http::request<http::string_body> request;
      http::read(socket, buffer, request, error);
      if (error) continue;
      const bool known = request.target() == "/health/live" || request.target() == "/health/ready";
      const bool healthy = request.target() == "/health/live" ? live() : request.target() == "/health/ready" && ready();
      http::response<http::string_body> response{known ? (healthy ? http::status::ok : http::status::service_unavailable)
                                                     : http::status::not_found,
                                                  request.version()};
      response.set(http::field::content_type, "application/json; charset=utf-8");
      response.keep_alive(false);
      response.body() = healthy ? R"({"status":"ok"})" : R"({"status":"unavailable"})";
      response.prepare_payload();
      http::write(socket, response, error);
      socket.shutdown(tcp::socket::shutdown_send, error);
    }
  } catch (const std::exception& error) {
    std::cerr << "健康服务退出: " << error.what() << '\n';
  }
}

