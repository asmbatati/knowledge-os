import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countLines, localDay, parsePlan, readable, ROAD_FILE, statusText } from '../src/road.ts';

test('the status bar says what Learning Road said', () => {
	assert.equal(statusText(null, 0, null), '🧭 no road plan today');
	assert.equal(statusText({ status: 'paused', paused_until: '2026-11-01' }, 0, null), '🧭 paused until 2026-11-01');
	assert.equal(statusText({ due_total: 3, ready_total: 5, readings: [1] }, 2, { streak: { days: 4 } }),
		'🧭 3 due · 5 ready · 1 to read · ✓ 2 today · 🔥 4');
	// totals fall back to the lists when the plan predates them
	assert.equal(statusText({ due: [1, 2], checks: [1] }, 0, { streak: { days: 0 } }), '🧭 2 due · 1 ready · 0 to read');
});

test('plans and ledgers are read without trusting them', () => {
	assert.equal(parsePlan(null), null);
	assert.equal(parsePlan('not json'), null);
	assert.equal(parsePlan('[1]') !== null, true);
	assert.equal(parsePlan('"text"'), null);
	assert.deepEqual(parsePlan('{"due_total": 1}'), { due_total: 1 });
	assert.equal(countLines(null), 0);
	assert.equal(countLines('{"a":1}\n\n{"b":2}\n'), 2);
});

test('only the road files wake the bar', () => {
	assert.ok(ROAD_FILE.test('x/reports/learning/road-plan-2026-10-26.json'));
	assert.ok(ROAD_FILE.test('x/reports/learning/road-verdicts-2026-10-26.jsonl'));
	assert.ok(!ROAD_FILE.test('x/reports/learning/road-state.json'));
	assert.ok(!ROAD_FILE.test('x/reports/learning/road-placement-2026-10-26.jsonl'));
});

test('mark as read keeps to its zones', () => {
	const zones = 'Atlas/, Library/, Areas/Portfolio/My Research/'.split(',');
	assert.ok(readable('Atlas/Concepts/Kalman Filter.md', zones));
	assert.ok(readable('Areas/Portfolio/My Research/Idea.md', zones));
	assert.ok(!readable('+/Clippings/x.md', zones));
	assert.ok(!readable('Atlasx/y.md', zones));
	assert.ok(readable('anything.md', ['']));
	assert.ok(readable('anything.md', []));
});

test('the day is the local day', () => {
	assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});
