CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    content TEXT NOT NULL,

    memory_type VARCHAR(50) NOT NULL DEFAULT 'fact',

    source VARCHAR(100),

    confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    embedding vector(768),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memories_type
    ON memories(memory_type);

CREATE INDEX IF NOT EXISTS idx_memories_created
    ON memories(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memories_embedding
    ON memories USING hnsw (embedding vector_cosine_ops)
    with (
         m = 16,
         ef_connection
    );
