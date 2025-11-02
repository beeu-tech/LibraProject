/**
 * 음성 처리 클러스터 서비스
 * 
 * 역할:
 * 1. ASR (Speech-to-Text) 처리
 * 2. LLM (대화 생성) 처리  
 * 3. TTS (Text-to-Speech) 처리
 * 
 * 아키텍처:
 * Redis Message Queue ↔ Voice Processing Cluster ↔ External APIs
 */

import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';

const logger = createLogger('voice-processing-cluster');

interface ProcessingRequest {
  requestId: string;
  sessionId: string;
  userId: string;
  audioData: string; // base64 encoded
  timestamp: Date;
}

interface ProcessingResult {
  requestId: string;
  sessionId: string;
  type: 'asr' | 'llm' | 'tts';
  data: any;
  timestamp: Date;
}

export class VoiceProcessingCluster extends EventEmitter {
  private redisClient!: ReturnType<typeof createClient>;
  private isProcessing = false;
  private processingQueue: ProcessingRequest[] = [];
  
  // 외부 API 설정
  private groqApiKey: string;
  private cloudflareApiKey: string;

  constructor() {
    super();
    
    this.groqApiKey = process.env.GROQ_API_KEY || '';
    this.cloudflareApiKey = process.env.CLOUDFLARE_API_KEY || '';
    
    this.initializeRedis();
    this.startProcessingLoop();
    
    logger.info('Voice Processing Cluster 초기화 완료');
  }

  private async initializeRedis(): Promise<void> {
    try {
      this.redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      
      await this.redisClient.connect();
      logger.info('Redis 연결 성공');
      
      // ASR 요청 구독
      await this.redisClient.subscribe('voice:asr:request', (message) => {
        this.handleASRRequest(JSON.parse(message));
      });
      
      // LLM 요청 구독
      await this.redisClient.subscribe('voice:llm:request', (message) => {
        this.handleLLMRequest(JSON.parse(message));
      });
      
      // TTS 요청 구독
      await this.redisClient.subscribe('voice:tts:request', (message) => {
        this.handleTTSRequest(JSON.parse(message));
      });
      
    } catch (error) {
      logger.error('Redis 초기화 실패', { error });
      throw error;
    }
  }

  private async handleASRRequest(request: ProcessingRequest): Promise<void> {
    try {
      logger.info('ASR 요청 처리 시작', { 
        requestId: request.requestId,
        sessionId: request.sessionId,
        audioSize: request.audioData.length
      });
      
      // Groq Whisper API 호출
      const audioBuffer = Buffer.from(request.audioData, 'base64');
      const transcription = await this.transcribeAudio(audioBuffer);
      
      // ASR 결과 발행
      const result: ProcessingResult = {
        requestId: request.requestId,
        sessionId: request.sessionId,
        type: 'asr',
        data: {
          text: transcription,
          confidence: 0.95,
          language: 'ko'
        },
        timestamp: new Date()
      };
      
      await this.redisClient.publish('voice:processing:result', JSON.stringify(result));
      
      // LLM 처리 요청
      await this.redisClient.publish('voice:llm:request', JSON.stringify({
        requestId: uuidv4(),
        sessionId: request.sessionId,
        userId: request.userId,
        text: transcription,
        timestamp: new Date()
      }));
      
      logger.info('ASR 처리 완료', { 
        requestId: request.requestId,
        transcription: transcription.substring(0, 50) + '...'
      });
      
    } catch (error) {
      logger.error('ASR 처리 실패', { 
        requestId: request.requestId,
        error 
      });
    }
  }

  private async handleLLMRequest(request: any): Promise<void> {
    try {
      logger.info('LLM 요청 처리 시작', { 
        requestId: request.requestId,
        sessionId: request.sessionId,
        text: request.text
      });
      
      // Groq LLM API 호출
      const response = await this.generateResponse(request.text);
      
      // LLM 결과 발행
      const result: ProcessingResult = {
        requestId: request.requestId,
        sessionId: request.sessionId,
        type: 'llm',
        data: {
          text: response,
          tokens: response.length,
          model: 'llama-3.1-8b-instant'
        },
        timestamp: new Date()
      };
      
      await this.redisClient.publish('voice:processing:result', JSON.stringify(result));
      
      // TTS 처리 요청
      await this.redisClient.publish('voice:tts:request', JSON.stringify({
        requestId: uuidv4(),
        sessionId: request.sessionId,
        userId: request.userId,
        text: response,
        timestamp: new Date()
      }));
      
      logger.info('LLM 처리 완료', { 
        requestId: request.requestId,
        response: response.substring(0, 50) + '...'
      });
      
    } catch (error) {
      logger.error('LLM 처리 실패', { 
        requestId: request.requestId,
        error 
      });
    }
  }

