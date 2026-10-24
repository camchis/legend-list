import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SRC = resolve(import.meta.dir, "../src");
const IMPORT_RE = /^\s*(?:import|export)\s+(type\s+)?(?:([^;]*?)\s+from\s+)?"([^"]+)"/gm;

function listFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? listFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
    });
}

function resolveImport(from: string, spec: string, platformExt: string) {
    const base = spec.startsWith("@/")
        ? join(SRC, spec.slice(2))
        : spec.startsWith(".")
          ? resolve(dirname(from), spec)
          : null;
    if (!base) {
        return undefined;
    }
    for (const candidate of [base, join(base, "index")]) {
        for (const ext of [`${platformExt}.ts`, `${platformExt}.tsx`, ".ts", ".tsx"]) {
            if (existsSync(candidate + ext)) {
                return candidate + ext;
            }
        }
    }
}

function getRuntimeImports(file: string, platformExt: string) {
    const imports: string[] = [];
    for (const [, typeOnly, clause, spec] of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
        const allTypes = clause?.startsWith("{") && clause.match(/[^{},\s][^,{}]*/g)?.every((s) => /^type\s/.test(s));
        if (!typeOnly && !allTypes) {
            const resolved = resolveImport(file, spec, platformExt);
            if (resolved) {
                imports.push(resolved);
            }
        }
    }
    return imports;
}

// Pre-existing cycles among the scroll orchestration modules. Shrink this list as they are broken;
// any module newly joining a cycle fails the test.
const KNOWN_CYCLE_FILES = [
    "core/cancelScroll.ts",
    "core/checkFinishedScroll.ts",
    "core/doMaintainScrollAtEnd.ts",
    "core/finishInitialScroll.ts",
    "core/finishScrollTo.ts",
    "core/mvcp.ts",
    "core/recalculateSettledScroll.ts",
    "core/scrollRequestTracker.ts",
    "core/updateScroll.ts",
    "utils/checkThresholds.ts",
    "utils/requestAdjust.ts",
];
const KNOWN_PLATFORM_CYCLE_FILES: Record<string, string[]> = {
    ".native": ["core/doScrollTo.native.ts"],
    ".web": ["core/doScrollTo.ts", "core/scrollTo.ts"],
};

function findFilesInCycles(platformExt: string) {
    const files = listFiles(SRC).filter((f) => !/\.(native|web)\.tsx?$/.test(f) || f.includes(`${platformExt}.`));
    const graph = new Map(files.map((f) => [f, getRuntimeImports(f, platformExt)]));
    const reachesItself = (file: string) => {
        const seen = new Set<string>();
        const queue = [...(graph.get(file) ?? [])];
        for (const next of queue) {
            if (next === file) {
                return true;
            }
            if (!seen.has(next)) {
                seen.add(next);
                queue.push(...(graph.get(next) ?? []));
            }
        }
        return false;
    };
    return files
        .filter(reachesItself)
        .map((f) => relative(SRC, f))
        .sort();
}

describe("import cycles", () => {
    for (const platformExt of [".native", ".web"]) {
        it(`has no new runtime import cycles under src for ${platformExt}`, () => {
            const expected = [...KNOWN_CYCLE_FILES, ...KNOWN_PLATFORM_CYCLE_FILES[platformExt]].sort();
            expect(findFilesInCycles(platformExt)).toEqual(expected);
        });
    }
});
