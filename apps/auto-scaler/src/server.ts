/**
 * 자동 스케일링 시스템
 * 
 * 기능:
 * 1. 메트릭 기반 자동 스케일링
 * 2. Docker 컨테이너 관리
 * 3. 리소스 사용률 모니터링
 * 4. 스케일링 정책 관리
 */

import { createClient } from 'redis';
import Docker from 'dockerode';
import * as cron from 'node-cron';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';

const logger = createLogger('auto-scaler');

interface ScalingPolicy {
  service: string;
  minInstances: number;
  maxInstances: number;
  targetCpuPercent: number;
  targetMemoryPercent: number;
  targetQueueLength: number;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  cooldownPeriod: number; // 초
}

interface ServiceInstance {
  id: string;
  service: string;
  containerId: string;
  status: 'running' | 'stopped' | 'starting' | 'stopping';
  cpuUsage: number;
  memoryUsage: number;
  queueLength: number;
  lastScaling: Date;
}

export class AutoScaler extends EventEmitter {
  private redisClient: ReturnType<typeof createClient>;
  private docker: Docker;
  private policies: Map<string, ScalingPolicy> = new Map();
  private instances: Map<string, ServiceInstance[]> = new Map();
  private scalingHistory: Map<string, Date> = new Map();
  private scalingInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    
    this.docker = new Docker();
    this.initializeRedis();
    this.setupDefaultPolicies();
    this.startScalingLoop();
    
