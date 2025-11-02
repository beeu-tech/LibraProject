import { Client, GatewayIntentBits, Events, Message } from 'discord.js';
import { config } from 'dotenv';
import { createLogger } from './utils/logger';
import { RateLimiter } from './utils/rateLimiter';
import { AIWorkerClient } from './services/aiWorkerClient';
// intentRouter 제거: 모든 메시지를 LLM으로 처리
import { RealtimeVoiceService } from './services/realtimeVoiceService';
// import { registerVoiceCommands } from './commands/voiceCommands';
import { Collection, REST, Routes, SlashCommandBuilder } from 'discord.js';

// 환경변수 로드
config();

const logger = createLogger('bot');
const rateLimiter = new RateLimiter();
const aiWorkerClient = new AIWorkerClient();

// 채팅 상태 관리
const chatStates = new Map<string, boolean>(); // userId -> chatEnabled
const commands = new Collection<string, any>();

// 실시간 음성 서비스 초기화
let voiceService: RealtimeVoiceService;

// Discord 클라이언트 생성
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// 명령어 등록
async function registerCommands() {
  const commandData = [
    // 채팅 명령어
    new SlashCommandBuilder()
      .setName('chat')
      .setDescription('리브라 봇과의 채팅을 켜거나 끕니다')
      .addStringOption(option =>
        option.setName('mode')
          .setDescription('채팅 모드')
          .setRequired(true)
          .addChoices(
            { name: '켜기', value: 'on' },
            { name: '끄기', value: 'off' }
          )
      ),
    
    // 음성 명령어들
    new SlashCommandBuilder()
      .setName('join')
      .setDescription('음성 채널에 참여합니다'),
    
    new SlashCommandBuilder()
      .setName('leave')
      .setDescription('음성 채널에서 나갑니다'),
    
    new SlashCommandBuilder()
      .setName('record')
      .setDescription('음성 녹음을 시작합니다'),
    
    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('음성 녹음을 중지합니다'),
    
    new SlashCommandBuilder()
      .setName('voice-status')
      .setDescription('음성 상태를 확인합니다'),
  ];

  const rest = new REST().setToken(process.env.DISCORD_TOKEN!);
  
  try {
    logger.info('슬래시 명령어를 등록하는 중...');
    
    await rest.put(
      Routes.applicationCommands(client.user!.id),
      { body: commandData }
    );
    
    logger.info(`${commandData.length}개의 슬래시 명령어가 성공적으로 등록되었습니다.`);
  } catch (error) {
    logger.error('명령어 등록 중 오류 발생:', error);
  }
}

// 봇 준비 완료 이벤트
client.once(Events.ClientReady, async (readyClient) => {
  logger.info(`봇이 준비되었습니다! ${readyClient.user.tag}로 로그인했습니다.`);
  
  // 실시간 음성 서비스 초기화 (VAD 기반 자동 처리)
  voiceService = new RealtimeVoiceService(client, {
    gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:8001',
    silenceThreshold: 2000, // 2초 무음 감지
    sampleRate: 48000,
    channels: 2,
  });
  
  // 명령어 등록
  await registerCommands();
});

