# WorkRelay AI 公開デモ（Hugging Face Spaces 用）
# 1. 画面（React）をビルド → 2. Python 環境に API と画面をまとめ、1つのサービスとして起動する

# ---- 1. 画面のビルド
FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 2. 実行環境
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WORKRELAY_PUBLIC=true \
    WORKRELAY_STATIC_DIR=/app/web
# Hugging Face Spaces は UID 1000 のユーザーで動かす
RUN useradd -m -u 1000 user
WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY --chown=user backend/ ./backend/
COPY --from=web --chown=user /web/dist ./web
# デモ用の架空の売上Excelは、ビルド時にスクリプトで作る（毎回同じ数値。バイナリをリポジトリに置かないため）
RUN cd backend && python scripts/make_demo_excel.py \
    && mkdir -p /app/backend/data && chown -R user /app/backend
USER user
WORKDIR /app/backend
EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
