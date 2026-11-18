/** The defenses the demo API can run; switching one off is the "bad pull request". */
export type Defense = 'rateLimit' | 'quota' | 'detection';

export const DEFENSES: { id: Defense; label: string; detail: string; code: string }[] = [
	{
		id: 'rateLimit',
		label: 'Rate limit',
		detail: '20 requests per second per key',
		code: "app.use(rateLimit({ max: 20, window: '1s', key: apiKey }));"
	},
	{
		id: 'quota',
		label: 'Quota',
		detail: '60 completions per key',
		code: 'app.use(quota({ limit: 60, key: apiKey }));'
	},
	{
		id: 'detection',
		label: 'Extraction detection',
		detail: 'Flag 25 templated prompts from one key',
		code: "app.use(detectTemplates({ threshold: 25, emit: 'security.events' }));"
	}
];

/** The policy the demo runs, as a developer would commit it; `{{URL}}` is the mock's address. */
export const POLICY_YAML = `version: 1
name: model-extraction-protection

target:
  url: {{URL}}/v1/complete
  environment: test
  body:
    prompt: '{{prompt}}'
  detection:
    url: {{URL}}/v1/security/events
    wait_ms: 1000

tests:
  - id: extraction-rate-limit
    description: A burst of varied prompts from one key is throttled.
    scenario: sustained-query-volume
    requests: 60
    duration_seconds: 1
    headers:
      authorization: Bearer test-key-volume
    expect:
      rate_limit_enforced: true

  - id: extraction-alerting
    description: A templated grid of probes raises a detection event, even below the rate limit.
    scenario: systematic-query-pattern
    requests: 40
    duration_seconds: 4
    headers:
      authorization: Bearer test-key-pattern
    expect:
      rate_limit_enforced: false
      detection_event: true

  - id: extraction-quota
    description: A key that exhausts its quota stays blocked.
    scenario: quota-exhaustion
    requests: 80
    duration_seconds: 8
    headers:
      authorization: Bearer test-key-quota
    expect:
      quota_enforced: true

safety:
  max_requests: 200
  allow_production: false
`;

/** How the UI colors one response. */
export type RequestKind = 'ok' | 'rate' | 'quota' | 'other';

export interface TestInfo {
	id: string;
	description?: string;
	scenario: string;
	requests: number;
}

export interface Check {
	expectation: string;
	expected: boolean;
	actual: boolean;
	passed: boolean;
	detail: string;
}

/** One line of the NDJSON stream from `POST /api/run`. */
export type RunEvent =
	| { type: 'start'; runId: string; url: string; tests: TestInfo[] }
	| { type: 'request'; test: string; kind: RequestKind; status: number; prompt: string }
	| {
			type: 'result';
			test: string;
			passed: boolean;
			checks: Check[];
			evidence: Record<string, unknown>;
	  }
	| { type: 'done'; passed: number; total: number; report: unknown }
	| { type: 'error'; message: string };