// 슬래시 명령어 인터랙션 처리
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user, options } = interaction;

  try {
    switch (commandName) {
      case 'chat': {
        const mode = options.getString('mode', true);
        const userId = user.id;
        const currentState = chatStates.get(userId) || false;
        
        if (mode === 'on') {
          if (currentState) {
            await interaction.reply('ℹ️ 이미 채팅이 활성화되어 있습니다.');
          } else {
            chatStates.set(userId, true);
            await interaction.reply('✅ 리브라 봇과의 채팅이 활성화되었습니다! 이제 자유롭게 대화할 수 있어요.');
          }
        } else {
          if (!currentState) {
            await interaction.reply('ℹ️ 이미 채팅이 비활성화되어 있습니다.');
          } else {
            chatStates.set(userId, false);
            await interaction.reply('❌ 리브라 봇과의 채팅이 비활성화되었습니다.');
          }
        }
        break;
      }
      
      case 'join': {
        if (!interaction.guild || !interaction.member) {
          return interaction.reply('이 명령어는 서버에서만 사용할 수 있습니다.');
        }
        
        const member = interaction.member as any;
        const voiceChannel = member.voice?.channel;
        
        if (!voiceChannel) {
          return interaction.reply('음성 채널에 먼저 참여해주세요.');
        }
        
        try {
          const success = await voiceService.joinAndListen(voiceChannel, member.id);
          
          if (success) {
            await interaction.reply(`🎤 음성 채널 "${voiceChannel.name}"에 참여했습니다!\n\n🤖 **실시간 음성 대화 모드 활성화**\n- 말씀하시면 자동으로 감지합니다\n- 2초 무음 후 자동 응답합니다\n- 계속 대화하세요!`);
            logger.info('실시간 음성 대화 시작', { 
              userId: member.id, 
              channelId: voiceChannel.id, 
              channelName: voiceChannel.name 
            });
          } else {
            await interaction.reply('❌ 음성 채널 참여에 실패했습니다.');
          }
        } catch (error) {
          logger.error('Failed to join voice channel:', error);
          await interaction.reply('❌ 음성 채널 참여 중 오류가 발생했습니다.');
        }
        break;
      }
      
      case 'leave': {
        try {
          const success = await voiceService.leave(user.id);
          if (success) {
            await interaction.reply('👋 음성 채널에서 나갔습니다.');
          } else {
            await interaction.reply('❌ 음성 채널에서 나가기에 실패했습니다.');
          }
        } catch (error) {
          logger.error('Failed to leave voice channel:', error);
          await interaction.reply('❌ 음성 채널 나가기 중 오류가 발생했습니다.');
        }
        break;
      }
      
      case 'record':
      case 'stop': {
        // 실시간 모드에서는 더 이상 필요 없음
        await interaction.reply('ℹ️ 실시간 음성 대화 모드에서는 이 명령어가 필요 없습니다.\n`/join`하면 자동으로 음성을 감지하고 응답합니다!');
        break;
      }
      
      case 'voice-status': {
        try {
          const isActive = voiceService.isActive(user.id);
          const isProcessing = voiceService.isProcessing(user.id);
          
          let status = '🔍 **실시간 음성 대화 상태**\n';
          status += `음성 채널: ${isActive ? '✅ 참여 중' : '❌ 미참여'}\n`;
          status += `처리 상태: ${isProcessing ? '⚙️ 처리 중...' : '👂 대기 중'}\n`;
          status += `\n💡 말씀하시면 자동으로 감지하고 응답합니다!`;
          
          await interaction.reply(status);
        } catch (error) {
          logger.error('Failed to get voice status:', error);
          await interaction.reply('❌ 음성 상태 확인 중 오류가 발생했습니다.');
        }
        break;
      }
      
      default:
        await interaction.reply('알 수 없는 명령어입니다.');
    }
  } catch (error) {
    logger.error('명령어 처리 중 오류 발생:', error);
    await interaction.reply('명령어 처리 중 오류가 발생했습니다.');
  }
});

