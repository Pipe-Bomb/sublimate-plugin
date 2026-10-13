import {
	DataClient,
	EphemeralSourceInfo,
	Logger,
	SearchFilter,
	SearchSource,
} from "@pipe-bomb/plugin-sdk";
import { SearchClientPayload } from "./search-client-payload.js";
import { SearchAttribute, SupportedAttributeType } from "./attribute-entry.js";
import {
	AttributeMatchResult,
	compareSearchAttributes,
	stringSimilarity,
	totalMatchConfidence,
} from "./attribute-match.js";

interface Props {
	payload: SearchClientPayload;
	logger: Logger;
	getEphemeralSources: () => EphemeralSourceInfo[];
	dataClient: DataClient;
	getSearchSource: () => SearchSource | null;
}

interface FindTrackOptions {
	title: string;
	attributes?: SearchAttribute[];
}

export class SearchClient {
	private readonly logger: Logger;
	private readonly dataClient: DataClient;
	private readonly getSearchSource: () => SearchSource | null;
	private isDestroyed = false;

	constructor(options: Props) {
		this.logger = options.logger;
		this.dataClient = options.dataClient;
		this.getSearchSource = options.getSearchSource;

		options.payload.on("destroy", () => {
			this.isDestroyed = true;
			this.logger.debug("Search client has been destroyed");
		});
	}

	async findTrack(options: FindTrackOptions) {
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

		const searchSource = this.getSearchSource();
		if (searchSource) {
			const results = await searchSource.search({
				query: options.title,
				entities: {
					tracks: {
						limit: 20,
					},
				},
			});

			if (results.tracks?.length) {
				const tracks = await this.dataClient.getTracks(results.tracks, {
					relations: {
						attributes: true,
						artists: {
							attributes: true,
						},
					},
				});

				const confidences: (number | null)[] = [];

				for (const track of tracks) {
					const matchResults: AttributeMatchResult[] = [];

					matchResults.push({
						key: "title",
						score: stringSimilarity(options.title, track.title),
					});

					if (options.attributes) {
						for (const { key, type } of matchKeys) {
							const attributes = options.attributes.filter(
								(a) => a.key == key && a.type == type,
							);
							const match = track.attributes!.find(
								(a) => a.key == key && a.type == type,
							);
							if (match) {
								// console.log("\n\nComparing:", attributes, match);
								const score = compareSearchAttributes(attributes, match);
								matchResults.push({
									key,
									score,
								});
							}
						}
					}

					const confidenceScore = totalMatchConfidence(matchResults);
					confidences.push(confidenceScore);
				}

				console.log(confidences);

				let bestIndex = -1;
				let bestConfidence = 0;
				for (const [index, confidence] of confidences.entries()) {
					if (confidence === null) {
						continue;
					}
					if (bestIndex == -1 || bestConfidence < confidence) {
						bestIndex = index;
						bestConfidence = confidence;
					}
				}
				console.log(`Best index: ${bestIndex} (confidence: ${bestConfidence})`);
			}
		}
	}
}
