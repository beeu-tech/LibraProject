/**
 * WebSocket 기반 실시간 음성 서비스
 * 
 * 아키텍처:
 * Discord Voice ↔ Bot ↔ WebSocket Gateway ↔ Voice Processing Cluster
 */

import { VoiceConnection, VoiceConnectionStatus, AudioPlayer, AudioPlayerStatus, createAudioPlayer, createAudioResource, joinVoiceChannel, EndBehaviorType } from '@discordjs/voice';
import { Client, VoiceChannel } from 'discord.js';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { createLogger } from '../utils/logger';
import * as prism from 'prism-media';
import { Readable } from 'stream';

const logger = createLogger('websocket-voice');

export interface VoiceConfig {
  websocketUrl: string;
  silenceThreshold: number;
  sampleRate: number;
  channels: number;
}

export interface WebSocketSession {
  connection: VoiceConnection;
  player: AudioPlayer;
  userId: string;
  channelId: string;
  ws: WebSocket;
  isProcessing: boolean;
  silenceTimer: NodeJS.Timeout | null;
  audioChunks: Buffer[];
}

export class WebSocketVoiceService extends EventEmitter {
  private client: Client;
  private config: VoiceConfig;
  private activeSessions: Map<string, WebSocketSession> = new Map();
  private websocketUrl: string;

  constructor(client: Client, config: VoiceConfig) {
    super();
    this.client = client;
    this.config = config;
    this.websocketUrl = config.websocketUrl;
    
    logger.info('WebSocket 음성 서비스 초기화', { 
      websocketUrl: config.websocketUrl,
      silenceThreshold: config.silenceThreshold
    });
  }

  /**
   * 음성 채널 참여 및 WebSocket 연결
   */
  async joinAndListen(channel: VoiceChannel, userId: string): Promise<boolean> {
    try {
      logger.info('음성 채널 참여 및 WebSocket 연결 시작', { userId, channelId: channel.id });
      
      // Discord Voice 연결
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator as any,
        selfDeaf: true,  // Echo 방지
        selfMute: false,
      });

      // WebSocket 연결
      const ws = new WebSocket(`${this.websocketUrl}?userId=${userId}`);
      
      const player = createAudioPlayer();
      
      // Player 이벤트 리스너
      player.on('stateChange', (oldState, newState) => {
        logger.info('Player 상태 변경', { 
          userId,
          oldStatus: oldState.status, 
          newStatus: newState.status 
        });
        
        // 재생 시작 시 isProcessing = true
        if (newState.status === 'playing') {
          const session = this.activeSessions.get(userId);
          if (session) {
            session.isProcessing = true;
            logger.info('재생 중 - 녹음 중단', { userId });
          }
        }
        
        // 재생 종료 시 isProcessing = false
        if (newState.status === 'idle' && oldState.status === 'playing') {
          const session = this.activeSessions.get(userId);
          if (session) {
            session.isProcessing = false;
            logger.info('재생 종료 - 녹음 재개', { userId });
          }
        }
      });

      const session: WebSocketSession = {
        connection,
        player,
        userId,
        channelId: channel.id,
        ws,
        isProcessing: false,
        silenceTimer: null,
        audioChunks: []
      };

      this.activeSessions.set(userId, session);

      // WebSocket 이벤트 처리
      ws.on('open', () => {
        logger.info('WebSocket 연결 성공', { userId });
      });

      ws.on('message', (data: Buffer) => {
        this.handleProcessingResult(userId, data);
      });

      ws.on('close', () => {
        logger.info('WebSocket 연결 종료', { userId });
        this.cleanup(userId);
      });

      ws.on('error', (error) => {
        logger.error('WebSocket 에러', { userId, error });
        this.cleanup(userId);
      });

      // 음성 스트림 처리
      await this.setupVoiceStream(session);

