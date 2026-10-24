import { expect, it } from "bun:test";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dir, "../..");
const config = ts.readConfigFile(resolve(root, "tsconfig.src.json"), ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;

for (const [name, entry] of [
    ["source web", "src/types.web"],
    ["source native", "src/types.react-native"],
    ...(process.env.TEST_BUILT_TYPES
        ? [
              ["built web", "dist/react"],
              ["built native", "dist/react-native"],
          ]
        : []),
]) {
    it(`accepts a 3.6.0-shaped listen implementation with typed new keys (${name})`, () => {
        const file = resolve(root, "__tests__/state/listen-consumer.ts");
        const source = `
import type { LegendListState } from "../../${entry}";
type LegacyValues = {
    activeStickyIndex: number;
    anchoredEndSpaceSize: number;
    footerSize: number;
    headerSize: number;
    isAtEnd: boolean;
    isAtStart: boolean;
    isNearEnd: boolean;
    isNearStart: boolean;
    isWithinMaintainScrollAtEndThreshold: boolean;
    adaptiveRender: "normal" | "light";
    lastItemKeys: string[];
    lastPositionUpdate: number;
    numContainers: number;
    numContainersPooled: number;
    otherAxisSize: number;
    readyToRender: boolean;
    snapToOffsets: number[];
    totalSize: number;
};
type Pending = "distanceFromEnd" | "isFollowingEnd";
declare const legacyState: Omit<LegendListState, Pending | "listen"> & {
    listen: <T extends keyof LegacyValues>(key: T, callback: (value: LegacyValues[T]) => void) => () => void;
};
const state: Omit<LegendListState, Pending> = legacyState;
// Pending required members remain required.
// @ts-expect-error legacy state lacks the pending required members
const fullState: LegendListState = legacyState;
state.listen("isFollowingEnd", value => { const following: boolean = value; });
state.listen("distanceFromEnd", value => { const distance: number = value; });
state.listen("isAtEnd", value => { const atEnd: boolean = value; });
state.listen("lastItemKeys", value => { const keys: string[] = value; });
declare const key: "distanceFromEnd" | "isAtEnd";
state.listen(key, value => { const metric: number | boolean = value; });
// @ts-expect-error callback must receive boolean
state.listen("isFollowingEnd", (value: number) => {});
// @ts-expect-error unknown listener keys are rejected
state.listen("unknownKey", () => {});
`;
        const host = ts.createCompilerHost(options);
        const getSourceFile = host.getSourceFile.bind(host);
        host.getSourceFile = (path, languageVersion, ...rest) =>
            path === file
                ? ts.createSourceFile(path, source, languageVersion)
                : getSourceFile(path, languageVersion, ...rest);
        const program = ts.createProgram([file], { ...options, incremental: false, noEmit: true }, host);
        const diagnostics = ts
            .getPreEmitDiagnostics(program)
            .filter((diagnostic) => diagnostic.file?.fileName === file);
        expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual(
            [],
        );
    });
}
