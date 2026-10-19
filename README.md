<h1>
    <img src="https://raw.githubusercontent.com/Pipe-Bomb/.github/refs/heads/master/assets/logos/Pipe%20Bomb%20no%20background%20w%20outline.png" width="40" />
    Sublimate Plugin
</h1>

Provides utility functions for other plugins to search for tracks throughout your library and ephemeral sources.

## Installation

Clone the repo into your [Pipe Bomb server's](https://github.com/pipe-bomb/server) `plugins` directory. Then inside, run:

```bash
npm ci
npm run build
```

## Usage

This is a library, not a plugin that implements user-facing features. To use it in your plugin, import it:

```ts
import { Plugin, PluginApiContext } from "@pipe-bomb/plugin-sdk";
import { SublimatePlugin } from "sublimate";

export default class ExamplePlugin implements Plugin {
	enable(ctx: PluginApiContext) {
		const getSublimate = () =>
			ctx.getPlugin<SublimatePlugin>("sublimate")?.getSearchClient() ?? null; // () => (SearchClient | null)
	}

	disable() {}
}
```

To avoid plugin loading race conditions, retrieve Sublimate when you need it instead of immediately on `enable()`. Using the `SublimatePlugin` type is optional, but adds handy types for development. To get the types:

```bash
npm i github:pipe-bomb/sublimate-plugin
```

## Contributing

The Sublimate plugin is developed by [eyezah](https://github.com/eyezahhhh), but contributions are welcome!
