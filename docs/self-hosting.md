# 自己ホスト

PetalはCloudflare Workers上で動作するVinextアプリです。画像アップロードには自分のD1データベースとR2バケットが必要です。**このリポジトリには運営中のPetalの認証情報・保存画像・DBは含まれません。**

## ローカル実行

```sh
npm ci
npm run build
npx wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_good_spirit.sql
npx wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_loving_anthem.sql
npm start
```

SQLは新規DBに順番に適用します。同じDBで二重実行しないでください。

`npm run dev`は開発サーバー、`npm start`はビルド済みWorkerのローカル実行です。`.wrangler/`はローカルデータを含むため公開しないでください。通常のNostrリレーへの接続や外部メディアの取得は実際に行われます。

## 自分のCloudflareアカウントへ配置

CloudflareアカウントでWorkers・D1・R2の利用条件と課金設定を確認してから実行してください。以下は実リソースの作成と公開を伴います。

```sh
npx wrangler login
npx wrangler d1 create petal
npx wrangler r2 bucket create YOUR-UNIQUE-BUCKET
npm run build
node scripts/prepare-self-host.mjs YOUR-D1-DATABASE-UUID YOUR-UNIQUE-BUCKET petal
```

`YOUR-D1-DATABASE-UUID`を作成時に表示されるIDへ、バケット名を自分の名前へ置き換えます。スクリプトはビルド出力のWrangler設定を基に、`DB`と`BUCKET`を設定した `wrangler.self-host.json` を作ります。このファイルはGit管理対象外です。既存ファイルは上書きしません。

設定を確認してから実行します。

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.self-host.json
npx wrangler deploy --config wrangler.self-host.json
```

公開URLはWranglerが表示します。別のホスト名へ変更するとNIP-98署名の対象URLも変わるため、アップロードを再確認してください。依存更新で生成設定が変わった場合は自己ホスト設定も再生成・比較します。

## 運用上の注意

- アップロードはNIP-98署名で検証。PNG/JPEG/WebP、1リクエスト30,000,000バイトまでです。
- 画像は公開URLで配信されます。非公開ファイル置き場ではありません。
- アプリ独自の総容量・日次アップロード制限は設けていません。R2/D1の利用量・課金を監視し、必要なら運営者側で制限を設けてください。
- URLを知る人が閲覧できる画像の削除・通報対応、バックアップ、濫用対策は運営者の責任です。
- リレーへ公開した投稿は、このサーバーのデータ削除だけでは消えません。
- サーバーAPIにCloudflareトークンやNostr秘密鍵を入れる必要はありません。Cloudflareデプロイ資格情報はWrangler/CIの秘密管理で扱います。

## Sitesで使う場合

`.openai/hosting.json`には汎用のD1/R2バインディングだけが入っています。新しいSiteを作成し、自分のSite IDを設定してください。稼働中PetalのIDをコピーしないでください。補助ツールの詳細は [スターター資料](sites-starter.md) にあります。
