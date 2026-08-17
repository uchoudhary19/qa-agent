import { chat } from "./ollama.js";
import type { ChatMessage } from "./session.js";

// ---- portal beforeEach templates ----

const BEFORE_EACH: Record<string, string> = {
  "admin-client": `test.beforeEach(async ({ loginPage, homePage, testData }) => {
  const helper = new TestDataHelper(testData);
  const superAdmin = helper.getSuperAdminUser();
  await loginPage.navigate();
  await loginPage.login(superAdmin!.username, 'Password.123');
  await homePage.contextSwitchTo(testData.client?.name || '');
  await homePage.verifyContextSwitched(testData.client?.name || '');
});`,

  agency: `test.beforeEach(async ({ loginPage, homePage, testData }) => {
  const helper = new TestDataHelper(testData);
  const agencyUser = helper.getAgencyUsers()[0];
  await loginPage.navigate();
  await loginPage.login(agencyUser!.username, 'Password.123');
  await homePage.verifyNavigationBarIsVisible();
});`,

  client: `test.beforeEach(async ({ loginPage, homePage, testData }) => {
  const helper = new TestDataHelper(testData);
  const clientUser = helper.getFirstClientUser();
  await loginPage.navigate();
  await loginPage.login(clientUser!.username, 'Password.123');
  await homePage.verifyNavigationBarIsVisible();
});`,

  "admin-agency": `test.beforeEach(async ({ loginPage, homePage, testData }) => {
  const helper = new TestDataHelper(testData);
  const superAdmin = helper.getSuperAdminUser();
  await loginPage.navigate();
  await loginPage.login(superAdmin!.username, 'Password.123');
  await homePage.contextSwitchTo(testData.agency?.name || '');
  await homePage.verifyContextSwitched(testData.agency?.name || '');
});`
};

// A real booking test used as a few-shot example for admin-client context
const ADMIN_CLIENT_EXAMPLE = `import { TestDataHelper } from '@data/test-data.helper';
import { test } from '@fixtures/test.fixture';

test.describe('Booking - Admin Client Context', () => {
  test.beforeEach(async ({ loginPage, homePage, testData }) => {
    const helper = new TestDataHelper(testData);
    const superAdmin = helper.getSuperAdminUser();
    await loginPage.navigate();
    await loginPage.login(superAdmin!.username, 'Password.123');
    await homePage.contextSwitchTo(testData.client?.name || '');
    await homePage.verifyContextSwitched(testData.client?.name || '');
  });

  test(
    'Verify ad-hoc booking shows only Booking Details tab',
    { tag: ['@Booking', '@VMS-T2686'] },
    async ({ testData, homePage, bookingsPage }) => {
      const helper = new TestDataHelper(testData);
      await homePage.navigateToBookings();
      await bookingsPage.clickSearchOnFirstBooking();
      await bookingsPage.verifyBookingDetailsTabVisible();
      await bookingsPage.verifyVacancyDetailsTabNotVisible();
    }
  );
});`;

const AGENCY_EXAMPLE = `import { TestDataHelper } from '@data/test-data.helper';
import { test } from '@fixtures/test.fixture';

test.describe('Candidate - Agency Portal', () => {
  test.beforeEach(async ({ loginPage, homePage, testData }) => {
    const helper = new TestDataHelper(testData);
    const agencyUser = helper.getAgencyUsers()[0];
    await loginPage.navigate();
    await loginPage.login(agencyUser!.username, 'Password.123');
    await homePage.verifyNavigationBarIsVisible();
  });

  test(
    'Verify candidate list is visible to agency user',
    { tag: ['@e2e', '@VMS-T0000'] },
    async ({ homePage, candidatePage }) => {
      await homePage.navigateToCandidates();
      await candidatePage.verifyCandidateListVisible();
    }
  );
});`;

function exampleForPortal(portal: string): string {
  if (portal === "agency" || portal === "admin-agency") return AGENCY_EXAMPLE;
  return ADMIN_CLIENT_EXAMPLE;
}

