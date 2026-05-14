---
name: agpr-issue
description: GitHub Issue 番号を起点に、Issue 内容確認、ブランチ準備、実装、検証、コミット、push、agpr CLI による PR 作成までを一括で進める skill。既定では draft PR を作成し、args に `open` を渡すと draft ではない PR を作成する。`$agpr-issue 20 plan copilot`、`agpr-issue 20 auto`、「Issue 20 を対応して PR 作って」など、Issue 対応から PR 作成まで依頼されたときに使う。args で issue number、`plan` または `auto`、Copilot review 依頼有無、draft/open を指定できる。
---

# agpr-issue

## 概要

GitHub Issue を読んで必要な実装を行い、検証・コミット・push 後に agpr CLI で PR を作成する。既定では draft PR を作成し、args に `open` を指定すると draft ではない PR を作成する。PR 作成時の入力 JSON は Issue 内容、コミット履歴、差分から組み立てる。

**前提条件:**
- `gh auth login` 済みであること
- `git push` 権限があること
- 対象リポジトリ内で実行していること
- agpr CLI を `npx @ksugawara61/agpr@latest` で実行できること

## args の解釈

受け付ける args:
- `<issue-number>`: 必須。GitHub Issue 番号。`#20` のような形式も `20` として扱う
- `plan`: Issue とコードを調査した後、実装修正前に対応方針の承認を取る
- `auto`: 確認を省略して Issue 対応から PR 作成まで進める
- `copilot`: PR 作成時に GitHub Copilot review を依頼する (`--copilot` を付与)
- `no-copilot`: Copilot review を依頼しない
- `open`: draft ではない PR を作成する (`--open` を付与)
- `draft`: draft PR を作成する

既定値:
- issue number が無い場合は、Issue 番号をユーザーに確認して中止する
- mode が無い場合は `plan` として扱う
- Copilot 設定が無い場合は依頼しない
- PR は既定で draft として作成する
- `plan` と `auto` が両方ある場合、最後に指定された方を採用する
- `open` と `draft` が両方ある場合、最後に指定された方を採用する
- 不明な args は「issue number / plan / auto / copilot / no-copilot / open / draft のみ受け付けています」と伝えて無視する

## Step 1: リポジトリと Issue を確認

`--repo` の値を取得する:

```bash
gh repo view --json nameWithOwner -q .nameWithOwner
```

既定の base branch を取得する。取得できない場合は `main` を使う:

```bash
gh repo view --json defaultBranchRef -q .defaultBranchRef.name
```

Issue を取得する:

```bash
gh issue view <issue-number> --json title,body,labels,state,url,comments
```

確認すること:
- Issue が存在すること
- Issue が `OPEN` であること。`CLOSED` の場合、明示指示が無ければ中止する
- Issue body と comments に追加要件や制約がないか
- 関連するラベル、エラー文、再現手順、受け入れ条件

取得した Issue の title / URL / 要約を作業ログとして短く表示する。

## Step 2: 作業ブランチを準備

作業前に状態を確認する:

```bash
git status --short --branch
git rev-parse --abbrev-ref HEAD
```

ルール:
- dirty worktree にユーザー由来の変更がある場合は、それを壊さない。`auto` でも勝手に revert / stash しない
- 現在のブランチが `main` / `master` / base branch の場合は、Issue title から slug を作り `codex/issue<issue-number>-<slug>` で branch を作る
- 既に feature branch にいる場合は、現在の branch を head branch として使ってよい。ただし unrelated な未コミット変更があれば中止して確認する
- base branch は原則 repo default branch。既存運用が明確に `main` 固定なら `main` を使ってよい

branch 作成例:

```bash
git switch -c codex/issue20-catalog-package-versions
```

## Step 3: リポジトリ指示と実装対象を調査

実装前に必ず読む:
- `AGENTS.md`、親ディレクトリの `AGENTS.md` があれば該当スコープ分
- `.github/instructions/**/*.md` があれば、対象ファイルに該当するもの
- package manager、test、lint、build の既存コマンド

コード探索は `rg` / `rg --files` を優先する。Issue から関連ファイル、既存テスト、既存パターンを特定する。

## Step 4: plan mode の承認

