import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync
} from "node:fs";
import { join, relative, extname, dirname, basename } from "node:path";

const automationPath =
  process.env.AUTOMATION_PROJECT_PATH ?? "";

export interface TestFileSummary {
  path: string;
  size: number;
  describes: string[];
  tests: string[];
  tags: string[];
}

export interface AutomationStatus {
  mounted: boolean;
  projectPath: string;
  testCount: number;
  pageObjectCount: number;
}

export interface WriteResult {
  filePath: string;
  absolutePath: string;
  written: boolean;
  alreadyExisted: boolean;
}

// ---- filesystem helpers ----

function walkDir(
  dir: string,
  ext: string,
  exclude: string[] = []
): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!exclude.includes(entry.name)) {
        results.push(...walkDir(full, ext, exclude));
      }
    } else if (entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

function extractSpecMeta(content: string): {
  describes: string[];
  tests: string[];
  tags: string[];
} {
  const describes: string[] = [];
  const tests: string[] = [];
  const tags = new Set<string>();

  for (const line of content.split("\n")) {
    const describeMatch = line.match(/test\.describe\(['"`](.*?)['"`]/);
    if (describeMatch) describes.push(describeMatch[1]);

    const testMatch = line.match(/test(?:\.skip)?\(\s*['"`](.*?)['"`]/);
    if (testMatch && !line.includes("test.describe")) {
      tests.push(testMatch[1]);
    }

    for (const [tag] of line.matchAll(/@[\w-]+/g)) {
      tags.add(tag);
    }
  }

  return { describes, tests, tags: [...tags] };
}

// ---- public API ----

export function getStatus(): AutomationStatus {
  if (!automationPath || !existsSync(automationPath)) {
    return {
      mounted: false,
      projectPath: automationPath,
      testCount: 0,
      pageObjectCount: 0
    };
  }

  const testFiles = walkDir(
    join(automationPath, "tests"),
    ".spec.ts",
    ["node_modules", "allure-results", "test-results", "blob-report"]
  );

  const pageFiles = walkDir(
    join(automationPath, "src", "pages"),
    ".ts"
  );

  return {
    mounted: true,
    projectPath: automationPath,
    testCount: testFiles.length,
    pageObjectCount: pageFiles.length
  };
}

export function listTestFiles(filter?: string): TestFileSummary[] {
  if (!automationPath || !existsSync(automationPath)) return [];

  const testsDir = join(automationPath, "tests");
  const files = walkDir(testsDir, ".spec.ts", [
    "node_modules",
    "allure-results",
    "test-results",
    "blob-report"
  ]);

  return files
    .filter(
      f =>
        !filter ||
        relative(testsDir, f)
          .toLowerCase()
          .includes(filter.toLowerCase())
    )
    .map(f => {
      const content = readFileSync(f, "utf-8");
      const meta = extractSpecMeta(content);
      return {
        path: relative(automationPath, f),
        size: statSync(f).size,
        ...meta
      };
    });
}

export function readTestFile(relativePath: string): string | null {
  if (!automationPath) return null;

  const resolved = join(automationPath, relativePath);
  if (!resolved.startsWith(automationPath)) return null;

  if (!existsSync(resolved)) return null;

  const allowed = [".ts", ".js", ".json", ".md", ".mjs"];
  if (!allowed.includes(extname(resolved))) return null;

  return readFileSync(resolved, "utf-8");
}

export function listPageObjects(): string[] {
  if (!automationPath) return [];
  return walkDir(join(automationPath, "src", "pages"), ".ts").map(f =>
    relative(automationPath, f)
  );
}

/**
 * Extract method signatures from a page object file.
 * Returns a formatted string suitable for inclusion in a prompt.
 */
function extractPageObjectSignatures(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  const classMatch = content.match(/export class (\w+)/);
  const className = classMatch ? classMatch[1] : basename(filePath, ".ts");

  const methods: string[] = [];
  for (const line of content.split("\n")) {
    // Match public async methods
    const m = line.match(/^\s{2}async (\w+)\s*\(([^)]*)\)/);
    if (m && m[1] !== "constructor") {
      methods.push(`  ${m[1]}(${m[2].trim()})`);
    }
  }

  if (!methods.length) return "";
  return `${className}:\n${methods.join("\n")}`;
}

/**
 * Build page object context for the given feature keywords.
 * Always includes LoginPage and HomePage (needed for setup).
 * Adds feature-specific page objects based on keyword matching.
 */
export function getPageObjectContext(featureKeywords: string): string {
  if (!automationPath) return "";

  const pagesDir = join(automationPath, "src", "pages");
  if (!existsSync(pagesDir)) return "";

  const allPages = walkDir(pagesDir, ".ts");

  // Always include these core pages
  const alwaysInclude = ["login.page.ts", "home.page.ts", "base.page.ts"];

  // Score pages by keyword relevance
  const keywords = featureKeywords.toLowerCase().split(/\s+/);
  const scored: Array<{ file: string; score: number }> = allPages.map(f => {
    const name = basename(f).toLowerCase();
    const isCore = alwaysInclude.some(a => name === a);
    if (isCore) return { file: f, score: 100 };

    let score = 0;
    for (const kw of keywords) {
      if (name.includes(kw)) score += 10;
      // Check content for keyword matches too (first 50 lines only for speed)
      const firstLines = readFileSync(f, "utf-8")
        .split("\n")
        .slice(0, 50)
        .join("\n")
        .toLowerCase();
      if (firstLines.includes(kw)) score += 2;
    }
    return { file: f, score };
  });

  // Always include core + top 2 relevant feature pages
  const corePages = scored.filter(s => s.score === 100).map(s => s.file);
  const featurePages = scored
    .filter(s => s.score > 0 && s.score < 100)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(s => s.file);

  const pagesToInclude = [...new Set([...corePages, ...featurePages])];

  const sections = pagesToInclude
    .map(f => extractPageObjectSignatures(f))
    .filter(Boolean);

  return sections.join("\n\n");
}

/**
 * Write a generated test file to the automation project.
 * Safety: only allows writing inside the tests/ directory with .spec.ts extension.
 */
export function writeTestFile(
  relativePath: string,
  content: string,
  overwrite = false
): WriteResult {
  if (!automationPath) {
    throw new Error("Automation project is not mounted.");
  }

  // Security: enforce tests/ prefix and .spec.ts suffix
  const normalised = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalised.startsWith("tests/")) {
    throw new Error("Test files must be written inside the tests/ directory.");
  }
  if (!normalised.endsWith(".spec.ts")) {
    throw new Error("Test files must have the .spec.ts extension.");
  }
  if (normalised.includes("..")) {
    throw new Error("Path must not contain '..'.");
  }

  const absolutePath = join(automationPath, normalised);

  const alreadyExisted = existsSync(absolutePath);
  if (alreadyExisted && !overwrite) {
    throw new Error(
      `File already exists: ${normalised}. Pass overwrite=true to replace it.`
    );
  }

  // Create parent directories if needed
  mkdirSync(dirname(absolutePath), { recursive: true });

  writeFileSync(absolutePath, content, "utf-8");

  return { filePath: normalised, absolutePath, written: true, alreadyExisted };
}
