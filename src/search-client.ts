import {
	DataClient,
	EphemeralSourceInfo,
	EphemeralTrack,
	Logger,
	SavedTrack,
	SearchSource,
} from "@pipe-bomb/plugin-sdk";
import { SearchClientPayload } from "./search-client-payload.js";
import { SearchAttribute, SupportedAttributeType } from "./attribute-entry.js";
import {
	AttributeMatchResult,
	compareAttributeSets,
	compareEntitySets,
	compareSearchAttributes,
	stringSimilarity,
	totalMatchConfidence,
} from "./attribute-match.js";
import {
	EphemeralCandidateSource,
	MatchCandidate,
	toEphemeralCandidate,
	toLibraryCandidate,
} from "./match-candidate.js";

const CONFIDENCE_MATCH = 0.4;

interface Props {
	payload: SearchClientPayload;
	logger: Logger;
	getEphemeralSources: () => EphemeralSourceInfo[];
	dataClient: DataClient;
	getSearchSource: () => SearchSource | null;
}

export interface FindTrackOptions {
	title: string;
	attributes?: SearchAttribute[];
	artists?: SearchAttribute[][];
	album?: SearchAttribute[];
	confidenceMatch?: number;
}

export type FindTrackResult =
	| { ephemeral: false; track: SavedTrack; confidence: number }
	| {
			ephemeral: true;
			source: EphemeralSourceInfo;
			track: EphemeralTrack;
			confidence: number;
	  };

interface MatchOutcome<TValue> {
	value: TValue;
	confidence: number;
	results: AttributeMatchResult[];
}

export class SearchClient {
	private readonly logger: Logger;
	private readonly dataClient: DataClient;
	private readonly getEphemeralSources: () => EphemeralSourceInfo[];
	private readonly getSearchSource: () => SearchSource | null;
	private isDestroyed = false;

	constructor(options: Props) {
		this.logger = options.logger;
		this.dataClient = options.dataClient;
		this.getEphemeralSources = options.getEphemeralSources;
		this.getSearchSource = options.getSearchSource;

		options.payload.on("destroy", () => {
			this.isDestroyed = true;
			this.logger.debug("Search client has been destroyed");
		});
	}

	async findTrack(options: FindTrackOptions): Promise<FindTrackResult | null> {
		const libraryMatch = await this.matchLibraryTracks(options);
		if (
			libraryMatch &&
			libraryMatch.confidence >= (options.confidenceMatch ?? CONFIDENCE_MATCH)
		) {
			// this.logMatch(options.title, libraryMatch.value.title, libraryMatch);
			return {
				ephemeral: false,
				track: libraryMatch.value,
				confidence: libraryMatch.confidence,
			};
		}

		this.logger.debug(
			`No confident library match for "${options.title}", falling back to ephemeral sources`,
		);

		const ephemeralMatch = await this.matchEphemeralTracks(options);
		if (
			ephemeralMatch &&
			ephemeralMatch.confidence >= (options.confidenceMatch ?? CONFIDENCE_MATCH)
		) {
			// this.logMatch(
			// 	options.title,
			// 	ephemeralMatch.value.track.title,
			// 	ephemeralMatch,
			// );
			return {
				ephemeral: true,
				source: ephemeralMatch.value.source,
				track: ephemeralMatch.value.track,
				confidence: ephemeralMatch.confidence,
			};
		}

		return null;
	}

	async debugFindTrack(options: FindTrackOptions): Promise<{
		library: MatchOutcome<SavedTrack> | null;
		ephemeral: MatchOutcome<EphemeralCandidateSource> | null;
	}> {
		const library = await this.matchLibraryTracks(options);
		const ephemeral = await this.matchEphemeralTracks(options);
		return { library, ephemeral };
	}

