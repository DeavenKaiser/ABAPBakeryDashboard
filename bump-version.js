#!/usr/bin/env node
/**
 * Bump the cache-busting ?v= stamp on every versioned asset reference.
 *
 *   node bump-version.js
 *
 * RUN THIS BEFORE EVERY PUSH that touches config.js, nav.js or style.css.
 *
 * Why this exists
 * ---------------
 * Every page loads `config.js?v=<n>` and `nav.js?v=<n>`. Browsers cache those
 * under that exact URL. Ship new HTML that calls a new helper without changing
 * <n>, and the browser pairs your NEW html with its CACHED old config.js —
 * the helper is undefined, the first call throws ReferenceError, and the page
 * hangs on its loading message forever.
 *
 * That is exactly what happened on 2026-08-13: esc()/jsArg() were added to
 * config.js, the stamp was left at 1785531464, and the dashboard stuck on
 * "Loading your day…" for everyone whose browser had the old file.
 *
 * The real fix is a build step that stamps this automatically (ROADMAP Fixes
 * #14, task #32). Until that lands, this script makes it one command instead
 * of a find-and-replace across 15 files that is easy to forget.
 */

const fs = require("fs");
const path = require("path");

const dir = __dirname;
const stamp = Math.floor(Date.now() / 1000);
const pattern = /\?v=\d+/g;

let files = 0, refs = 0;
const seen = new Set();

for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith(".html")) continue;
  const file = path.join(dir, name);
  const before = fs.readFileSync(file, "utf8");
  const matches = before.match(pattern);
  if (!matches) continue;
  matches.forEach((m) => seen.add(m));
  const after = before.replace(pattern, `?v=${stamp}`);
  if (after !== before) {
    fs.writeFileSync(file, after);
    files++;
    refs += matches.length;
  }
}

if (!files) {
  console.log("No versioned asset references found — nothing to do.");
  process.exit(0);
}

const old = [...seen].join(", ");
console.log(`Bumped ${refs} reference(s) across ${files} file(s)`);
console.log(`  from: ${old}`);
console.log(`  to:   ?v=${stamp}`);

if (seen.size > 1) {
  console.log(
    "\nNote: the stamps were NOT all identical before this run. That means a\n" +
    "previous change bumped some files and missed others — the exact drift\n" +
    "this script exists to prevent. They are all consistent now."
  );
}
