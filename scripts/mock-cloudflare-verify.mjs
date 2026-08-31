/**
 * Fixtures for the Cloudflare token pre-flight check.
 *
 * Overrides globalThis.fetch so `verify-cloudflare-token.mjs` can be exercised
 * across every branch without touching the real API or needing a real token.
 * Driven by scripts/test-cloudflare-token.mjs; usable by hand too:
 *
 *   MOCK_SCENARIO=ok-no-groups CLOUDFLARE_API_TOKEN=x \
 *     node --import ./scripts/mock-cloudflare-verify.mjs \
 *          ./scripts/verify-cloudflare-token.mjs
 *
 * Scenario names are the contract. Adding one here without adding a matching
 * case to the test runner will fail the runner's completeness check.
 */

const scenario = process.env.MOCK_SCENARIO || 'ok-pages-write';

const group = (id, name) => ({ id, name });
const policy = (groups, resources = {}) => ({ permission_groups: groups, resources });

const ACCOUNT = 'acct_1111111111111111111111111111';

const scenarios = {
  // healthy: Pages present, with Write, scoped to the right account
  'ok-pages-write': {
    status: 200,
    body: {
      success: true,
      result: {
        status: 'active',
        expires_on: '2030-01-01T00:00:00Z',
        policies: [
          policy([group('a', 'Cloudflare Pages Write')], {
            [`com.cloudflare.api.account.${ACCOUNT}`]: '*',
          }),
        ],
      },
    },
  },

  // ★ REGRESSION CASE: the token that actually deploys this site.
  // Verify reports no permission groups at all, yet the Pages API accepts it.
  // Must NOT warn (that is what shipped two permanent warnings per run) and
  // must NOT fail.
  'ok-no-groups': {
    status: 200,
    body: {
      success: true,
      result: { status: 'active', expires_on: '2030-01-01T00:00:00Z', policies: [] },
    },
  },

  // Works, but the grant name lacks the word "Pages" (e.g. "Workers and Pages Edit"
  // reported under a different label). Advisory only, never a failure.
  'ok-pages-renamed': {
    status: 200,
    body: {
      success: true,
      result: {
        status: 'active',
        expires_on: '2030-01-01T00:00:00Z',
        policies: [policy([group('a', 'Workers and Pages Edit')])],
      },
    },
  },

  // Pages present but read-only: real problem, deserves a warning.
  'pages-readonly': {
    status: 200,
    body: {
      success: true,
      result: {
        status: 'active',
        expires_on: '2030-01-01T00:00:00Z',
        policies: [policy([group('a', 'Cloudflare Pages Read')])],
      },
    },
  },

  // No Pages grant at all.
  'no-pages-grant': {
    status: 200,
    body: {
      success: true,
      result: {
        status: 'active',
        expires_on: '2030-01-01T00:00:00Z',
        policies: [policy([group('a', 'Zone Read')])],
      },
    },
  },

  // Scoped to a different account: real problem, must warn.
  'wrong-account': {
    status: 200,
    body: {
      success: true,
      result: {
        status: 'active',
        expires_on: '2030-01-01T00:00:00Z',
        policies: [
          policy([group('a', 'Cloudflare Pages Write')], {
            'com.cloudflare.api.account.acct_deadbeef': '*',
          }),
        ],
      },
    },
  },

  // Expiring soon: must warn.
  'expiring-soon': {
    status: 200,
    body: {
      success: true,
      result: {
        status: 'active',
        expires_on: new Date(Date.now() + 5 * 86400000).toISOString(),
        policies: [policy([group('a', 'Cloudflare Pages Write')])],
      },
    },
  },

  // --- hard failures below ---

  'already-expired': {
    status: 200,
    body: {
      success: true,
      result: {
        status: 'active',
        expires_on: '2020-01-01T00:00:00Z',
        policies: [policy([group('a', 'Cloudflare Pages Write')])],
      },
    },
  },

  'token-rejected': {
    status: 401,
    body: { success: false, errors: [{ message: 'Invalid API token', code: 9109 }] },
  },

  'token-disabled': {
    status: 200,
    body: {
      success: true,
      result: { status: 'disabled', policies: [policy([group('a', 'Cloudflare Pages Write')])] },
    },
  },

  'unparseable': { raw: '<html>502 Bad Gateway</html>' },

  'network-throw': { throws: true },
};

const chosen = scenarios[scenario];
if (!chosen) {
  console.error(`unknown MOCK_SCENARIO: ${scenario}`);
  console.error(`available: ${Object.keys(scenarios).join(', ')}`);
  process.exit(2);
}

export const SCENARIOS = Object.keys(scenarios);

globalThis.fetch = async () => {
  if (chosen.throws) throw new Error('getaddrinfo ENOTFOUND api.cloudflare.com');
  const body = chosen.raw !== undefined ? chosen.raw : JSON.stringify(chosen.body);
  return { status: chosen.status || 200, text: async () => body, ok: true };
};
