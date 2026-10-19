import { AttributeType, AttributeValue } from "@pipe-bomb/plugin-sdk";

export type SupportedAttributeType = Exclude<AttributeType, "buffer">;

export type SearchAttribute<
	T extends SupportedAttributeType = SupportedAttributeType,
> = AttributeValue & {
	type: T;
};
