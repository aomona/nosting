# nost.ing

Material 3 Expressive の Nostr Web クライアント。

**[使ってみる](https://nost.ing)**

## 機能

- タイムライン、プロフィール、フォロー、返信スレッド、引用、通知
- リレーごとの読み取り・書き込み設定、再接続、検索対応リレーでの検索
- 画像・動画の表示、カスタム絵文字、Markdown、センシティブメディア表示
- 画像アップロード（PNG / JPEG / WebP / GIF、1回30 MBまで）
- NIP-07署名拡張・NIP-46リモート署名（bunker）によるログイン、Zap、共有、ローカル下書き・ミュート
- ダークモードとモバイル対応

開発中のソフトウェアです。リレーの対応状況により検索や取得できる情報は異なります。秘密鍵をnost.ingへ入力する方式ではなく、署名拡張またはリモート署名アプリを使います。

## 開発

Node.js 22.13以上とnpmを用意してください。

```sh
npm ci
npm run dev
```

表示されたローカルURLを開きます。読むだけなら署名拡張は不要です。ログインや投稿にはNIP-07対応の拡張機能、またはNIP-46対応の署名アプリが必要です。ローカルでも通常のリレーにつながるため、実際の投稿・フォロー変更は公開ネットワークへ送信されます。テスト投稿を大量に送らないでください。

```sh
npm test
npm run typecheck
npm run build
npm start
```

テストは順番に実行します。ネットワーク動作を模擬するテストとソース検査を含み、全NIPへの完全適合や全ブラウザでの動作を保証するものではありません。

画像アップロードにはD1のテーブルが必要です。[自己ホスト手順](docs/self-hosting.md)に従ってローカルマイグレーションを適用してください。

## リモート署名

拡張機能のないブラウザでは「ログイン」で署名アプリの `bunker://` 接続URLを貼り付けます。拡張機能がある場合も、設定の「リモート署名で接続」から選べます。必要なら「署名サービスで承認する」を開いて承認し、元のタブへ戻ります。主秘密鍵の入力は不要です。

- 対応: [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md) の bunker 接続、NIP-44 v2、`get_public_key`、`sign_event`、認証チャレンジ、`switch_relays`。`nostrconnect://` の生成、NIP-04へのフォールバック、DM用の暗号化操作は未対応です。
- 接続情報と使い捨てクライアント鍵はメモリのみ。再読み込み後・ログアウト後は署名アプリから接続URLを再取得します。NIP-07のログイン記憶とは独立しています。
- リレーが切れた場合、次の操作で再接続します。操作ごとに60秒でタイムアウトし、失敗した署名は自動再送しません。ログイン時は最大3操作を順番に行います。未対応の `switch_relays` は元のリレーを使います。
- ログアウトはクライアント鍵・待機中の操作を破棄します。signerへの任意の `logout` 通知は送りません。署名アプリ側で残った権限を取り消すこともできます。

ブラウザ検証は `tests/browser/remote-login.mjs` にあります。別途PlaywrightとChromiumを用意し、`npm run dev` 後に `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/remote-login.mjs` を実行します。モバイル幅でローカルsignerとインメモリのリレーを使用し、外部HTTP・公開リレーを遮断します。画像は `/tmp/nosting-issue25` に保存し、コミットしません。

## 構成

- React / TypeScript / [Vinext](https://github.com/cloudflare/vinext)
- M3E / Tailwind CSS
- `nostr-tools`
- Cloudflare Workers / D1 / R2（画像アップロード）

主要UIは `components/petal-app.tsx`、プロトコル処理は `lib/`、画像APIは `app/api/` にあります。

## コントリビューション

Issue / Pull Requestを歓迎します。変更は小さく分け、関連テストを追加してください。UIはM3Eを基準にし、不要な説明や重複した文言を避けます。秘密情報・ユーザーデータ・生成済みビルド・`node_modules`はコミットしないでください。

この初期公開は稼働中のSites版v52を基にしたクリーンスナップショットです。Sites側の更新とは自動同期されません。開発にはAIによる支援を使用しています。

## ライセンス

nost.ingのコードは [MIT](LICENSE)。依存ライブラリと取り込んだコードは各ライセンスに従います。[帰属と依存関係](THIRD_PARTY_NOTICES.md)を参照してください。

### コミット前チェック

`npm ci` / `npm install` でこのリポジトリのpre-commitフックを有効化します。
既存のフック設定は上書きしません。その場合は既存のpre-commitから
`npm run precommit`を呼び出してください。再設定は `npm run hooks:install`。

フックは**ステージした内容だけ**を一時ディレクトリに取り出し、`npm ci` と
`npm run check`（全テスト → 型チェック → ビルド）を実行します。
未追加のCSSや未ステージの修正で検査が偶然通ることを防ぎます。
作業ファイル・ステージ内容は変更せず、失敗時はコミットを止めます。
依存取得とビルドを含むため時間がかかります。npmキャッシュを再利用しますが、
初回やキャッシュ不足時はネットワーク接続が必要です。

- 関連ファイルをまとめてステージしてからコミットしてください。
- 検査だけ実行: `npm run precommit`。作業ツリーの検査: `npm run check`。
- 緊急時のみ `git -c core.hooksPath=/dev/null commit ...` で一回スキップできます（Git Bash/macOS/Linux）。CIは省略されません。
- CI・Git管理外のソース配布では自動設定しません。明示的な設定抑制は `PETAL_SKIP_HOOKS=1 npm ci`。
- GitHubのWeb編集・APIによるコミットではフックは動きません。APIを使う場合も同じステージ内容を検査し、関連ファイルを**一つのtree/commit**で送信してください。ファイルごとの途中状態をpushしないでください。
- フックはCIやブランチ保護の代替ではありません。PRのCI成功を確認してからマージしてください。
