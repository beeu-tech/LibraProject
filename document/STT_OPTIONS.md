# 무료 STT (음성 인식) 서비스 옵션

## 현재 사용 중인 서비스

### 1. Vosk (완전 무료 🆓)
- **장점**: 완전 무료, 오프라인 작동, 프라이버시 우수
- **단점**: 정확도가 클라우드 서비스보다 낮을 수 있음
- **설정**: 이미 프로젝트에 통합됨
- **모델 크기**: 40MB (small-en) ~ 1.8GB (full)
- **지원 언어**: 영어, 한국어, 중국어 등 다국어

```yaml
environment:
  - VOSK_MODEL_PATH=/app/models/vosk-model-small-en-us-0.15
```

## 무료 클라우드 STT 서비스

### 2. Azure Speech Service (월 5시간 무료) ✅
- **무료 티어**: 월 5시간 무료 오디오 처리
- **정확도**: 매우 높음
- **지연 시간**: 낮음 (~1초)
- **지원 언어**: 100개 이상
- **이미 키 설정됨**: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`

```bash
# .env 파일
AZURE_SPEECH_KEY=your_key_here
AZURE_SPEECH_REGION=koreacentral
```

### 3. Google Cloud Speech-to-Text (월 60분 무료)
- **무료 티어**: 월 60분 무료 오디오 처리
- **정확도**: 매우 높음
- **지연 시간**: 낮음
- **지원 언어**: 125개 이상
- **가격**: 60분 초과 시 분당 $0.006

```bash
# 설정 필요
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
```

### 4. OpenAI Whisper API (저렴)
- **가격**: 분당 $0.006 (무료 아님)
- **정확도**: 최상급
- **지연 시간**: 중간 (~2-3초)
- **지원 언어**: 99개 (한국어 포함)
- **장점**: 기존 OpenAI API 키 사용 가능

```bash
# 이미 설정됨
OPENAI_API_KEY=your_key_here
```

### 5. AssemblyAI (월 5시간 무료)
- **무료 티어**: 월 5시간 무료 오디오 처리
- **정확도**: 높음
- **지연 시간**: 낮음
- **지원 언어**: 영어 위주 (한국어 제한적)

### 6. ElevenLabs (TTS 주력)
- **주 기능**: TTS (Text-to-Speech)
- **STT 지원**: 제한적
- **이미 키 설정됨**: `ELEVENLABS_API_KEY`
- **추천**: TTS용으로만 사용

## 추천 조합

### 개발/테스트 환경
```yaml
STT: Vosk (로컬, 무료)
TTS: ElevenLabs (이미 키 있음)
```

### 프로덕션 환경 (한국어)
```yaml
STT: Azure Speech Service (월 5시간 무료)
TTS: ElevenLabs
백업: Vosk (무료)
```

### 프로덕션 환경 (영어)
```yaml
STT: OpenAI Whisper API (높은 정확도)
TTS: ElevenLabs
백업: Vosk (무료)
```

## 구현 예시

### Azure Speech Service 사용
```typescript
// apps/bot/src/services/azureSttService.ts
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

export class AzureSTTService {
  private speechConfig: sdk.SpeechConfig;

  constructor() {
    this.speechConfig = sdk.SpeechConfig.fromSubscription(
      process.env.AZURE_SPEECH_KEY!,
      process.env.AZURE_SPEECH_REGION!
    );
    this.speechConfig.speechRecognitionLanguage = 'ko-KR';
  }

  async transcribe(audioBuffer: Buffer): Promise<string> {
    const audioConfig = sdk.AudioConfig.fromWavFileInput(audioBuffer);
    const recognizer = new sdk.SpeechRecognizer(this.speechConfig, audioConfig);
    
    return new Promise((resolve, reject) => {
      recognizer.recognizeOnceAsync(result => {
        if (result.reason === sdk.ResultReason.RecognizedSpeech) {
          resolve(result.text);
        } else {
          reject(new Error('Recognition failed'));
        }
      });
    });
  }
}
```

## 비용 비교 (월간 기준)

| 서비스 | 무료 티어 | 초과 시 비용 |
|--------|-----------|--------------|
| Vosk | 무제한 | 무료 |
| Azure Speech | 5시간 | 시간당 $1 |
| Google Speech | 60분 | 분당 $0.006 |
| OpenAI Whisper | 없음 | 분당 $0.006 |
| AssemblyAI | 5시간 | 시간당 $0.65 |

## 결론

1. **개발 단계**: Vosk 사용 (완전 무료)
2. **프로덕션 초기**: Azure Speech Service (월 5시간 무료)
3. **확장 시**: 사용량에 따라 OpenAI Whisper 또는 Azure 유료 플랜

