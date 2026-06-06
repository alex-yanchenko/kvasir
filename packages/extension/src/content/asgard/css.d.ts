// esbuild's css-as-text loader: importing a stylesheet yields its source string
// (Heimdall injects it into the shadow root).
declare module "*.css" {
  const css: string;
  export default css;
}
