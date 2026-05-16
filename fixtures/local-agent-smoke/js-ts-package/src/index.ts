export interface GreetingOptions {
  name: string;
}

export function greeting(options: GreetingOptions): string {
  return `hello ${options.name}`;
}
