declare module "*.css?url" {
  const url: string;
  export default url;
}

declare module "*.css" {
  const css: string;
  export default css;
}

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}
