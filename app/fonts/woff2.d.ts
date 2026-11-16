/** A font file imported from code resolves to the address it is served at. */
declare module '*.woff2' {
  const href: string
  export default href
}