mode が `plan` の場合、実装修正前に以下を提示して承認を取る:
- Issue の要約
- 変更予定のファイルまたは領域
- 実装方針
- 追加・更新するテスト
- 実行予定の検証コマンド
- PR 作成設定: head branch、base branch、draft/open、Copilot review の有無

Plan mode / ExitPlanMode ツールが利用できる環境ではそれを使う。利用できない場合は、通常の返信で承認を求め、承認があるまで書き込み系ツールを実行しない。

mode が `auto` の場合、この承認 step を省略して実装へ進む。

## Step 5: 実装と検証

Issue に沿って必要最小限の差分を作る。既存の設計、命名、テストスタイル、format に合わせる。

原則:
- 関係ない refactor や生成物変更を混ぜない
- 変更の影響範囲に応じてテストを追加・更新する
- ユーザー由来の未コミット変更を revert しない
- frontend を変更した場合は、必要に応じてブラウザ確認や screenshot を行う

検証:
- `AGENTS.md` や README に指定されたコマンドを優先する
- 指定がなければ変更範囲に応じて test / typecheck / lint / build を実行する
- pnpm project では原則 `pnpm` を使う
- 失敗した場合は原因を修正して再実行する。環境要因で実行不能な場合は final / PR body に明記する

## Step 6: コミットと push

差分を確認する:

```bash
git diff --check
git status --short
git diff --stat
```

必要なファイルだけを stage してコミットする:

```bash
git add <files>
git commit -m "<summary>" [-m "<body>"]
```

コミットメッセージはリポジトリの規約と現在の開発者指示に従う。トレーラー指示がある場合は必ず守る。

push する:

```bash
git push -u origin <head-branch>
```

push 失敗時は PR 作成に進まず、エラー内容をユーザーに伝えて停止する。

## Step 7: PR の内容を組み立てる

差分とコミットから PR 入力を作る:

```bash
git log <base-branch>..HEAD --pretty=format:'%s'
git diff <base-branch>...HEAD --stat
```

PR 入力:
- `title`: Issue 対応の要点を 50 字以内目安で端的に書く
- `background`: Issue の背景と、この変更が必要な理由を書く
- `issueId`: `#<issue-number>`
- `changes`: 空配列にしない。実際の変更点を string[] で列挙する
- `headBranch`: 現在の branch
- `baseBranch`: Step 1/2 で決めた base branch

template path は次の順で使う:
1. `skills/agpr-pr/references/pull_request_template.md`
2. `${CODEX_HOME:-$HOME/.codex}/skills/agpr-pr/references/pull_request_template.md`

どちらも存在しない場合は、テンプレートが無いことを伝えて中止する。

## Step 8: PR を作成

mode が `plan` の場合でも、Step 4 で PR 作成まで承認済みなら追加確認なしで進めてよい。PR 入力に不確実な点がある場合のみ確認する。mode が `auto` の場合は確認なしで進む。

agpr CLI を 1 回実行する:

```bash
CI=true npx @ksugawara61/agpr@latest create-draft-pr \
  --input '{"title":"<title>","background":"<background>","issueId":"#<issue-number>","changes":["<item1>","<item2>"],"headBranch":"<head>","baseBranch":"<base>"}' \
  --repo <owner>/<repo> \
  --template <template-path> \
  [--open] \
  [--copilot]
```

`open` が指定されている場合だけ `--open` を付ける。`draft` または未指定の場合は付けない。
`copilot` が指定されている場合だけ `--copilot` を付ける。`no-copilot` または未指定の場合は付けない。

コマンドが失敗した場合は、同じ入力で勝手にリトライせず、エラーを示してユーザーの指示を待つ。

## Step 9: 結果を報告

stdout の JSON (`{pullRequestNumber, pullRequestUrl}`) を読み取り、以下を簡潔に報告する:
- 対応 Issue
- 作成した PR 番号と URL
- 主な変更点
- 実行した検証
- draft/open のどちらで作成したか
- Copilot review を依頼したか

## やってはいけないこと

- Issue 番号なしで推測実行する
- `main` / `master` / base branch に直 commit / push する
- dirty worktree のユーザー変更を勝手に revert / stash する
- `plan` mode で承認前に書き込み系ツールを実行する
- push 失敗後に PR 作成へ進む
- `changes` が空の PR 入力を送る
- `open` 指定なしで `--open` を付ける
- `copilot` 指定なしで `--copilot` を付ける
- template path を省略して `create-draft-pr` を実行する