    logger.info('Auto Scaler 초기화 완료');
  }

  private async initializeRedis(): Promise<void> {
    try {
      this.redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      
      await this.redisClient.connect();
      logger.info('Redis 연결 성공');
      
      // 메트릭 구독
      await this.redisClient.subscribe('metrics:*', (channel, message) => {
        this.handleMetricUpdate(channel, message);
      });
      
    } catch (error) {
      logger.error('Redis 초기화 실패', { error });
      throw error;
    }
  }

  private setupDefaultPolicies(): void {
    // WebSocket Gateway 스케일링 정책
    this.policies.set('websocket-gateway', {
      service: 'websocket-gateway',
      minInstances: 2,
      maxInstances: 10,
      targetCpuPercent: 70,
      targetMemoryPercent: 80,
      targetQueueLength: 50,
      scaleUpThreshold: 80,
      scaleDownThreshold: 30,
      cooldownPeriod: 60
    });

    // Voice Processing Cluster 스케일링 정책
    this.policies.set('voice-processing-cluster', {
      service: 'voice-processing-cluster',
      minInstances: 3,
      maxInstances: 20,
      targetCpuPercent: 75,
      targetMemoryPercent: 85,
      targetQueueLength: 100,
      scaleUpThreshold: 85,
      scaleDownThreshold: 25,
      cooldownPeriod: 120
    });

    logger.info('기본 스케일링 정책 설정 완료', { 
      services: Array.from(this.policies.keys()) 
    });
  }

  private startScalingLoop(): void {
    // 30초마다 스케일링 체크
    this.scalingInterval = setInterval(async () => {
      await this.performScalingCheck();
    }, 30000);
    
    logger.info('스케일링 루프 시작', { interval: '30초' });
  }

  private async performScalingCheck(): Promise<void> {
    for (const [serviceName, policy] of this.policies) {
      try {
        await this.checkServiceScaling(serviceName, policy);
      } catch (error) {
        logger.error('스케일링 체크 실패', { service: serviceName, error });
      }
    }
  }

  private async checkServiceScaling(serviceName: string, policy: ScalingPolicy): Promise<void> {
    const instances = await this.getServiceInstances(serviceName);
    const metrics = await this.getServiceMetrics(serviceName);
    
    if (!metrics) {
      logger.warn('서비스 메트릭 없음', { service: serviceName });
      return;
    }

    const currentInstances = instances.length;
    const avgCpuUsage = metrics.cpuUsage;
    const avgMemoryUsage = metrics.memoryUsage;
    const queueLength = metrics.queueLength;

    logger.debug('스케일링 체크', {
      service: serviceName,
      instances: currentInstances,
      cpuUsage: avgCpuUsage,
      memoryUsage: avgMemoryUsage,
      queueLength
    });

    // 스케일 업 조건 체크
    if (this.shouldScaleUp(serviceName, policy, avgCpuUsage, avgMemoryUsage, queueLength, currentInstances)) {
      await this.scaleUp(serviceName, policy);
    }
    // 스케일 다운 조건 체크
    else if (this.shouldScaleDown(serviceName, policy, avgCpuUsage, avgMemoryUsage, queueLength, currentInstances)) {
      await this.scaleDown(serviceName, policy);
    }
  }

  private shouldScaleUp(serviceName: string, policy: ScalingPolicy, cpuUsage: number, memoryUsage: number, queueLength: number, currentInstances: number): boolean {
    // 최대 인스턴스 수 체크
    if (currentInstances >= policy.maxInstances) {
      return false;
    }

    // 쿨다운 기간 체크
    if (this.isInCooldown(serviceName)) {
      return false;
    }

    // 스케일 업 조건
    const cpuThreshold = cpuUsage > policy.scaleUpThreshold;
    const memoryThreshold = memoryUsage > policy.scaleUpThreshold;
    const queueThreshold = queueLength > policy.targetQueueLength;

    return cpuThreshold || memoryThreshold || queueThreshold;
  }

  private shouldScaleDown(serviceName: string, policy: ScalingPolicy, cpuUsage: number, memoryUsage: number, queueLength: number, currentInstances: number): boolean {
    // 최소 인스턴스 수 체크
    if (currentInstances <= policy.minInstances) {
      return false;
    }

    // 쿨다운 기간 체크
    if (this.isInCooldown(serviceName)) {
      return false;
    }

    // 스케일 다운 조건
    const cpuThreshold = cpuUsage < policy.scaleDownThreshold;
    const memoryThreshold = memoryUsage < policy.scaleDownThreshold;
    const queueThreshold = queueLength < policy.targetQueueLength * 0.5;

    return cpuThreshold && memoryThreshold && queueThreshold;
  }

  private isInCooldown(serviceName: string): boolean {
    const lastScaling = this.scalingHistory.get(serviceName);
    if (!lastScaling) return false;

    const policy = this.policies.get(serviceName);
    if (!policy) return false;

    const cooldownMs = policy.cooldownPeriod * 1000;
    return Date.now() - lastScaling.getTime() < cooldownMs;
  }

  private async scaleUp(serviceName: string, policy: ScalingPolicy): Promise<void> {
    try {
      logger.info('스케일 업 시작', { service: serviceName });
      
      // 새 인스턴스 시작
      const container = await this.startServiceInstance(serviceName);
      
      if (container) {
        this.scalingHistory.set(serviceName, new Date());
        
        logger.info('스케일 업 완료', { 
          service: serviceName,
          containerId: container.id.substring(0, 12)
        });
        
        this.emit('scaledUp', { service: serviceName, containerId: container.id });
      }
      
    } catch (error) {
      logger.error('스케일 업 실패', { service: serviceName, error });
    }
  }

  private async scaleDown(serviceName: string, policy: ScalingPolicy): Promise<void> {
    try {
      logger.info('스케일 다운 시작', { service: serviceName });
      
      // 가장 오래된 인스턴스 중지
      const instances = await this.getServiceInstances(serviceName);
      if (instances.length > 0) {
        const oldestInstance = instances[0]; // 가장 오래된 인스턴스
        
        await this.stopServiceInstance(oldestInstance.containerId);
        
        this.scalingHistory.set(serviceName, new Date());
        
        logger.info('스케일 다운 완료', { 
          service: serviceName,
          containerId: oldestInstance.containerId.substring(0, 12)
        });
        
        this.emit('scaledDown', { 
          service: serviceName, 
          containerId: oldestInstance.containerId 
        });
      }
      
    } catch (error) {
      logger.error('스케일 다운 실패', { service: serviceName, error });
    }
  }

  private async startServiceInstance(serviceName: string): Promise<any> {
    try {
      const containerName = `${serviceName}-${Date.now()}`;
      
      const container = await this.docker.createContainer({
        Image: `discordbeeubot-${serviceName}:latest`,
        name: containerName,
        Env: [
          `SERVICE_NAME=${serviceName}`,
          `SERVICE_ID=${containerName}`,
          'REDIS_URL=redis://redis:6379'
        ],
        HostConfig: {
          NetworkMode: 'discordbeeubot_default'
        }
      });
      
      await container.start();
      
      // 서비스 등록
      await this.registerServiceInstance(serviceName, container.id);
      
      return container;
      
    } catch (error) {
      logger.error('서비스 인스턴스 시작 실패', { service: serviceName, error });
      throw error;
    }
  }

  private async stopServiceInstance(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      
      // 서비스 해제
      await this.unregisterServiceInstance(containerId);
      
      // 컨테이너 중지 및 제거
      await container.stop();
      await container.remove();
      
    } catch (error) {
      logger.error('서비스 인스턴스 중지 실패', { containerId, error });
      throw error;
    }
  }

  private async registerServiceInstance(serviceName: string, containerId: string): Promise<void> {
    const serviceData = {
      id: containerId,
      service: serviceName,
      containerId,
      status: 'running',
      timestamp: new Date()
    };
    
    await this.redisClient.publish('service:register', JSON.stringify(serviceData));
  }

  private async unregisterServiceInstance(containerId: string): Promise<void> {
    const serviceData = {
      id: containerId,
      timestamp: new Date()
    };
    
    await this.redisClient.publish('service:unregister', JSON.stringify(serviceData));
  }

  private async getServiceInstances(serviceName: string): Promise<ServiceInstance[]> {
    // Redis에서 서비스 인스턴스 조회
    const keys = await this.redisClient.keys(`service:${serviceName}:*`);
    const instances = [];
    
    for (const key of keys) {
      const data = await this.redisClient.get(key);
      if (data) {
        instances.push(JSON.parse(data));
      }
    }
    
    return instances;
  }

  private async getServiceMetrics(serviceName: string): Promise<any> {
    // Redis에서 서비스 메트릭 조회
    const metricsData = await this.redisClient.get(`metrics:${serviceName}`);
    return metricsData ? JSON.parse(metricsData) : null;
  }

  private handleMetricUpdate(channel: string, message: string): void {
    try {
      const data = JSON.parse(message);
      const metricType = channel.split(':')[1];
      
      if (metricType === 'resource') {
        this.updateServiceMetrics(data);
      }
      
    } catch (error) {
      logger.error('메트릭 업데이트 처리 실패', { channel, error });
    }
  }

  private async updateServiceMetrics(data: any): Promise<void> {
    const { service, cpu, memory, queueLength } = data;
    
    const metrics = {
      service,
      cpuUsage: cpu,
      memoryUsage: memory,
      queueLength,
      timestamp: new Date()
    };
    
    await this.redisClient.setEx(
      `metrics:${service}`,
      60,
      JSON.stringify(metrics)
    );
  }

  public async start(): Promise<void> {
    logger.info('Auto Scaler 시작');
  }

  public async stop(): Promise<void> {
    if (this.scalingInterval) {
      clearInterval(this.scalingInterval);
    }
    
    await this.redisClient.quit();
    logger.info('Auto Scaler 종료');
  }
}

// 서버 시작
if (require.main === module) {
  const autoScaler = new AutoScaler();
  autoScaler.start().catch(console.error);
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    await autoScaler.stop();
    process.exit(0);
  });
}
