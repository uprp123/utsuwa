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

test('uses custom expression asset names without UniVRM expr_ prefixes', () => {
	const available = ['happy', 'expr_confusion', 'expr_heart', 'expr_jitome'];
	assert.deepEqual(getPuppetExpressionNames(available), [
		'neutral', 'happy', 'confusion', 'heart', 'jitome'
	]);
	assert.equal(resolvePuppetExpression('confusion', available), 'expr_confusion');
	assert.equal(resolvePuppetExpression('JITOME', available), 'expr_jitome');
});

test('resolves a synchronized expression case-insensitively to its exact VRM name', () => {
	assert.equal(resolvePuppetExpression('jitome', ['Happy', 'Jitome']), 'Jitome');
	assert.equal(resolvePuppetExpression('unknown', ['Happy', 'Jitome']), undefined);
});
