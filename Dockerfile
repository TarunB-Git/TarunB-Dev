FROM python:3.13.7-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORTFOLIO_DATA_DIR=/data \
    PORTFOLIO_DB_PATH=/data/site.db \
    PORTFOLIO_UPLOAD_DIR=/data/uploads \
    PORTFOLIO_BACKUP_DIR=/data/backups \
    PORTFOLIO_SECURE_COOKIES=true

WORKDIR /app
RUN groupadd --system portfolio && useradd --system --gid portfolio --home /app portfolio
COPY server/requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r /app/server/requirements.txt
COPY --chown=portfolio:portfolio . /app
RUN mkdir -p /data/uploads /data/backups && chown -R portfolio:portfolio /data

USER portfolio
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/readyz' % os.environ.get('PORT','8000'), timeout=3)"
CMD ["sh", "-c", "exec python -m uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
