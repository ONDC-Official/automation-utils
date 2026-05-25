/**
 * Ambient declaration for the side-effect-free subpath of pdf-parse.
 * `@types/pdf-parse` only covers the top-level "pdf-parse" entry; we import
 * `pdf-parse/lib/pdf-parse.js` to avoid v1.1.1's debug branch in index.js.
 */
declare module "pdf-parse/lib/pdf-parse.js" {
    import pdfParse from "pdf-parse";
    export default pdfParse;
}
