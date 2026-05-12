---
description: GitHub PR のレビューコメントを agpr で取得し、コメントに沿ってコードを修正、各スレッドへ返信するまでを自動化する。args に `plan` を渡すと、修正は行わず plan mode で修正計画だけを立てて承認を取る。
name: agpr-fix-review
---
# agpr-fix-review

PR の未解決レビューコメントを `agpr review` で取得し、指摘に沿ってコードを修正してコミット・push し、`agpr review-reply` で各スレッドへ返信するまでを一連で行う。

## Prerequisites

- カレントブランチに対応する Open PR が GitHub 上に存在すること
- `gh` CLI が認証済みであること（`gh auth status` で確認）
- `dist/cli.js` がビルド済みであること（`node dist/cli.js --version` が通らなければ先に `pnpm build` を実行）

## Arguments

| 引数 | 挙動 |
|------|------|
| なし | 通常フロー：取得 → 修正 → コミット → push → reply |
| `plan` | plan モード：取得 → 修正計画をプランファイルへ書き出し → `ExitPlanMode` で承認を求める。コード編集・コミット・push・reply は一切行わない |

---

## 通常フロー

### Step 1 — 準備

以下を実行して環境を確認する。

```bash
node dist/cli.js --version   # ビルド済みか確認
git branch --show-current    # カレントブランチ取得
gh repo view --json owner,name -q '.owner.login + "/" + .name'  # owner/repo 取得
git status --porcelain       # 作業ツリーがクリーンか確認
```

`dist/cli.js` が見つからなければ `pnpm build` を実行してから再試行する。
作業ツリーが汚れている場合は中断してユーザーに報告する。

### Step 2 — レビューコメント取得

```bash
node dist/cli.js review \
  --branch "<current-branch>" \
  --repo "<owner/repo>" \
  --exclude-resolved \
  --exclude-outdated \
  --format json
```

出力 JSON の `filePaths[].reviews[]` をフラット化し、以下の形のリストを作る。

```
{ filePath, threadId, startLine, endLine, comments: string[] }
```

リストが空なら「修正対象のレビューコメントが見つかりませんでした」と報告して終了する。

### Step 3 — スレッド単位の修正ループ

各スレッドについて順番に処理する。

1. 対象ファイルの `startLine`〜`endLine` 周辺を **前後 20 行程度** Read して文脈を把握する
2. `comments` をすべて読み、指摘の意図を理解する
3. Edit / Write で修正を入れる（指摘範囲外の自発的なリファクタは禁止）
4. 以下を実行してすべて緑になることを確認する
   - `pnpm typecheck`
   - `pnpm test <変更ファイルのパス>` または全体が短ければ `pnpm test`
   - `pnpm fmt`
5. **スレッドごとに 1 コミット** を作成する

   ```bash
   git add <変更したファイル>
   git commit -m "fix(review): <指摘要約> (thread <threadId>)"
   ```

   コミットメッセージはレビュー指摘の主旨を 50 文字以内で要約する。
6. `git rev-parse HEAD` でコミットハッシュを取得し、以下の形で結果配列に蓄積する

   ```
   { threadId, message: "<要約>", commitHashs: ["<hash>"] }
   ```

### Step 4 — push

全スレッドの処理が終わったら push する。
reply はリモートへの反映後に行うため、push を先に実行する。

```bash
git push
```

### Step 5 — reply 投稿

蓄積した結果配列を `{ "replies": [...] }` の JSON にまとめて渡す。
Heredoc でクォートのエスケープを回避する。

```bash
node dist/cli.js review-reply \
  --input "$(cat <<'__JSON__'
{"replies":[{"threadId":"<id>","commitHashs":["<hash>"],"message":"<要約>"}]}
__JSON__
)" \
  --format markdown
```

`success: false` になったスレッドだけを別途報告し、残りは続行する。
reply 本文は日本語で書く（`🤖 create by agpr` フッタは CLI が自動付与するため skill 側では付与しない）。

### Step 6 — サマリ報告

処理完了後に以下を報告する。

1. 処理したスレッドの一覧（threadId / ファイル / コミットハッシュ / reply ステータス）
2. reply が失敗したスレッドの詳細（あれば）
3. ユーザーが手動で確認すべき項目（PR URL など）

---

## plan モード（args に `plan` を渡した場合）

通常フローの **Step 1〜2 のみ実行**してレビューコメントを取得し、その後 plan mode へ入る。

```
EnterPlanMode を呼び出し、プランファイル（~/.claude/plans/<worktree-name>.md）に以下を書く：
```

### プランファイルの構成

```markdown
## Context
- PR: <URL>
- ブランチ: <branch>
- 未解決スレッド数: <N>

## スレッド別修正方針

### Thread <threadId> — <ファイルパス> L<startLine>-<endLine>
**指摘要約:** …
**修正方針:** …
**編集予定ファイル:** `<path>` (L<start>-<end>)
**検証コマンド:** `pnpm typecheck` / `pnpm test <path>` / `pnpm fmt`
**reply ドラフト:** 「対応しました。…」

（スレッド数だけ繰り返す）

## Constraints
- 各スレッドは独立したコミットにする
- 指摘範囲外は変更しない
```

プランファイルを書き終えたら `ExitPlanMode` を呼んで承認を取る。
plan モードでは **Edit / Write / コミット / push / reply は一切実行しない**。

---

## Constraints

- 修正できるのは **PR で指摘された範囲のみ**。それ以外の自発的なリファクタや整理は禁止
- 既存テストの書き換えは、レビューが明示的にテスト修正を求めている場合のみ許可
- `--no-verify` による pre-commit フックのスキップ禁止
- `dist/` 配下の手動編集禁止（常にビルドを通して生成する）
- 1 スレッド = 1 コミット（複数スレッドの変更を 1 コミットにまとめない）
- `--exclude-resolved` `--exclude-outdated` は常に付ける
