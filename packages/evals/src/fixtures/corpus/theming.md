# Theming the widget

The widget renders inside a shadow root, so page styles cannot leak in and widget
styles cannot leak out. You brand it in four layers: the dashboard editor, embed
attributes, CSS custom properties, and named slots.

Every colour, radius and font is a CSS custom property prefixed `--deskbell-`.
Set them on any ancestor of the widget element and the cascade carries them in.
No rule in the widget uses `!important`, so a host page always wins.

Internal elements are exposed with the `::part()` selector — for example
`::part(panel)` targets the answer panel and `::part(launcher)` the button that
opens it. A full-height side rail is reachable this way.

The launcher can be moved with the `position` attribute, which accepts
`bottom-right` and `bottom-left`. Precedence runs defaults, then server
configuration, then embed attributes, then host-page CSS.
