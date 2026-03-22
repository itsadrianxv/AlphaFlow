FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

ARG INSTALL_REFCHECKER=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends libidn12 \
  && ln -sf /usr/lib/x86_64-linux-gnu/libidn.so.12 /usr/lib/x86_64-linux-gnu/libidn.so.11 \
  && rm -rf /var/lib/apt/lists/*

COPY python_services/requirements.txt ./requirements.txt
COPY python_services/requirements-refchecker.txt ./requirements-refchecker.txt
COPY deploy/python/vendor ./vendor
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
  && site_packages="$(python -c 'import site; print(site.getsitepackages()[0])')" \
  && found=0 \
  && for pkg in vendor/*.whl vendor/*.tar.gz vendor/*.zip; do \
    if [ -f "$pkg" ]; then \
      echo "Installing vendor Python package: $pkg"; \
      pip install --default-timeout=1200 --no-cache-dir "$pkg"; \
      found=1; \
    fi; \
  done \
  && if [ -f vendor/iFinDPy.py ]; then \
    echo "Installing vendored iFinDPy.py into ${site_packages}"; \
    cp vendor/iFinDPy.py "${site_packages}/iFinDPy.py"; \
    found=1; \
  fi \
  && if [ -d vendor/iFinDAPI ]; then \
    echo "Installing vendored iFinDAPI package tree into ${site_packages}"; \
    rm -rf "${site_packages}/iFinDAPI"; \
    cp -R vendor/iFinDAPI "${site_packages}/iFinDAPI"; \
    find "${site_packages}/iFinDAPI/Linux/bin64" -maxdepth 1 -name '*.so' -exec ln -sf {} /usr/local/lib/ \; ; \
    ldconfig; \
    found=1; \
  fi \
  && if [ "$found" -eq 0 ]; then \
    echo "No vendor iFinD package provided; continuing without iFinDPy."; \
  fi \
  && python -c "import importlib.util; print('iFinDPy spec:', importlib.util.find_spec('iFinDPy'))" \
  && rm -rf vendor requirements-refchecker.txt

COPY python_services/app ./app
COPY python_services/scripts ./scripts
COPY temp/-v3/backend/app/utils/indicators_mapping.py ./temp/-v3/backend/app/utils/indicators_mapping.py

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
