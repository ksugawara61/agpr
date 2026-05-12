---
applyTo: '.github/workflows/**/*.{yml,yaml}'
paths:
  - '.github/workflows/**/*.{yml,yaml}'
---

# GitHub Actions ワークフローのコーディングガイドライン

GitHub Actions のワークフローを作成・変更・レビューするときは、以下のルールに基づいて指摘してください。

## `pull_request` / `push` トリガーでは `concurrency` を指定する

`pull_request` や `push` は同じブランチで短時間に連続して発火しやすいため、
古い実行が残ると CI の待ち時間や Actions の消費が増えます。
同一ワークフロー・同一 ref の古い run を取り消せるように、原則としてトップレベルに
`concurrency` を指定してください。

```yaml
# Good: 同じ ref の古い run を自動で取り消せる
on:
  pull_request:
  push:
    branches:
      - main

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

```yaml
# Bad: 同じブランチへの連続 push で古い CI が走り続ける
on:
  pull_request:
  push:
    branches:
      - main
```

ただし、デプロイやリリースのように古い run を取り消すと危険なワークフローでは、
対象環境ごとに `group` を分ける、または `cancel-in-progress: false` にするなど、
ワークフローの責務に合わせて明示的に制御してください。

## 外部 action は SHA pin で固定する

タグやブランチ参照は後から指すコミットが変わる可能性があるため、
外部 action は full length の commit SHA で固定してください。
レビュー時にバージョン意図を追えるよう、必要に応じてタグ名をコメントで残します。

```yaml
# Good: 実行される action の内容が固定され、タグ意図も追える
steps:
  - name: Checkout
    uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5
```

```yaml
# Bad: タグやブランチの移動で実行内容が変わり得る
steps:
  - uses: actions/checkout@v5
  - uses: actions/setup-node@main
```

ローカル action（例: `uses: ./.github/actions/setup`）はリポジトリ内の差分としてレビューできるため、
SHA pin の対象外です。
