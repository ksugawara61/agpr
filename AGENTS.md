# AGENTS.md

## スコープ

このファイルの指示はリポジトリ全体に適用します。

## プロジェクト概要

`agpr` は GitHub Pull Request のレビュー作業を支援する Node.js / TypeScript 製 CLI です。

## コーディング前に参照するルール

- コードを書く、変更する、レビューするときは、作業対象に応じて `.github/instructions` ディレクトリ配下の Markdown ファイルを必ず参照してください。
- 各ルールファイルの front matter にある `applyTo` / `paths` を対象ファイルの glob として扱い、該当するルールを優先してください。
- TypeScript / TSX ファイルを扱う場合は `.github/instructions/shared/typescript.md` を参照してください。
- テストファイル（`*.test.ts` / `*.test.tsx`）を扱う場合は `.github/instructions/shared/test.md` も参照してください。
- `.github/instructions` 配下に新しいルールが追加されている場合は、その内容も同じ優先度で確認してください。

## 開発コマンド

- 依存関係の管理には `pnpm` を使います。
- 型チェック: `pnpm typecheck`
- テスト: `pnpm test`
- カバレッジ: `pnpm coverage`
- Lint: `pnpm lint`
- フォーマット: `pnpm fmt`
- 未使用コード検出: `pnpm knip`
- ビルド: `pnpm build`

## 実装方針

- 既存の TypeScript / Vitest / Biome の構成に合わせて実装してください。
- 変更の影響範囲に応じてテストを追加または更新してください。
- 生成物や無関係なファイルの変更は避け、必要な差分だけに留めてください。
