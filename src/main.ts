import { Plugin, PluginApiContext } from "@pipe-bomb/plugin-sdk";
import { SearchClient } from "./search-client.js";
import { SearchClientPayload } from "./search-client-payload.js";

interface ActiveClient {
	client: SearchClient;
	payload: SearchClientPayload;
}

export default class EphemeralImportPlugin implements Plugin {
	private searchClient: ActiveClient | null = null;

	enable(apiContext: PluginApiContext): void | Promise<void> {
		apiContext.registerLanguageDirectory("lang");

		const clientPayload = new SearchClientPayload();
		this.searchClient = {
			client: new SearchClient({
				payload: clientPayload,
				logger: apiContext.getLogger(),
				getEphemeralSources: () => apiContext.getEphemeralSources(),
				dataClient: apiContext.getDataClient(),
				getSearchSource: () => apiContext.getActiveSearchSource(),
			}),
			payload: clientPayload,
		};
	}

	disable() {
		if (this.searchClient) {
			this.searchClient.payload.destroy();
		}
	}

	public getSearchClient(): SearchClient | null {
		return this.searchClient?.client ?? null;
	}
}
