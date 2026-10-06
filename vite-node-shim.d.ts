declare const process: {
  env: Record<string, string | undefined>;
};

declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function readFile(file: string | URL, encoding: 'utf8'): Promise<string>;
  export function writeFile(file: string | URL, data: string, encoding?: 'utf8'): Promise<void>;
}

declare module 'node:fs' {
  export function readFileSync(file: URL, encoding: 'utf8'): string;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
}
