/**
 * Gateway Service - 실시간 음성 대화 오케스트레이션
 * 
 * Flow: Discord Voice → ASR → LLM → TTS → Discord Voice
 */

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { config } from 'dotenv';
import { createLogger } from './utils/logger';
import { voiceRoutes } from './routes/voice';
import { healthRoutes } from './routes/health';

// 환경변수 로드
config();

const logger = createLogger('gateway');
const port = parseInt(process.env.GATEWAY_PORT || '8001');

// Fastify 서버 생성
const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  },
  // 큰 오디오 파일 처리
  bodyLimit: 50 * 1024 * 1024, // 50MB
});

// 플러그인 등록
async function registerPlugins() {
  // CORS
  await server.register(require('@fastify/cors'), {
    origin: true,
    credentials: true,
  });

  // Multipart (파일 업로드)
  await server.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  });

  // Raw binary body 파서 (모든 오디오 타입 + octet-stream)
  server.addContentTypeParser(
    ['audio/wav', 'audio/opus', 'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/*', 'application/octet-stream'],
    async (req: any, payload: any) => {
      const chunks: Buffer[] = [];
      for await (const chunk of payload) {
        // chunk가 Buffer가 아닌 경우 Buffer로 변환
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else if (typeof chunk === 'number') {
          chunks.push(Buffer.from([chunk]));
        } else if (chunk instanceof Uint8Array) {
          chunks.push(Buffer.from(chunk));
        } else {
          chunks.push(Buffer.from(chunk));
        }
      }
      return Buffer.concat(chunks);
    }
  );
}

// 라우트 등록
async function registerRoutes() {
  // 헬스체크
  await server.register(healthRoutes, { prefix: '/api' });
  
  // 음성 처리
  await server.register(voiceRoutes, { prefix: '/api/voice' });
}

// 에러 핸들러
server.setErrorHandler(async (error, request, reply) => {
  logger.error('서버 오류 발생!', {
    message: error.message,
    name: error.name,
    stack: error.stack,
    statusCode: error.statusCode,
    url: request.url,
    method: request.method
  });
  
  // 콘솔에도 출력 (로그가 안 보일 경우 대비)
  console.error('=== GATEWAY ERROR ===');
  console.error('Message:', error.message);
  console.error('Stack:', error.stack);
  console.error('=====================');
  
  const statusCode = error.statusCode || 500;
  const message = statusCode === 500 ? '내부 서버 오류' : error.message;
  
  reply.status(statusCode).send({
    error: message,
    statusCode,
    timestamp: new Date().toISOString(),
  });
});

// 서버 시작
async function start() {
  try {
    console.log('[DEBUG] 플러그인 등록 시작...');
    await registerPlugins();
    console.log('[DEBUG] 플러그인 등록 완료');
    
    console.log('[DEBUG] 라우트 등록 시작...');
    await registerRoutes();
    console.log('[DEBUG] 라우트 등록 완료');
    
    console.log(`[DEBUG] 서버 listen 시작 (포트 ${port})...`);
    await server.listen({ port, host: '0.0.0.0' });
    logger.info(`Gateway 서버가 포트 ${port}에서 시작되었습니다.`);
    
    // 서비스 연결 확인
    console.log('[DEBUG] 서비스 확인 시작...');
    await checkServices();
    console.log('[DEBUG] 서버 시작 완료!');
    
  } catch (error) {
    console.error('[ERROR] 서버 시작 실패:');
    console.error(error);
    if (error instanceof Error) {
      console.error('메시지:', error.message);
      console.error('스택:', error.stack);
    }
    logger.error('서버 시작 실패:', error);
    process.exit(1);
  }
}

// 외부 서비스 연결 확인
async function checkServices() {
  const asrProvider = process.env.ASR_PROVIDER || 'local';
  const llmProvider = process.env.LLM_PROVIDER || 'ollama';
  
  // 로컬 서비스 모드인 경우에만 헬스체크
  if (asrProvider === 'local' || llmProvider === 'ollama') {
    const services = [];
    
    if (asrProvider === 'local') {
      services.push({ name: 'ASR', url: process.env.ASR_URL || 'http://asr:5005' });
    }
    
    if (llmProvider === 'ollama') {
      services.push({ name: 'LLM', url: process.env.LLM_URL || 'http://llm:11434' });
    }
    
    for (const service of services) {
      try {
        const response = await fetch(`${service.url}/health`, { 
          signal: AbortSignal.timeout(3000) 
        }).catch(() => null);
        
        if (response?.ok) {
          logger.info(`${service.name} 로컬 서비스 연결됨: ${service.url}`);
        } else {
          logger.warn(`${service.name} 로컬 서비스 미연결: ${service.url}`);
        }
      } catch (error) {
        logger.warn(`${service.name} 서비스 확인 실패 (정상 - 외부 API 사용 중)`);
      }
    }
  } else {
    // 외부 API 모드
    logger.info('외부 API 모드로 실행 중:');
    logger.info(`  - ASR: ${asrProvider === 'external' ? process.env.ASR_EXTERNAL_URL : 'N/A'}`);
    logger.info(`  - LLM: ${llmProvider === 'openai' ? process.env.LLM_BASE_URL : 'N/A'}`);
    logger.info(`  - TTS: ${process.env.TTS_PROVIDER || 'cloudflare'}`);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('서버 종료 중...');
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('서버 종료 중...');
  await server.close();
  process.exit(0);
});

start();

