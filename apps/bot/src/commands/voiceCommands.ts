/**
 * Discord 음성 채팅 명령어
 */

import { SlashCommandBuilder, CommandInteraction, GuildMember } from 'discord.js';
import { VoiceService } from '../services/voiceService';
import { BFFClient } from '../services/bffClient';
import { createLogger } from '../utils/logger';

const logger = createLogger('voice-commands');

export interface VoiceCommandContext {
  voiceService: VoiceService;
  bffClient: BFFClient;
}

// 음성 채널 참여 명령어
export const joinVoiceCommand = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('음성 채널에 참여합니다'),
  
  async execute(interaction: CommandInteraction, context: VoiceCommandContext) {
    const { voiceService } = context;
    
    if (!interaction.guild || !interaction.member) {
      return interaction.reply('이 명령어는 서버에서만 사용할 수 있습니다.');
    }

    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      return interaction.reply('먼저 음성 채널에 참여해주세요.');
    }

    try {
      const success = await voiceService.joinVoiceChannel(voiceChannel as any, member.id);
      
      if (success) {
        await interaction.reply(`🎤 ${voiceChannel.name}에 참여했습니다!`);
        logger.info('Joined voice channel', { 
          userId: member.id, 
          channelId: voiceChannel.id,
          channelName: voiceChannel.name 
        });
      } else {
        await interaction.reply('음성 채널 참여에 실패했습니다.');
      }
    } catch (error) {
      logger.error('Failed to join voice channel', { error, userId: member.id });
      await interaction.reply('음성 채널 참여 중 오류가 발생했습니다.');
    }
  }
};

// 음성 채널 나가기 명령어
export const leaveVoiceCommand = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('음성 채널에서 나갑니다'),
  
  async execute(interaction: CommandInteraction, context: VoiceCommandContext) {
    const { voiceService } = context;
    
    if (!interaction.guild || !interaction.member) {
      return interaction.reply('이 명령어는 서버에서만 사용할 수 있습니다.');
    }

    const member = interaction.member as GuildMember;

    try {
      const success = await voiceService.leaveVoiceChannel(member.id);
      
      if (success) {
        await interaction.reply('👋 음성 채널에서 나갔습니다.');
        logger.info('Left voice channel', { userId: member.id });
      } else {
        await interaction.reply('음성 채널에 참여하지 않았습니다.');
      }
    } catch (error) {
      logger.error('Failed to leave voice channel', { error, userId: member.id });
      await interaction.reply('음성 채널 나가기 중 오류가 발생했습니다.');
    }
  }
};

// 음성 녹음 시작 명령어
export const startRecordingCommand = {
  data: new SlashCommandBuilder()
    .setName('record')
    .setDescription('음성 녹음을 시작합니다'),
  
  async execute(interaction: CommandInteraction, context: VoiceCommandContext) {
    const { voiceService } = context;
    
    if (!interaction.guild || !interaction.member) {
      return interaction.reply('이 명령어는 서버에서만 사용할 수 있습니다.');
    }

    const member = interaction.member as GuildMember;

    if (!voiceService.isInVoiceChannel(member.id)) {
      return interaction.reply('먼저 음성 채널에 참여해주세요.');
    }

    if (voiceService.isRecording(member.id)) {
      return interaction.reply('이미 녹음 중입니다.');
    }

    try {
      const success = await voiceService.startRecording(member.id);
      
      if (success) {
        await interaction.reply('🎙️ 음성 녹음을 시작했습니다. 말씀해주세요!');
        logger.info('Started voice recording', { userId: member.id });
      } else {
        await interaction.reply('음성 녹음 시작에 실패했습니다.');
      }
    } catch (error) {
      logger.error('Failed to start recording', { error, userId: member.id });
      await interaction.reply('음성 녹음 시작 중 오류가 발생했습니다.');
    }
  }
};

// 음성 녹음 중지 명령어
export const stopRecordingCommand = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('음성 녹음을 중지하고 텍스트로 변환합니다'),
  
  async execute(interaction: CommandInteraction, context: VoiceCommandContext) {
    const { voiceService } = context;
    
    if (!interaction.guild || !interaction.member) {
      return interaction.reply('이 명령어는 서버에서만 사용할 수 있습니다.');
    }

    const member = interaction.member as GuildMember;

    if (!voiceService.isRecording(member.id)) {
      return interaction.reply('현재 녹음 중이 아닙니다.');
    }

    try {
      await interaction.deferReply();
      
      const transcription = await voiceService.stopRecording(member.id);
      
      if (transcription) {
        await interaction.editReply(`📝 인식된 텍스트: "${transcription}"`);
        logger.info('Voice transcription completed', { 
          userId: member.id, 
          text: transcription 
        });
      } else {
        await interaction.editReply('음성 인식에 실패했습니다.');
      }
    } catch (error) {
      logger.error('Failed to stop recording', { error, userId: member.id });
      await interaction.editReply('음성 녹음 중지 중 오류가 발생했습니다.');
    }
  }
};

// 음성 상태 확인 명령어
export const voiceStatusCommand = {
  data: new SlashCommandBuilder()
    .setName('voice-status')
    .setDescription('음성 채팅 상태를 확인합니다'),
  
  async execute(interaction: CommandInteraction, context: VoiceCommandContext) {
    const { voiceService } = context;
    
    if (!interaction.guild || !interaction.member) {
      return interaction.reply('이 명령어는 서버에서만 사용할 수 있습니다.');
    }

    const member = interaction.member as GuildMember;
    const isInVoice = voiceService.isInVoiceChannel(member.id);
    const isRecording = voiceService.isRecording(member.id);
    const isPlaying = voiceService.isPlaying(member.id);

    const status = {
      '음성 채널 참여': isInVoice ? '✅' : '❌',
      '녹음 중': isRecording ? '🎙️' : '⏹️',
      '재생 중': isPlaying ? '🔊' : '🔇'
    };

    const statusText = Object.entries(status)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    await interaction.reply(`**음성 채팅 상태**\n\`\`\`\n${statusText}\n\`\`\``);
  }
};

// 모든 음성 명령어 내보내기
export const voiceCommands = [
  joinVoiceCommand,
  leaveVoiceCommand,
  startRecordingCommand,
  stopRecordingCommand,
  voiceStatusCommand
];
