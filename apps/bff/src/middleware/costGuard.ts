import { FastifyRequest, FastifyReply } from 'fastify';
import Redis from 'ioredis';
import { createLogger } from '../utils/logger';

const logger = createLogger('costGuard');

// Redis 클라이언트
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// 유저/길드 별 분당 LLM 호출 상한
const LIMIT_PER_MIN = parseInt(process.env.LLM_CALLS_PER_MIN || '20', 10);

export async function costGuard(request: FastifyRequest, reply: FastifyReply) {
  try {
    const body = request.body as any;
    const userId = body?.userId || 'anon';
    const guildId = body?.guildId || 'dm';
    
    // 분 단위 윈도우 키 생성
    const window = Math.floor(Date.now() / 60000);
    const key = `llm:cost:${guildId}:${userId}:${window}`;

    // 현재 카운트 증가
    const current = await redis.incr(key);
    
    // 첫 번째 요청인 경우 TTL 설정 (70초 = 1분 + 10초 버퍼)
    if (current === 1) {
      await redis.expire(key, 70);
    }

    // 제한 초과 확인
    if (current > LIMIT_PER_MIN) {
      logger.warn({
        userId,
        guildId,
        current,
        limit: LIMIT_PER_MIN
      }, 'LLM 비용 가드 제한 초과');
      
      return reply.status(429).send({
        error: 'LLM 호출 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
        statusCode: 429,
        retryAfter: 60,
        current,
        limit: LIMIT_PER_MIN
      });
    }

    // 응답 헤더에 사용량 정보 추가
    reply.header('X-LLM-Usage', `${current}/${LIMIT_PER_MIN}`);
    reply.header('X-LLM-Remaining', Math.max(0, LIMIT_PER_MIN - current));

  } catch (error) {
    logger.error('비용 가드 오류:', error);
    // Redis 오류 시 기본적으로 허용 (서비스 가용성 우선)
  }
}
