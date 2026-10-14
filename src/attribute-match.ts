import { SearchAttribute, SupportedAttributeType } from "./attribute-entry.js";
import { CandidateAttribute } from "./match-candidate.js";

export type AttributeMatchResult = {
	key: string;
	score: number | null;
};

export type MatchEntityType = "track" | "artist" | "album";

export const MATCH_ATTRIBUTE_WEIGHTS: Record<
	MatchEntityType,
	Record<string, number>
> = {
	track: {
		title: 3,
		artist: 3,
		album: 2,
		duration: 1.5,
		bpm: 0.75,
		genre: 0.5,
		year: 0.5,
	},
	artist: {
		name: 3,
	},
	album: {
		title: 3,
		year: 1,
	},
};

const DEFAULT_ATTRIBUTE_WEIGHT = 1;
const AGREEMENT_THRESHOLD = 0.5;
const EVIDENCE_SATURATION = 2;

export function compareSearchAttributes(
	searchAttributes: SearchAttribute[],
	candidateAttribute: CandidateAttribute,
): number | null {
	const first = searchAttributes[0];
	if (!first) {
		return null;
	}

	if (first.key !== candidateAttribute.key) {
		return null;
	}

	if (!candidateAttribute.values.length) {
		return null;
	}

	const scores = searchAttributes
		.map((attribute) =>
			bestValueScore(attribute.value, candidateAttribute.values, first.type),
		)
		.filter((score): score is number => score !== null);

	if (!scores.length) {
		return null;
	}

	return scores.reduce((total, score) => total + score, 0) / scores.length;
}

export function compareAttributeSets(
	searchAttributes: SearchAttribute[],
	candidateAttributes: CandidateAttribute[],
	entityType: MatchEntityType,
): number | null {
	const groups = new Map<
		string,
		{ key: string; type: SupportedAttributeType; values: unknown[] }
	>();

	for (const attribute of searchAttributes) {
		const groupKey = `${attribute.key}:${attribute.type}`;
		let group = groups.get(groupKey);
		if (!group) {
			group = { key: attribute.key, type: attribute.type, values: [] };
			groups.set(groupKey, group);
		}
		group.values.push(attribute.value);
	}

	let totalWeight = 0;
	let weightedScore = 0;

	for (const group of groups.values()) {
		const candidates = candidateAttributes.filter(
			(attribute) => attribute.key === group.key,
		);
		if (!candidates.length) {
			continue;
		}

		const savedValues: unknown[] = candidates.flatMap(
			(attribute) => attribute.values,
		);
		const scores = group.values
			.map((value) => bestValueScore(value, savedValues, group.type))
			.filter((score): score is number => score !== null);
		if (!scores.length) {
			continue;
		}

		const keyScore = scores.reduce((total, score) => total + score, 0) / scores.length;
		const weight = attributeWeight(entityType, group.key);

		totalWeight += weight;
		weightedScore += weight * keyScore;
	}

	if (totalWeight === 0) {
		return null;
	}

	return weightedScore / totalWeight;
}

export function compareEntitySets<TInput, TCandidate>(
	input: TInput[],
	candidate: TCandidate[],
	similarity: (input: TInput, candidate: TCandidate) => number | null,
): number | null {
	if (!input.length) {
		return null;
	}

	if (!candidate.length) {
		return 0;
	}

	const pairs: { inputIndex: number; candidateIndex: number; score: number }[] =
		[];

	for (let inputIndex = 0; inputIndex < input.length; inputIndex++) {
		for (
			let candidateIndex = 0;
			candidateIndex < candidate.length;
			candidateIndex++
		) {
			const score = similarity(input[inputIndex]!, candidate[candidateIndex]!);
			if (score !== null) {
				pairs.push({ inputIndex, candidateIndex, score });
			}
		}
	}

	pairs.sort((a, b) => b.score - a.score);

	if (!pairs.length) {
		return null;
	}

	const usedInputs = new Set<number>();
	const usedCandidates = new Set<number>();
	let matchedScore = 0;

	for (const pair of pairs) {
		if (
			usedInputs.has(pair.inputIndex) ||
			usedCandidates.has(pair.candidateIndex)
		) {
			continue;
		}
		usedInputs.add(pair.inputIndex);
		usedCandidates.add(pair.candidateIndex);
		matchedScore += pair.score;
	}

	if (matchedScore === 0) {
		return 0;
	}

	const recall = matchedScore / input.length;
	const precision = matchedScore / candidate.length;

	return (2 * recall * precision) / (recall + precision);
}

