/*
 * The learning road in the status bar, as Learning Road showed it (its successor, the vault's Knowledge OS Plugin Plan
 * 2026-10, D1): 🧭 due · ready · to read from the day's road plan, ✓ the verdicts recorded today, 🔥 the streak when the
 * site answers. Pure: the plugin reads the files and hands their text here.
 */

export interface RoadPlan {
	status?: string;
	paused_until?: string;
	due_total?: number;
	ready_total?: number;
	due?: unknown[];
	checks?: unknown[];
	readings?: unknown[];
}

export interface SiteToday {
	streak?: { days?: number };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function localDay(d = new Date()): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parsePlan(text: string | null): RoadPlan | null {
	if (text === null) return null;
	try {
		const v: unknown = JSON.parse(text);
		return v && typeof v === 'object' ? v : null;
	} catch {
		return null;
	}
}

export function countLines(text: string | null): number {
	return (text ?? '').split('\n').filter((l) => l.trim()).length;
}

export function statusText(plan: RoadPlan | null, verdictsToday: number, site: SiteToday | null): string {
	const bits: string[] = [];
	if (!plan) bits.push('🧭 no road plan today');
	else if (plan.status === 'paused') bits.push(`🧭 paused${plan.paused_until ? ' until ' + plan.paused_until : ''}`);
	else {
		bits.push(`🧭 ${plan.due_total ?? (plan.due ?? []).length} due`,
			`${plan.ready_total ?? (plan.checks ?? []).length} ready`, `${(plan.readings ?? []).length} to read`);
	}
	if (verdictsToday) bits.push(`✓ ${verdictsToday} today`);
	const days = site?.streak?.days ?? 0;
	if (days) bits.push(`🔥 ${days}`);
	return bits.join(' · ');
}

/** The road's own files (the day's plan, the verdict ledgers) wake the status bar; nothing else does. */
export const ROAD_FILE = /road-(plan|verdicts)-\d{4}-\d{2}-\d{2}\.jsonl?$/;

/** Where `read_on` may be written (vault CLAUDE.md §8.3): a list of folder prefixes; an empty list means anywhere. */
export function readable(path: string, zones: string[]): boolean {
	const z = zones.map((s) => s.trim()).filter(Boolean);
	return z.length === 0 || z.some((p) => path.startsWith(p.endsWith('/') ? p : p + '/'));
}
