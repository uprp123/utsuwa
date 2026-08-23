// VRChat向けモデルは100件以上のシェイプキーをVRM表情として書き出すことがある。
// すべてをリアクティブな設定UIへ並べるとブラウザが停止するため、Puppetで
// 意味が明確な表情だけを公開する。追加候補はここへ少数ずつ登録する。
const PUPPET_EXPRESSIONS = new Set([
	'happy', 'sad', 'angry', 'surprised', 'relaxed',
	'confusion', 'tear', 'jitome', 'interest', 'serious', 'heart'
]);

/** Public Puppet name. UniVRM may export custom expressions with an expr_ prefix. */
export function toPuppetExpressionName(name: string): string {
	return String(name).trim().replace(/^expr_/i, '');
}

/** Expressions safe to expose as Puppet emotions; mouth, blink and gaze controls stay internal. */
export function getPuppetExpressionNames(available: readonly string[]): string[] {
	const result = ['neutral'];
	const seen = new Set(result);
	for (const rawName of available) {
		const name = toPuppetExpressionName(rawName);
		const key = name.toLowerCase();
		if (!name || !PUPPET_EXPRESSIONS.has(key) || seen.has(key)) continue;
		seen.add(key);
		result.push(name);
	}
	return result;
}

export function resolvePuppetExpression(requested: string | undefined, available: readonly string[]): string | undefined {
	const key = String(requested ?? '').trim().toLowerCase();
	if (!key || key === 'neutral') return undefined;
	return available.find((name) => toPuppetExpressionName(name).toLowerCase() === key);
}
