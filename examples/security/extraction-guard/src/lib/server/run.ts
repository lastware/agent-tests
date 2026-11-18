import {
	parseSecurityPolicy,
	ProbeOrchestrator,
	PROTECTED_DEFENSES,
	startMockApi,
	TEST_HEADER
} from 'agentests';
import type { MockDefenses } from 'agentests/types';
import { POLICY_YAML, type Defense, type RequestKind, type RunEvent } from '#lib/policy.js';

/** Classify a response the way the policy's default signals do: quota first, then rate limit. */
const classify = (status: number, body: string): RequestKind => {
	if ([402, 403, 429].includes(status) && /quota/i.test(body)) return 'quota';
	if (status === 429) return 'rate';
	return status >= 200 && status < 300 ? 'ok' : 'other';
};

/**
 * Start a mock API with the enabled defenses, run the real agentests security policy against it,
 * and report every request and result through `emit`. The mock is closed whatever happens.
 */
export const runPolicy = async (
	enabled: Defense[],
	emit: (event: RunEvent) => void
): Promise<void> => {
	const defenses: MockDefenses = {};
	for (const id of enabled) Object.assign(defenses, { [id]: PROTECTED_DEFENSES[id] });
	const api = await startMockApi({ port: 0, defenses });
	try {
		const policy = parseSecurityPolicy(POLICY_YAML.replaceAll('{{URL}}', api.url));
		const runId = crypto.randomUUID();
		emit({
			type: 'start',
			runId,
			url: policy.target.url,
			tests: policy.tests.map(({ id, description, scenario, requests }) => ({
				id,
				description,
				scenario,
				requests
			}))
		});
		// Observe each completion request on its way through, without changing what the runner sees.
		const observed: typeof fetch = async (input, init) => {
			const response = await fetch(input, init);
			if (init?.method === 'POST') {
				const headers = (init.headers ?? {}) as Record<string, string>;
				const body = await response.clone().text();
				const prompt = String(JSON.parse(String(init.body ?? '{}')).prompt ?? '');
				emit({
					type: 'request',
					test: headers[TEST_HEADER] ?? '',
					kind: classify(response.status, body),
					status: response.status,
					prompt
				});
			}
			return response;
		};
		const report = await new ProbeOrchestrator(
			policy,
			{},
			{
				fetch: observed,
				runId,
				onResult: ({ test, passed, checks, evidence }) =>
					emit({ type: 'result', test: test.id, passed, checks, evidence: { ...evidence } })
			}
		).run();
		emit({ type: 'done', passed: report.passed, total: report.total, report });
	} finally {
		await api.close();
	}
};
