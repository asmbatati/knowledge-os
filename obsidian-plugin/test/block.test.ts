import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listsFor, namesFor, parseBlock, rowFor, summary } from '../src/block.ts';

test('a progress block names the two properties it draws, and defaults to paper2chapter\'s', () => {
	assert.deepEqual(parseBlock('progress\nteaches: teaches\nassumes: prerequisites\n'), {
		kind: 'progress', assumes: 'prerequisites', teaches: 'teaches',
	});
	assert.deepEqual(parseBlock('  progress  \r\n\r\nassumes: assumes\r\n'), { kind: 'progress', assumes: 'assumes', teaches: 'teaches' });
	assert.deepEqual(parseBlock('progress'), { kind: 'progress', assumes: 'prerequisites', teaches: 'teaches' });
	assert.deepEqual(parseBlock('progress\nteaches: what it teaches'), { kind: 'progress', assumes: 'prerequisites', teaches: 'what it teaches' });
});

test('anything else in the block is named, not drawn', () => {
	assert.match((parseBlock('') as { error: string }).error, /draws `progress`/);
	assert.match((parseBlock('road\n') as { error: string }).error, /draws `progress`/);
	assert.match((parseBlock('progress\ncolour: red') as { error: string }).error, /colour/);
	assert.match((parseBlock('progress\nteaches:') as { error: string }).error, /teaches/);
});

test('names come from a property\'s links and plain values, resolved, in order, once each', () => {
	const fm = {
		teaches: ['[[Softmax]]', '[[Concepts/Softmax|the softmax]]', '[[Attention#Scaled]]', 'Plain name', 'plain NAME', 3, ''],
		prerequisites: '[[Exponential function]]',
	};
	const resolve = (link: string) => (link === 'Concepts/Softmax' ? 'Softmax' : link === 'Attention' ? 'Attention mechanism' : null);
	assert.deepEqual(namesFor(fm, 'teaches', resolve), ['Softmax', 'Attention mechanism', 'Plain name']);
	assert.deepEqual(namesFor(fm, 'prerequisites', resolve), ['Exponential function']);
	assert.deepEqual(namesFor(fm, 'missing', resolve), []);
	assert.deepEqual(namesFor(undefined, 'teaches', resolve), []);
});

test('a row\'s state, actions and distance follow the road', () => {
	assert.deepEqual(rowFor('Collection', { state: 'granted', stands: true, to_stand: 0, of: 1 }, 'assumes'), {
		name: 'Collection', state: 'granted', label: 'Granted', stands: true, detail: '', actions: [],
	});
	assert.deepEqual(rowFor('Counting', { state: 'ready', stands: false, to_stand: 1, of: 2 }, 'assumes').actions, ['check', 'teach']);
	assert.deepEqual(rowFor('Counting', { state: 'to-read', stands: false }, 'assumes').label, 'To read again');
	const locked = rowFor('Natural number', { state: 'locked', stands: false, to_stand: 2, of: 3 }, 'teaches');
	assert.deepEqual(locked.actions, ['teach', 'place']);
	assert.equal(locked.detail, '2 of 3 still to stand');
	assert.equal(rowFor('Natural number', { state: 'locked', stands: false, to_stand: 2, of: 3 }, 'assumes').detail, '');
	assert.equal(rowFor('Counting', { state: 'ready', stands: false, to_stand: 1, of: 2 }, 'teaches').detail, '1 of 2 still to stand');
	assert.deepEqual(rowFor('Stray idea', undefined, 'assumes'), {
		name: 'Stray idea', state: null, label: 'Not on the road', stands: false, detail: '', actions: ['explore'],
	});
	for (const s of ['provisional', 'passed', 'mastered']) assert.equal(rowFor('X', { state: s, stands: true }, 'teaches').actions.length, 0);
});

test('each list says how many stand, and an empty one says what it read', () => {
	const standing = {
		Collection: { state: 'granted', stands: true }, Counting: { state: 'ready', stands: false },
		'Natural number': { state: 'locked', stands: false, to_stand: 2, of: 3 },
	};
	const lists = listsFor({ kind: 'progress', assumes: 'prerequisites', teaches: 'teaches' },
		{ assumes: ['Collection', 'Counting', 'Stray idea'], teaches: ['Natural number'] }, standing);
	assert.deepEqual(lists.map((l) => [l.title, summary(l.rows)]), [['What it assumes', '1 of 3 stand'], ['What it teaches', '0 of 1 stand']]);
	assert.deepEqual(lists[0]!.rows.map((r) => r.state), ['granted', 'ready', null]);
	const none = listsFor({ kind: 'progress', assumes: 'prerequisites', teaches: 'teaches' }, { assumes: [], teaches: [] }, {});
	assert.deepEqual(none.map((l) => l.empty), ['This note names no concepts in prerequisites.', 'This note names no concepts in teaches.']);
});
