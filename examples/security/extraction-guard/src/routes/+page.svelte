<script lang="ts">
	import { Button, Icon, Pill, Progress, Spinner, Surface, Switch, Tabs } from 'bref-ui';
	import type { TabItemDataProps } from 'bref-ui/types';
	import {
		DEFENSES,
		POLICY_YAML,
		type Check,
		type Defense,
		type RequestKind,
		type RunEvent,
		type TestInfo
	} from '#lib/policy.js';

	type Phase = 'idle' | 'running' | 'passed' | 'failed' | 'error';
	interface TestState extends TestInfo {
		cells: { kind: RequestKind; status: number; prompt: string }[];
		state: 'queued' | 'running' | 'passed' | 'failed';
		checks: Check[];
		evidence?: Record<string, unknown>;
	}

	let enabled = $state<Record<Defense, boolean>>({ rateLimit: true, quota: true, detection: true });
	let phase = $state<Phase>('idle');
	let tests = $state<TestState[]>([]);
	let terminal = $state<string[]>([]);
	let report = $state<unknown>(null);
	let summary = $state({ passed: 0, total: 0 });
	let errorMessage = $state('');
	let pane = $state('terminal');
	let started = 0;
	let elapsed = $state(0);

	const removed = $derived(DEFENSES.filter((d) => !enabled[d.id]));
	const prTitle = $derived(
		removed.length
			? `Speed up /v1/complete: drop ${removed.map((d) => d.label.toLowerCase()).join(' and ')}`
			: 'Speed up /v1/complete: cache tokenizer'
	);
	const panes: TabItemDataProps[] = [
		{ id: 'terminal', label: 'Terminal', icon: 'terminal' },
		{ id: 'policy', label: 'Policy', icon: 'policy' },
		{ id: 'json', label: 'JSON report', icon: 'data_object' }
	];

	const scenarioLabel: Record<string, string> = {
		'sustained-query-volume': 'Sustained volume',
		'systematic-query-pattern': 'Systematic pattern',
		'quota-exhaustion': 'Quota exhaustion'
	};

	const preset = (off: Defense[]) => {
		for (const d of DEFENSES) enabled[d.id] = !off.includes(d.id);
	};

	const handle = (event: RunEvent) => {
		switch (event.type) {
			case 'start':
				tests = event.tests.map((t, i) => ({
					...t,
					cells: [],
					state: i === 0 ? 'running' : 'queued',
					checks: []
				}));
				terminal.push(`Security evaluation: model-extraction-protection → ${event.url} (test)`);
				break;
			case 'request': {
				const test = tests.find((t) => t.id === event.test);
				if (!test) break;
				test.state = 'running';
				test.cells.push({ kind: event.kind, status: event.status, prompt: event.prompt });
				break;
			}
			case 'result': {
				const index = tests.findIndex((t) => t.id === event.test);
				const test = tests[index];
				if (!test) break;
				test.state = event.passed ? 'passed' : 'failed';
				test.checks = event.checks;
				test.evidence = event.evidence;
				const next = tests[index + 1];
				if (next) next.state = 'running';
				for (const c of event.checks)
					terminal.push(
						`${c.passed ? 'PASS' : 'FAIL'}  ${test.id}  ${c.expectation}: expected ${c.expected}, got ${c.actual} (${c.detail})`
					);
				break;
			}
			case 'done':
				summary = { passed: event.passed, total: event.total };
				report = event.report;
				phase = event.passed === event.total ? 'passed' : 'failed';
				terminal.push(`Result: ${event.passed} of ${event.total} security test(s) passed.`);
				terminal.push(`exit code ${event.passed === event.total ? 0 : 1}`);
				break;
			case 'error':
				errorMessage = event.message;
				phase = 'error';
				terminal.push(`Error: ${event.message}`, 'exit code 2');
				break;
		}
	};

	const run = async () => {
		phase = 'running';
		tests = [];
		report = null;
		errorMessage = '';
		terminal = ['$ npx agentests security run'];
		started = performance.now();
		elapsed = 0;
		const timer = setInterval(() => (elapsed = (performance.now() - started) / 1000), 100);
		try {
			const response = await fetch('/api/run', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ defenses: DEFENSES.filter((d) => enabled[d.id]).map((d) => d.id) })
			});
			if (!response.body) throw new Error('No response stream');
			const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
			let buffer = '';
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += value;
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) if (line.trim()) handle(JSON.parse(line) as RunEvent);
			}
			if (phase === 'running') handle({ type: 'error', message: 'The run ended without a result' });
		} catch (error) {
			handle({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		} finally {
			clearInterval(timer);
			elapsed = (performance.now() - started) / 1000;
		}
	};

	const statePill = {
		queued: { label: 'Queued', color: 'muted', icon: 'pending' },
		running: { label: 'Attacking', color: 'info', icon: 'radar' },
		passed: { label: 'Pass', color: 'success', icon: 'verified_user' },
		failed: { label: 'Fail', color: 'error', icon: 'gpp_bad' }
	} as const;

	const kindLabel: Record<RequestKind, string> = {
		ok: 'Answered',
		rate: 'Rate-limited',
		quota: 'Quota exceeded',
		other: 'Other status'
	};

	const count = (test: TestState, kind: RequestKind) =>
		test.cells.filter((c) => c.kind === kind).length;
	const lastPrompt = (test: TestState) => test.cells.at(-1)?.prompt ?? '';
</script>

<div class="page">
	<Surface orientation="horizontal" spacing="medium" class="bar">
		<div class="brand">
			<Icon name="shield" size="large" color="primary" filled />
			<div>
				<h1>Extraction Guard</h1>
				<p class="muted">agentests security · model extraction policy as code</p>
			</div>
		</div>
		<div class="bar-right">
			<Pill
				label="environment: test"
				color="info"
				variant="soft"
				size="small"
				icon={{ name: 'lock' }}
			/>
			<Pill
				label="max 200 requests"
				color="muted"
				variant="soft"
				size="small"
				icon={{ name: 'speed' }}
			/>
		</div>
	</Surface>

	<div class="grid">
		<Surface
			as="section"
			variant="soft"
			color="muted"
			radius="small"
			spacing="medium"
			class="pr"
			aria-label="Pull request"
		>
			<div class="pr-head">
				<Icon name="merge" color="secondary" />
				<div>
					<p class="muted mono">#128 · feat/faster-completions → main</p>
					<h2>{prTitle}</h2>
				</div>
			</div>

			<div class="diff mono" aria-label="Diff of src/server.ts">
				<div class="diff-file">src/server.ts</div>
				<div>&nbsp;const app = createApi(model);</div>
				{#each DEFENSES as defense (defense.id)}
					<div class:del={!enabled[defense.id]}>
						{enabled[defense.id] ? '\u00a0' : '-'}{defense.code}
					</div>
				{/each}
				<div class="add">+app.use(tokenizerCache());</div>
				<div>&nbsp;app.post('/v1/complete', complete);</div>
			</div>

			<h3><Icon name="security" /> Defenses in this branch</h3>
			<ul class="defenses">
				{#each DEFENSES as defense (defense.id)}
					<li>
						<label>
							<Switch
								bind:checked={enabled[defense.id]}
								size="small"
								disabled={phase === 'running'}
							/>
							<span>
								<strong>{defense.label}</strong>
								<small class="muted">{defense.detail}</small>
							</span>
						</label>
					</li>
				{/each}
			</ul>

			<div class="presets">
				<Button
					label="Protected API"
					size="small"
					variant="neutral"
					icon={{ name: 'verified_user' }}
					disabled={phase === 'running'}
					onClick={() => preset([])}
				/>
				<Button
					label="Remove rate limit"
					size="small"
					variant="soft"
					color="warning"
					icon={{ name: 'block' }}
					disabled={phase === 'running'}
					onClick={() => preset(['rateLimit'])}
				/>
			</div>

			<Button
				label={phase === 'running' ? 'Running agentests security…' : 'Run agentests security'}
				icon={{ name: 'play_arrow' }}
				color="primary"
				variant="filled"
				wide
				disabled={phase === 'running'}
				onClick={run}
			/>
		</Surface>

		<section class="tests" aria-label="Security tests">
			{#if !tests.length}
				<Surface variant="soft" color="muted" radius="small" spacing="large" class="empty">
					<Icon name="radar" size="x-large" color="muted" />
					<h2>Three controlled extraction attempts</h2>
					<p class="muted">
						Run the policy to send 180 bounded, deterministic requests at a local mock of this
						branch's API. Each scenario checks one defense. Switch one off to see the pull request
						get blocked.
					</p>
				</Surface>
			{/if}
			{#each tests as test (test.id)}
				{@const pill = statePill[test.state]}
				<Surface
					variant="soft"
					color={test.state === 'failed' ? 'error' : test.state === 'passed' ? 'success' : 'muted'}
					radius="small"
					spacing="medium"
					class="test"
				>
					<div class="test-head">
						<div>
							<p class="muted small">{scenarioLabel[test.scenario] ?? test.scenario}</p>
							<h3 class="mono">{test.id}</h3>
						</div>
						<span class="pill">
							<Pill
								label={pill.label}
								color={pill.color}
								variant={test.state === 'running' ? 'soft' : 'filled'}
								size="small"
								icon={{ name: pill.icon }}
							/>
						</span>
					</div>
					<p class="desc">{test.description}</p>
					<div class="progress-row">
						<Progress
							value={test.cells.length / test.requests}
							label={`${test.id} requests sent`}
							size="small"
						/>
						<span class="mono small">{test.cells.length}/{test.requests}</span>
					</div>
					<div class="cells" aria-label={`${test.id} responses`}>
						{#each test.cells as cell, i (i)}
							<span
								class="cell {cell.kind}"
								title={`#${i + 1} · ${cell.status} ${kindLabel[cell.kind]}\n${cell.prompt}`}
							></span>
						{/each}
					</div>
					<p class="counts small">
						<span>
							<i class="dot ok"></i>
							{count(test, 'ok')} answered
						</span>
						<span>
							<i class="dot rate"></i>
							{count(test, 'rate')} rate-limited
						</span>
						<span>
							<i class="dot quota"></i>
							{count(test, 'quota')} quota
						</span>
					</p>
					{#if test.state === 'running' && lastPrompt(test)}
						<p class="prompt mono small" title="Last prompt sent">› {lastPrompt(test)}</p>
					{/if}
					{#if test.checks.length}
						<ul class="checks">
							{#each test.checks as check (check.expectation)}
								<li class:fail={!check.passed}>
									<Icon
										name={check.passed ? 'check_circle' : 'cancel'}
										color={check.passed ? 'success' : 'error'}
									/>
									<span>
										<strong class="mono">{check.expectation}</strong>
										expected {check.expected}, got {check.actual}
										<small class="muted">{check.detail}</small>
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				</Surface>
			{/each}
		</section>

		<Surface
			as="section"
			variant="soft"
			color="muted"
			radius="small"
			spacing="medium"
			class="ci"
			aria-label="CI checks"
		>
			<div class="ci-status {phase}">
				{#if phase === 'idle'}
					<Icon name="pending" size="large" color="muted" />
					<div>
						<strong>Checks haven't run yet</strong>
						<small class="muted">agentests security · required</small>
					</div>
				{:else if phase === 'running'}
					<Spinner size="medium" />
					<div>
						<strong>agentests security is running</strong>
						<small class="muted">{elapsed.toFixed(1)}s</small>
					</div>
				{:else if phase === 'passed'}
					<Icon name="verified_user" size="large" color="success" filled />
					<div>
						<strong>All checks have passed</strong>
						<small>
							{summary.passed} of {summary.total} security tests · {elapsed.toFixed(1)}s · ready to
							merge
						</small>
					</div>
				{:else if phase === 'failed'}
					<Icon name="gpp_bad" size="large" color="error" filled />
					<div>
						<strong>Merging is blocked</strong>
						<small>
							{summary.passed} of {summary.total} security tests passed · a defense regressed
						</small>
					</div>
				{:else}
					<Icon name="cancel" size="large" color="error" />
					<div>
						<strong>The check errored</strong>
						<small>{errorMessage}</small>
					</div>
				{/if}
			</div>
			<Button
				label="Merge pull request"
				icon={{ name: 'merge' }}
				color={phase === 'passed' ? 'success' : 'muted'}
				variant={phase === 'passed' ? 'filled' : 'soft'}
				wide
				disabled={phase !== 'passed'}
			/>

			<Tabs items={panes} bind:value={pane} label="Output" size="small" />
			<div class="pane">
				<Surface scroll height="fill" class="code">
					{#if pane === 'terminal'}
						<pre class="mono">{#each terminal as line, i (i)}<span
									class:pass={line.startsWith('PASS')}
									class:fail={line.startsWith('FAIL') || line.startsWith('Error')}
									class:cmd={line.startsWith('$')}>{line}
</span>{:else}<span class="muted">Output appears here when the check runs.</span>{/each}</pre>
					{:else if pane === 'policy'}
						<pre class="mono"><span class="muted"># agentests.security.yaml</span>
{POLICY_YAML.replaceAll('{{URL}}', 'http://127.0.0.1:4010')}</pre>
					{:else}
						<pre class="mono">{report
								? JSON.stringify(report, null, 2)
								: 'Run the check to get the machine-readable report.'}</pre>
					{/if}
				</Surface>
			</div>
		</Surface>
	</div>
</div>

<style>
	.page {
		--line: color-mix(in srgb, var(--color-muted) 25%, transparent);
		--ok: var(--color-success);
		--rate: var(--color-warning);
		--quota: var(--color-error);
		min-height: 100vh;
		box-sizing: border-box;
		padding: 1.25rem 1.5rem 1.5rem;
		display: grid;
		grid-template-rows: auto 1fr;
		gap: 1rem;
		color: var(--color-foreground);
		background: var(--color-background);
	}
	h1,
	h2,
	h3,
	p {
		margin: 0;
	}
	h1 {
		font-size: 1.35rem;
	}
	h2 {
		font-size: 1.05rem;
	}
	h3 {
		font-size: 0.95rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.muted {
		color: var(--color-muted);
	}
	.small {
		font-size: 0.8rem;
	}
	.mono {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
	}
	:global(.bar) {
		justify-content: space-between;
		align-items: center;
	}
	.brand,
	.bar-right {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(19rem, 22rem) minmax(0, 1fr) minmax(20rem, 26rem);
		gap: 1rem;
		align-items: start;
	}
	@media (max-width: 1150px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}

	:global(.pr),
	:global(.ci) {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.pr-head {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
	}
	.pr-head p {
		font-size: 0.78rem;
		margin-bottom: 0.2rem;
	}
	.diff {
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		overflow: hidden;
		font-size: 0.72rem;
		line-height: 1.6;
	}
	.diff > div {
		padding: 0 0.6rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.diff-file {
		background: color-mix(in srgb, var(--color-muted) 12%, transparent);
		border-bottom: 1px solid var(--line);
		font-weight: 600;
	}
	.del {
		background: color-mix(in srgb, var(--color-error) 16%, transparent);
		text-decoration: line-through;
		text-decoration-color: color-mix(in srgb, var(--color-error) 60%, transparent);
	}
	.add {
		background: color-mix(in srgb, var(--color-success) 14%, transparent);
	}
	.defenses {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}
	.defenses label {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		cursor: pointer;
	}
	.defenses span {
		display: grid;
	}
	.defenses small {
		font-size: 0.78rem;
	}
	.presets {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.tests {
		display: grid;
		gap: 1rem;
	}
	:global(.empty) {
		display: grid;
		justify-items: center;
		text-align: center;
		gap: 0.6rem;
		padding-block: 3rem !important;
	}
	:global(.empty) p {
		max-width: 34rem;
	}
	:global(.test) {
		display: grid;
		gap: 0.6rem;
	}
	.test-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}
	.pill {
		display: inline-flex;
		flex-shrink: 0;
	}
	.desc {
		font-size: 0.9rem;
	}
	.progress-row {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: 0.75rem;
	}
	.cells {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		min-height: 12px;
	}
	.cell {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		animation: pop 160ms ease-out;
	}
	.cell.ok,
	.dot.ok {
		background: var(--ok);
	}
	.cell.rate,
	.dot.rate {
		background: var(--rate);
	}
	.cell.quota,
	.dot.quota {
		background: var(--quota);
	}
	.cell.other {
		background: var(--color-muted);
	}
	@keyframes pop {
		from {
			transform: scale(0.3);
			opacity: 0;
		}
	}
	.counts {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		color: var(--color-muted);
	}
	.counts span {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		display: inline-block;
	}
	.prompt {
		color: var(--color-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.checks {
		list-style: none;
		margin: 0;
		padding: 0.6rem 0 0;
		border-top: 1px solid var(--line);
		display: grid;
		gap: 0.45rem;
		font-size: 0.88rem;
	}
	.checks li {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}
	.checks span {
		display: grid;
	}
	.checks small {
		font-size: 0.78rem;
	}

	.ci-status {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		padding: 0.75rem;
		border-radius: 0.5rem;
		border: 1px solid var(--line);
	}
	.ci-status div {
		display: grid;
		gap: 0.15rem;
	}
	.ci-status small {
		font-size: 0.8rem;
	}
	.ci-status.passed {
		background: color-mix(in srgb, var(--color-success) 14%, transparent);
	}
	.ci-status.failed,
	.ci-status.error {
		background: color-mix(in srgb, var(--color-error) 14%, transparent);
	}
	.pane {
		height: 24rem;
		display: flex;
	}
	:global(.code) {
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--color-foreground) 4%, var(--color-background));
	}
	pre {
		margin: 0;
		padding: 0.75rem;
		font-size: 0.72rem;
		line-height: 1.55;
		white-space: pre-wrap;
		word-break: break-word;
	}
	pre .pass {
		color: var(--color-success);
	}
	pre .fail {
		color: var(--color-error);
		font-weight: 600;
	}
	pre .cmd {
		color: var(--color-primary);
	}
</style>