// ---- helpers ----

function portalFolder(portal: string): string {
  const map: Record<string, string> = {
    "admin-client":  "admin-client",
    "admin-agency":  "admin-agency",
    agency:          "agency",
    client:          "client"
  };
  return map[portal] ?? "admin-client";
}

function suggestFilePath(
  portal: string,
  featureArea: string,
  description: string
): string {
  const area = featureArea
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const name = description
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 5)
    .join("-")
    .replace(/[^a-z0-9-]/g, "");
  return `tests/e2e/${portalFolder(portal)}/${area}/${name}.spec.ts`;
}

// ---- public exports ----

export interface GenerateOptions {
  portal?: string;
  featureArea?: string;
  pageObjectContext?: string;
}

export async function generateTest(
  feature: string,
  knowledge: string,
  options: GenerateOptions = {}
): Promise<{ code: string; suggestedPath: string }> {
  const portal      = options.portal ?? "admin-client";
  const featureArea = options.featureArea ?? "general";
  const pageCtx     = options.pageObjectContext ?? "";

  const beforeEach = BEFORE_EACH[portal] ?? BEFORE_EACH["admin-client"];
  const example    = exampleForPortal(portal);
  const suggested  = suggestFilePath(portal, featureArea, feature);

  const prompt = `You are a senior QA automation engineer writing a Playwright TypeScript test for the E-Tips VMS product.

STRICT RULES — follow them exactly, no exceptions:
1. Return ONLY the complete .spec.ts file content — nothing else
2. Do NOT wrap output in markdown fences or add any explanation
3. Use ONLY the imports and fixture names listed below
4. Use ONLY the page object methods listed in the context
5. Follow the exact structure from the EXAMPLE below
6. Every test must include tags: { tag: ['@e2e', '@VMS-XXXX'] }
7. Use 'Password.123' as the password for all test users

=== MANDATORY IMPORTS ===
import { TestDataHelper } from '@data/test-data.helper';
import { test } from '@fixtures/test.fixture';
// Only add TestDataOrchestrator if the test needs to create entities on the fly:
// import { TestDataOrchestrator } from '@data/test-data.orchestrator';

=== AVAILABLE FIXTURES (destructure from the test callback) ===
loginPage, homePage, candidatePage, bookingsPage, timesheetPage, vacancyPage,
planningPage, invoicingPage, invoiceManagerPage, businessUnitPage,
timeAndAttendancePage, clockingDevicePage, usermanagementPage, clientPage,
jobPage, userProfilePage, appSupportHelpPage, integrationsPage,
testData, testDataBuilder, apiClient, clientRepository, userRepository

=== TESTDATAHELPER METHODS ===
getSuperAdminUser(), getEtipsAdminUser(), getClient(), getClientUsers(),
getFirstClientUser(), getAgency(), getAgencyUsers(), getFirstAgencyUser(),
getClientCandidates(), getAgencyCandidates(), getFirstClientCandidate(),
getFirstAgencyCandidate(), getClientBookings(), getAgencyBookings(),
getClientVacancy(), getClientBusinessUnits(), getAgencyBusinessUnits(),
getClientJobs(), hasData(), hasClientData(), hasAgencyData()

=== PORTAL: ${portal.toUpperCase()} ===
Use this exact beforeEach — do not change it:
${beforeEach}

=== PAGE OBJECTS AVAILABLE FOR THIS FEATURE ===
${pageCtx || "Use loginPage and homePage as shown in the example."}

=== CONCRETE EXAMPLE (follow this structure) ===
${example}

=== PRODUCT KNOWLEDGE (use this to decide what to test and assert) ===
${knowledge || "No additional product knowledge available. Use what you know from the fixtures and example."}

=== FEATURE TO TEST ===
${feature}

=== SUGGESTED FILE PATH ===
${suggested}

Write the complete .spec.ts file now:`;

  const messages: ChatMessage[] = [{ role: "user", content: prompt }];
  const code = await chat(messages, "");

  // Strip any accidental markdown fences the model adds
  const cleaned = code
    .replace(/^```(?:typescript|ts)?\n?/im, "")
    .replace(/```\s*$/m, "")
    .trim();

  return { code: cleaned, suggestedPath: suggested };
}

