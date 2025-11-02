-- =====================================================
-- 마이그레이션: DB 스키마 무결성 수정
-- 작성일: 2024-10-13
-- 목적: user_id 타입 불일치 문제 해결 (VARCHAR → INTEGER + FK)
-- =====================================================

BEGIN;

-- 1. messages 테이블 수정
DO $$
BEGIN
    -- user_id 컬럼이 VARCHAR인 경우에만 변경
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'messages' 
        AND column_name = 'user_id' 
        AND data_type = 'character varying'
    ) THEN
        -- 타입 변경 (기존 데이터가 숫자 형식이어야 함)
        ALTER TABLE messages 
            ALTER COLUMN user_id TYPE INTEGER USING user_id::integer;
        
        RAISE NOTICE 'messages.user_id 타입 변경 완료: VARCHAR -> INTEGER';
    END IF;
    
    -- FK 제약조건이 없는 경우에만 추가
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_messages_user'
    ) THEN
        ALTER TABLE messages 
            ADD CONSTRAINT fk_messages_user 
            FOREIGN KEY (user_id) REFERENCES users(id) 
            ON DELETE CASCADE;
        
        RAISE NOTICE 'messages.user_id FK 제약조건 추가 완료';
    END IF;
END $$;

-- 2. memories 테이블 수정
DO $$
BEGIN
    -- user_id 컬럼이 VARCHAR인 경우에만 변경
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'memories' 
        AND column_name = 'user_id' 
        AND data_type = 'character varying'
    ) THEN
        -- 타입 변경
        ALTER TABLE memories 
            ALTER COLUMN user_id TYPE INTEGER USING user_id::integer;
        
        RAISE NOTICE 'memories.user_id 타입 변경 완료: VARCHAR -> INTEGER';
    END IF;
    
    -- FK 제약조건이 없는 경우에만 추가
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_memories_user'
    ) THEN
        ALTER TABLE memories 
            ADD CONSTRAINT fk_memories_user 
            FOREIGN KEY (user_id) REFERENCES users(id) 
            ON DELETE CASCADE;
        
        RAISE NOTICE 'memories.user_id FK 제약조건 추가 완료';
    END IF;
END $$;

-- 3. 인덱스 재생성 (성능 최적화)
DROP INDEX IF EXISTS idx_messages_user_id;
CREATE INDEX idx_messages_user_id ON messages(user_id);

DROP INDEX IF EXISTS idx_memories_user_id;
CREATE INDEX idx_memories_user_id ON memories(user_id);

COMMIT;

-- 검증 쿼리
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name IN ('messages', 'memories')
AND column_name = 'user_id';

