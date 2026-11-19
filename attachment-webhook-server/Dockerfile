FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Includes app/templates (Jinja UI) and app/static (CSS + Material JS).
COPY app ./app

RUN mkdir -p /data/gmail-attachments && chown -R 1000:1000 /data
USER 1000

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]