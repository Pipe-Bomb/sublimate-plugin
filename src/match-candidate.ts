import {
	AttributeValue,
	EphemeralSourceInfo,
	EphemeralTrack,
	SavedAttribute,
	SavedTrack,
} from "@pipe-bomb/plugin-sdk";
import { SupportedAttributeType } from "./attribute-entry.js";

export interface CandidateAttribute {
	key: string;
	type?: SupportedAttributeType;
	values: unknown[];
}

export interface MatchCandidate<TValue> {
	value: TValue;
	title: string;
	attributes: CandidateAttribute[];
	artists: CandidateAttribute[][];
	albums: CandidateAttribute[][];
	hasAlbumData: boolean;
}

export interface EphemeralCandidateSource {
	source: EphemeralSourceInfo;
	track: EphemeralTrack;
}

function fromSavedAttribute(attribute: SavedAttribute): CandidateAttribute {
	return {
		key: attribute.key,
		type: attribute.type === "buffer" ? undefined : attribute.type,
		values: attribute.values as unknown[],
	};
}

function fromAttributeValue(attribute: AttributeValue): CandidateAttribute {
	return {
		key: attribute.key,
		values: [attribute.value],
	};
}

export function toLibraryCandidate(track: SavedTrack): MatchCandidate<SavedTrack> {
	return {
		value: track,
		title: track.title,
		attributes: (track.attributes ?? []).map(fromSavedAttribute),
		artists: (track.artists ?? []).map((entry) =>
			(entry.artist?.attributes ?? []).map(fromSavedAttribute),
		),
		albums: (track.albums ?? []).map((entry) =>
			(entry.album?.attributes ?? []).map(fromSavedAttribute),
		),
		hasAlbumData: true,
	};
}

export function toEphemeralCandidate(
	source: EphemeralSourceInfo,
	track: EphemeralTrack,
): MatchCandidate<EphemeralCandidateSource> {
	return {
		value: { source, track },
		title: track.title,
		attributes: (track.attributes ?? []).map(fromAttributeValue),
		artists: (track.artists ?? []).map((artist) =>
			(artist.attributes ?? []).map(fromAttributeValue),
		),
		albums: [],
		hasAlbumData: false,
	};
}
