import { FastifyRequest, FastifyReply } from 'fastify';
import Redis from 'ioredis';
import { createLogger } from '../utils/logger';
import { createHash } from 'crypto';

const logger = createLogger('cache');
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export async function cacheMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    // GET 요청만 캐시 적용
    if (request.method !== 'GET') {
      return;
    }

    // 캐시 키 생성
    const cacheKey = `cache:${request.url}:${JSON.stringify(request.query)}`;
    
    // 캐시에서 조회
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      logger.info(`캐시 히트: ${cacheKey}`);
      return reply
        .header('X-Cache', 'HIT')
        .send(JSON.parse(cached));
    }

    // 캐시 미스 - 응답을 캐시에 저장하도록 플래그 설정
    (request as any).shouldCache = true;
    (request as any).cacheKey = cacheKey;

  } catch (error) {
    logger.error('캐시 미들웨어 오류:', error);
    // 캐시 오류는 무시하고 계속 진행
  }
}

export async function cacheResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: any
) {
  try {
    if (!(request as any).shouldCache) {
      return payload;
    }

    const cacheKey = (request as any).cacheKey;
    const ttl = 300; // 5분 TTL

    await redis.setex(cacheKey, ttl, JSON.stringify(payload));
    logger.info(`캐시 저장: ${cacheKey}`);

    reply.header('X-Cache', 'MISS');

  } catch (error) {
    logger.error('캐시 저장 오류:', error);
  }

  return payload;
}
