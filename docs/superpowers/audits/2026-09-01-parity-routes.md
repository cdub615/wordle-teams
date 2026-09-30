# Route parity — prod vs beta

- prod: `https://wordleteams.com`
- beta: `https://beta.wordleteams.com`
- run: 2026-09-01T20:44:45.551Z
- anonymous, redirects reported not followed

15 routes: 1 missing-on-prod, 13 differs, 1 expected

| Path | Prod | Beta | Verdict | Differs on |
| --- | --- | --- | --- | --- |
| / | 200 | 200 | differs | cacheControl, og:image, og:url |
| /home | 200 | 200 | differs | cacheControl, og:image, og:url |
| /about | 200 | 200 | differs | cacheControl, title, og:image, og:url |
| /privacy | 200 | 200 | differs | cacheControl, og:image, og:url |
| /terms | 200 | 200 | differs | cacheControl, og:image, og:url |
| /login | 200 | 200 | differs | cacheControl, og:image, og:url |
| /login-error | 200 | 200 | differs | cacheControl, og:image, og:url |
| /maintenance | 200 | 200 | differs | cacheControl, og:image, og:url |
| /me | 307 | 307 | differs | location, cacheControl, contentType |
| /app | 404 | 307 | missing-on-prod | status |
| /complete-profile | 307 | 307 | differs | cacheControl, contentType |
| /robots.txt | 200 | 200 | differs | contentType |
| /sitemap.xml | 200 | 200 | differs | cacheControl, contentType |
| /opengraph-image.png | 200 | 200 | differs | cacheControl |
| /branding | 307 | 404 | expected | status |

| Path | Field | Prod | Beta |
| --- | --- | --- | --- |
| / | cacheControl | private, no-cache, no-store, max-age=0, must-revalidate | public, max-age=0, s-maxage=86400, stale-while-revalidate=604800 |
| / | og:image | /opengraph-image.png?826b6e40d0d7ffa6 | https://wordleteams.com/opengraph-image.png |
| / | og:url | / | https://wordleteams.com |
| /home | cacheControl | public, max-age=0, must-revalidate | public, max-age=0, s-maxage=86400, stale-while-revalidate=604800 |
| /home | og:image | /opengraph-image.png?826b6e40d0d7ffa6 | https://wordleteams.com/opengraph-image.png |
| /home | og:url | / | https://wordleteams.com |
| /about | cacheControl | private, no-cache, no-store, max-age=0, must-revalidate | public, max-age=0, s-maxage=86400, stale-while-revalidate=604800 |
| /about | title | Wordle Teams: The ultimate app for Wordle enthusiasts | About - Wordle Teams |
| /about | og:image | /opengraph-image.png?826b6e40d0d7ffa6 | https://wordleteams.com/opengraph-image.png |
| /about | og:url | / | https://wordleteams.com |
| /privacy | cacheControl | public, max-age=0, must-revalidate | public, max-age=0, s-maxage=86400, stale-while-revalidate=604800 |
| /privacy | og:image | /opengraph-image.png?826b6e40d0d7ffa6 | https://wordleteams.com/opengraph-image.png |
| /privacy | og:url | / | https://wordleteams.com |
| /terms | cacheControl | public, max-age=0, must-revalidate | public, max-age=0, s-maxage=86400, stale-while-revalidate=604800 |
| /terms | og:image | /opengraph-image.png?826b6e40d0d7ffa6 | https://wordleteams.com/opengraph-image.png |
| /terms | og:url | / | https://wordleteams.com |
| /login | cacheControl | private, no-cache, no-store, max-age=0, must-revalidate | private, no-store |
| /login | og:image | /opengraph-image.png?826b6e40d0d7ffa6 | https://wordleteams.com/opengraph-image.png |
| /login | og:url | / | https://wordleteams.com |
| /login-error | cacheControl | public, max-age=0, must-revalidate | public, max-age=0, s-maxage=86400, stale-while-revalidate=604800 |
| /login-error | og:image | /opengraph-image.png?826b6e40d0d7ffa6 | https://wordleteams.com/opengraph-image.png |
| /login-error | og:url | / | https://wordleteams.com |
| /maintenance | cacheControl | public, max-age=0, must-revalidate | public, max-age=0, s-maxage=86400, stale-while-revalidate=604800 |
| /maintenance | og:image | /opengraph-image.png?826b6e40d0d7ffa6 | https://wordleteams.com/opengraph-image.png |
| /maintenance | og:url | / | https://wordleteams.com |
| /me | location | /login | /app |
| /me | cacheControl | public, max-age=0, must-revalidate | — |
| /me | contentType | text/html | — |
| /app | status | 404 | 307 |
| /complete-profile | cacheControl | public, max-age=0, must-revalidate | — |
| /complete-profile | contentType | text/html | — |
| /robots.txt | contentType | text/plain | text/plain; charset=utf-8 |
| /sitemap.xml | cacheControl | public, max-age=0, must-revalidate | public, max-age=0, s-maxage=86400, stale-while-revalidate=604800 |
| /sitemap.xml | contentType | application/xml | application/xml; charset=utf-8 |
| /opengraph-image.png | cacheControl | public, immutable, no-transform, max-age=31536000 | public, max-age=0, must-revalidate |
| /branding | status | 307 | 404 |

