/**
 * Shared between tests/live/setup.ts and src/scripts/sweep-test-characters.ts.
 * Lives in src/ (not tests/) so the sweep script — a normal build artifact, not
 * a test file — doesn't need to import across the tsconfig's tests/ exclusion.
 *
 * Every generated live-test fixture's name must carry this prefix. Write tests
 * may only target a character whose name carries it — enforced in code, not
 * just by convention (docs/plans/2026-09-05-character-fixes-integration-plan.md §3.2).
 */
export const MCPTEST_PREFIX = "MCPTEST-";

/**
 * Guards every write test against ever targeting a non-fixture character.
 * Throws rather than returning a boolean so a call site can't accidentally
 * ignore the result.
 */
export function assertIsTestCharacter(name: string): void {
  if (!name.startsWith(MCPTEST_PREFIX)) {
    throw new Error(
      `Refusing to run a write test against "${name}" — its name doesn't start with "${MCPTEST_PREFIX}". ` +
      `Write tests must only target characters created by setupWriteTestCharacter().`
    );
  }
}
