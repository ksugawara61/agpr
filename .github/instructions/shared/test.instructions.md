---
applyTo: '**/*.test.{ts,tsx}'
paths:
  - '**/*.test.{ts,tsx}'
---

# テストコードのコーディングガイドライン

このリポジトリでは Vitest を使ってテストを記述します。
コードレビュー時は以下のルールに基づいて指摘してください。

## 重複した入出力ケースは `it.each` でデータ駆動化する

「同じ関数を呼んで、入力と期待結果だけが違う」テストを `it` で並べると、
本質的な差分（入力と出力の対応）が assertion 周辺の定型コードに埋もれます。
このようなケースは `it.each` でテーブルにまとめ、
「入力 → 期待結果」の対応が一目で読めるようにしてください。

### タプル形式（引数が少ないとき）

```ts
// Good: しきい値と icon の対応がテーブルで一覧できる
it.each([
  [80, "✅"],
  [100, "✅"],
  [50, "⚠️"],
  [79, "⚠️"],
  [0, "❌"],
  [49, "❌"],
])("renders %s%% coverage with %s icon", (pct, icon) => {
  expect(formatResult(resultWithFile("src/a.ts", pct))).toContain(icon);
});

// Bad: 同じ assertion を 3 回コピペしていて、しきい値の境界が読み取りにくい
it("uses ✅ icon for coverage >= 80%", () => {
  expect(formatResult(resultWithFile("src/a.ts", 80))).toContain("✅");
  expect(formatResult(resultWithFile("src/a.ts", 100))).toContain("✅");
});
it("uses ⚠️ icon for coverage >= 50% and < 80%", () => {
  expect(formatResult(resultWithFile("src/a.ts", 50))).toContain("⚠️");
  expect(formatResult(resultWithFile("src/a.ts", 79))).toContain("⚠️");
});
it("uses ❌ icon for coverage < 50%", () => {
  expect(formatResult(resultWithFile("src/a.ts", 0))).toContain("❌");
  expect(formatResult(resultWithFile("src/a.ts", 49))).toContain("❌");
});
```

### オブジェクト形式（引数が多いとき）

引数が 3 つ以上、または意味が名前から分からないときは
オブジェクト形式にして `$propName` でテスト名にプロパティを差し込んでください。

```ts
// Good: 各ケースの意図が name から読める
it.each([
  { name: "matches *.mocks.ts under any directory", pattern: "*.mocks.ts", input: "src/foo.mocks.ts", expected: true },
  { name: "rejects different extension", pattern: "*.mocks.ts", input: "src/foo.test.ts", expected: false },
  { name: "anchors path-with-slash patterns to start", pattern: "src/*.mocks.ts", input: "other/foo.mocks.ts", expected: false },
])("$name", ({ pattern, input, expected }) => {
  expect(new RegExp(globToRegex(pattern)).test(input)).toBe(expected);
});

// Bad: タプルの 3 列目が boolean だが、何が「true」なのか名前から分からない
it.each([
  ["*.mocks.ts", "src/foo.mocks.ts", true],
  ["*.mocks.ts", "src/foo.test.ts", false],
])("globToRegex %s vs %s", (pattern, input, expected) => { ... });
```

## モックの前提が複数の観点で検証されるなら `describe.each` でスイートを括る

「同じセットアップで、複数の `it` を流したい」ときは `describe.each` でまとめます。
1 ケースに対して `it` 1 個（=観点 1 個）に絞れるので、失敗時にどの観点が壊れたか即座に分かります。

```ts
// Good: 同じ vitest config 配置 → runner detect の各観点を別々の it で検証
describe.each([
  { filename: "vitest.config.ts", content: "export default {}" },
  { filename: "vitest.config.js", content: "module.exports = {}" },
  { filename: "vitest.config.mts", content: "export default {}" },
])("detectRunner with $filename", ({ filename, content }) => {
  it("returns 'vitest'", async () => {
    await writeFile(join(tmpDir, filename), content);
    expect(await detectRunner(tmpDir)).toBe("vitest");
  });
});
```

`it.each` と `describe.each` の使い分けはシンプルに:

- 検証が assertion 1 行 → `it.each`
- 同じ前提から複数観点を検証 → `describe.each`

## テストデータは Builder / Factory 関数で組み立てる

巨大なオブジェクトをテスト本体にインラインで書くと、「このテストで本質的に違う部分はどこか」が読み取れなくなります。
共通部分はファイル先頭の factory 関数に追い出し、`Partial<T>` のオーバーライドだけテスト本体に書いてください。

```ts
// Good: デフォルト値は factory に押し込み、テスト本体は「差分」だけが残る
function makeResult(overrides?: Partial<DiffCoverageResult>): DiffCoverageResult {
  return {
    files: [],
    runner: "jest",
    summary: { /* ... */ },
    timestamp: "2024-01-01T00:00:00.000Z",
    uncoveredFiles: [],
    ...overrides,
  };
}

it("includes runner name in header", () => {
  expect(formatResult(makeResult({ runner: "vitest" }))).toContain("vitest");
});

// Bad: テストごとに完全なオブジェクトを書いていて、何が変わっているか目視で diff を取る必要がある
it("includes runner name in header", () => {
  const result: DiffCoverageResult = {
    files: [],
    runner: "vitest",
    summary: { /* 同じ巨大なオブジェクト */ },
    timestamp: "2024-01-01T00:00:00.000Z",
    uncoveredFiles: [],
  };
  expect(formatResult(result)).toContain("vitest");
});
```

