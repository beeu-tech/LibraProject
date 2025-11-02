/**
 * 모니터링 및 메트릭 수집 시스템
 * 
 * 기능:
 * 1. Prometheus 메트릭 수집
 * 2. 실시간 성능 모니터링
 * 3. 알림 및 경고 시스템
 * 4. 대시보드 API 제공
 */

import express from 'express';
import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import { createClient } from 'redis';
import * as cron from 'node-cron';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';

const logger = createLogger('monitoring');

// Prometheus 메트릭 정의
const voiceRequestsTotal = new Counter({
  name: 'voice_requests_total',
  help: 'Total number of voice processing requests',
  labelNames: ['service', 'status', 'type']
});

const voiceRequestDuration = new Histogram({
  name: 'voice_request_duration_seconds',
  help: 'Duration of voice processing requests in seconds',
  labelNames: ['service', 'type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10]
});

const activeConnections = new Gauge({
  name: 'active_connections',
  help: 'Number of active WebSocket connections',
  labelNames: ['service']
});

const serviceHealth = new Gauge({
  name: 'service_health',
  help: 'Service health status (1 = healthy, 0 = unhealthy)',
  labelNames: ['service', 'instance']
});

const queueLength = new Gauge({
  name: 'queue_length',
  help: 'Length of processing queues',
  labelNames: ['service', 'queue_type']
});

const memoryUsage = new Gauge({
  name: 'memory_usage_bytes',
  help: 'Memory usage in bytes',
  labelNames: ['service']
});

const cpuUsage = new Gauge({
  name: 'cpu_usage_percent',
  help: 'CPU usage percentage',
  labelNames: ['service']
});

export class MonitoringSystem extends EventEmitter {
  private app: express.Application;
  private redisClient: ReturnType<typeof createClient>;
  private metricsInterval: NodeJS.Timeout | null = null;
  private alertThresholds: Map<string, number> = new Map();

  constructor(port: number = 3000) {
    super();
    
    this.app = express();
    this.app.use(express.json());
    
    // 기본 메트릭 수집 시작
    collectDefaultMetrics();
    
    this.initializeRedis();
    this.setupAlertThresholds();
    this.setupRoutes();
    this.startMetricsCollection();
    
    logger.info('모니터링 시스템 초기화 완료', { port });
  }

  private async initializeRedis(): Promise<void> {
    try {
      this.redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      
      await this.redisClient.connect();
      logger.info('Redis 연결 성공');
      
      // 메트릭 이벤트 구독
      await this.redisClient.subscribe('metrics:*', (channel, message) => {
        this.handleMetricEvent(channel, message);
      });
      
    } catch (error) {
      logger.error('Redis 초기화 실패', { error });
      throw error;
    }
  }

  private setupAlertThresholds(): void {
    this.alertThresholds.set('response_time_ms', 2000); // 2초
    this.alertThresholds.set('error_rate_percent', 5); // 5%
    this.alertThresholds.set('queue_length', 100); // 100개
    this.alertThresholds.set('memory_usage_percent', 80); // 80%
    this.alertThresholds.set('cpu_usage_percent', 80); // 80%
    
    logger.info('알림 임계값 설정 완료', { 
      thresholds: Object.fromEntries(this.alertThresholds) 
    });
  }

  private setupRoutes(): void {
    // Prometheus 메트릭 엔드포인트
    this.app.get('/metrics', async (req, res) => {
      try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
      } catch (error) {
        res.status(500).end(error.message);
      }
    });

    // 헬스체크
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date(),
        uptime: process.uptime()
      });
    });

    // 대시보드 API
    this.app.get('/api/dashboard', async (req, res) => {
      try {
        const dashboard = await this.getDashboardData();
        res.json(dashboard);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // 서비스 상태 조회
    this.app.get('/api/services', async (req, res) => {
      try {
        const services = await this.getServiceStatus();
        res.json(services);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // 알림 설정
    this.app.post('/api/alerts/thresholds', (req, res) => {
      try {
        const { metric, threshold } = req.body;
        this.alertThresholds.set(metric, threshold);
        
        logger.info('알림 임계값 업데이트', { metric, threshold });
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // 알림 조회
    this.app.get('/api/alerts', async (req, res) => {
      try {
        const alerts = await this.getActiveAlerts();
        res.json(alerts);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  private handleMetricEvent(channel: string, message: string): void {
    try {
      const data = JSON.parse(message);
      const metricType = channel.split(':')[1];
      
      switch (metricType) {
        case 'request':
          this.handleRequestMetric(data);
          break;
        case 'connection':
          this.handleConnectionMetric(data);
          break;
        case 'health':
          this.handleHealthMetric(data);
          break;
        case 'queue':
          this.handleQueueMetric(data);
          break;
        case 'resource':
          this.handleResourceMetric(data);
          break;
      }
      
    } catch (error) {
      logger.error('메트릭 이벤트 처리 실패', { channel, error });
    }
  }

  private handleRequestMetric(data: any): void {
    const { service, status, type, duration } = data;
    
    voiceRequestsTotal.inc({ service, status, type });
    
    if (duration) {
      voiceRequestDuration.observe({ service, type }, duration / 1000);
    }
    
    // 응답 시간 알림 체크
    if (duration > this.alertThresholds.get('response_time_ms')!) {
      this.triggerAlert('high_response_time', {
        service,
        duration,
        threshold: this.alertThresholds.get('response_time_ms')
      });
    }
  }

  private handleConnectionMetric(data: any): void {
    const { service, count } = data;
    activeConnections.set({ service }, count);
  }

  private handleHealthMetric(data: any): void {
    const { service, instance, healthy } = data;
    serviceHealth.set({ service, instance }, healthy ? 1 : 0);
    
    if (!healthy) {
      this.triggerAlert('service_unhealthy', { service, instance });
    }
  }

  private handleQueueMetric(data: any): void {
    const { service, queueType, length } = data;
    queueLength.set({ service, queue_type: queueType }, length);
    
    if (length > this.alertThresholds.get('queue_length')!) {
      this.triggerAlert('queue_overflow', {
        service,
        queueType,
        length,
        threshold: this.alertThresholds.get('queue_length')
      });
    }
  }

  private handleResourceMetric(data: any): void {
    const { service, memory, cpu } = data;
    
    if (memory) {
      memoryUsage.set({ service }, memory);
      
      const memoryPercent = (memory / (1024 * 1024 * 1024)) * 100; // GB 기준
      if (memoryPercent > this.alertThresholds.get('memory_usage_percent')!) {
        this.triggerAlert('high_memory_usage', {
          service,
          memoryPercent,
          threshold: this.alertThresholds.get('memory_usage_percent')
        });
      }
    }
    
    if (cpu) {
      cpuUsage.set({ service }, cpu);
      
      if (cpu > this.alertThresholds.get('cpu_usage_percent')!) {
        this.triggerAlert('high_cpu_usage', {
          service,
          cpu,
          threshold: this.alertThresholds.get('cpu_usage_percent')
        });
      }
    }
  }

  private triggerAlert(type: string, data: any): void {
    const alert = {
      type,
      data,
      timestamp: new Date(),
      severity: this.getAlertSeverity(type)
    };
    
    logger.warn('알림 발생', alert);
    
    // Redis에 알림 저장
    this.redisClient.lpush('alerts', JSON.stringify(alert));
    this.redisClient.ltrim('alerts', 0, 999); // 최대 1000개 알림 유지
    
    this.emit('alert', alert);
  }

  private getAlertSeverity(type: string): 'low' | 'medium' | 'high' | 'critical' {
    const severityMap: Record<string, string> = {
      'high_response_time': 'medium',
      'service_unhealthy': 'high',
      'queue_overflow': 'high',
      'high_memory_usage': 'medium',
      'high_cpu_usage': 'medium'
    };
    
    return (severityMap[type] || 'low') as any;
  }

  private startMetricsCollection(): void {
    // 10초마다 시스템 메트릭 수집
    this.metricsInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, 10000);
    
    logger.info('메트릭 수집 시작', { interval: '10초' });
  }

  private collectSystemMetrics(): void {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // 메모리 사용량
    memoryUsage.set({ service: 'monitoring' }, memUsage.heapUsed);
    
    // CPU 사용량 (간단한 추정)
    const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // 마이크로초를 초로 변환
    cpuUsage.set({ service: 'monitoring' }, cpuPercent);
  }

  private async getDashboardData(): Promise<any> {
    const metrics = await register.getMetricsAsJSON();
    
    return {
      timestamp: new Date(),
      uptime: process.uptime(),
      metrics: {
        voiceRequests: metrics.find(m => m.name === 'voice_requests_total'),
        responseTime: metrics.find(m => m.name === 'voice_request_duration_seconds'),
        connections: metrics.find(m => m.name === 'active_connections'),
        health: metrics.find(m => m.name === 'service_health'),
        queues: metrics.find(m => m.name === 'queue_length'),
        memory: metrics.find(m => m.name === 'memory_usage_bytes'),
        cpu: metrics.find(m => m.name === 'cpu_usage_percent')
      }
    };
  }

  private async getServiceStatus(): Promise<any> {
    // Redis에서 서비스 상태 조회
    const serviceKeys = await this.redisClient.keys('service:*');
    const services = [];
    
    for (const key of serviceKeys) {
      const serviceData = await this.redisClient.get(key);
      if (serviceData) {
        services.push(JSON.parse(serviceData));
      }
    }
    
    return { services };
  }

  private async getActiveAlerts(): Promise<any> {
    const alerts = await this.redisClient.lrange('alerts', 0, 99); // 최근 100개 알림
    return alerts.map(alert => JSON.parse(alert));
  }

  public async start(): Promise<void> {
    this.app.listen(3000, () => {
      logger.info('모니터링 시스템 시작', { port: 3000 });
    });
  }

  public async stop(): Promise<void> {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    await this.redisClient.quit();
    logger.info('모니터링 시스템 종료');
  }
}

// 서버 시작
if (require.main === module) {
  const monitoring = new MonitoringSystem();
  monitoring.start().catch(console.error);
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    await monitoring.stop();
    process.exit(0);
  });
}
