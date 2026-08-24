# Integration roadmap

## Storybook

The config already reserves `sources.storybook` and screen nodes accept references
such as `storybook:console:conversion-banner--failed`. Follow-up work will read
Storybook `index.json`, map stories to screen states, and embed the existing Storybook
iframe rather than reimplementing its renderer.

## Result adapters

JUnit and framework-specific adapters should normalize suites, node results, logs,
metrics, and files into Baekstage's common model. Planned adapters include command,
JUnit, service/unit-test, database-diff, and worker/queue results.

## Data systems

Database and worker integrations will remain opt-in adapters with explicit redaction,
read-only defaults, and environment allowlists. They will not put database clients or
queue administration logic into the graph model.
