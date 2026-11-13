# Petal

Material 3 Expressive の Nostr Web クライアント。

**[使ってみる](https://petal-nostr-aomona.aomona.chatgpt.site)**

## 機能

- タイムライン、プロフィール、フォロー、返信スレッド、引用、通知
- リレーごとの読み取り・書き込み設定、再接続、検索対応リレーでの検索
- 画像・動画の表示、カスタム絵文字、Markdown、センシティブメディア表示
- 画像アップロード（PNG / JPEG / WebP、1回30 MBまで）
- NIP-07署名拡張によるログイン、Zap、共有、ローカル下書き・ミュート
- ダークモードとモバイル対応

開発中のソフトウェアです。リレーの対応状況により検索や取得できる情報は異なります。秘密鍵をPetalへ入力する方式ではなく、署名拡張を使います。

## 開発

Node.js 22.13以上とnpmを用意してください。

```sh
npm ci
npm run dev
```

表示されたローカルURLを開きます。読むだけなら署名拡張は不要です。ログインや投稿にはNIP-07対応のブラウザ拡張が必要です。ローカルでも通常のリレーにつながるため、実際の投稿・フォロー変更は公開ネットワークへ送信されます。テスト投稿を大量に送らないでください。

```sh
npm test
npm run typecheck
npm run build
npm start
```

テストは順番に実行します。ネットワーク動作を模擬するテストとソース検査を含み、全NIPへの完全適合や全ブラウザでの動作を保証するものではありません。

画像アップロードにはD1のテーブルが必要です。[自己ホスト手順](docs/self-hosting.md)に従ってローカルマイグレーションを適用してください。

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

Petalのコードは [MIT](LICENSE)。依存ライブラリと取り込んだコードは各ライセンスに従います。[帰属と依存関係](THIRD_PARTY_NOTICES.md)を参照してください。
