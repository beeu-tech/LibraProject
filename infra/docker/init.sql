-- PostgreSQL 초기화 스크립트

-- 데이터베이스 생성 (이미 docker-compose에서 생성됨)
-- CREATE DATABASE libra_bot;

-- 사용자 생성 (이미 docker-compose에서 생성됨)
-- CREATE USER libra_user WITH PASSWORD 'libra_password';
-- GRANT ALL PRIVILEGES ON DATABASE libra_bot TO libra_user;

-- 확장 기능 활성화
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- CREATE EXTENSION IF NOT EXISTS "vector"; -- pgvector 이미지에서 자동 활성화

-- 테이블 생성
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    discord_user_id VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(255),
    locale VARCHAR(10) DEFAULT 'ko',
    voice_prefs TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guilds (
    id SERIAL PRIMARY KEY,
    discord_guild_id VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    policies TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    channel_id VARCHAR(255),
    mode VARCHAR(20) DEFAULT 'text',
    state TEXT,
    last_seen TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id),
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    tokens INTEGER DEFAULT 0,
    latency_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memories (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    scope VARCHAR(20) DEFAULT 'user',
    content TEXT,
    -- vector VECTOR(1536), -- pgvector 확장 필요
    metadata TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_guilds_discord_id ON guilds(discord_guild_id);
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);

-- 권한 설정
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO libra_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO libra_user;
