FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple

ARG INSTALL_REFCHECKER=false

RUN set -eux; \
  find /etc/apt -type f \( -name '*.sources' -o -name '*.list' \) -print0 \
    | xargs -0 -r sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g'; \
  apt-get update; \
  apt-get install -y --no-install-recommends libidn12; \
  ln -sf /usr/lib/x86_64-linux-gnu/libidn.so.12 /usr/lib/x86_64-linux-gnu/libidn.so.11; \
  rm -rf /var/lib/apt/lists/*

COPY python_services/requirements.txt ./requirements.txt
COPY python_services/requirements-refchecker.txt ./requirements-refchecker.txt
COPY docker/python/vendor ./vendor
RUN pip install --default-timeout=1200 --no-cache-dir -r requirements.txt \
  && case "${INSTALL_REFCHECKER}" in \
    1|true|TRUE|yes|YES|on|ON) \
      echo "Installing optional RefChecker dependencies."; \
      pip install --default-timeout=1200 --no-cache-dir -r requirements-refchecker.txt; \
      ;; \
    *) \
      echo "Skipping optional RefChecker dependencies."; \
      ;; \
    esac \
  && found=0 \
  && for pkg in vendor/*.whl vendor/*.tar.gz vendor/*.zip; do \
    if [ -f "$pkg" ]; then \
      echo "Installing vendor Python package: $pkg"; \
      pip install --default-timeout=1200 --no-cache-dir "$pkg"; \
      found=1; \
    fi; \
  done \
  && if [ "$found" -eq 0 ]; then \
    echo "No vendor Python package provided."; \
  fi \
  && rm -rf vendor requirements-refchecker.txt

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "/app/app"]
