FROM debian:bookworm-slim AS builder

RUN set -eux; \
  find /etc/apt -type f \( -name '*.sources' -o -name '*.list' \) -print0 \
    | xargs -0 -r sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g'; \
  apt-get update && apt-get install -y --no-install-recommends \
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
COPY cpp/ ./cpp/
RUN cmake -S cpp -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON \
  && cmake --build build --target llm-scheduler llm-scheduler_tests llm_scheduler_repository_contract_tests \
  && ctest --test-dir build -R 'Llm(SchedulerConfig|InternalClient|TaskRepository)' --output-on-failure

FROM debian:bookworm-slim AS runtime

RUN set -eux; \
  find /etc/apt -type f \( -name '*.sources' -o -name '*.list' \) -print0 \
    | xargs -0 -r sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g'; \
  apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libboost-system1.74.0 \
    libcurl4 \
    libhiredis0.14 \
    libpqxx-6.4 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 llm-scheduler

COPY --from=builder /src/build/llm-scheduler /usr/local/bin/llm-scheduler
USER llm-scheduler
EXPOSE 8060
ENTRYPOINT ["/usr/local/bin/llm-scheduler"]
