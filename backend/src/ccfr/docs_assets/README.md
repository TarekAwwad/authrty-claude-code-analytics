# Vendored Swagger UI assets

Pinned copies of the Swagger UI distribution served at `/docs-assets` so the
`/docs` page loads no third-party JavaScript. FastAPI's stock docs page pulls
these from cdn.jsdelivr.net; CDN-served script runs in the API's own
unauthenticated origin and could read local session data, so we ship the
files inside the wheel instead.

- Package: `swagger-ui-dist` 5.32.13 (https://www.npmjs.com/package/swagger-ui-dist)
- License: Apache-2.0 (SwaggerUI, SmartBear Software)
- Files: `swagger-ui-bundle.js`, `swagger-ui.css`, `favicon-32x32.png`

To update, download the same three files for the new version from the npm
package (e.g. via jsDelivr or unpkg), verify the hashes match across both
mirrors, and update the version above. `swagger-ui.css` ends with a relative
`sourceMappingURL` comment; the map is intentionally not shipped, so browser
devtools log a harmless local 404 for it.
