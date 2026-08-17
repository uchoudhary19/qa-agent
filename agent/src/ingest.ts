import { remember } from "./memory.js";

export interface IngestResult {
  chunks: number;
  ids: string[];
  skipped: number;
}

function chunkText(text: string, maxSize = 400): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const chunks: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxSize) {
      chunks.push(paragraph);
      continue;
    }

    // Split long paragraphs at sentence boundaries
    const sentences = paragraph.split(/(?<=[.!?])\s+/);
    let current = "";

    for (const sentence of sentences) {
      const candidate = current ? `${current} ${sentence}` : sentence;

      if (candidate.length <= maxSize) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        // If a single sentence exceeds maxSize, keep it as-is
        current = sentence;
      }
    }

    if (current) chunks.push(current);
  }

  return chunks;
}

export async function ingestText(
  text: string,
  source: string,
  memoryType = "fact"
): Promise<IngestResult> {
  const chunks = chunkText(text);
  const ids: string[] = [];
  let skipped = 0;

  for (const chunk of chunks) {
    // Skip trivially short chunks (noise)
    if (chunk.length < 20) {
      skipped++;
      continue;
    }

    const id = await remember(chunk, memoryType, source);
    ids.push(id);
  }

  return { chunks: ids.length, ids, skipped };
}
