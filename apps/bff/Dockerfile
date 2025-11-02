FROM node:18-alpine

WORKDIR /app

# 패키지 파일 복사
COPY package*.json ./
COPY apps/bff/package*.json ./apps/bff/
COPY packages/shared/package*.json ./packages/shared/

# 의존성 설치 (빌드를 위해 dev 의존성도 포함)
RUN npm ci

# 소스 코드 복사
COPY apps/bff/src ./apps/bff/src
COPY apps/bff/tsconfig.json ./apps/bff/

# 빌드 (개별 앱만 빌드)
RUN cd apps/bff && npm run build

# 실행
WORKDIR /app/apps/bff
CMD ["npm", "start"]