// 메시지 생성 이벤트 처리
client.on(Events.MessageCreate, async (message: Message) => {
  try {
    // 봇 자신의 메시지는 무시
    if (message.author.bot) return;

    // 멘션, 특정 키워드, 또는 채팅 활성화 상태 확인
    const isMentioned = message.mentions.has(client.user!);
    const hasKeyword = message.content.toLowerCase().includes('리브라') || 
                      message.content.toLowerCase().includes('libra');
    const isChatEnabled = chatStates.get(message.author.id) || false;

    // 채팅이 활성화되지 않았고 멘션도 없고 키워드도 없으면 무시
    if (!isMentioned && !hasKeyword && !isChatEnabled) return;
    
    // 채팅이 비활성화된 상태에서는 멘션만 처리 (키워드는 무시)
    if (!isChatEnabled && !isMentioned) return;

    // 레이트리밋 확인
    const userId = message.author.id;
    const guildId = message.guildId || 'dm';
    
    if (!rateLimiter.checkLimit(userId, guildId)) {
      await message.reply('⏰ 요청이 너무 빈번합니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    logger.info(`메시지 처리 시작: ${message.author.tag} - ${message.content.substring(0, 100)}`);

    // AI Worker로 직접 요청 전송 (BFF 제거)
    const response = await aiWorkerClient.sendChatRequest({
      userId: message.author.id,
      username: message.author.username,
      guildId: message.guildId || null,
      channelId: message.channelId,
      content: message.content,
      messageId: message.id,
    });

    // 응답 스트리밍 → 전체 수집 후 한 번에 전송
    if (response && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullResponse = ''; // 전체 응답 누적
      const sentMsg = await message.reply('생각중...');

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let idx;
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            
            if (!line) continue;                 // 빈 줄
            if (line.startsWith(':')) continue;  // 하트비트
            if (line.startsWith('event: ')) continue; // 이벤트 타입
            
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (!data) continue;
              if (data === '[DONE]') break;
              
              try {
                const payload = JSON.parse(data);
                
                const hasContent = !!payload.content;
                const contentLen = payload.content?.length || 0;
                logger.info(`스트리밍 청크: content=${hasContent}, len=${contentLen}, finished=${!!payload.finished}`);
                
                if (payload.content) {
                  // 누적만 하고 메시지 수정 안 함
                  fullResponse += payload.content;
                  
                  // Discord 2000자 제한 체크 (스트리밍은 계속 진행)
                  // finished 신호를 받은 후 최종적으로 자르기
                }
                
                // 스트리밍 완료 확인
                if (payload.finished) {
                  logger.info('스트리밍 완료 신호 수신');
                  break;
                }
              } catch (e) {
                logger.error('JSON 파싱 실패', { line: line.substring(0, 100), error: e });
              }
            }
          }
        }
        
        // 전체 응답을 한 번에 전송 (Discord 2000자 제한 적용)
        logger.info(`스트리밍 완료: fullResponse.length=${fullResponse.length}, preview="${fullResponse.substring(0, 100)}"`);
        
        if (fullResponse && fullResponse.trim()) {
          let finalResponse = fullResponse.trim();
          
          // Discord 메시지 길이 제한 (2000자)
          if (finalResponse.length > 2000) {
            finalResponse = finalResponse.slice(0, 1997) + '...';
            logger.info('응답이 2000자를 초과하여 자름', { originalLength: fullResponse.length });
          }
          
          await sentMsg.edit(finalResponse);
          logger.info('응답 전송 완료', { responseLength: finalResponse.length });
        } else {
          logger.error('fullResponse가 비어있음!');
          await sentMsg.edit('죄송합니다. 응답을 생성하지 못했습니다.');
        }
        
      } catch (error) {
        logger.error('스트리밍 응답 처리 중 오류:', error);
        await sentMsg.edit('죄송합니다. 응답 처리 중 오류가 발생했습니다.');
      } finally {
        try { await reader.cancel(); } catch {}
      }
    }

  } catch (error) {
    logger.error('메시지 처리 중 오류:', error);
    await message.reply('죄송합니다. 처리 중 오류가 발생했습니다.');
  }
});

// 에러 처리
client.on('error', (error) => {
  logger.error('Discord 클라이언트 오류:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('처리되지 않은 Promise 거부:', reason);
});

// 봇 시작
const token = process.env.DISCORD_TOKEN;
if (!token) {
  logger.error('DISCORD_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

client.login(token).catch((error) => {
  logger.error('Discord 로그인 실패:', error);
  logger.error('토큰 길이:', token?.length);
  logger.error('토큰 시작:', token?.substring(0, 10));
  process.exit(1);
});
