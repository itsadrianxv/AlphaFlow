FROM python:3.11-slim

WORKDIR /app

ENV PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY python_services/requirements.txt ./requirements.txt
COPY python_services/requirements-kronos.txt ./requirements-kronos.txt
RUN pip install --default-timeout=1200 --no-cache-dir -r requirements.txt \
  && python -c "import shutil, urllib.request; url='https://download-r2.pytorch.org/whl/cpu/torch-2.6.0%2Bcpu-cp311-cp311-linux_x86_64.whl'; request=urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'}); source=urllib.request.urlopen(request, timeout=1200); target=open('/tmp/torch-2.6.0+cpu-cp311-cp311-linux_x86_64.whl', 'wb'); shutil.copyfileobj(source, target); target.close(); source.close()" \
  && pip install --default-timeout=1200 --no-cache-dir \
    --index-url https://mirrors.aliyun.com/pypi/simple \
    '/tmp/torch-2.6.0+cpu-cp311-cp311-linux_x86_64.whl' \
  && rm -f '/tmp/torch-2.6.0+cpu-cp311-cp311-linux_x86_64.whl' \
  && pip install --default-timeout=1200 --no-cache-dir -r requirements-kronos.txt

EXPOSE 8010

CMD ["uvicorn", "kronos_service.app:app", "--host", "0.0.0.0", "--port", "8010", "--reload", "--reload-dir", "/app/kronos_service"]
