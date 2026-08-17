import { createClient } from "redis";

const redisUrl =
  process.env.REDIS_URL ??
  "redis://localhost:6379";

const redis = createClient({
  url: redisUrl
});

redis.on("error", (error) => {
  console.error("Redis session error:", error);
});

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function connectSessionStore(): Promise<void> {
  if (!redis.isOpen) {
    await redis.connect();
  }
}

export async function getConversation(
  sessionId: string,
  limit = 10
): Promise<ChatMessage[]> {
  await connectSessionStore();

  const messages = await redis.lRange(
    `session:${sessionId}`,
    -limit,
    -1
  );

  return messages.map(
    message => JSON.parse(message) as ChatMessage
  );
}

export async function addMessage(
  sessionId: string,
  message: ChatMessage
): Promise<void> {
  await connectSessionStore();

  const key = `session:${sessionId}`;

  await redis.rPush(
    key,
    JSON.stringify(message)
  );

  await redis.expire(
    key,
    60 * 60 * 24
  );
}

export async function clearConversation(
  sessionId: string
): Promise<void> {
  await connectSessionStore();

  await redis.del(
    `session:${sessionId}`
  );
}
