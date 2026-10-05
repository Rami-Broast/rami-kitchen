/**
 * `qz-tray` ships no type declarations.
 *
 * Declared as `unknown` rather than `any` so nothing can use the client
 * untyped by accident: `printer.ts` narrows it through the explicit `QzApi`
 * interface, which is the documented surface we actually depend on.
 */
declare module 'qz-tray' {
  const qz: unknown;
  export default qz;
}
