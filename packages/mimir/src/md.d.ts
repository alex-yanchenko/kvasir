// Bun embeds `import x from "./f.md" with { type: "text" }` as the file's text at
// --compile time; this declares the module shape so tsc types it as a string.
declare module "*.md" {
  const content: string;
  export default content;
}
