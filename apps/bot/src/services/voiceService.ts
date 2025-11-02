/**
 * Discord 음성 채팅 서비스
 * Gateway를 통한 실시간 음성 대화
 */

import { VoiceConnection, VoiceConnectionStatus, AudioPlayer, AudioPlayerStatus, createAudioPlayer, createAudioResource, joinVoiceChannel, EndBehaviorType } from '@discordjs/voice';
import { Client, GuildMember, VoiceChannel } from 'discord.js';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import * as prism from 'prism-media';
import { Readable } from 'stream';

const logger = createLogger('voice-service');

export interface VoiceConfig {
  gatewayUrl: string;
  sampleRate: number;
  channels: number;
  bitDepth: number;
}

export interface VoiceSession {
  connection: VoiceConnection;
  player: AudioPlayer;
  isRecording: boolean;
  isPlaying: boolean;
  userId: string;
  channelId: string;
  audioChunks: Buffer[];
}

export class VoiceService extends EventEmitter {
  private client: Client;
  private config: VoiceConfig;
  private activeSessions: Map<string, VoiceSession> = new Map();
  private gatewayUrl: string;

  constructor(client: Client, config: VoiceConfig) {
    super();
    this.client = client;
    this.config = config;
    this.gatewayUrl = config.gatewayUrl;
  }

  /**
   * 음성 채널에 참여
   */
  async joinVoiceChannel(channel: VoiceChannel, userId: string): Promise<boolean> {
    try {
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator as any,
        selfDeaf: false,
        selfMute: false,
      });

      const player = createAudioPlayer();

      const session: VoiceSession = {
        connection,
        player,
        isRecording: false,
        isPlaying: false,
        userId,
        channelId: channel.id,
        audioChunks: [],
      };

      this.activeSessions.set(userId, session);

      // 연결 상태 모니터링
      connection.on(VoiceConnectionStatus.Ready, () => {
        logger.info('Voice connection ready', { userId, channelId: channel.id });
        this.emit('voiceReady', { userId, channelId: channel.id });
      });

      connection.on(VoiceConnectionStatus.Disconnected, () => {
        logger.info('Voice connection disconnected', { userId, channelId: channel.id });
        this.cleanupSession(userId);
      });

      // 오디오 플레이어 상태 모니터링
      player.on(AudioPlayerStatus.Playing, () => {
        session.isPlaying = true;
        logger.debug('Audio playing started', { userId });
      });

      player.on(AudioPlayerStatus.Idle, () => {
        session.isPlaying = false;
        logger.debug('Audio playing finished', { userId });
      });