	private async matchLibraryTracks(
		options: FindTrackOptions,
	): Promise<MatchOutcome<SavedTrack> | null> {
		const searchSource = this.getSearchSource();
		if (!searchSource) {
			return null;
		}

		const results = await searchSource.search({
			query: options.title,
			entities: {
				tracks: {
					limit: 20,
				},
			},
		});

		if (!results.tracks?.length) {
			return null;
		}

		const tracks = await this.dataClient.getTracks(results.tracks, {
			relations: {
				attributes: true,
				artists: {
					attributes: true,
				},
				albums: {
					attributes: true,
				},
			},
		});

		return this.matchCandidates(tracks.map(toLibraryCandidate), options);
	}

	private async matchEphemeralTracks(
		options: FindTrackOptions,
	): Promise<MatchOutcome<EphemeralCandidateSource> | null> {
		const candidates: MatchCandidate<EphemeralCandidateSource>[] = [];

		for (const sourceInfo of this.getEphemeralSources()) {
			try {
				const results = await sourceInfo.source.search({
					query: options.title,
				});

				for (const track of results.tracks) {
					candidates.push(toEphemeralCandidate(sourceInfo, track));
				}
			} catch (e) {
				this.logger.error(
					`Ephemeral source "${sourceInfo.sourceId}" failed to search:`,
					e,
				);
			}
		}

		return this.matchCandidates(candidates, options);
	}

	private matchCandidates<TValue>(
		candidates: MatchCandidate<TValue>[],
		options: FindTrackOptions,
	): MatchOutcome<TValue> | null {
		const matchKeySet = new Map<string, [string, SupportedAttributeType]>();
		for (const attribute of options.attributes ?? []) {
			matchKeySet.set(`${attribute.key}:${attribute.type}`, [
				attribute.key,
				attribute.type,
			]);
		}
		const matchKeys = Array.from(matchKeySet.values()).map(([key, type]) => ({
			key,
			type,
		}));

		let best: MatchOutcome<TValue> | null = null;

		for (const candidate of candidates) {
			const results = this.scoreCandidate(candidate, options, matchKeys);
			const confidence = totalMatchConfidence(results);
			if (confidence === null) {
				continue;
			}

			if (!best || confidence > best.confidence) {
				best = { value: candidate.value, confidence, results };
			}
		}

		return best;
	}

	private scoreCandidate(
		candidate: MatchCandidate<unknown>,
		options: FindTrackOptions,
		matchKeys: { key: string; type: SupportedAttributeType }[],
	): AttributeMatchResult[] {
		const matchResults: AttributeMatchResult[] = [];

		matchResults.push({
			key: "title",
			score: stringSimilarity(options.title, candidate.title),
		});

		if (options.artists?.length) {
			const artistScore = compareEntitySets(
				options.artists,
				candidate.artists,
				(input, artistAttributes) =>
					compareAttributeSets(input, artistAttributes, "artist"),
			);
			if (artistScore !== null) {
				matchResults.push({ key: "artist", score: artistScore });
			}
		}

		if (options.album && candidate.hasAlbumData) {
			const albumScore = compareEntitySets(
				[options.album],
				candidate.albums,
				(input, albumAttributes) =>
					compareAttributeSets(input, albumAttributes, "album"),
			);
			if (albumScore !== null) {
				matchResults.push({ key: "album", score: albumScore });
			}
		}

		if (options.attributes) {
			for (const { key, type } of matchKeys) {
				const attributes = options.attributes.filter(
					(attribute) => attribute.key == key && attribute.type == type,
				);
				const candidates = candidate.attributes.filter(
					(attribute) => attribute.key == key,
				);
				if (!candidates.length) {
					continue;
				}

				let best: number | null = null;
				for (const candidateAttribute of candidates) {
					const score = compareSearchAttributes(attributes, candidateAttribute);
					if (score !== null && (best === null || score > best)) {
						best = score;
					}
				}

				if (best !== null) {
					matchResults.push({ key, score: best });
				}
			}
		}

		return matchResults;
	}
}
