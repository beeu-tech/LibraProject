FROM node:18

# ffmpeg 설치 (Discord 음성 재생용)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 패키지 파일 복사
COPY package*.json ./
COPY apps/bot/package*.json ./apps/bot/
COPY packages/shared/package*.json ./packages/shared/

# 의존성 설치 (빌드를 위해 dev 의존성도 포함)
RUN npm ci

# 소스 코드 복사
COPY apps/bot/src ./apps/bot/src
COPY apps/bot/tsconfig.json ./apps/bot/

# 빌드 (개별 앱만 빌드)
RUN cd apps/bot && npm run build

# 실행
WORKDIR /app/apps/bot
CMD ["npm", "start"]
