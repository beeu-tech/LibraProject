# ============================================================================
# 무료 모드 실행 준비 스크립트
# ============================================================================

Write-Host "=== 리브라 봇 무료 모드 실행 준비 ===" -ForegroundColor Cyan
Write-Host ""

# 1. Docker Desktop 확인
Write-Host "[1/4] Docker Desktop 확인..." -ForegroundColor Yellow
try {
    $dockerVersion = docker version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✅ Docker Desktop 실행 중" -ForegroundColor Green
    } else {
        Write-Host "  ❌ Docker Desktop이 실행되지 않았습니다!" -ForegroundColor Red
        Write-Host "  → Docker Desktop을 시작한 후 다시 실행하세요." -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "  ❌ Docker가 설치되지 않았습니다!" -ForegroundColor Red
    Write-Host "  → https://www.docker.com/products/docker-desktop 에서 설치하세요." -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# 2. .env 파일 확인
Write-Host "[2/4] 환경변수 파일 확인..." -ForegroundColor Yellow

if (Test-Path ".env") {
    Write-Host "  ✅ .env 파일이 존재합니다." -ForegroundColor Green
    
    # API 키 확인
    $envContent = Get-Content .env -Raw
    
    $hasGroqKey = $envContent -match 'OPENAI_API_KEY=gsk_'
    $hasCfToken = $envContent -match 'CF_API_TOKEN=.+'
    $hasCfAccount = $envContent -match 'CF_ACCOUNT_ID=.+'
    $hasDiscord = $envContent -match 'DISCORD_TOKEN=.+'
    
    Write-Host ""
    Write-Host "  필수 API 키 확인:" -ForegroundColor Cyan
    
    if ($hasGroqKey) {
        Write-Host "    ✅ OPENAI_API_KEY (Groq)" -ForegroundColor Green
    } else {
        Write-Host "    ❌ OPENAI_API_KEY (Groq) - 설정 필요!" -ForegroundColor Red
        Write-Host "       발급: https://console.groq.com/keys" -ForegroundColor Yellow
    }
    
    if ($hasCfToken) {
        Write-Host "    ✅ CF_API_TOKEN (Cloudflare)" -ForegroundColor Green
    } else {
        Write-Host "    ⚠️  CF_API_TOKEN (Cloudflare) - 선택 사항" -ForegroundColor Yellow
        Write-Host "       발급: https://dash.cloudflare.com/profile/api-tokens" -ForegroundColor Yellow
    }
    
    if ($hasCfAccount) {
        Write-Host "    ✅ CF_ACCOUNT_ID (Cloudflare)" -ForegroundColor Green
    } else {
        Write-Host "    ⚠️  CF_ACCOUNT_ID (Cloudflare) - 선택 사항" -ForegroundColor Yellow
    }
    
    if ($hasDiscord) {
        Write-Host "    ✅ DISCORD_TOKEN" -ForegroundColor Green
    } else {
        Write-Host "    ❌ DISCORD_TOKEN - 설정 필요!" -ForegroundColor Red
        Write-Host "       발급: https://discord.com/developers/applications" -ForegroundColor Yellow
    }
    
    if (-not ($hasGroqKey -and $hasDiscord)) {
        Write-Host ""
        Write-Host "  ❌ 필수 API 키가 누락되었습니다!" -ForegroundColor Red
        Write-Host "  → .env 파일을 열어서 API 키를 설정하세요." -ForegroundColor Yellow
        Write-Host "  → env.free.example 파일을 참고하세요." -ForegroundColor Yellow
        
        # .env 파일 열기
        $response = Read-Host "  .env 파일을 지금 열까요? (Y/N)"
        if ($response -eq 'Y' -or $response -eq 'y') {
            notepad .env
            Write-Host ""
            Write-Host "  API 키 설정 후 이 스크립트를 다시 실행하세요." -ForegroundColor Yellow
        }
        exit 1
    }
    
} else {
    Write-Host "  ❌ .env 파일이 없습니다!" -ForegroundColor Red
    
    if (Test-Path "env.free.example") {
        Write-Host "  → env.free.example을 .env로 복사합니다..." -ForegroundColor Yellow
        Copy-Item "env.free.example" ".env"
        Write-Host "  ✅ .env 파일 생성 완료" -ForegroundColor Green
        Write-Host ""
        Write-Host "  📝 .env 파일을 열어서 API 키를 설정하세요:" -ForegroundColor Cyan
        Write-Host "     1. OPENAI_API_KEY (Groq): https://console.groq.com/keys" -ForegroundColor Yellow
        Write-Host "     2. DISCORD_TOKEN: https://discord.com/developers/applications" -ForegroundColor Yellow
        Write-Host "     3. CF_API_TOKEN (선택): https://dash.cloudflare.com/profile/api-tokens" -ForegroundColor Yellow
        
        notepad .env
        
        Write-Host ""
        Write-Host "  API 키 설정 후 이 스크립트를 다시 실행하세요." -ForegroundColor Yellow
        exit 1
    } else {
        Write-Host "  ❌ env.free.example도 없습니다!" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""

# 3. 기존 컨테이너 확인
Write-Host "[3/4] 기존 컨테이너 확인..." -ForegroundColor Yellow

$runningContainers = docker ps --filter "name=libra" --format "{{.Names}}"

if ($runningContainers) {
    Write-Host "  ⚠️  기존 컨테이너가 실행 중입니다:" -ForegroundColor Yellow
    $runningContainers | ForEach-Object { Write-Host "     - $_" -ForegroundColor Gray }
    Write-Host ""
    
    $response = Read-Host "  기존 컨테이너를 중지하고 무료 모드로 전환할까요? (Y/N)"
    if ($response -eq 'Y' -or $response -eq 'y') {
        Write-Host "  → 기존 컨테이너 중지 중..." -ForegroundColor Yellow
        docker compose down
        Write-Host "  ✅ 중지 완료" -ForegroundColor Green
    } else {
        Write-Host "  → 취소되었습니다." -ForegroundColor Yellow
        exit 0
    }
} else {
    Write-Host "  ✅ 실행 중인 컨테이너 없음" -ForegroundColor Green
}

Write-Host ""

# 4. 무료 모드 실행
Write-Host "[4/4] 무료 모드 실행..." -ForegroundColor Yellow
Write-Host "  → docker compose -f docker-compose.voice.yml -f docker-compose.free.yml up -d" -ForegroundColor Cyan
Write-Host ""

docker compose -f docker-compose.voice.yml -f docker-compose.free.yml up -d

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "=== ✅ 무료 모드 실행 성공! ===" -ForegroundColor Green
    Write-Host ""
    Write-Host "실행 중인 컨테이너:" -ForegroundColor Cyan
    docker ps --filter "name=libra" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    
    Write-Host ""
    Write-Host "로그 확인:" -ForegroundColor Cyan
    Write-Host "  docker compose -f docker-compose.voice.yml -f docker-compose.free.yml logs -f gateway" -ForegroundColor Yellow
    
    Write-Host ""
    Write-Host "중지:" -ForegroundColor Cyan
    Write-Host "  docker compose -f docker-compose.voice.yml -f docker-compose.free.yml down" -ForegroundColor Yellow
    
    Write-Host ""
    Write-Host "✨ llm, asr 컨테이너가 없어야 정상입니다 (로컬 부하 0%)" -ForegroundColor Green
    
    # 5초 후 로그 표시
    Write-Host ""
    Write-Host "5초 후 Gateway 로그를 표시합니다..." -ForegroundColor Cyan
    Start-Sleep -Seconds 5
    docker compose -f docker-compose.voice.yml -f docker-compose.free.yml logs --tail 30 gateway
    
} else {
    Write-Host ""
    Write-Host "=== ❌ 실행 실패 ===" -ForegroundColor Red
    Write-Host "위 에러 메시지를 확인하세요." -ForegroundColor Yellow
}

