import type { ScenarioRunResult } from "../core/types";

export type ExecutionContext = { scenarioId: string; nodeId?: string };
export interface ExecutionAdapter<Input = unknown> {
  readonly id: string;
  run(input: Input, context: ExecutionContext): Promise<ScenarioRunResult>;
}
