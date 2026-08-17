#!/usr/bin/env node
/**
 * Testa knowledge ingestion script for the pw-sanity Playwright project.
 *
 * Crawls docs, test specs, page objects, and the data model — then
 * sends everything to the running Testa agent as structured product knowledge.
 *
 * Usage:
 *   node scripts/ingest-project.mjs
 *   node scripts/ingest-project.mjs --dry-run     (print chunks, don't POST)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TESTA_URL  = process.env.TESTA_URL  ?? 'http://localhost:4000';
const PROJECT    = process.env.PROJECT_PATH ??
  '/Users/uchoudhary/Delivery/magnit/qa/pw-sanity';

const DRY_RUN = process.argv.includes('--dry-run');

let posted = 0;
let skipped = 0;

// ---- helpers ----------------------------------------------------------------

function walk(dir, ext, exclude = []) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!exclude.includes(entry.name)) results.push(...walk(full, ext, exclude));
    } else if (!ext || entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

async function post(content, source, type) {
  if (!content || content.trim().length < 20) { skipped++; return; }

  if (DRY_RUN) {
    console.log(`\n[DRY-RUN] type=${type} source=${source}`);
    console.log(content.slice(0, 200) + (content.length > 200 ? '…' : ''));
    posted++;
    return;
  }

  const res = await fetch(`${TESTA_URL}/ingest/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, source, type }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`  ✗ POST failed (${res.status}): ${body.slice(0, 120)}`);
    return;
  }

  const data = await res.json();
  posted++;
  process.stdout.write(`  ✓ ${data.chunks} chunk(s) — ${source}\n`);
}

// ---- 1. System overview -------------------------------------------------------

async function ingestSystemOverview() {
  console.log('\n── System Overview ──');

  const overview = `
The product being tested is the Magnit E-Tips VMS (Vendor Management System).
It is a workforce management platform used by staffing agencies and their clients.

The system has three user portal types:
- Admin/Client portal — used by administrators and client organisations
- Agency portal — used by staffing agencies and their staff
- Candidate portal — used by candidates (workers/contractors)

The backend is built on a microservice architecture. Each service has its own MySQL schema:
authentication, core, timesheets, planning, booking, candidate, agency, client,
messaging, reporting, audit, configuration, fulfillment.

The frontend is an Angular web application.

Key product areas:
- Authentication — login, lockout, session management across portals
- Booking — ad-hoc bookings and vacancy-based bookings (both IR35 UK and Non-UK)
- Candidate management — create, edit, Right-to-Work (RTW), IR35 classification, custom forms
- Timesheet — generation, screen validations, hide-cost settings
- Vacancy — posting, filters, IR35 flags, visibility by role
- Planning — shift planning, plan creation, drag-select shifts
- Business Unit — holidays, regions, tree structure
- General Account Settings — candidate/booking/user management configuration
- Rota / Team Rota — rota patterns, CRUD
- Time & Attendance — rota patterns, clocking devices
- Invoicing / Invoice Manager — screen validations and invoice processing
- Integrations — Magnit VMSLink
- Jobs — SaaS job creation and editing
- User Management — user creation, roles, profile management

IR35 is a UK tax legislation concept that affects how contractors are classified.
The system has specific IR35 visibility and configuration features that differ between
UK and Non-UK contexts, and between Admin, Agency, and Client portal views.

Right-to-Work (RTW) is a UK legal requirement. The system tracks RTW documents and
compliance status for candidates.
`.trim();

  await post(overview, 'system-overview', 'architecture');
}

// ---- 2. Documentation files --------------------------------------------------

async function ingestDocs() {
  console.log('\n── Documentation ──');
  const docsDir = path.join(PROJECT, 'docs');
  const files   = walk(docsDir, '.md');

  for (const file of files) {
    const content = read(file).trim();
    const name    = path.basename(file, '.md').toLowerCase().replace(/_/g, '-');
    await post(content, `docs/${name}`, 'feature');
  }
}

// ---- 3. Test spec files -------------------------------------------------------

function extractSpecKnowledge(filePath, content) {
  const relativePath = path.relative(path.join(PROJECT, 'tests'), filePath);
  const lines        = content.split('\n');

  // Extract describe blocks
  const describes = [];
  const tests     = [];
  const tags      = new Set();

  for (const line of lines) {
    const describeMatch = line.match(/test\.describe\(['"](.*?)['"]/);
    if (describeMatch) describes.push(describeMatch[1]);

    const testMatch = line.match(/test(?:\.skip)?\(\s*['"`](.*?)['"`]/);
    if (testMatch && !line.includes('test.describe')) tests.push(testMatch[1]);

    const tagMatches = line.matchAll(/@[\w-]+/g);
    for (const [tag] of tagMatches) tags.add(tag);
  }

  if (!describes.length && !tests.length) return null;

  const lines_out = [
    `Test file: ${relativePath}`,
    '',
  ];

  if (describes.length) {
    lines_out.push(`Feature groups being tested:`);
    for (const d of describes) lines_out.push(`  - ${d}`);
    lines_out.push('');
  }

  if (tests.length) {
    lines_out.push(`Test scenarios covered:`);
    for (const t of tests) lines_out.push(`  - ${t}`);
    lines_out.push('');
  }

  if (tags.size) {
    const jiraTickets = [...tags].filter(t => t.match(/@VMS-/));
    const areaTags    = [...tags].filter(t => !t.match(/@VMS-/));
    if (areaTags.length)   lines_out.push(`Areas: ${areaTags.join(', ')}`);
    if (jiraTickets.length) lines_out.push(`Tickets: ${jiraTickets.join(', ')}`);
  }

  return lines_out.join('\n').trim();
}

async function ingestSpecs() {
  console.log('\n── Test Specifications ──');
  const specFiles = walk(path.join(PROJECT, 'tests'), '.spec.ts',
    ['node_modules', 'allure-results', 'test-results', 'blob-report']);

  for (const file of specFiles) {
    const content   = read(file);
    const knowledge = extractSpecKnowledge(file, content);
    if (knowledge) {
      const rel = path.relative(path.join(PROJECT, 'tests'), file);
      await post(knowledge, `spec/${rel}`, 'test-coverage');
    }
  }
}

// ---- 4. Page objects ----------------------------------------------------------

function extractPageKnowledge(filePath, content) {
  const lines    = content.split('\n');
  const fileName = path.basename(filePath, '.ts');

  // Class name
  const classMatch = content.match(/export class (\w+)/);
  const className  = classMatch ? classMatch[1] : fileName;

  // Async public methods (not constructor, not private)
  const methods = [];
  for (const line of lines) {
    const m = line.match(/^\s{2}async (\w+)\s*\(/);
    if (m && m[1] !== 'constructor') methods.push(m[1]);
  }

  // Locator names (private locator fields hint at what UI elements exist)
  const locators = [];
  for (const line of lines) {
    const m = line.match(/(?:private|readonly|protected)?\s+(\w+)\s*(?:=|:)\s*(?:this\.page|page)\./);
    if (m) locators.push(m[1]);
  }

  if (!methods.length && !locators.length) return null;

  const lines_out = [`Page Object: ${className}`];
  lines_out.push(`Source file: src/pages/${path.basename(filePath)}`);
  lines_out.push('');

  if (methods.length) {
    lines_out.push('Available actions (async methods):');
    for (const m of methods) lines_out.push(`  - ${m}()`);
    lines_out.push('');
  }

  if (locators.length > 0) {
    lines_out.push('UI elements tracked:');
    for (const l of locators.slice(0, 20)) lines_out.push(`  - ${l}`);
    if (locators.length > 20) lines_out.push(`  … and ${locators.length - 20} more`);
  }

  return lines_out.join('\n').trim();
}

async function ingestPageObjects() {
  console.log('\n── Page Objects ──');
  const pageFiles = walk(path.join(PROJECT, 'src', 'pages'), '.ts');

  for (const file of pageFiles) {
    const content   = read(file);
    const knowledge = extractPageKnowledge(file, content);
    if (knowledge) {
      await post(knowledge, `page-object/${path.basename(file)}`, 'architecture');
    }
  }
}

// ---- 5. Data model ------------------------------------------------------------

async function ingestDataModel() {
  console.log('\n── Data Model ──');

  const typesFile = path.join(PROJECT, 'src', 'types', 'test-data.types.ts');
  if (!fs.existsSync(typesFile)) return;

  const content = read(typesFile);
  const lines   = content.split('\n');

  // Extract interface names and their fields
  let currentInterface = null;
  const interfaces = {};

  for (const line of lines) {
    const ifMatch = line.match(/(?:export\s+)?interface\s+(\w+)/);
    if (ifMatch) {
      currentInterface = ifMatch[1];
      interfaces[currentInterface] = [];
      continue;
    }
    if (currentInterface && line.includes('}')) {
      currentInterface = null;
      continue;
    }
    if (currentInterface) {
      const fieldMatch = line.match(/^\s+(\w+)\??:\s+(.+?);/);
      if (fieldMatch) {
        interfaces[currentInterface].push(`${fieldMatch[1]}: ${fieldMatch[2]}`);
      }
    }
  }

  const chunks = [];
  for (const [name, fields] of Object.entries(interfaces)) {
    if (!fields.length) continue;
    chunks.push(
      `Data entity: ${name}\nFields:\n${fields.map(f => `  - ${f}`).join('\n')}`
    );
  }

  if (chunks.length) {
    await post(
      `Product data model — core entities used in testing:\n\n${chunks.join('\n\n')}`,
      'data-model/test-data.types.ts',
      'architecture'
    );
  }
}

// ---- 6. Environment / system config ------------------------------------------

async function ingestSystemConfig() {
  console.log('\n── System Configuration ──');

  const envFile = path.join(PROJECT, 'src', 'config', 'environment.config.ts');
  if (!fs.existsSync(envFile)) return;

  const content = read(envFile);

  // Extract schema names
  const schemaMatches = content.match(/\w+:\s*['"](\w+)['"]\s*,?\s*\/\/.*schema/gi) || [];
  const schemas = [];
  for (const line of content.split('\n')) {
    if (line.includes('_SCHEMA') || line.toLowerCase().includes('schema')) {
      const m = line.match(/['"]([a-z_]+)['"]/);
      if (m) schemas.push(m[1]);
    }
  }

  // Extract DB config
  const dbInfo = [];
  for (const line of content.split('\n')) {
    if (line.match(/MYSQL|DB_|DATABASE/)) {
      const m = line.match(/static\s+(?:readonly\s+)?(\w+)\s*=/);
      if (m) dbInfo.push(m[1]);
    }
  }

  const knowledge = `
System architecture and configuration for the E-Tips VMS:

Database: MySQL (microservice architecture — one database schema per service)
Known schemas: ${[...new Set(schemas)].filter(Boolean).join(', ')}

The test framework connects directly to the MySQL database for:
- Setting up test preconditions that can't be done via API/UI
- Validating data state after UI operations
- Resetting test data between runs
- Enabling feature flags (e.g. rota_enabled = 1 in planning schema)

Test environment configuration:
- BASE_URL: application frontend URL
- API_BASE_URL: backend REST API URL
- CANDIDATE_PORTAL_URL: candidate-facing portal URL
- Tests are run against local, preprod, and potentially other named environments
- Environment is selected via ENV variable (default: local)

Feature flags in config:
- ENABLE_DB_TESTS: enables tests that make direct DB calls
- ENABLE_API_TESTS: enables API-only test projects
- ENABLE_UI_TESTS: enables E2E UI tests

Test timeouts:
- Per-test timeout: 2 minutes (120,000ms)
- Navigation timeout: 30 seconds
- Action timeout: 90 seconds
- Retries on CI: 2; locally: 0
- Parallel workers: 5 (each with its own pre-generated test data file)
`.trim();

  await post(knowledge, 'config/environment.config.ts', 'architecture');
}

// ---- 7. API services (what APIs exist) ----------------------------------------

async function ingestApiServices() {
  console.log('\n── API Services ──');

  const servicesDir = path.join(PROJECT, 'src', 'data', 'api');
  if (!fs.existsSync(servicesDir)) return;

  const serviceFiles = fs.readdirSync(servicesDir)
    .filter(f => f.endsWith('.service.ts'));

  const services = [];
  for (const file of serviceFiles) {
    const content = read(path.join(servicesDir, file));
    const name    = path.basename(file, '.ts');

    const methods = [];
    for (const line of content.split('\n')) {
      const m = line.match(/^\s+async (\w+)\s*\(/);
      if (m && m[1] !== 'constructor') methods.push(m[1]);
    }

    if (methods.length) {
      services.push(`${name}:\n${methods.map(m => `  - ${m}()`).join('\n')}`);
    }
  }

  if (services.length) {
    const knowledge = `
E-Tips VMS REST API services available (used for test data setup):

${services.join('\n\n')}

These services are used to create and manage test data programmatically,
allowing tests to set up their required state without going through the UI.
All services authenticate using JWT tokens that auto-refresh every 5 minutes.
`.trim();

    await post(knowledge, 'api-services', 'architecture');
  }
}

// ---- 8. Product workflows from orchestrator ----------------------------------

async function ingestWorkflows() {
  console.log('\n── Product Workflows ──');

  const orchestratorFile = path.join(
    PROJECT, 'src', 'data', 'test-data.orchestrator.ts'
  );
  if (!fs.existsSync(orchestratorFile)) return;

  const content = read(orchestratorFile);

  const methods = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^\s+async (\w+)\s*\(/);
    if (m && m[1] !== 'constructor') methods.push(m[1]);
  }

  if (!methods.length) return;

  const knowledge = `
Product workflows and entity creation flows (from TestDataOrchestrator):

The orchestrator coordinates the creation of test data entities in the correct order,
managing dependencies between entities. It supports:

${methods.map(m => `  - ${m}()`).join('\n')}

Key entity relationships:
- A Client organisation has Business Units
- A Client has Vacancies, which have associated Jobs and Rates
- An Agency is linked to a Client via tier structure
- A Candidate is linked to an Agency and can apply to Vacancies
- A Booking links a Candidate to a Vacancy (or ad-hoc slot)
- A Timesheet is generated from a Booking
- Planning creates Shift plans linked to Business Units and Vacancies
- A Team Rota is a scheduling pattern for a Business Unit

IR35 workflow:
- Bookings and Candidates can be classified as Inside IR35 or Outside IR35
- UK-specific IR35 settings are configured per Client and per Business Unit
- IR35 status affects invoice generation and rate calculations

Right-to-Work (RTW) workflow:
- Candidates must have RTW documents on file
- Admin users can verify RTW status
- Expired RTW blocks certain booking operations
`.trim();

  await post(knowledge, 'workflows/orchestrator', 'flow');
}

// ---- 9. Test conventions and patterns ----------------------------------------

async function ingestConventions() {
  console.log('\n── Test Conventions ──');

  const knowledge = `
E-Tips VMS test automation conventions and patterns:

Framework: Playwright 1.58+ with TypeScript, using the page object pattern.

Test structure:
- All test files live under tests/e2e/ (UI), tests/api/ (API), tests/database/ (DB)
- Tests are grouped by user context folder: admin-client/, admin-agency/, agency/, client/
- Each spec file covers one product feature within one user context
- Custom test fixture (src/fixtures/test.fixture.ts) provides all page objects and testData

Standard test pattern:
  test.describe('Feature — User Context', () => {
    test.beforeEach — login + context switch to the right org
    test('Scenario name', { tag: ['@area', '@VMS-XXXX'] }, async ({ page objects }) => {
      // Arrange: set up via API or DB if needed
      // Act: UI interactions via page object methods
      // Assert: expect(locator).toBeVisible() / page object assertion methods
    });
  });

Test data approach:
- 5 pre-generated fixture files (one per parallel worker): src/fixtures/test-data.worker-{1-5}.json
- Each fixture contains: superAdmin, etipsAdmin, client, agency, users, candidates, bookings, vacancies
- TestDataHelper provides typed accessors: getSuperAdminUser(), getFirstClientUser(), etc.
- For additional entities needed within a test: TestDataOrchestrator creates them via API
- Direct DB manipulation via DatabaseManager for state that API cannot set

Authentication in tests:
- Universal test password: Password.123 (all test users)
- loginPage.navigate() → loginPage.login(username, password) → homePage.verifyNavigationBarIsVisible()
- The authenticateUser() helper wraps this flow
- Context switching (admin portal switching between client org contexts) via homePage.contextSwitchTo()

Tags and traceability:
- Every test must have a Jira/Zephyr ticket tag: @VMS-XXXX
- Area tags for filtering: @e2e, @api, @Booking, @planning, @Authentication, @admin-client, etc.
- Tests that are currently broken are tagged @failing and excluded from CI runs

Naming conventions (enforced by check-naming.js):
- All files: kebab-case with type suffix (.page.ts, .spec.ts, .service.ts, .helper.ts, etc.)
- All directories: kebab-case
- Test imports: use path aliases (@pages/, @fixtures/, @utils/, @data/, @config/, @app-types/)

Selector strategy (in order of preference):
- data-testid attributes (most resilient)
- ARIA roles: getByRole('button', { name: '...' })
- CSS class selectors where stable
- Text selectors for validation messages: getByText(/pattern/i)
- Avoid: positional selectors, index-based selectors

CI/CD:
- Bitbucket Pipelines (bitbucket-pipelines.yml)
- Test results uploaded to Zephyr Scale
- Allure HTML reports generated from blob reports (5 workers merged)
- Failed tests auto-tagged with @failing script for next-run isolation
`.trim();

  await post(knowledge, 'conventions/test-patterns', 'architecture');
}

// ---- main -------------------------------------------------------------------

async function main() {
  console.log('==============================================');
  console.log('  TESTA — E-Tips VMS Knowledge Ingestion');
  console.log('==============================================');
  console.log(`Target:  ${TESTA_URL}`);
  console.log(`Project: ${PROJECT}`);
  console.log(`Mode:    ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  if (!DRY_RUN) {
    // Confirm agent is reachable
    try {
      const res = await fetch(`${TESTA_URL}/health`);
      const data = await res.json();
      console.log(`Agent status: ${data.status}, memories before: ${data.memories}`);
    } catch (err) {
      console.error(`Cannot reach Testa at ${TESTA_URL}: ${err.message}`);
      process.exit(1);
    }
  }

  await ingestSystemOverview();
  await ingestDocs();
  await ingestSpecs();
  await ingestPageObjects();
  await ingestDataModel();
  await ingestSystemConfig();
  await ingestApiServices();
  await ingestWorkflows();
  await ingestConventions();

  console.log('\n==============================================');
  console.log(`Done. Ingested: ${posted} items, skipped: ${skipped}`);

  if (!DRY_RUN) {
    try {
      const res = await fetch(`${TESTA_URL}/health`);
      const data = await res.json();
      console.log(`Agent memories after: ${data.memories}`);
    } catch {}
  }

  console.log('==============================================');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
