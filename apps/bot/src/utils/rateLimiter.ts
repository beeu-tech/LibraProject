import Redis from 'ioredis';
import { createLogger } from './logger';

const logger = createLogger('rateLimiter');

export class RateLimiter {
  private redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }

  /**
   * 레이트리밋 확인
   * @param userId 사용자 ID
   * @param guildId 길드 ID (DM의 경우 'dm')
   * @param limit 분당 요청 제한 (기본값: 10)
   * @param window 시간 윈도우 (초, 기본값: 60)
   */
  async checkLimit(
    userId: string, 
    guildId: string, 
    limit: number = 10, 
    window: number = 60
  ): Promise<boolean> {
    try {
      const key = `rate_limit:${guildId}:${userId}`;
      const current = await this.redis.incr(key);
      
      if (current === 1) {
        await this.redis.expire(key, window);
      }
      
      const allowed = current <= limit;
      
      if (!allowed) {
        logger.warn(`레이트리밋 초과: ${userId} in ${guildId} (${current}/${limit})`);
      }
      
      return allowed;
    } catch (error) {
      logger.error('레이트리밋 확인 중 오류:', error);
      // Redis 오류 시 기본적으로 허용
      return true;
    }
  }

  /**
   * 사용자별 쿨다운 설정
   * @param userId 사용자 ID
   * @param guildId 길드 ID
   * @param cooldownSeconds 쿨다운 시간 (초)
   */
  async setCooldown(
    userId: string, 
    guildId: string, 
    cooldownSeconds: number = 5
  ): Promise<void> {
    try {
      const key = `cooldown:${guildId}:${userId}`;
      await this.redis.setex(key, cooldownSeconds, '1');
    } catch (error) {
      logger.error('쿨다운 설정 중 오류:', error);
    }
  }

  /**
   * 쿨다운 확인
   * @param userId 사용자 ID
   * @param guildId 길드 ID
   */
  async isOnCooldown(userId: string, guildId: string): Promise<boolean> {
    try {
      const key = `cooldown:${guildId}:${userId}`;
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error('쿨다운 확인 중 오류:', error);
      return false;
    }
  }
}
