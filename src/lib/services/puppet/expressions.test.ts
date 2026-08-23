import assert from 'node:assert/strict';
import test from 'node:test';
import { getPuppetExpressionNames, resolvePuppetExpression } from './expressions.ts';

test('exposes custom VRM expressions but hides technical face controls', () => {
	const names = getPuppetExpressionNames([
		'happy', 'confusion', 'tear', 'jitome', 'interest', 'serious', 'heart',
		'aa', 'blink', 'lookUp', 'eye_half_closed', 'mouth_smile_left'
	]);
	assert.deepEqual(names, [
		'neutral', 'happy', 'confusion', 'tear', 'jitome', 'interest', 'serious', 'heart'
	]);
});

test('resolves a synchronized expression case-insensitively to its exact VRM name', () => {
	assert.equal(resolvePuppetExpression('jitome', ['Happy', 'Jitome']), 'Jitome');
	assert.equal(resolvePuppetExpression('unknown', ['Happy', 'Jitome']), undefined);
});
