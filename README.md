# 就活選考管理

エントリー〜内定までの選考状況を1画面で管理するPWA。

- ビルド不要の単一HTML(React CDN + htm)
- データ同期: Supabase (`shukatsu_items` テーブル / anonキー・ログインなし)
- ローカル確認: `powershell -ExecutionPolicy Bypass -File serve.ps1` → http://localhost:5506

## 経緯 (2026-09-10)

旧構成は別のSupabaseプロジェクト(`wkcgoszprjppovzgvefe`)とGoogleログインを使っていたが、
そのプロジェクトが削除されておりアプリが使用不能になっていた。

- 接続先を稼働中のSupabaseプロジェクトに移設し、テーブルを `shukatsu_items` として作り直した
- Googleログインは廃止し、他の自作アプリと同じ「anonキー + 固定ユーザーID」構成に統一
- 端末のChromeに残っていた選考データ121件をSupabaseへ復旧
- 画像48枚は旧プロジェクトのStorageごと消失したため復旧不可(参照は除去済み)
- クラウドが空のときに端末のデータを消さない安全弁を同期処理に追加
