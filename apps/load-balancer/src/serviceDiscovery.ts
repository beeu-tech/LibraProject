/**
 * 서비스 디스커버리 및 등록
 * 
 * 기능:
 * 1. 서비스 자동 등록/해제
 * 2. 헬스체크 및 상태 관리
 * 3. 로드밸런서와 통신
 */

import { createClient } from 'redis';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';

const logger = createLogger('service-discovery');

interface ServiceConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  type: 'websocket-gateway' | 'voice-processing-cluster';
  healthCheckPath: string;
  healthCheckInterval: number;
}

export class ServiceDiscovery extends EventEmitter {
  private redisClient: ReturnType<typeof createClient>;
  private config: ServiceConfig;
  private registrationInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isRegistered = false;

  constructor(config: ServiceConfig) {
    super();
    this.config = config;
    this.initializeRedis();
  }

  private async initializeRedis(): Promise<void> {
    try {
      this.redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      
      await this.redisClient.connect();
      logger.info('Redis 연결 성공', { serviceId: this.config.id });
      
    } catch (error) {
      logger.error('Redis 초기화 실패', { error, serviceId: this.config.id });
      throw error;
    }
  }

  public async start(): Promise<void> {
    await this.registerService();
    this.startHealthChecks();
    this.startPeriodicRegistration();
    
    logger.info('서비스 디스커버리 시작', { 
      serviceId: this.config.id,
      type: this.config.type,
      host: this.config.host,
      port: this.config.port
    });
  }

  private async registerService(): Promise<void> {
    try {
      const serviceData = {
        id: this.config.id,
        host: this.config.host,
        port: this.config.port,
        type: this.config.type,
        timestamp: new Date()
      };
      
      await this.redisClient.publish('service:register', JSON.stringify(serviceData));
      
      // 서비스 정보를 Redis에 저장 (TTL: 60초)
      await this.redisClient.setEx(
        `service:${this.config.id}`,
        60,
        JSON.stringify(serviceData)
      );
      
      this.isRegistered = true;
      logger.info('서비스 등록 완료', { serviceId: this.config.id });
      
    } catch (error) {
      logger.error('서비스 등록 실패', { error, serviceId: this.config.id });
    }
  }

  private async unregisterService(): Promise<void> {
    try {
      const serviceData = {
        id: this.config.id,
        type: this.config.type,
        timestamp: new Date()
      };
      
      await this.redisClient.publish('service:unregister', JSON.stringify(serviceData));
      await this.redisClient.del(`service:${this.config.id}`);
      
      this.isRegistered = false;
      logger.info('서비스 해제 완료', { serviceId: this.config.id });
      
    } catch (error) {
      logger.error('서비스 해제 실패', { error, serviceId: this.config.id });
    }
  }

  private startPeriodicRegistration(): void {
    // 30초마다 서비스 재등록 (TTL 갱신)
    this.registrationInterval = setInterval(async () => {
      if (this.isRegistered) {
        await this.registerService();
      }
    }, 30000);
  }

  private startHealthChecks(): void {
    // 설정된 간격으로 헬스체크 실행
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  private async performHealthCheck(): Promise<void> {
    try {
      const healthUrl = `http://${this.config.host}:${this.config.port}${this.config.healthCheckPath}`;
      
      const response = await fetch(healthUrl, {
        method: 'GET',
        timeout: 5000
      });
      
      if (response.ok) {
        logger.debug('헬스체크 성공', { 
          serviceId: this.config.id,
          status: response.status
        });
        
        // 헬스체크 성공 시 서비스 재등록
        if (!this.isRegistered) {
          await this.registerService();
        }
        
      } else {
        logger.warn('헬스체크 실패', { 
          serviceId: this.config.id,
          status: response.status
        });
        
        // 헬스체크 실패 시 서비스 해제
        if (this.isRegistered) {
          await this.unregisterService();
        }
      }
      
    } catch (error) {
      logger.error('헬스체크 에러', { 
        serviceId: this.config.id,
        error: error.message
      });
      
      // 헬스체크 에러 시 서비스 해제
      if (this.isRegistered) {
        await this.unregisterService();
      }
    }
  }

  public async stop(): Promise<void> {
    if (this.registrationInterval) {
      clearInterval(this.registrationInterval);
    }
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.isRegistered) {
      await this.unregisterService();
    }
    
    await this.redisClient.quit();
    logger.info('서비스 디스커버리 종료', { serviceId: this.config.id });
  }
}

// 서비스 디스커버리 헬퍼 함수
export function createServiceDiscovery(config: ServiceConfig): ServiceDiscovery {
  return new ServiceDiscovery(config);
}
