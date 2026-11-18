import { runPolicy } from '#lib/server/run.js';
import { DEFENSES, type Defense, type RunEvent } from '#lib/policy.js';
import type { RequestHandler } from './$types';

const KNOWN = new Set<string>(DEFENSES.map((d) => d.id));

/** Run the policy against a fresh mock with the posted defenses; streams one JSON event per line. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { defenses?: unknown };
	const enabled = (Array.isArray(body.defenses) ? body.defenses : []).filter(
		(id): id is Defense => typeof id === 'string' && KNOWN.has(id)
	);
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start: async (controller) => {
			const emit = (event: RunEvent) =>
				controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
			try {
				await runPolicy(enabled, emit);
			} catch (error) {
				emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
			} finally {
				controller.close();
			}
		}
	});
	return new Response(stream, {
		headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' }
	});
};
