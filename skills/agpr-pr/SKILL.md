---
name: agpr-pr
description: agpr CLI で GitHub draft PR を作成する skill。現在のブランチと差分から title / background / changes を自動抽出し、skill 同梱の PR テンプレを使って create-draft-pr を 1 回実行する。args に `copilot` を渡すと PR 作成直後に GitHub Copilot のレビューも依頼する。args に `auto` を渡すと main ブランチからの自動 checkout と PR 作成前の確認をスキップして完全自動で実行する。args に `base=<branch>` を渡すと PR の base branch を指定できる。「draft PR 作って」「プルリク立てて」「PR 起票して」「PR ドラフトして」「agpr-pr で PR 作って」「PR 出して」など PR 作成のリクエストで積極的に使うこと。ユーザー承認→1 コマンド実行→URL 返却の流れが特徴。
---

# agpr-pr

## 概要

agpr CLI を使って現在のブランチの差分から GitHub に draft PR を作成する。git log と diff から title / background / changes を自動抽出してユーザーが確認したうえで `create-draft-pr` を 1 回実行し、発行された PR URL を返す。args に `copilot` を指定すると PR 作成直後に GitHub Copilot のレビューも依頼する。args に `auto` を指定すると main ブランチからの自動 checkout と PR 作成前の確認をスキップして完全自動で実行する。args に `base=<branch>` を指定すると `main` 以外の base branch へ draft PR を作成できる。

**前提条件:**
- `gh auth login` 済みであること
- カレントブランチが feature ブランチ (`main` / `master` / base branch 以外) であること
- `git push` 権限があること

## args の解釈

- `copilot`: PR 作成後に GitHub Copilot のレビューを依頼する (`--copilot` を付与)
- `auto`: main ブランチからの自動 checkout と Step 3 の PR 作成前確認をスキップして完全自動で実行する
- `base=<branch>` / `base:<branch>` / `--base=<branch>` / `--base <branch>`: PR の base branch を指定する
- base branch の既定値は `main`
- base branch が複数指定された場合は、最後に指定された値を使う
- base branch の値が空の場合は「base branch が空です」と伝えて中止する
- それ以外の引数は「`copilot` / `auto` / `base=<branch>` のみ受け付けています」と伝えて無視する

## 手順

### Step 1: リポジトリとブランチを確認

`--repo` の値を取得する:
```bash
gh repo view --json nameWithOwner -q .nameWithOwner
```

現在のブランチを取得する:
```bash
git rev-parse --abbrev-ref HEAD
```

args から base branch を決める。指定がなければ `main` を使う。

head ブランチが `main` / `master` / base branch の場合:
- `auto` が指定されている場合: 未コミットの変更内容からブランチ名を推測して自動で `git checkout -b <branch-name>` を実行する。ユーザーへの確認は不要。
- `auto` が指定されていない場合: 「feature ブランチから実行してください」と伝えて中止する。

未コミットの変更を確認する:
```bash
git status --porcelain
```

変更がある場合はファイル一覧をユーザーに提示し、コミット対象とするファイルを確認してから個別に add してコミットする:
```bash
git add <file1> <file2> ...
git commit -m "<summary>"
```

コミットが完了したら push する:
```bash
git push
```

push 失敗時はエラーをユーザーに見せて中止する。返信は送らない。

### Step 2: PR 内容の素案を組み立てる

base branch は args で指定された値を使う。指定がなければ `main` を使う。

コミット履歴と差分サマリを読む:
```bash
git log <base-branch>..HEAD --pretty=format:'%s'
git diff <base-branch>...HEAD --stat
```

読み取った情報から以下を組み立てる:
- `title`: 変更の要点を端的に (50 字以内目安)
- `background`: なぜこの変更が必要か (背景・目的)
- `changes`: string[] — 変更点の箇条書き項目を列挙する (各要素に `- ` プレフィクス不要。CLI 側で付与される)
- `issueId`: ブランチ名やコミットメッセージから Issue 番号・チケット ID を読み取れれば設定、なければ `N/A`

### Step 3: ユーザーへ確認

`auto` が指定されている場合はこの Step をスキップして Step 4 へ進む。

以下を提示し、ok を得てから Step 4 へ進む:
- 入力 JSON の中身 (`title` / `background` / `issueId` / `changes` / `headBranch` / `baseBranch`)
- `baseBranch`: args で指定された base branch、または既定値の `main`
- テンプレートパス: `skills/agpr-pr/references/pull_request_template.md`
- `--copilot` の有無
- 作成先リポジトリ

修正依頼があればフィールドを直して再確認する。

### Step 4: draft PR を 1 回作成する

```bash
CI=true npx @ksugawara61/agpr@latest create-draft-pr \
  --input '{"title":"<title>","background":"<background>","issueId":"<issueId>","changes":["<item1>","<item2>"],"headBranch":"<head>","baseBranch":"<base-branch>"}' \
  --repo <owner>/<repo> \
  --template skills/agpr-pr/references/pull_request_template.md \
  [--copilot]
```

コマンドが失敗した場合はエラー内容をそのままユーザーに見せて停止する。リトライ前にユーザーの指示を仰ぐ。

### Step 5: 結果を報告

stdout の JSON (`{pullRequestNumber, pullRequestUrl}`) を受け取り、PR 番号と URL をユーザーに伝える。`copilot` を指定した場合は Copilot レビューが依頼済みである旨も添える。

## やってはいけないこと

- `main` / `master` / base branch を head ブランチとして PR を作成する
- push 失敗のまま PR 作成に進む
- args に `copilot` が無いのに `--copilot` を勝手に付与する
- `auto` 指定なしでユーザー承認前に `create-draft-pr` を実行する
- `changes` を空配列 (`[]`) のまま送る
- `--template` を省略する (常に同梱テンプレを渡す)
