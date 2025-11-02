export type IntentAction = 'HELP' | 'RESET' | 'MUTE' | 'STATUS' | 'LLM';

const RULES: Array<{ test: (t: string) => boolean; action: IntentAction }> = [
  { test: t => t.trim().startsWith('/help'), action: 'HELP' },
  { test: t => t.trim().startsWith('/reset'), action: 'RESET' },
  { test: t => /\/mute\s+\d+/.test(t), action: 'MUTE' },
  { test: t => t.trim().startsWith('/status'), action: 'STATUS' },
];

export function routeIntent(text: string): IntentAction {
  for (const r of RULES) {
    if (r.test(text)) {
      return r.action;
    }
  }
  return 'LLM';
}

export function isDeterministicIntent(intent: IntentAction): boolean {
  return intent !== 'LLM';
}

export function getIntentResponse(intent: IntentAction): string | null {
  switch (intent) {
    case 'HELP':
      return '사용법: /help, /reset, /mute <초>, /status';
    case 'RESET':
      return '세션을 초기화했어요.';
    case 'MUTE':
      return '뮤트 설정 반영';
    case 'STATUS':
      return '현재 시스템 상태는 정상입니다.';
    default:
      return null;
  }
}
