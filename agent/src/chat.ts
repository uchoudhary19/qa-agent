import readline from "node:readline";
import { remember, recall, recallRelevant } from "./memory.js";
import { chat } from "./ollama.js";

async function main(): Promise<void> {
  console.log("");
  console.log("======================================");
  console.log("             TESTA QA BRAIN");
  console.log("======================================");
  console.log("");
  console.log("Commands:");
  console.log("  memory              — list stored knowledge");
  console.log("  remember <text>     — store a fact");
  console.log("  exit                — quit");
  console.log("");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "You > "
  });

  rl.prompt();

  // Maintain a simple conversation history for context
  const history: { role: "user" | "assistant"; content: string }[] = [];

  for await (const line of rl) {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      continue;
    }

    if (input.toLowerCase() === "exit") {
      rl.close();
      break;
    }

    if (input.toLowerCase() === "memory") {
      const memories = await recall(20);
      console.log("\nTesta currently remembers:");
      for (const memory of memories) {
        console.log(`  [${memory.memoryType}] ${memory.content}`);
      }
      console.log("");
      rl.prompt();
      continue;
    }

    if (input.toLowerCase().startsWith("remember ")) {
      const content = input.substring(9).trim();
      if (content) {
        const id = await remember(content, "fact", "user");
        console.log(`\n✓ Remembered (${id})\n`);
      }
      rl.prompt();
      continue;
    }

    try {
      const memories = await recallRelevant(input, 5);

      const knowledge = memories
        .map(
          m =>
            `[${m.memoryType}] ${m.content} (relevance: ${m.similarity?.toFixed(3) ?? "n/a"})`
        )
        .join("\n");

      history.push({ role: "user", content: input });

      const answer = await chat(history, knowledge);

      history.push({ role: "assistant", content: answer });

      // Keep history at last 10 turns to avoid runaway context
      if (history.length > 20) history.splice(0, 2);

      console.log(`\nTesta > ${answer}\n`);
    } catch (error) {
      console.error("\n❌ Error:", error);
    }

    rl.prompt();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
