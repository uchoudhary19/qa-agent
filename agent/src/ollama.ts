import type { ChatMessage } from "./session.js";

const ollamaUrl =
  process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

export const chatModel =
  process.env.OLLAMA_MODEL ?? "llama3.2";

const embedModel =
  process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";

const SYSTEM_PROMPT = `You are Testa, an AI software quality engineer embedded in a product team.

Your responsibilities:
- Understand product behaviour from the knowledge you have been taught
- Identify test scenarios, edge cases, and quality risks
- Write and review Playwright TypeScript automation tests
- Help QA engineers understand the product deeply

Rules:
1. Never invent product behaviour — only use supplied knowledge as product facts
2. Clearly distinguish known facts from assumptions
3. When knowledge is insufficient, say so explicitly AND ask a targeted clarifying question to fill the gap — this is how you learn
4. Do not claim to have executed a test unless it was actually run
5. Be technically precise and concise
6. When writing Playwright tests, use TypeScript with the page object pattern where the test has multiple interactions`;

export async function createEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${ollamaUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embedModel, input: text })
  });

  if (!response.ok) {
    throw new Error(
      `Embedding failed: ${response.status} ${await response.text()}`
    );
  }

  const data = await response.json();

  if (!data.embeddings?.[0]) {
    throw new Error("Ollama returned no embedding");
  }

  return data.embeddings[0];
}

export async function chat(
  messages: ChatMessage[],
  knowledge: string
): Promise<string> {
  const knowledgeBlock = knowledge.trim()
    ? `\n\nCURRENT PRODUCT KNOWLEDGE:\n${knowledge}`
    : "\n\nNo product knowledge has been loaded yet. When asked product questions, ask the user to teach you by sharing what they know about the product.";

  const systemContent = SYSTEM_PROMPT + knowledgeBlock;

  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: chatModel,
      messages: [
        { role: "system", content: systemContent },
        ...messages
      ],
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(
      `Ollama chat failed: ${response.status} ${await response.text()}`
    );
  }

  const data = await response.json();
  return (data.message?.content ?? "").trim();
}

export async function pingOllama(): Promise<string> {
  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: chatModel,
      messages: [
        {
          role: "user",
          content:
            "Confirm you are operational. Reply with exactly: TESTA ONLINE"
        }
      ],
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama unreachable: ${response.status}`);
  }

  const data = await response.json();
  return (data.message?.content ?? "").trim();
}
