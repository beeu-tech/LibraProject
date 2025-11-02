import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },  // 30초간 10명으로 증가
    { duration: '1m', target: 50 },   // 1분간 50명으로 증가
    { duration: '30s', target: 0 },   // 30초간 0명으로 감소
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'], // 95% 요청이 3초 이내
    http_req_failed: ['rate<0.1'],     // 실패율 10% 미만
  },
};

const BFF_URL = __ENV.BFF_URL || 'http://localhost:3001';

export default function () {
  const url = `${BFF_URL}/api/chat/completions`;
  const payload = JSON.stringify({
    userId: `test-user-${__VU}`,
    username: `testuser${__VU}`,
    guildId: null,
    channelId: `test-channel-${__VU}`,
    content: '리브라, 오늘 날씨는 어때? 간단히 답변해줘.',
    messageId: `msg-${__VU}-${Date.now()}`,
    stream: true,
  });
  
  const params = {
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': 'Bearer default',
    },
    timeout: '30s',
  };
  
  const res = http.post(url, payload, params);
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 3s': (r) => r.timings.duration < 3000,
    'has SSE headers': (r) => r.headers['Content-Type']?.includes('text/event-stream'),
  });
  
  // 요청 간 간격
  sleep(1);
}
