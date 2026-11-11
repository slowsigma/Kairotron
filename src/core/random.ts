// Monte Carlo randomness (milestone 8): deterministic by default, stochastic
// only under an explicit seed. splitmix32 is the uniform source (small,
// well-mixed, exact in 32-bit integers); normal draws use Box-Muller with the
// spare cached *inside* the stream, so a path's draw sequence depends only on
// (seed, path) — never on wall-clock, iteration order, or worker scheduling.

export class Rng {
  private state: number;
  private spare: number | undefined;

  constructor(seed: number) {
    if (!Number.isInteger(seed)) throw new Error(`Rng seed must be an integer (got ${seed})`);
    this.state = seed >>> 0;
  }

  // Uniform in [0, 1).
  uniform(): number {
    this.state = (this.state + 0x9e3779b9) >>> 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    z = (z ^ (z >>> 15)) >>> 0;
    return z / 0x100000000;
  }

  // Standard normal. One uniform pair yields two draws; the spare keeps the
  // stream aligned no matter how many normals the consumer asks for.
  normal(): number {
    if (this.spare !== undefined) {
      const s = this.spare;
      this.spare = undefined;
      return s;
    }
    let u = 0;
    do {
      u = this.uniform();
    } while (u < 1e-12); // keep log(u) finite
    const v = this.uniform();
    const m = Math.sqrt(-2 * Math.log(u));
    const a = 2 * Math.PI * v;
    this.spare = m * Math.sin(a);
    return m * Math.cos(a);
  }
}

// Per-path seeding: path i of master seed s gets its own well-mixed stream,
// so adding or reordering paths never shifts another path's draws.
export function pathSeed(seed: number, path: number): number {
  if (!Number.isInteger(seed) || !Number.isInteger(path)) {
    throw new Error(`path seed needs integer seed and path index (got ${seed}, ${path})`);
  }
  let z = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(path + 0x165667b1, 0xc2b2ae35)) >>> 0;
  z = (z ^ (z >>> 13)) >>> 0;
  z = Math.imul(z, 0x27d4eb2f) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}
