# リレー認証（NIP-42）

[NIP-42 原文](https://github.com/nostr-protocol/nips/blob/master/42.md)に基づく、`RelayConnections` 管理下の接続の認証。
ログイン後、リレー画面の既存行に challenge を受信した接続先の「認証」と状態を表示する。
公開一覧に含まれない接続先も同じ一覧内に1行だけ表示し、公開保存の対象には加えない。
ユーザーが選んだ接続先にだけ NIP-07 で署名し、kind 22242 を `AUTH` として送る。
受信や再接続だけでは署名せず、認証許可・challenge・イベントを永続化しない。

- 正確な relay URL / challenge / kind / 時刻 / 空 content / アカウントと署名を検証する。署名ライブラリの検証済みキャッシュは信頼しない。
- 同じ challenge に対する連続署名は行わず、接続ごとの明示署名は最大3回。challenge 更新時は署名中の結果と古い ACK を無効化する。署名・ACK 待ちは15秒まで。
- `auth-required:` で拒否された REQ / EVENT だけを、認証成功後に各1回再送する。`restricted:` は再送しない。認証 OK と投稿 OK を区別する。
- CLOSE / 投稿ジョブ終了・タイムアウト・取消後の再送を禁止する。別リレーの成功は従来どおり直ちに返すため、その時点で未認証のリレーには遅れて投稿しない。
- 接続ごとに購読・送信各128件まで認証用に追跡する。超過分は通常どおり送信されるが認証後の再送対象にはならない。直接送信の保持は最大15秒。
- 認証操作の中止、ダイアログ閉鎖、アカウント変更、切断時は古い署名結果を送らない。再接続は新しい認証状態から始める。署名拡張自体のダイアログを閉じることはできない。

## 対象と制限

ホーム、検索、接続共有のプロフィール・引用等、および `RelayPublisher` が対象。
フォロー中・通知・スレッド・編集前の最新一覧確認など、独自に短命の WebSocket を開く既存ローダーはこの接続の認証状態を共有しない。
それらを認証対象に移すには各ローダーで接続と同意の寿命を設計する必要があり、他 Issue の並行実装は取り込んでいない。
NIP-67 EOSE auth hint、多鍵同時認証、接続をまたぐ認証許可保存は対象外。
リレーが新しい challenge を出さない場合、署名拒否・タイムアウト後の再認証には新しい接続が必要。
購読元に固有の期限がある場合、その期限内の認証だけが再購読対象になる。

## 検証

`node tests/relay-auth.test.mjs` と `node tests/relay-connections.test.mjs` はネットワークを使わず一時テスト鍵とモックで実行する。
全体確認は `npm test` / `npm run typecheck` / `npm run build` / `npm run lint`。
ブラウザ検証は `tests/browser/relay-auth.html` を Vite（React plugin、`@` alias はリポジトリルート、127.0.0.1:4174）で配信し、`python tests/browser/relay-auth.py` を実行する。
全画面を一時鍵・モック WebSocket で動かし、外部 HTTP / ネイティブ WebSocket は遮断する。
スクリーンショットは `/tmp/nosting-issue19-{1280,390}-{before,authenticated}.png` に出力し、コミットしない。
