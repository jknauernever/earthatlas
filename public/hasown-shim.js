// Mapbox GL calls Object.hasOwn (ES2022); without this shim, browsers older than
// Chrome 93 / Safari 15.4 crash every map tool on load. (A file, not inline, for the CSP.)
if (!Object.hasOwn) {
  Object.defineProperty(Object, 'hasOwn', {
    value: function (obj, prop) {
      return Object.prototype.hasOwnProperty.call(Object(obj), prop)
    },
    writable: true,
    configurable: true,
  })
}
