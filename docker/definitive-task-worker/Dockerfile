FROM debian:bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    ninja-build \
    pkg-config \
    libboost-system-dev \
    libcurl4-openssl-dev \
    libgtest-dev \
    libhiredis-dev \
    libpqxx-dev \
    nlohmann-json3-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY definitive_task_worker/ ./
RUN cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON \
  && cmake --build build --target definitive-task-worker definitive-task-worker-tests \
  && ctest --test-dir build --output-on-failure

FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libboost-system1.74.0 \
    libcurl4 \
    libhiredis0.14 \
    libpqxx-6.4 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10002 definitive-task-worker

COPY --from=builder /src/build/definitive-task-worker /usr/local/bin/definitive-task-worker
USER definitive-task-worker
EXPOSE 8040
ENTRYPOINT ["/usr/local/bin/definitive-task-worker"]

