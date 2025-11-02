/**
 * 로드밸런서 및 서비스 디스커버리
 * 
 * 기능:
 * 1. WebSocket Gateway 로드밸런싱
 * 2. Voice Processing Cluster 로드밸런싱
 * 3. 서비스 헬스체크 및 자동 복구
 * 4. 트래픽 분산 및 장애 격리
 */

import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import WebSocket from 'ws';
import { createClient } from 'redis';
import * as cron from 'node-cron';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';

const logger = createLogger('load-balancer');

interface ServiceInstance {
  id: string;
  host: string;
  port: number;
  type: 'websocket-gateway' | 'voice-processing-cluster';
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastHealthCheck: Date;
  connections: number;
  load: number; // CPU/Memory 사용률
  responseTime: number; // 평균 응답 시간
}

interface LoadBalancingStrategy {
  name: string;
  selectInstance: (instances: ServiceInstance[]) => ServiceInstance | null;
}

export class LoadBalancer extends EventEmitter {
  private app: express.Application;
  private redisClient: ReturnType<typeof createClient>;
  private services: Map<string, ServiceInstance[]> = new Map();
  private strategies: Map<string, LoadBalancingStrategy> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(port: number = 8000) {
    super();
    
    this.app = express();
    this.app.use(express.json());
    
    this.initializeRedis();
    this.setupLoadBalancingStrategies();
    this.setupRoutes();
    this.startHealthChecks();
    
    logger.info('Load Balancer 초기화 완료', { port });
  }

  private async initializeRedis(): Promise<void> {
    try {
      this.redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      
      await this.redisClient.connect();
      logger.info('Redis 연결 성공');
      
      // 서비스 등록 구독
      await this.redisClient.subscribe('service:register', (message) => {
        this.registerService(JSON.parse(message));
      });
      
      // 서비스 해제 구독
      await this.redisClient.subscribe('service:unregister', (message) => {
        this.unregisterService(JSON.parse(message));
      });
      
    } catch (error) {
      logger.error('Redis 초기화 실패', { error });
      throw error;
    }
  }

  private setupLoadBalancingStrategies(): void {
    // Round Robin 전략
    this.strategies.set('round-robin', {
      name: 'round-robin',
      selectInstance: (instances) => {
        const healthyInstances = instances.filter(i => i.status === 'healthy');
        if (healthyInstances.length === 0) return null;
        
        // 가장 적은 연결 수를 가진 인스턴스 선택
        return healthyInstances.reduce((min, current) => 
          current.connections < min.connections ? current : min
        );
      }
    });

    // Least Connections 전략
    this.strategies.set('least-connections', {
      name: 'least-connections',
      selectInstance: (instances) => {
        const healthyInstances = instances.filter(i => i.status === 'healthy');
        if (healthyInstances.length === 0) return null;
        
        return healthyInstances.reduce((min, current) => 
          current.connections < min.connections ? current : min
        );
      }
    });

    // Weighted Response Time 전략
    this.strategies.set('weighted-response-time', {
      name: 'weighted-response-time',
      selectInstance: (instances) => {
        const healthyInstances = instances.filter(i => i.status === 'healthy');
        if (healthyInstances.length === 0) return null;
        
        // 응답 시간이 가장 빠른 인스턴스 선택
        return healthyInstances.reduce((min, current) => 
          current.responseTime < min.responseTime ? current : min
        );
      }
    });

    logger.info('로드밸런싱 전략 설정 완료', { 
      strategies: Array.from(this.strategies.keys()) 
    });
  }

  private setupRoutes(): void {
    // WebSocket Gateway 프록시
    this.app.use('/ws', (req, res, next) => {
      const instance = this.selectInstance('websocket-gateway', 'least-connections');
      if (!instance) {
        return res.status(503).json({ error: 'No healthy WebSocket Gateway instances available' });
      }
      
      req.headers['x-forwarded-for'] = req.ip;
      req.headers['x-forwarded-proto'] = req.protocol;
      
      const proxy = createProxyMiddleware({
        target: `ws://${instance.host}:${instance.port}`,
        ws: true,
        changeOrigin: true,
        onProxyReq: (proxyReq, req, res) => {
          logger.info('WebSocket 프록시 요청', { 
            target: `${instance.host}:${instance.port}`,
            client: req.ip
          });
        },
        onError: (err, req, res) => {
          logger.error('WebSocket 프록시 에러', { error: err.message });
          res.status(502).json({ error: 'Gateway error' });
        }
      });
      
      proxy(req, res, next);
    });

    // Voice Processing Cluster 프록시
    this.app.use('/api/voice', (req, res, next) => {
      const instance = this.selectInstance('voice-processing-cluster', 'round-robin');
      if (!instance) {
        return res.status(503).json({ error: 'No healthy Voice Processing instances available' });
      }
      
      const proxy = createProxyMiddleware({
        target: `http://${instance.host}:${instance.port}`,
        changeOrigin: true,
        onProxyReq: (proxyReq, req, res) => {
          logger.info('Voice Processing 프록시 요청', { 
            target: `${instance.host}:${instance.port}`,
            path: req.path
          });
        },
        onError: (err, req, res) => {
          logger.error('Voice Processing 프록시 에러', { error: err.message });
          res.status(502).json({ error: 'Processing service error' });
        }
      });
      
      proxy(req, res, next);
    });

    // 헬스체크 엔드포인트
    this.app.get('/health', (req, res) => {
      const stats = this.getServiceStats();
      res.json({
        status: 'healthy',
        timestamp: new Date(),
        services: stats
      });
    });

    // 서비스 상태 조회
    this.app.get('/services', (req, res) => {
      const services = Object.fromEntries(this.services);
      res.json({ services });
    });

    // 로드밸런싱 통계
    this.app.get('/stats', (req, res) => {
      const stats = this.getLoadBalancingStats();
      res.json(stats);
    });
  }