## `describe` は対象、`it` は振る舞いで命名する

- `describe` には「何をテストしているか」（関数名・クラス名）を書きます
- `it` には「どう振る舞うか」を `〜する` / `returns 〜` の形で書きます
- ケースの内容を細かく書くより、「入力 → 期待結果」の対応が短く分かる名前を優先してください

```ts
// Good
describe("getDiffFiles", () => {
  it("returns empty array when git diff reports no changed files", async () => { ... });
  it("filters out test files by default", async () => { ... });
});

// Bad: describe / it の責務が逆転している、または冗長
describe("test for the function that gets diff files from git", () => {
  it("getDiffFiles", async () => { ... });
});
```

## モックは毎テスト前にリセットする

`vi.fn()` の呼び出し履歴やオーバーライドはテスト間で共有されます。
リークを避けるため、モックを使う `describe` の冒頭で `beforeEach(() => vi.clearAllMocks())` を呼んでください。
連続呼び出しのスタブには `mockResolvedValueOnce` / `mockRejectedValueOnce` を使い、
1 回ごとの応答を明示します。

```ts
// Good: clearAllMocks で履歴を毎回リセットし、Once 系で順序を明示
beforeEach(() => {
  vi.clearAllMocks();
});

it("falls back when origin/<base> is missing", async () => {
  mockExeca
    .mockRejectedValueOnce(new Error("no origin/main")) // git rev-parse --verify
    .mockResolvedValueOnce({ stdout: "/project" } as never); // git rev-parse --show-toplevel
  await getDiffFiles("/project", "main");
});

// Bad: clearAllMocks を忘れていて、前のテストの呼び出しが mock.calls に残る
it("falls back when origin/<base> is missing", async () => {
  mockExeca.mockResolvedValue({ stdout: "/project" } as never); // 全呼び出しに同じ値が返る
  ...
});
```

連続スタブの繰り返しが多い場合は、ヘルパ関数（例: `mockGit(...returns)`）に切り出して
テスト本体から定型処理を消してください。

## ファイルシステム等の副作用フィクスチャは afterEach で必ず片付ける

`mkdtemp` で作った一時ディレクトリ、書き込んだファイル、起動したプロセスは
テストが落ちた場合でも残らないよう、`afterEach` で確実に解放します。

```ts
// Good: tmpDir は afterEach で必ず削除される
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "my-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { force: true, recursive: true });
});

// Bad: テスト本体の最後で削除しているため、assertion が落ちると残骸が残る
it("does something with a tmp dir", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "my-test-"));
  // ... assertion が途中で落ちると次の行に到達しない
  await rm(tmpDir, { force: true, recursive: true });
});
```

## アサーションは「何を検証したいか」で粒度を選ぶ

- 完全な等価検証: `toEqual`（ディープ）/ `toBe`（参照・プリミティブ）
- 部分一致: `toContain`（配列・文字列）/ `toMatchObject`（オブジェクト部分一致）
- モック呼び出し: `toHaveBeenCalledWith` / `toHaveBeenCalledOnce`
- 例外: `toThrow` / 非同期は `await expect(promise).rejects.toThrow(...)`

意図と粒度がズレた matcher を使うと、
- 過剰に厳しい assertion で関係ない変更で壊れる
- 過剰に緩い assertion で本来検出したいリグレッションが通ってしまう

```ts
// Good: 「runner 名がヘッダに入っていること」だけを検証 → toContain
expect(formatResult(makeResult({ runner: "vitest" }))).toContain("vitest");

// Good: 「diff ファイルが正確にこの 1 件であること」を検証 → toEqual
expect(files).toEqual([
  { addedLines: [1, 2, 3], additions: 3, deletions: 0, path: "src/foo.ts" },
]);

// Bad: 「含まれていれば OK」程度の検証なのに完全一致を要求している
expect(formatResult(makeResult({ runner: "vitest" }))).toBe(
  "Header: vitest\n...完全な出力文字列...",
);
```

## 非同期テストは `async` / `await` で書く

`typescript.md` のルールに整合させ、テストでも Promise チェーンや `done` コールバックは使いません。
失敗パスは `await expect(...).rejects.toThrow(...)` で検証します。

```ts
// Good: async/await で素直に書く
it("rejects when ref is missing", async () => {
  await expect(resolveRef("/repo", "missing")).rejects.toThrow(/not found/);
});

// Bad: .then().catch() で失敗時の done を忘れる典型パターン
it("rejects when ref is missing", () => {
  return resolveRef("/repo", "missing").then(() => {
    throw new Error("should have thrown");
  }, (err) => {
    expect(err.message).toMatch(/not found/);
  });
});
```
