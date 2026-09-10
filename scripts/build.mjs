import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const outdir = "dist";

async function copyStaticFiles() {
  await mkdir(outdir, { recursive: true });
  await cp("public/manifest.json", `${outdir}/manifest.json`);
  await cp("src/options/index.html", `${outdir}/options.html`);
  await cp("src/options/styles.css", `${outdir}/options.css`);
}

const buildOptions = {
  entryPoints: {
    background: "src/background/index.ts",
    content: "src/content/index.ts",
    options: "src/options/index.ts"
  },
  bundle: true,
  entryNames: "[name]",
  format: "iife",
  target: "chrome120",
  outdir,
  sourcemap: watch,
  minify: !watch,
  logLevel: "info"
};

await rm(outdir, { recursive: true, force: true });
await copyStaticFiles();

if (watch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log("Watching extension sources…");
} else {
  await build(buildOptions);
}
