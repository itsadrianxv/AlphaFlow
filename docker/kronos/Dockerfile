FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY python_services/requirements.txt ./requirements.txt
COPY python_services/requirements-kronos.txt ./requirements-kronos.txt
RUN pip install --default-timeout=1200 --no-cache-dir -r requirements.txt \
  && pip install --default-timeout=1200 --no-cache-dir -r requirements-kronos.txt

EXPOSE 8010

CMD ["uvicorn", "kronos_service.app:app", "--host", "0.0.0.0", "--port", "8010", "--reload", "--reload-dir", "/app/kronos_service"]