      return true;
    } catch (error) {
      logger.error('음성 채널 참여 실패', { error, userId });
      return false;
    }
  }

  private async setupVoiceStream(session: WebSocketSession): Promise<void> {
    const { connection, userId } = session;
    
    // 음성 스트림 구독
    const audioStream = connection.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: this.config.silenceThreshold,
      },
    });

    // Opus 디코더 생성
    const decoder = new prism.opus.Decoder({
      rate: this.config.sampleRate,
      channels: this.config.channels,
      frameSize: 960,
    });

    let chunkCount = 0;
    let lastDataTime = Date.now();
    
    // Opus 스트림을 디코더로 파이프
    audioStream.pipe(decoder);
    
    decoder.on('data', (pcmChunk: Buffer) => {
      if (session.isProcessing) {
        // 재생 중에는 녹음하지 않음 (Echo 방지)
        return;
      }
      
      // 최소 오디오 크기 체크
      if (pcmChunk.length < 1000) {
        return;
      }
      
      session.audioChunks.push(pcmChunk);
      chunkCount++;
      lastDataTime = Date.now();
      
      // 무음 감지 타이머 재설정
      if (session.silenceTimer) {
        clearTimeout(session.silenceTimer);
      }
      
      // 2초 무음 감지
      session.silenceTimer = setTimeout(() => {
        logger.info('무음 타이머 발동', { userId, chunks: chunkCount });
        this.onSilenceDetected(userId);
      }, this.config.silenceThreshold);
    });
    
    decoder.on('end', () => {
      logger.debug('PCM 디코딩 종료', { userId, totalChunks: chunkCount });
    });
    
    decoder.on('error', (error) => {
      logger.error('Opus 디코딩 에러', { userId, error });
    });
  }

  private async onSilenceDetected(userId: string): Promise<void> {
    const session = this.activeSessions.get(userId);
    if (!session || session.isProcessing) return;

    const pcmChunks = [...session.audioChunks];
    session.audioChunks = [];

    if (pcmChunks.length === 0) {
      logger.debug('오디오 데이터 없음, 스킵', { userId });
      return;
    }

    const totalPcmBuffer = Buffer.concat(pcmChunks);
    const minAudioSize = 19200; // 0.2초

    if (totalPcmBuffer.length < minAudioSize) {
      logger.warn('오디오 너무 짧음 - 무음으로 판단, 스킵', {
        userId,
        pcmSize: totalPcmBuffer.length,
        minAudioSize
      });
      return;
    }

    logger.info('무음 감지 → WebSocket으로 전송', {
      userId,
      pcmChunkCount: pcmChunks.length,
      totalPcmSize: totalPcmBuffer.length
    });

    session.isProcessing = true;

    try {
      // WebSocket으로 오디오 데이터 전송
      session.ws.send(totalPcmBuffer);
      
    } catch (error) {
      logger.error('WebSocket 전송 실패', { userId, error });
    } finally {
      session.isProcessing = false;
    }
  }

  private async handleProcessingResult(userId: string, data: Buffer): Promise<void> {
    try {
      const result = JSON.parse(data.toString());
      
      logger.info('처리 결과 수신', { 
        userId,
        type: result.processingType,
        requestId: result.requestId
      });
      
      if (result.processingType === 'tts' && result.data.audioData) {
        // TTS 오디오 재생
        await this.playTTSAudio(userId, result.data.audioData);
      }
      
    } catch (error) {
      logger.error('처리 결과 처리 실패', { userId, error });
    }
  }

  private async playTTSAudio(userId: string, audioData: string): Promise<void> {
    const session = this.activeSessions.get(userId);
    if (!session) return;

    try {
      // Base64 디코딩
      const audioBuffer = Buffer.from(audioData, 'base64');
      
      logger.info('TTS 오디오 재생 시작', { 
        userId,
        audioSize: audioBuffer.length
      });
      
      // 오디오 리소스 생성 및 재생
      const stream = Readable.from(audioBuffer);
      const resource = createAudioResource(stream);
      session.player.play(resource);
      
    } catch (error) {
      logger.error('TTS 오디오 재생 실패', { userId, error });
    }
  }

  /**
   * 음성 채널 나가기
   */
  async leave(userId: string): Promise<boolean> {
    const session = this.activeSessions.get(userId);
    if (!session) return false;

    try {
      session.connection.destroy();
      session.ws.close();
      this.cleanup(userId);
      logger.info('음성 채널 나감', { userId });
      return true;
    } catch (error) {
      logger.error('음성 채널 나가기 실패', { error, userId });
      return false;
    }
  }

  /**
   * 세션 정리
   */
  private cleanup(userId: string): void {
    const session = this.activeSessions.get(userId);
    if (session) {
      if (session.silenceTimer) {
        clearTimeout(session.silenceTimer);
      }
      this.activeSessions.delete(userId);
    }
  }
}
