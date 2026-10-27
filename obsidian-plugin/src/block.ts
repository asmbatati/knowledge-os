/*
 * The `knowledge-os` code block (docs/plans/2026-10-27-paper-chapters.md, K4): what a note assumes and what it teaches,
 * each concept with its live standing on the road. paper2chapter writes it into a chapter as
 *
 *   ```knowledge-os
 *   progress
 *   teaches: teaches
 *   assumes: prerequisites
 *   ```
 *
 * naming the two frontmatter properties that hold the concepts. Pure: the plugin reads the note's frontmatter and the
 * site's standing and hands them here; nothing is written anywhere.
 */

/** A concept's standing as the site gives it (/api/standing), and the API's status() passes it on. */
export interface Standing {
	note?: string;
	state: string;
	stands: boolean;
	layer?: number;
	to_stand?: number;
	of?: number;
}

export interface ProgressSpec {
	kind: 'progress';
	assumes: string;
	teaches: string;
}

export type Role = 'assumes' | 'teaches';
export type Action = 'check' | 'teach' | 'place' | 'explore';

export interface Row {
	name: string;
	state: string | null; // null: the road does not hold it
	label: string;
	stands: boolean;
	detail: string;
	actions: Action[];
}

export interface List {
	role: Role;
	title: string;
	key: string;
	rows: Row[];
	empty: string; // what to say when the property names no concept
}

/** paper2chapter's default property names. */
const DEFAULT_KEYS: Record<Role, string> = { assumes: 'prerequisites', teaches: 'teaches' };
const MAX_NAMES = 200;

export function parseBlock(source: string): ProgressSpec | { error: string } {
	const lines = source.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	if (lines[0] !== 'progress') return { error: 'This Knowledge OS block draws `progress`, with the properties it reads: `teaches:` and `assumes:`.' };
	const spec: ProgressSpec = { kind: 'progress', ...DEFAULT_KEYS };
	for (const line of lines.slice(1)) {
		const m = /^(teaches|assumes)\s*:\s*(.*)$/.exec(line);
		if (!m) return { error: `This Knowledge OS block does not know the line "${line}": it reads \`teaches:\` and \`assumes:\`.` };
		const key = m[2]!.trim();
		if (!key) return { error: `The line "${m[1]}:" in this Knowledge OS block names no property.` };
		spec[m[1] as Role] = key;
	}
	return spec;
}

const LINK = /^\[\[([^\]|#]*)(?:[#|][^\]]*)?\]\]$/;

/**
 * The concepts a frontmatter property names: its wikilinks (by their link path, resolved to the note they reach) and
 * plain names, in order, each once whatever its case.
 */
export function namesFor(fm: Record<string, unknown> | undefined, key: string, resolve: (link: string) => string | null): string[] {
	const raw = fm?.[key];
	const values = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const v of values) {
		if (typeof v !== 'string') continue;
		const s = v.trim();
		const m = LINK.exec(s);
		const link = (m ? m[1]! : s).trim();
		if (!link) continue;
		const name = resolve(link) ?? link.split('/').pop()!;
		if (!name || seen.has(name.toLowerCase())) continue;
		seen.add(name.toLowerCase());
		out.push(name);
		if (out.length >= MAX_NAMES) break;
	}
	return out;
}

const LABELS: Record<string, string> = {
	granted: 'Granted', provisional: 'Provisional', passed: 'Passed', mastered: 'Mastered',
	ready: 'Ready to check', 'to-read': 'To read again', locked: 'Locked',
};

export function rowFor(name: string, s: Standing | undefined, role: Role): Row {
	if (!s) return { name, state: null, label: 'Not on the road', stands: false, detail: '', actions: ['explore'] };
	const actions: Action[] = s.stands ? []
		: s.state === 'ready' || s.state === 'to-read' ? ['check', 'teach']
			: ['teach', 'place'];
	const far = role === 'teaches' && !s.stands && typeof s.to_stand === 'number' && typeof s.of === 'number';
	return {
		name, state: s.state, label: LABELS[s.state] ?? s.state, stands: s.stands,
		detail: far ? `${s.to_stand} of ${s.of} still to stand` : '', actions,
	};
}

export function listsFor(spec: ProgressSpec, names: Record<Role, string[]>, standing: Record<string, Standing>): List[] {
	const roles: [Role, string][] = [['assumes', 'What it assumes'], ['teaches', 'What it teaches']];
	return roles.map(([role, title]) => ({
		role, title, key: spec[role],
		rows: names[role].map((n) => rowFor(n, standing[n], role)),
		empty: `This note names no concepts in ${spec[role]}.`,
	}));
}

export function summary(rows: Row[]): string {
	return `${rows.filter((r) => r.stands).length} of ${rows.length} stand`;
}
