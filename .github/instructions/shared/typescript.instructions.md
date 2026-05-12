---
applyTo: '**/*.{ts,tsx}'
paths:
  - '**/*.{ts,tsx}'
---

# JavaScript / TypeScript 構文のコーディングガイドライン

コードレビュー時は以下のルールに基づいて指摘してください

## 配列生成は `map` / `reduce` / `filter` を優先する

`for` ループと `push` を組み合わせて配列を生成すると、中間状態の `let` 変数が増え、
途中で break / continue / 条件分岐が混ざりやすくなり、意図（「何を作っているか」）と
実装（「どう作るか」）が分離されません。
配列の生成には可能な限り `map` / `filter` / `reduce` などの高階関数を使い、
入力と出力の対応関係だけでロジックを読める形にしてください。

### 1 対 1 変換は `map`

```ts
// Good: 入力 → 出力の対応が 1 行で読める
const titles = bookmarks.map((bookmark) => bookmark.title);

// Bad: for + push で中間状態を作っている
const titles: string[] = [];
for (const bookmark of bookmarks) {
  titles.push(bookmark.title);
}
```

### 条件による絞り込みは `filter`、`map` と組み合わせる

```ts
// Good: filter → map のチェーンで「絞ってから変換」を宣言的に書く
const publishedTitles = bookmarks.filter((bookmark) => bookmark.publishedAt != null).map((bookmark) => bookmark.title);

// Bad: if + push で絞り込みと変換が手続き的に混ざっている
const publishedTitles: string[] = [];
for (const bookmark of bookmarks) {
  if (bookmark.publishedAt != null) {
    publishedTitles.push(bookmark.title);
  }
}
```

### 集約・畳み込みは `reduce`

単純な合計や、配列から別の形（オブジェクト・Map など）を組み立てる処理は
`reduce` を使ってください。累積値が明示されるため、初期値や中間の型が読み取りやすくなります。

```ts
// Good: 合計値の累積が 1 式で読める
const totalCount = bookmarks.reduce((sum, bookmark) => sum + bookmark.count, 0);

// Good: id をキーにしたマップを reduce で組み立てる
const bookmarksById = bookmarks.reduce<Record<string, Bookmark>>((acc, bookmark) => {
  acc[bookmark.id] = bookmark;
  return acc;
}, {});

// Bad: for + 再代入 / for + push で中間変数を積み上げている
let totalCount = 0;
for (const bookmark of bookmarks) {
  totalCount += bookmark.count;
}

const bookmarksById: Record<string, Bookmark> = {};
for (const bookmark of bookmarks) {
  bookmarksById[bookmark.id] = bookmark;
}
```

### 例外: `for` を許容するケース

以下のように「配列の生成」ではないケースでは、無理に `reduce` などに寄せず `for...of` を使ってください。

- 途中で `break` / `return` して早期終了したい（`find` / `some` / `every` で表現できないもの）
- 各要素に対して副作用のみを行い、配列を作らない（ログ出力・DOM 操作など）
- `await` を逐次実行する必要がある（`Promise.all` では並列になってしまうケース）

```ts
// Good: 逐次の副作用は for...of
for (const bookmark of bookmarks) {
  await syncBookmark(bookmark);
}

// Bad: 副作用の実行に forEach / map を使っている（戻り値を捨てている）
bookmarks.forEach((bookmark) => {
  syncBookmark(bookmark);
});
```

## 非同期処理は `async` / `await` + `try` / `catch` を優先する

Promise のメソッドチェーン（`.then()` / `.catch()` / `.finally()`）や、
コールバック関数（`(err, result) => {}`）を使った非同期記述は、
スコープが入れ子になりやすく、変数の型も Promise に包まれてしまうため、
エラー発生箇所と責務の対応が追いにくくなります。
`async` / `await` と `try` / `catch` を基本形にし、エラーは発生点と同じ階層で処理してください。

### メソッドチェーンではなく `await` を使う

```ts
// Good: 値はそのまま変数に入り、次の処理が直線的に読める
const fetchBookmark = async (id: string): Promise<Bookmark> => {
  const response = await fetch(`/api/bookmarks/${id}`);
  const bookmark = await response.json();
  return bookmark;
};

// Bad: then のネストで中間値の型が Promise に埋もれている
const fetchBookmark = (id: string): Promise<Bookmark> =>
  fetch(`/api/bookmarks/${id}`).then((response) => response.json().then((bookmark) => bookmark));
```

### エラーハンドリングは `try` / `catch` に寄せる

コールバックでエラーを処理すると、成功時と失敗時のロジックが分散し、
エラーの発生箇所と処理の対応が追いにくくなります。
エラーを捕捉したい範囲を `try` ブロックで明示し、同じ階層で処理してください。

