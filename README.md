# シフト管理 MVP

Next.js + Supabase + Vercel を前提にした、希望休入力と月次シフト自動作成のMVPです。

## 機能

- Supabase Auth: メールアドレスとパスワードでログイン
- 権限管理: 管理者ユーザーとスタッフユーザーを分離
- スタッフ画面: 自分の希望休入力、メモ入力、自分の確定シフト閲覧
- 管理者画面: スタッフ管理、スタッフ招待、必要人数設定、希望休一覧、シフト自動作成、手動編集
- 休業日: 土曜日、日曜日、日本の祝日をグレー表示し、作成対象外
- Excel出力: 横軸日付、2行目曜日、縦軸スタッフ名、出勤日は「○」、A4横向き印刷向けxlsx

Supabase未設定時は、ブラウザ内のサンプルデータで動作します。

## ローカル開発

```bash
npm install
npm run dev
```

http://localhost:3000 を開きます。

ローカルでSupabaseに接続する場合は `.env.local` を作成します。`.env.local` は `.gitignore` で除外されています。

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Supabase側の準備

1. Supabaseで新規プロジェクトを作成します。
2. Project Settings > API で以下を確認します。
   - Project URL
   - anon public key
   - service_role key
3. SQL Editorを開きます。
4. リポジトリ内の `supabase-schema.sql` の内容をSQL Editorに貼り付けて実行します。
5. Table Editorで以下のテーブルが作成されていることを確認します。
   - `staff`
   - `time_off_requests`
   - `required_staff`
   - `shift_assignments`
6. Authentication > Users で管理者ユーザーを作成します。
7. 作成した管理者ユーザーのUser UIDを控えます。
8. SQL Editorで管理者ロールを設定します。

```sql
update auth.users
set raw_app_meta_data =
  coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where id = '管理者ユーザーのUser UID';
```

設定後、管理者でログインすると管理者画面が表示されます。スタッフは管理者画面のスタッフ管理から、スタッフ名とメールアドレスを入力して招待します。招待に成功すると、Supabase Authユーザーと `staff.auth_user_id` が自動で紐づきます。

## Vercelデプロイ手順

1. このプロジェクトをGitHubなどのGitリポジトリにpushします。
2. Vercelで `Add New Project` を選択します。
3. 対象リポジトリをImportします。
4. Framework Preset が `Next.js` になっていることを確認します。
5. Environment Variables に以下3つを設定します。

```bash
NEXT_PUBLIC_SUPABASE_URL=SupabaseのProject URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=Supabaseのanon public key
SUPABASE_SERVICE_ROLE_KEY=Supabaseのservice_role key
```

注意:
- `SUPABASE_SERVICE_ROLE_KEY` はサーバーAPIでのみ使用します。
- `SUPABASE_SERVICE_ROLE_KEY` はブラウザに公開しないでください。
- Vercelでは `NEXT_PUBLIC_` が付いていない環境変数はブラウザバンドルに公開されません。
- Production / Preview / Development の必要な環境に同じ3変数を設定してください。

6. `Deploy` を実行します。
7. デプロイ完了後、VercelのFunctionsに `/api/staff/invite` が含まれることを確認します。

## デプロイ後の動作確認チェックリスト

- 未ログイン状態でアクセスするとログイン画面が表示される。
- 管理者ユーザーでログインできる。
- 管理者ログイン後、管理者画面が表示される。
- 管理者画面でスタッフ名とメールアドレスを入力して招待できる。
- 招待したスタッフの `staff.email` と `staff.auth_user_id` がSupabaseで設定されている。
- スタッフユーザーでログインできる。
- スタッフログイン後、スタッフ画面だけが表示される。
- スタッフは自分の希望休だけ登録・編集・削除できる。
- スタッフは自分の確定シフトだけ閲覧できる。
- スタッフで管理者画面に切り替えできない。
- 管理者は全スタッフの希望休一覧を閲覧できる。
- 管理者は必要人数を設定できる。
- 管理者はシフトを自動作成できる。
- 管理者は作成済みシフトを手動編集できる。
- Excel出力でxlsxをダウンロードできる。
- 土日祝がグレー表示され、シフト作成対象外になっている。
- VercelのEnvironment Variablesに以下3つが設定されている。
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- `.env.local` がGitに含まれていない。

## 権限とRLS

`supabase-schema.sql` ではRow Level Securityを有効化しています。

- 管理者: `app_metadata.role = admin` のAuthユーザーのみ、スタッフ、希望休、必要人数、シフトを管理できます。
- スタッフ: `staff.auth_user_id = auth.uid()` に一致する自分のスタッフ行だけ読み取れます。
- スタッフ: 自分に紐づく希望休だけ登録・編集・削除できます。
- スタッフ: 自分に紐づく確定シフトだけ読み取れます。

管理者判定は `user_metadata` ではなく `app_metadata` を使用します。