function bestValueScore(
	value: unknown,
	savedValues: unknown[],
	type: SupportedAttributeType,
): number | null {
	const scores = savedValues
		.map((savedValue) => valueScore(value, savedValue, type))
		.filter((score): score is number => score !== null);

	if (!scores.length) {
		return null;
	}

	return Math.max(...scores);
}

function valueScore(
	value: unknown,
	savedValue: unknown,
	type: SupportedAttributeType,
): number | null {
	switch (type) {
		case "string":
			return typeof value === "string" && typeof savedValue === "string"
				? stringSimilarity(value, savedValue)
				: null;
		case "integer":
		case "decimal":
			return typeof value === "number" && typeof savedValue === "number"
				? numberSimilarity(value, savedValue)
				: null;
		case "boolean":
			return typeof value === "boolean" && typeof savedValue === "boolean"
				? value === savedValue
					? 1
					: 0
				: null;
	}
}

export function stringSimilarity(a: string, b: string): number {
	const left = normalize(a);
	const right = normalize(b);

	if (left === right) {
		return 1;
	}

	return 0.3 * fullRatio(left, right) + 0.7 * partialRatio(left, right);
}

function normalize(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function fullRatio(a: string, b: string): number {
	const maxLength = Math.max(a.length, b.length);
	if (maxLength === 0) {
		return 1;
	}
	return 1 - levenshteinDistance(a, b) / maxLength;
}

function partialRatio(a: string, b: string): number {
	const short = a.length <= b.length ? a : b;
	const long = a.length <= b.length ? b : a;
	const length = short.length;

	if (length === 0) {
		return long.length === 0 ? 1 : 0;
	}
	if (length === long.length) {
		return fullRatio(short, long);
	}

	let best = 0;
	for (let i = 0; i + length <= long.length; i++) {
		const score =
			1 - levenshteinDistance(short, long.slice(i, i + length)) / length;
		if (score > best) {
			best = score;
		}
	}
	return best;
}

function numberSimilarity(a: number, b: number): number {
	if (a === b) {
		return 1;
	}

	const magnitude = Math.max(Math.abs(a), Math.abs(b), 1);
	return Math.max(0, 1 - Math.abs(a - b) / magnitude);
}

function levenshteinDistance(a: string, b: string): number {
	const distances = Array.from({ length: b.length + 1 }, (_, i) => i);

	for (let i = 1; i <= a.length; i++) {
		let diagonal = distances[0]!;
		distances[0] = i;

		for (let j = 1; j <= b.length; j++) {
			const previous = distances[j]!;
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			distances[j] = Math.min(
				distances[j]! + 1,
				distances[j - 1]! + 1,
				diagonal + cost,
			);
			diagonal = previous;
		}
	}

	return distances[b.length]!;
}

function attributeWeight(entityType: MatchEntityType, key: string): number {
	return (
		MATCH_ATTRIBUTE_WEIGHTS[entityType][key.toLowerCase()] ??
		DEFAULT_ATTRIBUTE_WEIGHT
	);
}

export function totalMatchConfidence(
	results: AttributeMatchResult[],
	entityType: MatchEntityType = "track",
): number | null {
	if (!results.length) {
		return null;
	}

	let totalWeight = 0;
	let scoreableWeight = 0;
	let weightedScore = 0;
	let agreementWeight = 0;

	for (const { key, score } of results) {
		const weight = attributeWeight(entityType, key);
		totalWeight += weight;

		if (score === null) {
			continue;
		}

		scoreableWeight += weight;
		weightedScore += weight * score;

		if (score >= AGREEMENT_THRESHOLD) {
			agreementWeight += weight;
		}
	}

	if (scoreableWeight === 0) {
		return null;
	}

	const base = weightedScore / scoreableWeight;
	return (base * agreementWeight) / (totalWeight + EVIDENCE_SATURATION);
}