```tsx
// Good: try/catch で mutation のエラーを捕捉し、成功・失敗の処理を同じ階層で記述
const useBookmarkSave = () => {
  const [saveBookmarkMutation] = useSaveBookmarkMutation();

  const handleSaveBookmark = async (input: BookmarkInput) => {
    try {
      const result = await saveBookmarkMutation({ variables: { input } });
      toast.success('ブックマークを保存しました');
      return result.data?.saveBookmark;
    } catch (error) {
      console.error('failed to save bookmark', { error, input });
      toast.error('保存に失敗しました');
      throw error;
    }
  };

  return { handleSaveBookmark };
};

// Bad: onCompleted/onError でエラー処理が分散し、呼び出し元で結果を制御できない
const useBookmarkSave = () => {
  const [saveBookmarkMutation] = useSaveBookmarkMutation({
    onCompleted: (data) => {
      toast.success('ブックマークを保存しました');
    },
    onError: (error) => {
      console.error('failed to save bookmark', { error });
      toast.error('保存に失敗しました');
    },
  });

  const handleSaveBookmark = (input: BookmarkInput) => {
    saveBookmarkMutation({ variables: { input } });
    // 戻り値が void のため、呼び出し元で結果を使えない
  };

  return { handleSaveBookmark };
};
```

### mutation は `await` で扱い、コールバックを避ける

mutation の結果を `onCompleted` / `onError` コールバックで処理すると、
成功時と失敗時のロジックが mutation の options に散り、呼び出し元での制御が難しくなります。
mutation 関数を `await` で呼び出し、結果は戻り値で受け取り、エラーは `try` / `catch` で捕捉してください。

```tsx
// Good: mutation を await で呼び出し、結果とエラーを呼び出し元で制御
const BookmarkForm: React.FC = () => {
  const [saveBookmarkMutation] = useSaveBookmarkMutation();

  const handleSubmit = async (input: BookmarkInput) => {
    try {
      const result = await saveBookmarkMutation({ variables: { input } });
      toast.success('ブックマークを保存しました');
      router.push(`/bookmarks/${result.data?.saveBookmark.id}`);
    } catch (error) {
      console.error('failed to save bookmark', { error, input });
      toast.error('保存に失敗しました');
    }
  };

  return <form onSubmit={handleSubmit}>...</form>;
};

// Bad: onCompleted/onError で処理を分散させている
const BookmarkForm: React.FC = () => {
  const router = useRouter();
  const [saveBookmarkMutation] = useSaveBookmarkMutation({
    onCompleted: (data) => {
      toast.success('ブックマークを保存しました');
      router.push(`/bookmarks/${data.saveBookmark.id}`);
    },
    onError: (error) => {
      console.error('failed to save bookmark', { error });
      toast.error('保存に失敗しました');
    },
  });

  const handleSubmit = (input: BookmarkInput) => {
    saveBookmarkMutation({ variables: { input } });
  };

  return <form onSubmit={handleSubmit}>...</form>;
};
```

### 並列実行は `Promise.all` + `await` を使う

独立した非同期処理を並列に走らせたい場合も、`.then()` チェーンではなく
`Promise.all` の結果を `await` で受けて分解代入してください。

```ts
// Good: 並列実行の結果を await で受け、以降は同期的に読める
const loadDashboard = async (userId: string) => {
  try {
    const [bookmarks, scraps] = await Promise.all([fetchBookmarks(userId), fetchScraps(userId)]);
    return { bookmarks, scraps };
  } catch (error) {
    console.error('failed to load dashboard', { error, userId });
    throw error;
  }
};

// Bad: then チェーンで結果を組み立てている
const loadDashboard = (userId: string) =>
  Promise.all([fetchBookmarks(userId), fetchScraps(userId)]).then(([bookmarks, scraps]) => ({ bookmarks, scraps }));
```

### 省略可能な引数は rest や props でまとめる

コンポーネントで使わない props を下位コンポーネントに渡す場合、個別に展開せず rest パターンでまとめてください。
必要な props だけを分割代入で取り出し、残りは `...rest` で受け取って渡します。

**基本パターン: rest を使った受け渡し**

```tsx
// Good: 必須な props だけを展開し、残りは rest でまとめる
const SomeComponent: React.FC<{
  top: string;
  left: string;
  careReceiverName: string;
  timeRange: string;
  onClick: () => void;
}> = ({ careReceiverName, timeRange, ...rest }) => {
  return (
    <Box {...rest} aria-label={`${careReceiverName} ${timeRange}`}>
      ...
    </Box>
  );
};

// Bad: 使わない props も個別に展開している
const SomeComponent: React.FC<{
  top: string;
  left: string;
  width: string;
  height: string;
  careReceiverName: string;
  timeRange: string;
  onClick: () => void;
}> = ({ top, left, width, height, careReceiverName, timeRange, onClick }) => {
  return (
    <Box top={top} left={left} w={width} h={height} aria-label={`${careReceiverName} ${timeRange}`} onClick={onClick}>
      ...
    </Box>
  );
};
```

**カスタムフックと組み合わせる場合**

ロジックをカスタムフックに分離する際は、props をそのまま渡して hook 内で必要な値だけ取り出します。

```tsx
// Good: props をそのまま hook に渡し、コンポーネントは描画に専念
const SomeComponent: React.FC<{
  top: string;
  left: string;
  width: string;
  height: string;
  onClick: () => void;
}> = (props) => {
  const { careReceiverName, timeRange } = useSomeComponent(props);
  return (
    ...
  );
};

// Bad: props を展開してから hook に渡し直している
const SomeComponent: React.FC<{
  top: string;
  left: string;
  width: string;
  height: string;
  onClick: () => void;
}> = ({ top, left, width, height, onClick }) => {
  const { careReceiverName, timeRange } = useSomeComponent({ top, left, width, height, onClick });
  return (
    ...
  );
};
```
