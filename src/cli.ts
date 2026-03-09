export function main(): void {
  process.stdout.write("agent-bus bootstrap\n");
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  main();
}
