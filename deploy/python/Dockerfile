ARG PYTHON_VOICE_BASE_IMAGE=stock-screening-boost-python-voice-base:local
FROM ${PYTHON_VOICE_BASE_IMAGE}

COPY python_services/app ./app
COPY temp/-v3/backend/app/utils/indicators_mapping.py ./temp/-v3/backend/app/utils/indicators_mapping.py

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
