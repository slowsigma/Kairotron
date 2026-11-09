export type TickUnit =
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year";

export interface Horizon {
  readonly start: number;
  readonly end: number;
  readonly unit: TickUnit;
}

export interface Rate {
  readonly kind: "rate";
  readonly value: number;
  readonly perUnit: TickUnit;
}

export type ConstValue = number | Rate;

export interface SourceLocation {
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly text?: string;
}

export type StockMap = Readonly<Record<string, number>>;

export interface Delta {
  readonly stock: string;
  readonly amount: number;
  readonly rule: string;
  readonly loc?: SourceLocation;
}

export interface Snapshot {
  readonly t: number;
  readonly stocks: StockMap;
  readonly derived: StockMap;
  readonly deltas: readonly Delta[];
}

export interface TickContext {
  readonly t: number;
  readonly stocks: StockMap;
  readonly constants: Readonly<Record<string, number>>;
  readonly horizon: Horizon;
  readonly tickUnit: TickUnit;
  perTick(name: string): number;
  lag(stock: string, ticks: number): number;
}

export interface DerivedContext {
  readonly t: number;
  readonly stocks: StockMap;
  readonly derived: StockMap;
  readonly constants: Readonly<Record<string, number>>;
  readonly horizon: Horizon;
  readonly tickUnit: TickUnit;
  perTick(name: string): number;
}

export interface DerivedDef {
  readonly name: string;
  readonly expr: (ctx: DerivedContext) => number;
  readonly loc?: SourceLocation;
}

export type Guard = (ctx: TickContext) => boolean;

export type ScheduleSpec =
  | { readonly kind: "every"; readonly interval: number | Rate; readonly offset: number }
  | { readonly kind: "once"; readonly tick: number }
  | { readonly kind: "between"; readonly from: number; readonly to: number };

export interface FlowRule {
  readonly kind: "flow";
  readonly stock: string;
  readonly amount: (ctx: TickContext) => number;
  readonly label: string;
  readonly loc?: SourceLocation;
}

export interface TransferRule {
  readonly kind: "transfer";
  readonly from: string;
  readonly to: string;
  readonly amount: (ctx: TickContext) => number;
  readonly label: string;
  readonly loc?: SourceLocation;
}

export interface GuardedRule {
  readonly kind: "when" | "unless";
  readonly guard: Guard;
  readonly rule: Rule;
  readonly loc?: SourceLocation;
}

export interface ScheduledRule {
  readonly kind: "on";
  readonly schedule: ScheduleSpec;
  readonly rule: Rule;
  readonly loc?: SourceLocation;
}

export type Rule = FlowRule | TransferRule | GuardedRule | ScheduledRule;

export interface ModelSpec {
  readonly horizon?: Horizon;
  readonly constants?: Readonly<Record<string, ConstValue>>;
  readonly stocks: Readonly<Record<string, number>>;
  readonly rules: readonly Rule[];
  readonly derived?: readonly DerivedDef[];
}

export interface Model extends ModelSpec {
  readonly horizon: Horizon;
  readonly constants: Readonly<Record<string, ConstValue>>;
  readonly derived: readonly DerivedDef[];
}

export interface ForkSpec {
  readonly horizon?: Horizon;
  readonly stocks?: Readonly<Record<string, number>>;
  readonly label?: string;
}

export interface Branch {
  readonly label: string;
  readonly forkT: number;
  readonly horizon: Horizon;
  readonly snapshots: readonly Snapshot[];
}