  private async handleTTSRequest(request: any): Promise<void> {
    try {
      logger.info('TTS 요청 처리 시작', { 
        requestId: request.requestId,
        sessionId: request.sessionId,
        text: request.text
      });
      
      // Cloudflare TTS API 호출
      const audioData = await this.synthesizeSpeech(request.text);
      
      // TTS 결과 발행
      const result: ProcessingResult = {
        requestId: request.requestId,
        sessionId: request.sessionId,
        type: 'tts',
        data: {
          audioData: audioData.toString('base64'),
          format: 'wav',
          sampleRate: 24000,
          duration: audioData.length / 48000 // 추정
        },
        timestamp: new Date()
      };
      
      await this.redisClient.publish('voice:processing:result', JSON.stringify(result));
      
      logger.info('TTS 처리 완료', { 
        requestId: request.requestId,
        audioSize: audioData.length
      });
      
    } catch (error) {
      logger.error('TTS 처리 실패', { 
        requestId: request.requestId,
        error 
      });
    }
  }

  private async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    try {
      const formData = new FormData();
      const audioBlob = new Blob([audioBuffer.buffer], { type: 'audio/wav' });
      formData.append('file', audioBlob, 'audio.wav');
      formData.append('model', 'whisper-large-v3');
      formData.append('language', 'ko');
      
      const response = await axios.post(
        'https://api.groq.com/openai/v1/audio/transcriptions',
        formData,
        {
          headers: {
            'Authorization': `Bearer ${this.groqApiKey}`,
            'Content-Type': 'multipart/form-data'
          }
        }
      );
      
      return response.data.text || '음성을 인식할 수 없습니다.';
      
    } catch (error) {
      logger.error('음성 인식 실패', { error });
      return '음성 인식에 실패했습니다.';
    }
  }

  private async generateResponse(text: string): Promise<string> {
    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.1-8b-instant',
          messages: [
            {
              role: 'system',
              content: '당신은 친근하고 도움이 되는 AI 어시스턴트입니다. 한국어로 대화하며, 친근하고 자연스러운 톤을 유지하세요.'
            },
            {
              role: 'user',
              content: text
            }
          ],
          max_tokens: 256,
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${this.groqApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return response.data.choices[0].message.content || '응답을 생성할 수 없습니다.';
      
    } catch (error) {
      logger.error('응답 생성 실패', { error });
      return '죄송합니다. 응답을 생성하지 못했습니다.';
    }
  }

  private async synthesizeSpeech(text: string): Promise<Buffer> {
    try {
      const response = await axios.post(
        'https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/run/@cf/meta/melo-tts',
        {
          prompt: text,
          language: 'ko'
        },
        {
          headers: {
            'Authorization': `Bearer ${this.cloudflareApiKey}`,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer'
        }
      );
      
      return Buffer.from(response.data);
      
    } catch (error) {
      logger.error('음성 합성 실패', { error });
      // 기본 오디오 반환 (무음)
      return Buffer.alloc(48000); // 1초 무음
    }
  }

  private startProcessingLoop(): void {
    setInterval(() => {
      // 처리 상태 모니터링
      if (this.isProcessing) {
        logger.debug('처리 중...', { 
          queueLength: this.processingQueue.length 
        });
      }
    }, 5000);
  }

  public async start(): Promise<void> {
    logger.info('Voice Processing Cluster 시작');
  }

  public async stop(): Promise<void> {
    await this.redisClient.quit();
    logger.info('Voice Processing Cluster 종료');
  }
}

// 서버 시작
if (require.main === module) {
  const cluster = new VoiceProcessingCluster();
  cluster.start().catch(console.error);
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    await cluster.stop();
    process.exit(0);
  });
}
