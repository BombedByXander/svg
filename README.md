# cherri

Static site files for cherri. The app and all of its bundled scripts, styles, fonts, and images are in `b/`.

## Open the site

The runnable site is hosted with GitHub Pages:

<https://bombedbyxander.github.io/svg/>

The repository root redirects to `b/index.html`. The app loads its bundled assets from paths relative to that directory. jsDelivr serves the repository files as static downloads, but returns HTML as `text/plain`, so it cannot run the app as a website directly. Features that use external services still need those services to be available in the browser.
