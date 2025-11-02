FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

# 작업 디렉토리
WORKDIR /app

# 시스템 패키지 설치
RUN apt-get update && apt-get install -y \
    python3.11 \
    python3.11-dev \
    python3-pip \
    python3.11-venv \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Python 심볼릭 링크
RUN ln -sf /usr/bin/python3.11 /usr/bin/python && \
    ln -sf /usr/bin/python3.11 /usr/bin/python3 && \
    ln -sf /usr/bin/pip3 /usr/bin/pip

# pip 업그레이드
RUN python -m pip install --upgrade pip

# 의존성 파일 복사
COPY apps/asr-worker/requirements.txt .

# Python 패키지 설치
RUN python -m pip install --no-cache-dir -r requirements.txt

# 소스 코드 복사
COPY apps/asr-worker/app ./app

# 포트 노출
EXPOSE 5005

# 실행
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5005"]

