/**
 * 의도 라우터 - 결정론적 명령 처리
 */

export type IntentAction = 'HELP' | 'RESET' | 'MUTE' | 'STATUS' | 'LLM';

export interface IntentResult {
  action: IntentAction;
  params?: Record<string, any>;
}

// 의도 라우팅 규칙
const RULES: Array<{ 
  test: (text: string) => boolean; 
  action: IntentAction;
  extractParams?: (text: string) => Record<string, any>;
}> = [
  // 도움말 명령
  { 
    test: (t) => t.trim().toLowerCase().startsWith('/help') || 
                 t.trim().toLowerCase().includes('도움말') ||
                 t.trim().toLowerCase().includes('help'),
    action: 'HELP' 
  },
  
  // 세션 초기화 명령
  { 
    test: (t) => t.trim().toLowerCase().startsWith('/reset') || 
                 t.trim().toLowerCase().includes('초기화') ||
                 t.trim().toLowerCase().includes('리셋'),
    action: 'RESET' 
  },
  
  // 뮤트 명령 (숫자 포함)
  { 
    test: (t) => /\/mute\s+\d+/.test(t.trim()) || 
                 /뮤트\s+\d+/.test(t.trim()),
    action: 'MUTE',
    extractParams: (t) => {
      const match = t.match(/(\d+)/);
      return { duration: match ? parseInt(match[1]) : 0 };
    }
  },
  
  // 상태 확인 명령
  { 
    test: (t) => t.trim().toLowerCase().startsWith('/status') || 
                 t.trim().toLowerCase().includes('상태') ||
                 t.trim().toLowerCase().includes('status'),
    action: 'STATUS' 
  },
];

/**
 * 텍스트에서 의도를 라우팅
 */
export function routeIntent(text: string): IntentResult {
  const normalizedText = text.trim();
  
  for (const rule of RULES) {
    if (rule.test(normalizedText)) {
      const params = rule.extractParams ? rule.extractParams(normalizedText) : {};
      return {
        action: rule.action,
        params
      };
    }
  }
  
  // 기본적으로 LLM 경로
  return { action: 'LLM' };
}

/**
 * 의도별 응답 템플릿
 */
export function getIntentResponse(intent: IntentResult): string {
  switch (intent.action) {
    case 'HELP':
      return `🤖 **리브라 봇 도움말**

**기본 명령어:**
• \`/help\` - 이 도움말 표시
• \`/reset\` - 대화 세션 초기화
• \`/status\` - 봇 상태 확인
• \`/mute <초>\` - 일정 시간 뮤트

**사용법:**
• 봇을 멘션하거나 "리브라"라고 입력하면 AI와 대화할 수 있습니다
• 자연스러운 한국어로 질문하세요
• 음성 채팅도 지원합니다 (보이스 채널에서)

**주의사항:**
• 개인정보나 민감한 정보는 입력하지 마세요
• Discord 커뮤니티 가이드라인을 준수해주세요`;

    case 'RESET':
      return '✅ 대화 세션이 초기화되었습니다. 새로운 대화를 시작할 수 있습니다.';

    case 'MUTE':
      const duration = intent.params?.duration || 0;
      if (duration > 0) {
        return `🔇 ${duration}초 동안 뮤트 설정이 적용되었습니다.`;
      }
      return '❌ 뮤트 시간을 올바르게 입력해주세요. (예: /mute 300)';

    case 'STATUS':
      return `🟢 **리브라 봇 상태**

**서비스 상태:** 정상 운영
**응답 시간:** < 3초
**지원 기능:** 텍스트 채팅, 음성 채팅 (준비중)
**마지막 업데이트:** ${new Date().toLocaleString('ko-KR')}`;

    case 'LLM':
    default:
      return ''; // LLM으로 전달
  }
}

/**
 * 의도가 결정론적 처리 가능한지 확인
 */
export function isDeterministicIntent(intent: IntentResult): boolean {
  return intent.action !== 'LLM';
}
