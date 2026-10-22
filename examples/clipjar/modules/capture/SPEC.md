# Capture requirements

- **CAPTURE-1** (MUST) (inferred) While the tool runs it notices each new copy within a fraction of a second and turns it into one clip. A copy with files becomes a file clip. Otherwise text with a non-whitespace character becomes a text clip, or a link clip when the whole text is one web address without whitespace. Otherwise an image becomes an image clip. Anything else is ignored.
- **CAPTURE-2** (MUST) (inferred) The clipboard contents present at start are never captured. Only later copies are.
- **CAPTURE-3** (MUST) (inferred) A copy the source app marks as concealed, transient or auto-generated, or that carries a known password-manager marker, is skipped, decided from type metadata before any content is read.
- **CAPTURE-4** (MUST) (inferred) A copy that may have come from an app on the ignore list is skipped before any content is read. The candidates are the app the copy declares, the app in front at the previous check, any app activated since, and the app in front now.
- **CAPTURE-5** (MUST) (inferred) The tool never captures its own clipboard writes. Each write carries a marker of its own, checked before anything else.
- **CAPTURE-6** (MUST) (inferred) While paused nothing is captured. A copy made during a pause, or by an ignored app, is never picked up later.
- **CAPTURE-7** (SHOULD) (inferred) A text copy over about a megabyte, or an image over about twenty, is skipped. Rich-text and web-markup versions over about two megabytes are dropped and the plain text is kept.
- **CAPTURE-8** (SHOULD) (inferred) Each clip records its source app, taken from the app the copy declares, otherwise the app in front, and never the tool itself.
