# 納品スケジューラー

営業チーム向け 納品スケジュール管理システム。  
**完全無料構成：Render.com（無料 Web Service） + Supabase（無料 PostgreSQL）**

---

## 機能

| 役割 | できること |
|------|-----------|
| 営業 | 案件登録・候補日（最大3件）の登録・自分の案件一覧 |
| 管理者 | 全案件閲覧・候補日から確定・ステータス変更・削除 |

ステータスフロー：`承認待ち → 日程確定 → 納品済み`

---

## 無料構成の根拠

| サービス | 役割 | 無料枠 |
|---------|------|--------|
| **Render.com**（Free Web Service） | Node.js サーバー + React 配信 | 750時間/月（1サービスなら実質無制限） |
| **Supabase**（Free Tier） | PostgreSQL データベース | 500MB・無期限（アクティブな限り） |

> ⚠️ Render.com 無料枠は15分間アクセスなしでスリープします（次のリクエストで30秒で復帰）。
> ⚠️ Supabase 無料DBは1週間アクセスがないと一時停止しますが、アクセスで復帰します。

---

## デプロイ手順

### Step 1：Supabase でDBを作成

1. https://supabase.com にアクセス → **Start for free** でアカウント作成
2. **New Project** をクリック
3. 任意の名前（例: `delivery-scheduler`）と DB パスワードを設定して作成（2〜3分かかります）
4. 作成後、左メニュー → **Project Settings → Database** を開く
5. **Connection string** → **URI** タブを選択
6. 表示されている接続URL（`postgresql://postgres:...`）をコピー

### Step 2：GitHub にリポジトリを作成

```bash
cd delivery-scheduler
git init
git add .
git commit -m "initial commit"
# GitHubに新しいリポジトリを作ってpush
git remote add origin https://github.com/あなたのID/delivery-scheduler.git
git push -u origin main
```

### Step 3：Render.com にデプロイ

1. https://render.com にアクセス → **Start for Free** でアカウント作成（無料・クレカ不要）
2. **New → Web Service** を選択
3. GitHubアカウントを接続して、作成したリポジトリを選択
4. 以下を設定：

| 項目 | 値 |
|------|----|
| **Name** | delivery-scheduler（任意） |
| **Environment** | Node |
| **Build Command** | `npm run install:all && npm run build` |
| **Start Command** | `npm start` |
| **Instance Type** | **Free** |

5. **Environment Variables** に以下を追加：

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase でコピーした接続URL（`postgresql://postgres:パスワード@...`） |

6. **Create Web Service** をクリック → 自動でビルド・デプロイが始まります（3〜5分）

7. デプロイ完了後、表示されたURL（`https://delivery-scheduler-xxxx.onrender.com`）にアクセス！

---

## ローカル開発

```bash
# .env ファイルを作成
echo "DATABASE_URL=postgresql://postgres:パスワード@db.xxx.supabase.co:5432/postgres" > .env

npm run install:all

# サーバーとReactを同時起動
npm run dev
```

ブラウザ: http://localhost:5173

---

## 初期アカウント（初回起動時に自動作成）

| ユーザー名 | パスワード | 役割 |
|-----------|-----------|------|
| 管理者 | admin123 | 管理者 |
| 営業 山田 | sales123 | 営業 |
| 営業 田中 | sales456 | 営業 |

> **本番運用前にパスワード変更を推奨。**  
> Supabase のダッシュボード → Table Editor → `users` テーブルで直接編集できます。

---

## 技術スタック

- **フロント**: React 18 + Vite（スマホ対応レスポンシブ）
- **バックエンド**: Node.js + Express
- **DB**: PostgreSQL（Supabase 無料枠）— Diskなし、完全無料
- **ホスティング**: Render.com 無料 Web Service
