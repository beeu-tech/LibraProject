FROM node:18-alpine

# ffmpeg 설치 (Opus → WAV 변환용)
RUN apk add --no-cache ffmpeg

WORKDIR /app

# 패키지 파일 복사
COPY package*.json ./
COPY apps/gateway/package*.json ./apps/gateway/

# 의존성 설치
RUN npm ci

# 소스 코드 복사
COPY apps/gateway/src ./apps/gateway/src
COPY apps/gateway/tsconfig.json ./apps/gateway/

# 빌드
RUN cd apps/gateway && npm run build

# 실행
WORKDIR /app/apps/gateway
CMD ["npm", "start"]

