cmake_minimum_required(VERSION 3.20)
project(definitive_task_worker VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
option(ENABLE_TSAN "使用 ThreadSanitizer 构建" OFF)

if(ENABLE_TSAN)
  add_compile_options(-fsanitize=thread -fno-omit-frame-pointer)
  add_link_options(-fsanitize=thread)
endif()

find_package(Boost REQUIRED COMPONENTS system)
find_package(CURL REQUIRED)
find_package(nlohmann_json REQUIRED)
find_package(PkgConfig REQUIRED)
pkg_check_modules(PQXX REQUIRED libpqxx)
pkg_check_modules(HIREDIS REQUIRED hiredis)

add_library(definitive_task_worker_core
  src/config.cpp
  src/thread_pool.cpp
  src/redis_stream.cpp
  src/definitive_task_repository.cpp
  src/python_client.cpp
  src/retry_coordinator.cpp
  src/health_server.cpp
  src/worker_runtime.cpp
)
target_include_directories(definitive_task_worker_core PUBLIC src ${PQXX_INCLUDE_DIRS} ${HIREDIS_INCLUDE_DIRS})
target_link_libraries(definitive_task_worker_core PUBLIC Boost::system CURL::libcurl nlohmann_json::nlohmann_json ${PQXX_LIBRARIES} ${HIREDIS_LIBRARIES})
target_compile_options(definitive_task_worker_core PRIVATE -Wall -Wextra -Wpedantic)

add_executable(definitive-task-worker src/main.cpp)
target_link_libraries(definitive-task-worker PRIVATE definitive_task_worker_core)

include(CTest)
if(BUILD_TESTING)
  find_package(GTest REQUIRED)
  add_executable(definitive-task-worker-tests
    tests/unit/blocking_queue_test.cpp
    tests/unit/config_test.cpp
    tests/unit/python_response_test.cpp
    tests/unit/thread_pool_test.cpp
    tests/unit/retry_coordinator_test.cpp
  )
  target_link_libraries(definitive-task-worker-tests PRIVATE definitive_task_worker_core GTest::gtest_main)
  include(GoogleTest)
  gtest_discover_tests(definitive-task-worker-tests DISCOVERY_MODE PRE_TEST)
endif()

