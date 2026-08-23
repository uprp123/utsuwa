const TECHNICAL_EXPRESSIONS = new Set([
	'aa', 'ih', 'ou', 'ee', 'oh',
	'blink', 'blinkleft', 'blinkright',
	'lookup', 'lookdown', 'lookleft', 'lookright'
]);

/** Expressions safe to expose as Puppet emotions; mouth, blink and gaze controls stay internal. */
export function getPuppetExpressionNames(available: readonly string[]): string[] {
	const result = ['neutral'];
	const seen = new Set(result);
	for (const rawName of available) {
		const name = String(rawName).trim();
		const key = name.toLowerCase();
		if (!name || TECHNICAL_EXPRESSIONS.has(key) || seen.has(key)) continue;
		seen.add(key);
		result.push(name);
	}
	return result;
}

export function resolvePuppetExpression(requested: string | undefined, available: readonly string[]): string | undefined {
	const key = String(requested ?? '').trim().toLowerCase();
	if (!key || key === 'neutral') return undefined;
	return getPuppetExpressionNames(available).find((name) => name.toLowerCase() === key);
}