export async function reviewTest(
  code: string,
  knowledge: string
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `Review this Playwright TypeScript test for the E-Tips VMS product:

${code}

Evaluate:
1. **Coverage gaps** — what scenarios or edge cases are missing based on known product behaviour?
2. **Assertion quality** — are assertions meaningful, or do they just check element visibility?
3. **Selector resilience** — are selectors fragile (positional, index-based) or robust (role, data-testid)?
4. **Structure** — does it follow the project's describe/beforeEach/test pattern correctly?
5. **Recommended additions** — specific new test cases with priority (HIGH / MED / LOW)

Be specific and actionable.`
    }
  ];

  return chat(messages, knowledge);
}

export interface FailureAnalysis {
  summary: string;
  failures: Array<{
    testName: string;
    errorMessage: string;
    category: 'flaky-selector' | 'timing' | 'data-setup' | 'product-bug' | 'test-logic' | 'environment' | 'unknown';
    reasoning: string;
    suggestedFix: string;
    codeSnippet?: string;
  }>;
  passing: string[];
  overallHealth: 'healthy' | 'needs-attention' | 'critical';
  recommendations: string[];
}

export async function analyzeTestResults(
  playwrightOutput: string,
  testCode: string,
  knowledge: string
): Promise<string> {
  const codeSection = testCode
    ? `\n=== TEST CODE THAT WAS RUN ===\n${testCode.slice(0, 3000)}\n`
    : "";

  const prompt = `You are a senior QA engineer diagnosing Playwright test results for E-Tips VMS.

Analyse the test output below and provide a structured report.

For each FAILING test, identify:
1. The test name and what it was trying to verify
2. Root cause category (choose one):
   - FLAKY SELECTOR: Element selector is fragile, positional, or timing-dependent
   - TIMING ISSUE: Race condition, animation not complete, async op not awaited
   - DATA SETUP: Test fixture data missing, wrong state, or stale
   - PRODUCT BUG: The actual application is broken / behaving unexpectedly
   - TEST LOGIC: The test has incorrect assertions or wrong expectations
   - ENVIRONMENT: Network, auth token, or environment config issue
3. Specific reasoning based on the error message and stack trace
4. A concrete fix suggestion — include updated code where possible

For PASSING tests, just list what's covered and working.

Format your response with clear sections:
## Overall Health
Brief summary with counts (X passed, Y failed).

## Failures

### [Test Name]
**Category:** [category]
**Error:** [error message excerpt]
**Root Cause:** [your analysis]
**Fix:**
[specific fix — include a code snippet if you can improve the selector, assertion, or setup]

## Passing Tests
[brief list]

## Recommendations
[top 3 actionable improvements for the whole suite]
${codeSection}
=== PLAYWRIGHT OUTPUT ===
${playwrightOutput}

=== PRODUCT KNOWLEDGE (context for understanding expected behaviour) ===
${knowledge || "No additional product knowledge available."}

Diagnose each failure now:`;

  const messages: ChatMessage[] = [{ role: "user", content: prompt }];
  return chat(messages, "");
}

export async function analyzeCoverage(
  feature: string,
  existingTestSummary: string,
  knowledge: string
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `Analyse test coverage for this E-Tips VMS feature: ${feature}

Existing tests:
${existingTestSummary || "None provided."}

Report:
1. **Covered** — what is currently tested
2. **Not covered** — critical paths and edge cases with no test
3. **Recommended test cases** — specific new tests with priority (HIGH / MED / LOW)
4. **Effort estimate** — rough estimate to achieve solid coverage

Base your analysis on the known product knowledge.`
    }
  ];

  return chat(messages, knowledge);
}
