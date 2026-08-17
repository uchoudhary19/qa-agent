import { Client } from "pg";
import { createEmbedding } from "./ollama.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://qa:qa_password@localhost:5432/qa_brain";

export interface Memory {
  id: string;
  content: string;
  memoryType: string;
  source?: string;
  confidence: number;
  metadata: Record<string, unknown>;
  similarity?: number;
}

function getClient(): Client {
  return new Client({ connectionString: databaseUrl });
}

export async function remember(
  content: string,
  memoryType = "fact",
  source = "agent",
  confidence = 1.0,
  metadata: Record<string, unknown> = {}
): Promise<string> {
  const embedding = await createEmbedding(content);
  const client = getClient();

  try {
    await client.connect();

    const result = await client.query(
      `INSERT INTO memories (content, memory_type, source, confidence, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        content,
        memoryType,
        source,
        confidence,
        JSON.stringify(metadata),
        JSON.stringify(embedding)
      ]
    );

    return result.rows[0].id;
  } finally {
    await client.end();
  }
}

export async function recall(limit = 10): Promise<Memory[]> {
  const client = getClient();

  try {
    await client.connect();

    const result = await client.query(
      `SELECT id, content, memory_type, source, confidence, metadata
       FROM memories ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      content: row.content,
      memoryType: row.memory_type,
      source: row.source,
      confidence: Number(row.confidence),
      metadata: row.metadata
    }));
  } finally {
    await client.end();
  }
}

export async function recallRelevant(
  question: string,
  limit = 5
): Promise<Memory[]> {
  const embedding = await createEmbedding(question);
  const client = getClient();

  try {
    await client.connect();

    const result = await client.query(
      `SELECT id, content, memory_type, source, confidence, metadata,
              1 - (embedding <=> $1::vector) AS similarity
       FROM memories WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector LIMIT $2`,
      [JSON.stringify(embedding), limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      content: row.content,
      memoryType: row.memory_type,
      source: row.source,
      confidence: Number(row.confidence),
      metadata: row.metadata,
      similarity: Number(row.similarity)
    }));
  } finally {
    await client.end();
  }
}

export async function forget(id: string): Promise<boolean> {
  const client = getClient();

  try {
    await client.connect();
    const result = await client.query(
      "DELETE FROM memories WHERE id = $1",
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    await client.end();
  }
}

export async function count(): Promise<number> {
  const client = getClient();

  try {
    await client.connect();
    const result = await client.query("SELECT COUNT(*) FROM memories");
    return Number(result.rows[0].count);
  } finally {
    await client.end();
  }
}

export async function searchByText(
  query: string,
  limit = 20
): Promise<Memory[]> {
  const client = getClient();

  try {
    await client.connect();

    const result = await client.query(
      `SELECT id, content, memory_type, source, confidence, metadata
       FROM memories WHERE content ILIKE $1
       ORDER BY created_at DESC LIMIT $2`,
      [`%${query}%`, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      content: row.content,
      memoryType: row.memory_type,
      source: row.source,
      confidence: Number(row.confidence),
      metadata: row.metadata
    }));
  } finally {
    await client.end();
  }
}