  private selectInstance(serviceType: string, strategy: string): ServiceInstance | null {
    const instances = this.services.get(serviceType) || [];
    const strategyImpl = this.strategies.get(strategy);
    
    if (!strategyImpl) {
      logger.error('알 수 없는 로드밸런싱 전략', { strategy });
      return null;
    }
    
    const selected = strategyImpl.selectInstance(instances);
    
    if (selected) {
      // 연결 수 증가
      selected.connections++;
      logger.debug('인스턴스 선택', { 
        serviceType, 
        strategy, 
        instance: `${selected.host}:${selected.port}`,
        connections: selected.connections
      });
    }
    
    return selected;
  }

  private registerService(serviceData: any): void {
    const { id, host, port, type } = serviceData;
    
    const instance: ServiceInstance = {
      id,
      host,
      port,
      type,
      status: 'unknown',
      lastHealthCheck: new Date(),
      connections: 0,
      load: 0,
      responseTime: 0
    };
    
    if (!this.services.has(type)) {
      this.services.set(type, []);
    }
    
    const instances = this.services.get(type)!;
    const existingIndex = instances.findIndex(i => i.id === id);
    
    if (existingIndex >= 0) {
      instances[existingIndex] = instance;
    } else {
      instances.push(instance);
    }
    
    logger.info('서비스 등록', { 
      id, 
      type, 
      host, 
      port,
      totalInstances: instances.length
    });
    
    this.emit('serviceRegistered', instance);
  }

  private unregisterService(serviceData: any): void {
    const { id, type } = serviceData;
    
    const instances = this.services.get(type);
    if (instances) {
      const index = instances.findIndex(i => i.id === id);
      if (index >= 0) {
        const removed = instances.splice(index, 1)[0];
        logger.info('서비스 해제', { 
          id, 
          type,
          remainingInstances: instances.length
        });
        this.emit('serviceUnregistered', removed);
      }
    }
  }

  private startHealthChecks(): void {
    // 30초마다 헬스체크 실행
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, 30000);
    
    logger.info('헬스체크 시작', { interval: '30초' });
  }

  private async performHealthChecks(): Promise<void> {
    const allInstances = Array.from(this.services.values()).flat();
    
    for (const instance of allInstances) {
      try {
        const startTime = Date.now();
        
        // HTTP 헬스체크
        const response = await fetch(`http://${instance.host}:${instance.port}/health`, {
          method: 'GET',
          timeout: 5000
        });
        
        const responseTime = Date.now() - startTime;
        
        if (response.ok) {
          instance.status = 'healthy';
          instance.responseTime = responseTime;
          instance.lastHealthCheck = new Date();
          
          logger.debug('헬스체크 성공', { 
            instance: `${instance.host}:${instance.port}`,
            responseTime
          });
        } else {
          instance.status = 'unhealthy';
          logger.warn('헬스체크 실패', { 
            instance: `${instance.host}:${instance.port}`,
            status: response.status
          });
        }
        
      } catch (error) {
        instance.status = 'unhealthy';
        logger.error('헬스체크 에러', { 
          instance: `${instance.host}:${instance.port}`,
          error: error.message
        });
      }
    }
  }

  private getServiceStats(): any {
    const stats: any = {};
    
    for (const [serviceType, instances] of this.services) {
      const healthy = instances.filter(i => i.status === 'healthy').length;
      const unhealthy = instances.filter(i => i.status === 'unhealthy').length;
      const totalConnections = instances.reduce((sum, i) => sum + i.connections, 0);
      const avgResponseTime = instances.reduce((sum, i) => sum + i.responseTime, 0) / instances.length || 0;
      
      stats[serviceType] = {
        total: instances.length,
        healthy,
        unhealthy,
        totalConnections,
        avgResponseTime: Math.round(avgResponseTime)
      };
    }
    
    return stats;
  }

  private getLoadBalancingStats(): any {
    return {
      strategies: Array.from(this.strategies.keys()),
      services: this.getServiceStats(),
      uptime: process.uptime(),
      timestamp: new Date()
    };
  }

  public async start(): Promise<void> {
    this.app.listen(8000, () => {
      logger.info('Load Balancer HTTP 서버 시작', { port: 8000 });
    });
    
    logger.info('Load Balancer 시작 완료');
  }

  public async stop(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    await this.redisClient.quit();
    logger.info('Load Balancer 종료');
  }
}

// 서버 시작
if (require.main === module) {
  const loadBalancer = new LoadBalancer();
  loadBalancer.start().catch(console.error);
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    await loadBalancer.stop();
    process.exit(0);
  });
}
