---
name: agpr-fix
description: GitHub PR のレビューコメントを agpr CLI で取得し、指摘ごとにコード修正・コミット・push・スレッド返信までを一括で実行する skill。args に `plan` が渡された場合は修正着手前に必ず plan mode (ExitPlanMode) で対応方針をユーザーに承認してもらってから実行する。「PR のレビュー対応して」「レビューコメント直して」「agpr-fix で対応して」「指摘を修正して返信して」など PR レビュー対応のリクエストで積極的に使うこと。plan モード対応とコミット→push→返信の1ループが特徴。
---

# agpr-fix

## 概要

agpr CLI を使って GitHub PR のアクティブなレビューコメントを取得し、指摘に沿ってコードを修正してコミット・push し、各スレッドへ日本語で返信するまでを一括で行う。

**前提条件:**
- `gh auth login` 済みであること
- カレントブランチが対象 PR の head ブランチであること
- `git push` 権限があること

## args の解釈

- `plan`: plan mode フラグ。修正着手前に対応方針をまとめ ExitPlanMode でユーザー承認を取る。
- それ以外の引数は「`plan` のみ受け付けています」と伝えて無視する。

## 手順

### Step 1: PR コメント取得

`--repo` の値を取得する:
```bash
gh repo view --json nameWithOwner -q .nameWithOwner
```

現在のブランチを取得する:
```bash
git rev-parse --abbrev-ref HEAD
```

レビューコメントを取得する (解決済み・outdated は必ず除外):
```bash
CI=true npx @ksugawara61/agpr@latest review \
  --branch <current-branch> \
  --repo <owner/repo> \
  --exclude-resolved \
  --exclude-outdated \
  --format json
```

取得した JSON から各スレッドの `threadId` / コメント内容 / 対象ファイル・行を整理して表示する。コメントがゼロ件なら「未解決のレビューコメントはありません」と報告して終了する。

### Step 2 (plan モードのみ): 対応方針を整理して承認を取る

スレッドごとに「何をどう修正するか」を箇条書きでまとめる。承認前は Edit / Write / Bash の書き込み系ツールを絶対に実行しない。ExitPlanMode を呼んでユーザー承認後に Step 3 へ進む。

### Step 3: 修正 → コミット → push → 返信を 1 ループで実行

スレッド単位、または論理的にまとまる単位でコードを修正し、以下をループする:

1. コードを修正する
2. `git add <files>` → `git commit -m "<summary>"` でコミットする
   - コミットメッセージはリポジトリのコミット規約に従う
3. `git push` で push する
   - push 失敗時はコミットを残したままここで停止し、ユーザーに確認を仰ぐ。返信は送らない。
4. `git rev-parse HEAD` でコミット hash を取得し、対象 threadId と紐付けて返信ペイロードに積む

### Step 4: 一括返信

全スレッドの処理が終わったら 1 回で送信する:
```bash
CI=true npx @ksugawara61/agpr@latest review-reply \
  --input '{"replies":[{"threadId":"PRRT_xxx","commitHashs":["<hash>"],"message":"<日本語サマリ>"},...]}' \
  --format markdown
```

- `commitHashs` は必ず 1 件以上設定する。空で送らない。
- `message` は「何をどう修正したか」を日本語で簡潔に記述する。コミット hash や URL を添えると丁寧。

## やってはいけないこと

- main/master への直 push や force push
- `--no-verify` でフックをスキップ
- 解決済みスレッドへの再返信
- `commitHashs` が空のままの返信
- push 前に返信を送る