      return true;
    } catch (error) {
      logger.error('Failed to join voice channel', { error, userId, channelId: channel.id });
      return false;
    }
  }

  /**
   * 음성 채널에서 나가기
   */
  async leaveVoiceChannel(userId: string): Promise<boolean> {
    const session = this.activeSessions.get(userId);
    if (!session) {
      return false;
    }

    try {
      session.connection.destroy();
      this.cleanupSession(userId);
      logger.info('Left voice channel', { userId });
      return true;
    } catch (error) {
      logger.error('Failed to leave voice channel', { error, userId });
      return false;
    }
  }

  /**
   * 음성 녹음 시작
   */
  async startRecording(userId: string): Promise<boolean> {
    const session = this.activeSessions.get(userId);
    if (!session) {
      logger.warn('No active voice session', { userId });
      return false;
    }

    if (session.isRecording) {
      logger.warn('Already recording', { userId });
      return false;
    }

    try {
      session.isRecording = true;
      session.audioChunks = [];
      
      logger.info('Started voice recording', { userId });
      
      // Discord Voice Receiver 설정
      const receiver = session.connection.receiver;
      
      // 사용자 음성 스트림 구독
      receiver.speaking.on('start', (speakingUserId) => {
        if (speakingUserId !== userId) return;
        
        logger.info('User started speaking', { userId: speakingUserId });
        
        // 오디오 스트림 수신
        const audioStream = receiver.subscribe(speakingUserId, {
          end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 500, // 500ms 무음 후 종료
          },
        });
        
        // Opus → PCM 디코딩
        const decoder = new prism.opus.Decoder({
          rate: 48000,
          channels: 2,
          frameSize: 960,
        });
        
        audioStream.pipe(decoder);
        
        // PCM 데이터 수집
        decoder.on('data', (chunk: Buffer) => {
          if (session.isRecording) {
            session.audioChunks.push(chunk);
          }
        });
        
        decoder.on('end', () => {
          logger.info('Audio stream ended', { userId, chunks: session.audioChunks.length });
        });
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to start recording', { error, userId });
      return false;
    }
  }

  /**
   * 음성 녹음 중지 및 처리
   */
  async stopRecording(userId: string): Promise<string | null> {
    const session = this.activeSessions.get(userId);
    if (!session) {
      logger.warn('No active voice session', { userId });
      return null;
    }

    if (!session.isRecording) {
      logger.warn('Not currently recording', { userId });
      return null;
    }

    try {
      session.isRecording = false;
      
      // 녹음된 오디오 병합
      const audioBuffer = Buffer.concat(session.audioChunks);
      session.audioChunks = [];
      
      logger.info('Recording stopped', { 
        userId, 
        audioSize: audioBuffer.length 
      });
      
      if (audioBuffer.length === 0) {
        logger.warn('No audio data recorded');
        return null;
      }
      
      // Gateway로 전체 파이프라인 실행 (ASR → LLM → TTS)
      const result = await this.processVoiceWithGateway(audioBuffer, userId);
      
      if (result.success && result.audioResponse) {
        // AI 응답 음성 재생
        await this.playAudioBuffer(userId, result.audioResponse);
        
        return result.transcript || '(변환 성공)';
      }
      
      return result.transcript || null;
      
    } catch (error) {
      logger.error('Failed to stop recording and process', { error, userId });
      return null;
    }
  }
  
  /**
   * Gateway를 통한 음성 처리 (전체 파이프라인)
   */
  private async processVoiceWithGateway(audioBuffer: Buffer, userId: string): Promise<any> {
    try {
      logger.info('Gateway 파이프라인 요청', { 
        gatewayUrl: this.gatewayUrl,
        audioSize: audioBuffer.length 
      });
      
      // FormData로 파일 전송
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', audioBuffer, {
        filename: 'audio.pcm',
        contentType: 'audio/pcm',
      });
      
      const response = await fetch(`${this.gatewayUrl}/api/voice/process`, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders(),
      });
      
      if (!response.ok) {
        logger.error('Gateway 요청 실패', { status: response.status });
        
        // 실패 시 ASR만 시도
        return await this.fallbackToASROnly(audioBuffer);
      }
      
      // 응답 음성 받기
      const audioResponse = Buffer.from(await response.arrayBuffer());
      
      return {
        success: true,
        audioResponse,
        transcript: '(음성 인식 완료)',
      };
      
    } catch (error) {
      logger.error('Gateway 처리 오류:', error);
      
      // Fallback: ASR만 시도
      return await this.fallbackToASROnly(audioBuffer);
    }
  }
  
  /**
   * Fallback: ASR만 실행 (Gateway 실패 시)
   */
  private async fallbackToASROnly(audioBuffer: Buffer): Promise<any> {
    try {
      logger.info('Fallback: ASR만 실행');
      
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', audioBuffer, 'audio.pcm');
      
      const response = await fetch(`${this.gatewayUrl}/api/voice/stt`, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders(),
      });
      
      if (response.ok) {
        const result = await response.json() as { text: string };
        return {
          success: true,
          transcript: result.text,
        };
      }
      
      return { success: false };
      
    } catch (error) {
      logger.error('ASR fallback 실패:', error);
      return { success: false };
    }
  }
  
  /**
   * 오디오 버퍼 재생
   */
  private async playAudioBuffer(userId: string, audioBuffer: Buffer): Promise<boolean> {
    const session = this.activeSessions.get(userId);
    if (!session) {
      return false;
    }
    
    try {
      // Buffer → Readable Stream
      const stream = Readable.from(audioBuffer);
      
      // AudioResource 생성
      const resource = createAudioResource(stream);
      
      // 재생
      session.player.play(resource);
      session.connection.subscribe(session.player);
      
      logger.info('Playing AI response audio', { userId });
      
      return true;
    } catch (error) {
      logger.error('Failed to play audio:', error);
      return false;
    }
  }

  /**
   * 세션 정리
   */
  private cleanupSession(userId: string): void {
    const session = this.activeSessions.get(userId);
    if (session) {
      try {
        session.connection.destroy();
        session.player.stop();
      } catch (error) {
        logger.error('Error cleaning up voice session', { error, userId });
      }
      this.activeSessions.delete(userId);
    }
  }

  /**
   * 활성 세션 확인
   */
  isInVoiceChannel(userId: string): boolean {
    return this.activeSessions.has(userId);
  }

  /**
   * 녹음 중인지 확인
   */
  isRecording(userId: string): boolean {
    const session = this.activeSessions.get(userId);
    return session?.isRecording || false;
  }

  /**
   * 재생 중인지 확인
   */
  isPlaying(userId: string): boolean {
    const session = this.activeSessions.get(userId);
    return session?.isPlaying || false;
  }

  /**
   * 활성 세션 목록
   */
  getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }
}
