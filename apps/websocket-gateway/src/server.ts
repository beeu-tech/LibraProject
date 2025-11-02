/**
 * WebSocket 기반 실시간 음성 Gateway
 * 
 * 아키텍처:
 * Discord Bot ↔ WebSocket Gateway ↔ Voice Processing Cluster
 *                    ↓
 *              Message Queue (Redis)
 *                    ↓
 *              [ASR] [LLM] [TTS] Services
 */

import WebSocket from 'ws';
import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';

const logger = createLogger('websocket-gateway');

interface VoiceSession {
  id: string;
  userId: string;
  channelId: string;
  ws: WebSocket;
  isActive: boolean;
  lastActivity: Date;
  audioBuffer: Buffer[];
}

interface ProcessingRequest {
  sessionId: string;
  userId: string;
  channelId: string;
  audioData: Buffer;
  timestamp: Date;
  requestId: string;
}

interface ProcessingResponse {
  requestId: string;
  sessionId: string;
  type: 'asr' | 'llm' | 'tts';
  data: any;
  timestamp: Date;
}

export class WebSocketVoiceGateway extends EventEmitter {
  private wss: WebSocket.Server;
  private app: express.Application;
  private redisClient!: ReturnType<typeof createClient>;
  private sessions: Map<string, VoiceSession> = new Map();
  private processingQueue: ProcessingRequest[] = [];
  private isProcessing = false;

  constructor(port: number = 8002) {
    super();
    
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());
    
    this.wss = new WebSocket.Server({ 
      port,
      perMessageDeflate: false // 음성 데이터 압축 비활성화
    });

    this.initializeRedis();
    this.setupWebSocketHandlers();
    this.setupHttpRoutes();
    this.startProcessingLoop();
    
    logger.info('WebSocket Voice Gateway 초기화 완료', { port });
  }

  private async initializeRedis(): Promise<void> {
    try {
      this.redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      
      await this.redisClient.connect();
      logger.info('Redis 연결 성공');
      
      // 처리 결과 구독
      await this.redisClient.subscribe('voice:processing:result', (message: string) => {
        this.handleProcessingResult(JSON.parse(message));
      });
      
    } catch (error) {
      logger.error('Redis 초기화 실패', { error });
      throw error;
    }
  }

  private setupWebSocketHandlers(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const sessionId = uuidv4();
      const userId = req.url?.split('userId=')[1] || 'unknown';
      
      logger.info('WebSocket 연결 수립', { sessionId, userId });
      
      const session: VoiceSession = {
        id: sessionId,
        userId,
        channelId: 'default',
        ws,
        isActive: true,
        lastActivity: new Date(),
        audioBuffer: []
      };
      
      this.sessions.set(sessionId, session);
      
      // 연결 확인 메시지
      ws.send(JSON.stringify({
        type: 'connected',
        sessionId,
        timestamp: new Date()
      }));
      
      // 음성 데이터 수신
      ws.on('message', (data: Buffer) => {
        this.handleVoiceData(sessionId, data);
      });
      
      // 연결 종료
      ws.on('close', () => {
        logger.info('WebSocket 연결 종료', { sessionId });
        this.sessions.delete(sessionId);
      });
      
      // 에러 처리
      ws.on('error', (error) => {
        logger.error('WebSocket 에러', { sessionId, error });
        this.sessions.delete(sessionId);
      });
    });
  }

  private handleVoiceData(sessionId: string, data: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) return;
    
    session.lastActivity = new Date();
    session.audioBuffer.push(data);
    
    // 오디오 버퍼가 일정 크기에 도달하면 처리 요청
    if (session.audioBuffer.length >= 10) { // 10개 청크 = 약 200ms
      this.queueProcessingRequest(session);
      session.audioBuffer = []; // 버퍼 초기화
    }
  }

  private queueProcessingRequest(session: VoiceSession): void {
    const requestId = uuidv4();
    const audioData = Buffer.concat(session.audioBuffer);
    
    const request: ProcessingRequest = {
      sessionId: session.id,
      userId: session.userId,
      channelId: session.channelId,
      audioData,
      timestamp: new Date(),
      requestId
    };
    
    this.processingQueue.push(request);
    logger.info('처리 요청 큐에 추가', { 
      requestId, 
      sessionId: session.id,
      audioSize: audioData.length,
      queueLength: this.processingQueue.length
    });
  }

  private async startProcessingLoop(): Promise<void> {
    setInterval(async () => {
      if (this.processingQueue.length === 0 || this.isProcessing) return;
      
      this.isProcessing = true;
      const request = this.processingQueue.shift();
      
      if (request) {
        await this.processVoiceRequest(request);
      }
      
      this.isProcessing = false;
    }, 100); // 100ms 간격으로 처리
  }

  private async processVoiceRequest(request: ProcessingRequest): Promise<void> {
    try {
      logger.info('음성 처리 시작', { 
        requestId: request.requestId,
        sessionId: request.sessionId,
        audioSize: request.audioData.length
      });
      
      // 1. ASR 처리 요청
      await this.redisClient.publish('voice:asr:request', JSON.stringify({
        requestId: request.requestId,
        sessionId: request.sessionId,
        userId: request.userId,
        audioData: request.audioData.toString('base64'),
        timestamp: request.timestamp
      }));
      
    } catch (error) {
      logger.error('음성 처리 실패', { 
        requestId: request.requestId,
        error 
      });
    }
  }

  private async handleProcessingResult(result: ProcessingResponse): Promise<void> {
    try {
      const session = this.sessions.get(result.sessionId);
      if (!session) return;
      
      logger.info('처리 결과 수신', { 
        requestId: result.requestId,
        type: result.type,
        sessionId: result.sessionId
      });
      
      // 결과를 WebSocket으로 전송
      session.ws.send(JSON.stringify({
        type: 'processing_result',
        requestId: result.requestId,
        processingType: result.type,
        data: result.data,
        timestamp: result.timestamp
      }));
      
    } catch (error) {
      logger.error('처리 결과 처리 실패', { error });
    }
  }

  private setupHttpRoutes(): void {
    // 헬스체크
    this.app.get('/health', (req: any, res: any) => {
      res.json({
        status: 'healthy',
        sessions: this.sessions.size,
        queueLength: this.processingQueue.length,
        timestamp: new Date()
      });
    });
    
    // 세션 정보
    this.app.get('/sessions', (req: any, res: any) => {
      const sessions = Array.from(this.sessions.values()).map(session => ({
        id: session.id,
        userId: session.userId,
        channelId: session.channelId,
        isActive: session.isActive,
        lastActivity: session.lastActivity
      }));
      
      res.json({ sessions });
    });
    
    // 통계
    this.app.get('/stats', (req: any, res: any) => {
      res.json({
        totalSessions: this.sessions.size,
        activeSessions: Array.from(this.sessions.values()).filter(s => s.isActive).length,
        queueLength: this.processingQueue.length,
        isProcessing: this.isProcessing,
        uptime: process.uptime()
      });
    });
  }

  public async start(): Promise<void> {
    this.app.listen(3001, () => {
      logger.info('HTTP 서버 시작', { port: 3001 });
    });
    
    logger.info('WebSocket Voice Gateway 시작 완료');
  }

  public async stop(): Promise<void> {
    this.wss.close();
    await this.redisClient.quit();
    logger.info('WebSocket Voice Gateway 종료');
  }
}

// 서버 시작
if (require.main === module) {
  const gateway = new WebSocketVoiceGateway();
  gateway.start().catch(console.error);
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    await gateway.stop();
    process.exit(0);
  });
}
