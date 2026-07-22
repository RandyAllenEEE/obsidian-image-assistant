declare const __TEST__: boolean;

declare module "virtual:reference-index-worker" {
    const sources: {
        readonly browser: string;
        readonly node: string;
    };
    export default sources;
}
