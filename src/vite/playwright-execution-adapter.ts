import type { ScenarioRunResult } from "../core/types";
import type { ExecutionAdapter, ExecutionContext } from "./execution-adapter";

export type PlaywrightRunInput = { source?: string; grep?: string };

export class PlaywrightExecutionAdapter implements ExecutionAdapter<PlaywrightRunInput> {
  readonly id = "playwright";
  constructor(private readonly execute: (scenarioId: string, source?: string, grep?: string) => Promise<ScenarioRunResult>) {}
  run(input: PlaywrightRunInput, context: ExecutionContext) { return this.execute(context.scenarioId, input.source, input.grep); }
}
