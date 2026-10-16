# EPICS PV Plotter - backend gateway (FastAPI + caproto)
#
# Built from the repo root:
#   docker build -f docker/backend.Dockerfile -t epics-pv-backend .

FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY epics_fastapi_gateway.py ./
COPY routers ./routers

EXPOSE 8000

CMD ["python", "epics_fastapi_gateway.py"]
