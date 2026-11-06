// Type shims for markdown-it plugins that ship no declarations (#1110).
// Each is a markdown-it plugin: a function that takes the markdown-it instance.
declare module 'markdown-it-sup' {
  const plugin: (md: unknown) => void
  export default plugin
}
declare module 'markdown-it-sub' {
  const plugin: (md: unknown) => void
  export default plugin
}
